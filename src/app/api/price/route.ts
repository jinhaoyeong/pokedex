import { NextResponse } from "next/server";

import { fetchPriceChartingMarketPrice } from "@/lib/market/pricecharting-provider";
import {
  findOfficialJapaneseBrowseSeedByCardId,
  findOfficialJapaneseBrowseSeedBySetIndex,
  type OfficialJapaneseBrowseSeedMatch,
} from "@/lib/official-japanese-browse.server";
import {
  buildOfficialJapaneseDetailFromBrowseItem,
  fetchOfficialJapaneseCardDetail,
  resolveOfficialJapaneseEnglishName,
} from "@/lib/pokemon-tcg/official-japanese-catalog";
import {
  readCardIdentityMapping,
  writeCardIdentityMapping,
} from "@/lib/price/identity-cache.server";
import { resolvePrice } from "@/lib/price/resolve.server";
import { sanitizeResolvedPrice } from "@/lib/price/sanity";
import type { PriceQuery, ResolvedPrice } from "@/lib/price/types";
import { readCachedResponse, writeCachedResponse } from "@/lib/server-response-cache";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Priced answers are safe to hold at the CDN edge for an hour and serve stale
// for a day while revalidating; unpriced/error answers stay no-store so a
// transient provider outage is never frozen at the edge.
const EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const MEMORY_TTL_MS = 5 * 60_000;

function memoryCacheKey(params: URLSearchParams) {
  const entries = [...params.entries()]
    .filter(([key]) => key !== "refresh")
    .sort(([left], [right]) => left.localeCompare(right));
  return `price:${new URLSearchParams(entries).toString()}`;
}

function normalizeProviderCardId(cardId?: string) {
  const clean = cardId?.trim();

  if (!clean) {
    return undefined;
  }

  if (clean.startsWith("official-")) {
    const officialId = clean.replace(/^official-/, "");
    return /^\d+$/.test(officialId) ? undefined : officialId;
  }

  return clean;
}

function extractParentheticalEnglish(value?: string | null) {
  const match = value?.match(/\(([^()]*[A-Za-z][^()]*)\)\s*$/);
  return match?.[1]?.trim() || undefined;
}

function extractOfficialJapaneseId(value?: string | null) {
  const clean = value?.trim();

  if (!clean) {
    return undefined;
  }

  const slugMatch = clean.match(/^ja--official-(\d+)$/i);

  if (slugMatch?.[1]) {
    return slugMatch[1];
  }

  const cardIdMatch = clean.match(/^official-(\d+)$/i);

  if (cardIdMatch?.[1]) {
    return cardIdMatch[1];
  }

  return undefined;
}

async function hydrateOfficialJapanesePriceQuery(
  query: PriceQuery,
  raw: { cardId?: string | null; number?: string | null },
): Promise<PriceQuery> {
  if (query.language !== "ja") {
    return query;
  }

  const officialId =
    extractOfficialJapaneseId(raw.cardId) ?? extractOfficialJapaneseId(query.slug);

  // Official-catalog list rows often carry a browse-index "number" (list position),
  // not the printed collector number. Always resolve the printed number for
  // official-* ids — even when englishName + number are already present — or
  // PriceCharting matches the wrong print (e.g. Cinccino #95 index → $1.72
  // instead of printed #117 → $42).
  if (
    !officialId &&
    query.englishName?.trim() &&
    query.collectorNumber?.trim() &&
    query.setCode?.trim()
  ) {
    return query;
  }
  let seedMatch: OfficialJapaneseBrowseSeedMatch | null = officialId
    ? findOfficialJapaneseBrowseSeedByCardId(officialId)
    : null;

  // Search-list fallbacks can pass `official-173`/`number=173`, where 173 is
  // the browse index, not the printed collector number. Resolve that index to
  // the real official cardID before constructing PriceCharting queries.
  if (!seedMatch) {
    seedMatch = findOfficialJapaneseBrowseSeedBySetIndex(query.setCode, raw.number ?? undefined);
  }

  const mappingKey = officialId || (seedMatch ? String(seedMatch.item.cardID) : "");
  if (mappingKey) {
    const mapping = await readCardIdentityMapping(mappingKey);

    if (mapping?.printedCollectorNumber) {
      return {
        ...query,
        cardId: undefined,
        collectorNumber: mapping.printedCollectorNumber,
        englishName:
          query.englishName?.trim() ||
          mapping.englishName ||
          extractParentheticalEnglish(query.name),
        setCode: mapping.setCode || query.setCode,
      };
    }
  }

  if (!seedMatch && !officialId) {
    return query;
  }

  const browseDetail = seedMatch
    ? buildOfficialJapaneseDetailFromBrowseItem(
        seedMatch.item,
        seedMatch.setIndex,
        seedMatch.setCode,
        seedMatch.hitCnt,
      )
    : null;
  // Never fall back to browse-index collector numbers — those are list positions
  // and poison PriceCharting matches (Cinccino index 95 ≠ printed 117).
  const officialDetail = await fetchOfficialJapaneseCardDetail(
    seedMatch?.item.cardID ?? officialId!,
    seedMatch?.item,
  ).catch(() => null);

  if (!officialDetail?.collectorNumber?.trim()) {
    return {
      ...query,
      englishName:
        query.englishName?.trim() ||
        (browseDetail
          ? await resolveOfficialJapaneseEnglishName(browseDetail).catch(() => undefined)
          : undefined) ||
        extractParentheticalEnglish(query.name),
      setCode: browseDetail?.setCode?.trim() || query.setCode,
    };
  }

  const collectorNumber =
    officialDetail.collectorNumber.trim().replace(/^0+(?=\d)/, "") ||
    officialDetail.collectorNumber.trim();
  const englishName =
    query.englishName?.trim() ||
    (await resolveOfficialJapaneseEnglishName(officialDetail)) ||
    extractParentheticalEnglish(query.name);
  const resolvedSetCode = officialDetail.setCode?.trim() || browseDetail?.setCode || null;

  if (mappingKey) {
    void writeCardIdentityMapping({
      officialCardId: mappingKey,
      printedCollectorNumber: collectorNumber,
      setCode: resolvedSetCode,
      englishName: (await resolveOfficialJapaneseEnglishName(officialDetail)) || null,
      priceChartingSlug: null,
    });
  }

  return {
    ...query,
    cardId: undefined,
    collectorNumber,
    englishName,
    setCode: resolvedSetCode || query.setCode,
  };
}

async function applyJapaneseGuideFallback(
  query: PriceQuery,
  resolved: ResolvedPrice,
): Promise<ResolvedPrice> {
  if (resolved.ungradedUsd > 0 || query.language !== "ja") {
    return resolved;
  }

  // Avoid re-entering resolvePrice (another 15s localized budget). Hit the
  // public PriceCharting guide page directly — same source grading-market uses
  // successfully for official JP sets like CP2.
  const guide = await fetchPriceChartingMarketPrice({
    language: query.language,
    name: query.name,
    englishName: query.englishName,
    setName: query.setName,
    setEnglishName: query.setEnglishName,
    setCode: query.setCode,
    collectorNumber: query.collectorNumber,
    rarity: query.rarity,
  }).catch((error) => {
    console.warn("japanese guide fallback failed", {
      slug: query.slug,
      setCode: query.setCode,
      collectorNumber: query.collectorNumber,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  });

  if (!guide?.ungradedUsd) {
    return resolved;
  }

  return {
    ...resolved,
    ungradedUsd: guide.ungradedUsd,
    confidenceScore: Math.max(resolved.confidenceScore, guide.confidenceScore),
    primaryProvider: "pricecharting-api",
    results: [
      ...resolved.results,
      {
        provider: "pricecharting-api",
        sourceLabel: guide.sourceLabel,
        ungradedUsd: guide.ungradedUsd,
        confidenceScore: guide.confidenceScore,
        matchConfidence: guide.matchConfidence,
        evidenceType: guide.evidenceType,
        gradedPrices: guide.gradedPrices,
        sourceUrl: guide.sourceUrl,
        sampleCount: 1,
        fetchedAt: new Date().toISOString(),
      },
    ],
  };
}

/**
 * The UI's price hooks read the headline through several historical aliases
 * (`ungradedUsd`, `marketPrice`, `prices.market` — see getPriceLookupUsd in
 * price-query.ts). Answer with ALL of them so no consumer is ever stuck on
 * "Price Pending" because it reads a key this route didn't populate.
 */
function withFrontendAliases(priced: ResolvedPrice) {
  const market = priced.ungradedUsd > 0 ? priced.ungradedUsd : null;
  const psa10 =
    priced.results
      .flatMap((result) => result.gradedPrices ?? [])
      .find((graded) => /psa\s*10/i.test(graded.grade))?.value ?? null;

  return {
    ...priced,
    marketPrice: market,
    psa10,
    prices: { market, ungraded: market, raw: market, psa10 },
  };
}

/**
 * Block-resistant price lookup. Reads the local price cache first and, on a miss,
 * queries only the NON-BLOCKING API providers (never a scrape). Safe to call from
 * the list/detail UI without ever triggering an IP block.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug")?.trim();
  const name = params.get("name")?.trim();

  if (!slug || !name) {
    return NextResponse.json({ error: "slug and name are required" }, { status: 400 });
  }

  // The background warmer forces a fresh, scrape-allowed resolve via an internal
  // token. Public callers always get the fast cache-first, non-blocking path.
  const internalToken = process.env.INTERNAL_REFRESH_TOKEN;
  const isWarm =
    params.get("refresh") === "1" &&
    Boolean(internalToken) &&
    request.headers.get("x-internal-token") === internalToken;
  const memoKey = memoryCacheKey(params);

  if (!isWarm) {
    const memoized = readCachedResponse<ReturnType<typeof withFrontendAliases>>(memoKey);

    if (memoized) {
      return NextResponse.json(memoized, {
        headers: { "Cache-Control": EDGE_CACHE_CONTROL, "X-Memory-Cache": "hit" },
      });
    }
  }

  const rawCardId = params.get("cardId");
  const rawNumber = params.get("number");
  const query: PriceQuery = {
    slug,
    name,
    language: params.get("language")?.trim() || "en",
    cardId: normalizeProviderCardId(rawCardId ?? undefined),
    setCode: params.get("setCode")?.trim() || undefined,
    setName: params.get("setName")?.trim() || undefined,
    setEnglishName: params.get("setEnglishName")?.trim() || undefined,
    collectorNumber: rawNumber?.trim() || undefined,
    englishName:
      params.get("englishName")?.trim() ||
      extractParentheticalEnglish(name) ||
      undefined,
    rarity: params.get("rarity")?.trim() || undefined,
  };

  query.setEnglishName ||= extractParentheticalEnglish(query.setName);
  const resolvedQuery = await hydrateOfficialJapanesePriceQuery(query, {
    cardId: rawCardId,
    number: rawNumber,
  });
  resolvedQuery.setEnglishName ||= extractParentheticalEnglish(resolvedQuery.setName);

  try {
    const resolved = await resolvePrice(
      resolvedQuery,
      isWarm ? { refresh: true, ttlMs: 0, allowScrape: true } : {},
    );
    const priced = sanitizeResolvedPrice(await applyJapaneseGuideFallback(resolvedQuery, resolved));
    const payload = withFrontendAliases(priced);
    const hasPrice = priced.ungradedUsd > 0;

    if (hasPrice) {
      writeCachedResponse(memoKey, payload, MEMORY_TTL_MS);
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": hasPrice && !isWarm ? EDGE_CACHE_CONTROL : "no-store",
      },
    });
  } catch (error) {
    console.error("price lookup failed", { slug, error });
    return NextResponse.json(
      withFrontendAliases({
        slug,
        ungradedUsd: 0,
        confidenceScore: 0,
        primaryProvider: "",
        results: [],
        fetchedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
