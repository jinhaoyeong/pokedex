import { NextResponse } from "next/server";

import { lookupCardsInIndexByCardIds } from "@/lib/pokemon-cards-index.server";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import {
  isEmbeddingIndexReady,
  isVisualIndexReady,
  searchByEmbedding,
  searchByHash,
  searchByHashes,
  visualIndexSize,
} from "@/lib/scan/visual-index.server";
import {
  DHASH_WORK_HEIGHT,
  DHASH_WORK_WIDTH,
  dHashFromWorkGray,
} from "@/lib/scan/dhash-core";
import { localVisualIndexPath } from "@/lib/scan/visual-index-local.server";
import type { VisualIndexHit } from "@/lib/scan/types";
import type { CardLanguageCode, SearchResult, TcgCard } from "@/types/pokemon";

export const runtime = "nodejs";

/** Hydrate card rows for any hit the client can show immediately. */
const DIRECT_MATCH_THRESHOLD = 0.62;
const DIRECT_MATCH_TIMEOUT_MS = 400;

function parseHashString(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

function hashFromWorkGray(workGray: unknown): bigint | null {
  if (!Array.isArray(workGray) || workGray.length !== DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT) {
    return null;
  }
  if (!workGray.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  const hash = dHashFromWorkGray(workGray);
  return hash === 0n ? null : hash;
}

function collectQueryHashes(body: VisualSearchBody): bigint[] {
  const values: string[] = [];
  if (Array.isArray(body.hashes)) {
    for (const value of body.hashes) {
      if (typeof value === "string") values.push(value);
    }
  }
  if (typeof body.hash === "string") {
    values.push(body.hash);
  }

  const hashes: bigint[] = [];
  const seen = new Set<string>();
  const push = (parsed: bigint) => {
    const key = parsed.toString();
    if (seen.has(key) || hashes.length >= 6) return;
    seen.add(key);
    hashes.push(parsed);
  };

  for (const value of values) {
    const parsed = parseHashString(value);
    if (parsed != null && parsed !== 0n) push(parsed);
  }

  // Tiny grayscale fingerprint (72×64). Server box-filters to 9×8 with the
  // same dHash packing as the seed script — more stable than browser 9×8 draw.
  const fromFingerprint = hashFromWorkGray(body.workGray);
  if (fromFingerprint) push(fromFingerprint);

  return hashes;
}

/** Capability probe — which matchers are populated. */
export async function GET() {
  const size = await visualIndexSize();
  const neural = await isEmbeddingIndexReady();
  return NextResponse.json({
    ready: size > 0,
    neural,
    size,
    localPath: localVisualIndexPath(),
  });
}

interface VisualSearchBody {
  hash?: string;
  /** Optional inset-crop / alternate hashes; server keeps the best hit. */
  hashes?: string[];
  /**
   * Optional 72×64 Rec.601 luminance fingerprint (4608 numbers, 0–255).
   * Never a full photo — just enough for a stable server-side dHash.
   */
  workGray?: number[];
  embedding?: number[];
  limit?: number;
}

function isCardLanguageCode(value: string): value is CardLanguageCode {
  return value in LANGUAGE_LABELS;
}

/** Build a catalog-shaped card from a visual hit when Postgres identity lookup is empty. */
function cardFromVisualHit(hit: VisualIndexHit): TcgCard {
  const language = isCardLanguageCode(hit.lang) ? hit.lang : "en";
  const slug = language === "en" ? hit.id : `${language}--${hit.id}`;
  const setCode = hit.id.includes("-") ? hit.id.split("-")[0]?.toUpperCase() ?? "" : "";

  return {
    id: hit.id,
    slug,
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? language,
    name: hit.name,
    englishName: hit.name,
    collectorNumber: hit.localId || "?",
    rarity: "Unknown",
    supertype: "Pokemon",
    hp: "-",
    types: [],
    setId: setCode.toLowerCase(),
    setCode,
    setName: hit.setName || setCode || "Unknown set",
    image: hit.image,
    artist: "Unknown",
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Scan visual match",
      fetchedAt: null,
      note: "Identity matched visually. Open the card for live market and population data.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [],
    gradedPrices: [],
    recentSales: [],
    sources: [
      {
        source: "Scan visual index",
        status: "estimated",
        fetchedAt: new Date().toISOString(),
        confidence: 0.7,
        note: "Identity resolved from the local/server visual catalog match.",
      },
    ],
  };
}

async function resolveDirectMatches(
  hits: VisualIndexHit[],
): Promise<SearchResult[]> {
  const strongHits = hits.filter((hit) => hit.score >= DIRECT_MATCH_THRESHOLD);
  if (!strongHits.length) {
    return [];
  }

  // Always have instant hit→card rows. Enrich from Postgres when it answers
  // quickly; never block the scan on a slow/unavailable catalog DB.
  const fallbackById = new Map(
    strongHits.map((hit) => [hit.id, cardFromVisualHit(hit)] as const),
  );

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
    const card = cardById.get(hit.id) ?? fallbackById.get(hit.id);
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
 * perceptual hash. The full photo stays on-device — only a hash, embedding, or
 * tiny 72×64 luminance fingerprint is sent.
 */
export async function POST(request: Request) {
  let body: VisualSearchBody;
  try {
    body = (await request.json()) as VisualSearchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const limit = Math.min(40, Math.max(1, Number(body.limit) || 24));
  const queryHashes = collectQueryHashes(body);

  const size = await visualIndexSize();
  const ready = size > 0 || (await isVisualIndexReady());
  if (!ready) {
    console.warn(
      "[visual-search] Visual index is empty (no remote card_visuals and no local scan-visual-index.sqlite). Every visual lookup will return 0 hits until it is seeded.",
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
      console.log("Vector search returned 0 matches. Falling back to hash matching.");
    }
    const directMatches = await resolveDirectMatches(hits);
    if (hits.length || !queryHashes.length) {
      return NextResponse.json(
        {
          ready,
          size,
          method: "neural",
          hits,
          directMatches,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // Perceptual-hash fallback (supports multiple inset-crop hashes).
  if (!queryHashes.length) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  const hits =
    queryHashes.length === 1
      ? await searchByHash(queryHashes[0], limit)
      : await searchByHashes(queryHashes, limit);
  if (!hits.length) {
    console.log(
      "[visual-search] Perceptual-hash search returned 0 matches. Client falls back to OCR text matching.",
    );
  }
  const directMatches = await resolveDirectMatches(hits);
  return NextResponse.json(
    { ready, size, method: "phash", hits, directMatches },
    { headers: { "Cache-Control": "no-store" } },
  );
}
