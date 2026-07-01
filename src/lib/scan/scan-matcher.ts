/**
 * Client-side visual matcher. Given a scanned photo's signature and the
 * candidate cards returned by OCR-driven search, re-rank the candidates by how
 * closely their official art matches the photo.
 *
 * Layered + zero-cost:
 *  - perceptual hash (dHash) for every candidate — cheap, always available
 *  - CLIP embedding cosine similarity for the strongest candidates — accurate,
 *    bounded for speed, cached per card so repeat scans are instant
 */

import {
  cosineSimilarity,
  embedImage,
  type ModelProgress,
} from "@/lib/scan/embedding";
import {
  getCardSignature,
  putCardSignature,
  type CardSignature,
} from "@/lib/scan/embedding-store";
import { dHash, hashSimilarity } from "@/lib/scan/phash";
import type { ScanMatch } from "@/lib/scan/types";
import type { SearchResult, TcgCard } from "@/types/pokemon";

/** Max candidates to run through the (heavier) neural encoder per scan. */
const MAX_NEURAL_CANDIDATES = 8;

export interface PhotoSignature {
  hash: bigint;
  vector: Float32Array | null;
}

/** Route a catalog image URL through the same-origin proxy (canvas-safe). */
export function proxiedImageUrl(url: string): string {
  if (url.startsWith("data:") || url.startsWith("/")) {
    return url;
  }
  return `/api/card-image?url=${encodeURIComponent(url)}`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Build the photo's signature: a dHash plus (optionally) a CLIP embedding. */
export async function buildPhotoSignature(
  photo: HTMLImageElement | HTMLCanvasElement,
  dataUrl: string,
  neural: boolean,
  onModelProgress?: (progress: ModelProgress) => void,
): Promise<PhotoSignature> {
  const hash = dHash(photo);
  const vector = neural ? await embedImage(dataUrl, onModelProgress) : null;
  return { hash, vector };
}

/**
 * Resolve a card's art signature, using the IndexedDB cache when possible and
 * computing (then caching) whatever is missing.
 */
async function ensureCardSignature(
  card: TcgCard,
  wantNeural: boolean,
): Promise<CardSignature> {
  const cached = (await getCardSignature(card.id)) ?? {};
  let hash = cached.hash;
  let vector = cached.vector;

  const needHash = !hash;
  const needVector = wantNeural && !vector;
  if (!needHash && !needVector) {
    return cached;
  }

  const proxied = proxiedImageUrl(card.image);

  if (needHash) {
    const img = await loadImage(proxied);
    if (img) {
      hash = dHash(img).toString();
    }
  }

  if (needVector) {
    vector = (await embedImage(proxied)) ?? undefined;
  }

  const next: CardSignature = { hash, vector };
  if (hash || vector) {
    await putCardSignature(card.id, next);
  }
  return next;
}

/**
 * Re-rank candidate search results by visual similarity to the scanned photo.
 * Results keep their original order as a tie-breaker so a confident text match
 * is never demoted purely by a noisy hash.
 */
export async function rankByVisualSimilarity(
  photo: PhotoSignature,
  candidates: SearchResult[],
  options: { neural: boolean; onProgress?: (done: number, total: number) => void },
): Promise<ScanMatch[]> {
  const { neural, onProgress } = options;
  const matches: ScanMatch[] = [];

  // Cheap pass: perceptual hash for every candidate.
  for (let i = 0; i < candidates.length; i += 1) {
    const result = candidates[i];
    const signature = await ensureCardSignature(result.card, false);
    const cardHash = signature.hash ? BigInt(signature.hash) : 0n;
    matches.push({
      result,
      visualScore: hashSimilarity(photo.hash, cardHash),
      method: signature.hash ? "phash" : "none",
    });
    onProgress?.(i + 1, candidates.length);
  }

  if (!neural || !photo.vector) {
    return sortMatches(matches);
  }

  // Accurate pass: neural embeddings for the most promising candidates.
  const ranked = sortMatches(matches);
  const neuralCount = Math.min(MAX_NEURAL_CANDIDATES, ranked.length);
  for (let i = 0; i < neuralCount; i += 1) {
    const match = ranked[i];
    const signature = await ensureCardSignature(match.result.card, true);
    if (signature.vector && photo.vector) {
      match.visualScore = cosineSimilarity(photo.vector, signature.vector);
      match.method = "neural";
    }
    onProgress?.(candidates.length + i + 1, candidates.length + neuralCount);
  }

  return sortMatches(ranked);
}

function sortMatches(matches: ScanMatch[]): ScanMatch[] {
  return [...matches].sort((a, b) => {
    if (b.visualScore !== a.visualScore) {
      return b.visualScore - a.visualScore;
    }
    return b.result.score - a.result.score;
  });
}
