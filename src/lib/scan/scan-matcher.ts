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
const MAX_NEURAL_CANDIDATES = 6;
/** Low-res hashes are noise, so CLIP more of the OCR/live-search shortlist. */
const MAX_NEURAL_CANDIDATES_LOW_RES = 16;
/** Parallel CLIP embeds against catalog art (bounded for device memory). */
const NEURAL_CONCURRENCY = 3;
const CARD_IMAGE_TIMEOUT_MS = 6_000;
const CANDIDATE_EMBED_TIMEOUT_MS = 8_000;

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
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    const timeoutId = window.setTimeout(() => finish(null), CARD_IMAGE_TIMEOUT_MS);
    img.crossOrigin = "anonymous";
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

async function withFallbackTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
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
    vector =
      (await withFallbackTimeout(
        embedImage(proxied),
        null,
        CANDIDATE_EMBED_TIMEOUT_MS,
      )) ?? undefined;
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
  options: {
    neural: boolean;
    onProgress?: (done: number, total: number) => void;
    /** Pixelated photos: ignore dHash order and CLIP more of the text shortlist. */
    hashUnreliable?: boolean;
  },
): Promise<ScanMatch[]> {
  const { neural, onProgress, hashUnreliable } = options;
  const matches: ScanMatch[] = [];

  if (hashUnreliable) {
    const neuralCount = Math.min(MAX_NEURAL_CANDIDATES_LOW_RES, candidates.length);
    if (neural && photo.vector) {
      let neuralDone = 0;
      for (let start = 0; start < neuralCount; start += NEURAL_CONCURRENCY) {
        const batch = candidates.slice(
          start,
          Math.min(start + NEURAL_CONCURRENCY, neuralCount),
        );
        const batchMatches = await Promise.all(
          batch.map(async (result) => {
            const signature = await ensureCardSignature(result.card, true);
            neuralDone += 1;
            onProgress?.(neuralDone, neuralCount);
            const score =
              signature.vector && photo.vector
                ? cosineSimilarity(photo.vector, signature.vector)
                : Math.max(0.62, result.score);
            return {
              result,
              visualScore: score,
              method: signature.vector ? "neural" : "none",
            } satisfies ScanMatch;
          }),
        );
        matches.push(...batchMatches);
      }
      for (const result of candidates.slice(neuralCount)) {
        matches.push({
          result,
          visualScore: Math.max(0.55, result.score),
          method: "none",
        });
      }
      return sortMatches(matches);
    }
    return candidates.map((result, index) => ({
      result,
      visualScore: Math.max(0.62, result.score) - index * 0.002,
      method: "none" as const,
    }));
  }

  // Cheap pass: load in parallel so one unreachable art URL cannot serialize
  // six-second timeouts across the entire candidate list.
  let hashDone = 0;
  const hashMatches = await Promise.all(
    candidates.map(async (result) => {
      const signature = await ensureCardSignature(result.card, false);
      const cardHash = signature.hash ? BigInt(signature.hash) : 0n;
      hashDone += 1;
      onProgress?.(hashDone, candidates.length);
      return {
        result,
        visualScore: hashSimilarity(photo.hash, cardHash),
        method: signature.hash ? "phash" : "none",
      } satisfies ScanMatch;
    }),
  );
  matches.push(...hashMatches);

  if (!neural || !photo.vector) {
    return sortMatches(matches);
  }

  // Accurate pass: neural embeddings for the most promising candidates.
  const ranked = sortMatches(matches);
  const neuralCount = Math.min(MAX_NEURAL_CANDIDATES, ranked.length);
  let neuralDone = 0;
  for (let start = 0; start < neuralCount; start += NEURAL_CONCURRENCY) {
    const batch = ranked.slice(start, Math.min(start + NEURAL_CONCURRENCY, neuralCount));
    await Promise.all(
      batch.map(async (match) => {
        const signature = await ensureCardSignature(match.result.card, true);
        if (signature.vector && photo.vector) {
          match.visualScore = cosineSimilarity(photo.vector, signature.vector);
          match.method = "neural";
        }
        neuralDone += 1;
        onProgress?.(candidates.length + neuralDone, candidates.length + neuralCount);
      }),
    );
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
