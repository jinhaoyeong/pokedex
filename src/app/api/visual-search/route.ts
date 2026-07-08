import { NextResponse } from "next/server";

import { lookupCardsInIndexByCardIds } from "@/lib/pokemon-cards-index.server";
import {
  isEmbeddingIndexReady,
  isVisualIndexReady,
  searchByEmbedding,
  searchByHash,
  visualIndexSize,
} from "@/lib/scan/visual-index.server";
import type { VisualIndexHit } from "@/lib/scan/types";
import type { SearchResult } from "@/types/pokemon";

export const runtime = "nodejs";

const DIRECT_MATCH_THRESHOLD = 0.8;
const DIRECT_MATCH_TIMEOUT_MS = 1_500;

/** Capability probe — which matchers are populated. */
export async function GET() {
  return NextResponse.json({
    ready: await isVisualIndexReady(),
    neural: await isEmbeddingIndexReady(),
    size: await visualIndexSize(),
  });
}

interface VisualSearchBody {
  hash?: string;
  embedding?: number[];
  limit?: number;
}

async function resolveDirectMatches(
  hits: VisualIndexHit[],
): Promise<SearchResult[]> {
  const strongHits = hits.filter((hit) => hit.score >= DIRECT_MATCH_THRESHOLD);
  if (!strongHits.length) {
    return [];
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const cards = await Promise.race([
    lookupCardsInIndexByCardIds(
      strongHits.map((hit) => ({ id: hit.id, language: hit.lang })),
    ),
    new Promise<Awaited<ReturnType<typeof lookupCardsInIndexByCardIds>>>((resolve) => {
      timeout = setTimeout(() => resolve([]), DIRECT_MATCH_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const matches: SearchResult[] = [];
  const seen = new Set<string>();

  for (const hit of strongHits) {
    const card = cardById.get(hit.id);
    if (!card || seen.has(card.slug)) {
      continue;
    }
    seen.add(card.slug);
    matches.push({
      card,
      score: hit.score,
      matchReason: "Direct visual match",
    });
  }

  return matches;
}

/**
 * Match a scanned photo against the catalog visual index. Prefers the CLIP
 * embedding (robust to foil/lighting) when provided, falling back to the
 * perceptual hash. Either way the photo never leaves the device — only a hash
 * or an embedding vector is sent.
 */
export async function POST(request: Request) {
  let body: VisualSearchBody;
  try {
    body = (await request.json()) as VisualSearchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const limit = Math.min(40, Math.max(1, Number(body.limit) || 24));

  const ready = await isVisualIndexReady();
  if (!ready) {
    console.warn(
      "[visual-search] card_visuals is empty — the visual index was never seeded (run scripts/seed-scan-index.mjs). Every visual lookup will return 0 hits until it is.",
    );
  }

  // Embedding match (preferred).
  if (
    Array.isArray(body.embedding) &&
    body.embedding.length >= 128 &&
    body.embedding.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    const hits = await searchByEmbedding(body.embedding, limit);
    if (!hits.length) {
      console.log("Vector search returned 0 matches. Falling back to text matching.");
    }
    const directMatches = await resolveDirectMatches(hits);
    if (hits.length || !body.hash) {
      return NextResponse.json(
        {
          ready,
          method: "neural",
          hits,
          directMatches,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // Perceptual-hash fallback.
  const rawHash = typeof body.hash === "string" ? body.hash.trim() : "";
  if (!/^\d+$/.test(rawHash)) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  let hash: bigint;
  try {
    hash = BigInt(rawHash);
  } catch {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  const hits = await searchByHash(hash, limit);
  if (!hits.length) {
    console.log(
      "[visual-search] Perceptual-hash search returned 0 matches. Client falls back to OCR text matching.",
    );
  }
  const directMatches = await resolveDirectMatches(hits);
  return NextResponse.json(
    { ready, method: "phash", hits, directMatches },
    { headers: { "Cache-Control": "no-store" } },
  );
}
