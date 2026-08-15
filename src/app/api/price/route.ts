import { NextResponse } from "next/server";

import {
  buildJapaneseMarketCacheKey,
  hasConfirmedJapaneseCanonicalMarketIdentity,
  isConfirmedJapaneseMarketIdentity,
} from "@/lib/japanese-market-identity";
import { resolveJapaneseMarketIdentity } from "@/lib/japanese-market-identity.server";
import { getMarketCircuitSnapshots } from "@/lib/market/host-governor";
import { fetchPriceChartingMarketPrice } from "@/lib/market/pricecharting-provider";
import { lookupPriceChartingSetGuidePrice } from "@/lib/market/pricecharting-set-guide.server";
import {
  findOfficialJapaneseBrowseSeedByCardId,
  findOfficialJapaneseBrowseSeedBySetIndex,
  type OfficialJapaneseBrowseSeedMatch,
} from "@/lib/official-japanese-browse.server";
import { resolveOfficialJapaneseBrowseMatchForMarket } from "@/lib/official-japanese-print-identity.server";
import { writeCachedPrice } from "@/lib/price/price-cache.server";
import { findNmMarketUsd, isPricedResolvedPrice, sanitizeNmMarketUsd } from "@/lib/price/priced-payload";
import { resolvePrice } from "@/lib/price/resolve.server";
import { findResolvedPsa10Usd, sanitizeResolvedPrice } from "@/lib/price/sanity";
import type { PriceQuery, ResolvedPrice } from "@/lib/price/types";
import { readCachedResponse, writeCachedResponse } from "@/lib/server-response-cache";
import type { JapaneseMarketIdentity } from "@/types/pokemon";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Priced answers are safe to hold at the CDN edge for an hour and serve stale
// for a day while revalidating; unpriced/error answers stay no-store so a
// transient provider outage is never frozen at the edge.
const EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const MEMORY_TTL_MS = 5 * 60_000;

function memoryCacheKey(params: URLSearchParams, canonicalCacheKey?: string) {
  const entries = [...params.entries()]
    .filter(([key]) => key !== "refresh" && key !== "debug")
    .sort(([left], [right]) => left.localeCompare(right));
  return `price:${canonicalCacheKey ?? "native"}:${new URLSearchParams(entries).toString()}`;
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

type CanonicalPriceQueryResult = {
  query: PriceQuery;
  identity: JapaneseMarketIdentity | null;
  receivedIdentity: Record<string, unknown>;
  candidateOfficialCardIds?: string[];
  printDisambiguation?: string;
};

async function canonicalizeJapanesePriceQuery(
  query: PriceQuery,
  raw: {
    cardId?: string | null;
    officialCardId?: string | null;
    number?: string | null;
    browseIndex?: string | null;
    productId?: string | null;
    productUrl?: string | null;
    setSlug?: string | null;
  },
): Promise<CanonicalPriceQueryResult> {
  const receivedIdentity = {
    cardId: raw.cardId ?? null,
    officialCardId:
      raw.officialCardId ?? extractOfficialJapaneseId(raw.cardId) ?? null,
    browseIndex: raw.browseIndex ?? null,
    collectorNumber: raw.number ?? null,
    name: query.name,
    englishName: query.englishName ?? null,
    setCode: query.setCode ?? null,
    productId: raw.productId ?? null,
    productUrl: raw.productUrl ?? null,
  };

  if (query.language !== "ja") {
    return { query, identity: null, receivedIdentity };
  }

  let officialId =
    raw.officialCardId?.trim() ||
    extractOfficialJapaneseId(raw.cardId) ||
    extractOfficialJapaneseId(query.slug);
  let seedMatch: OfficialJapaneseBrowseSeedMatch | null = officialId
    ? findOfficialJapaneseBrowseSeedByCardId(officialId)
    : null;
  let candidateOfficialCardIds: string[] = officialId ? [officialId] : [];
  let printDisambiguation: string | undefined;

  // Legacy snapshots sometimes encoded the browse position as `official-173`.
  // Repair only that card-id form; the collector-number request field is never
  // interpreted as a browse position.
  if (officialId && !seedMatch) {
    seedMatch = findOfficialJapaneseBrowseSeedBySetIndex(query.setCode, officialId);
    officialId = seedMatch?.item.cardID ?? officialId;
  }

  // Requests from older cards/search results may not carry the official card
  // ID. A unique official browse-name hit may provide that ID, but the detail
  // resolver below must still confirm the printed collector number before a
  // provider or cache lookup is allowed. Same-name prints are disambiguated
  // by hydrating official detail and matching the printed number.
  if (!officialId && !seedMatch) {
    const printResolution = await resolveOfficialJapaneseBrowseMatchForMarket({
      setCode: query.setCode,
      names: [query.name, query.englishName],
      printedCollectorNumber: query.collectorNumber,
    });
    seedMatch = printResolution.match;
    officialId = seedMatch?.item.cardID;
    candidateOfficialCardIds = printResolution.candidateOfficialCardIds;
    printDisambiguation = printResolution.disambiguation;
  }

  if (!officialId && !seedMatch) {
    return {
      query,
      identity: null,
      receivedIdentity,
      candidateOfficialCardIds,
      printDisambiguation,
    };
  }

  const requestedBrowseIndex = Number.parseInt(raw.browseIndex ?? "", 10);
  const identity = await resolveJapaneseMarketIdentity({
    officialCardId: seedMatch?.item.cardID ?? officialId!,
    browseIndex: Number.isFinite(requestedBrowseIndex)
      ? requestedBrowseIndex
      : seedMatch
        ? seedMatch.setIndex + 1
        : null,
    browseItem: seedMatch?.item,
    japaneseName: query.name,
    englishMarketName: query.englishName,
    printedCollectorNumber: query.collectorNumber,
    japaneseSetCode: query.setCode,
    japaneseSetName: query.setName,
    englishSetName: query.setEnglishName,
    priceChartingSetSlug: raw.setSlug,
    priceChartingProductId: raw.productId,
    priceChartingProductUrl: raw.productUrl,
    identitySource: ["caller-supplied"],
  });

  return {
    identity,
    receivedIdentity,
    candidateOfficialCardIds,
    printDisambiguation,
    query: {
      ...query,
      cardId: undefined,
      officialCardId: identity.officialCardId,
      browseIndex: identity.browseIndex ?? undefined,
      collectorNumber: identity.printedCollectorNumber ?? undefined,
      englishName: identity.englishMarketName ?? query.englishName,
      setCode: identity.japaneseSetCode ?? query.setCode,
      setName: identity.japaneseSetName ?? query.setName,
      setEnglishName: identity.englishSetName ?? query.setEnglishName,
      productId: identity.priceChartingProductId ?? undefined,
      productUrl: identity.priceChartingProductUrl ?? undefined,
      setSlug: identity.priceChartingSetSlug ?? undefined,
      identityVersion: identity.identityVersion,
      cacheIdentityKey: buildJapaneseMarketCacheKey(identity, "price"),
    },
  };
}

async function applyJapaneseGuideFallback(
  query: PriceQuery,
  resolved: ResolvedPrice,
): Promise<ResolvedPrice> {
  if (resolved.ungradedUsd > 0 || query.language !== "ja") {
    return resolved;
  }

  // Cheapest first: the shared set-level guide (one console-page fetch prices
  // the whole set, so 81 sibling cards reuse this snapshot instead of each
  // firing their own scrape).
  const setGuide = await lookupPriceChartingSetGuidePrice(query).catch(() => null);

  if (setGuide?.ungradedUsd) {
    return {
      ...resolved,
      ungradedUsd: setGuide.ungradedUsd,
      confidenceScore: Math.max(resolved.confidenceScore, setGuide.confidenceScore),
      primaryProvider: setGuide.provider,
      results: [...resolved.results, setGuide],
    };
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
  const psa10Value = findResolvedPsa10Usd(priced);
  const psa10 = psa10Value > 0 ? psa10Value : null;
  const nmMarketUsd = sanitizeNmMarketUsd(
    market ?? 0,
    priced.nmMarketUsd ?? findNmMarketUsd(priced.results),
  );

  return {
    ...priced,
    marketPrice: market,
    psa10,
    nmMarketUsd: nmMarketUsd && nmMarketUsd > 0 ? nmMarketUsd : null,
    prices: { market, ungraded: market, raw: market, psa10, nm: nmMarketUsd },
  };
}

function priceRouteStatus(
  priced: ResolvedPrice,
  identity: JapaneseMarketIdentity | null,
) {
  if (identity && !isConfirmedJapaneseMarketIdentity(identity)) {
    return "identity_incomplete" as const;
  }
  if (isPricedResolvedPrice(priced)) {
    return "success" as const;
  }
  if (priced.results.length > 0) {
    return "partial" as const;
  }
  if (priced.providerAttempts?.some((attempt) => attempt.status === "timeout")) {
    return "timeout" as const;
  }
  if (priced.providerAttempts?.some((attempt) => attempt.status === "circuit_open")) {
    return "circuit_open" as const;
  }
  if (priced.providerAttempts?.some((attempt) => attempt.status === "provider_error")) {
    return "provider_error" as const;
  }
  return "no_match" as const;
}

function withPriceRouteMetadata(
  priced: ResolvedPrice,
  input: {
    identity: JapaneseMarketIdentity | null;
    receivedIdentity: Record<string, unknown>;
    debug: boolean;
    cacheStatus: "hit" | "miss" | "bypass";
    cacheKey: string;
    startedAt: number;
    identityIncomplete?: boolean;
    candidateOfficialCardIds?: string[];
    printDisambiguation?: string;
  },
) {
  const status = input.identityIncomplete
    ? ("identity_incomplete" as const)
    : priceRouteStatus(priced, input.identity);
  const payload = {
    ...withFrontendAliases(priced),
    status,
    identityStatus: input.identity?.identityStatus ?? null,
    marketIdentity: input.identity,
    candidateOfficialCardIds: input.candidateOfficialCardIds ?? [],
    printDisambiguation: input.printDisambiguation ?? null,
  };

  if (!input.debug) {
    return payload;
  }

  const selectedProduct = priced.results.find(
    (result) => result.productId || result.productUrl || /pricecharting/i.test(result.provider),
  );
  const diagnostics = {
    receivedIdentity: input.receivedIdentity,
    canonicalIdentity: input.identity,
    candidateOfficialCardIds: input.candidateOfficialCardIds ?? [],
    printDisambiguation: input.printDisambiguation ?? null,
    cacheStatus: input.cacheStatus,
    officialDetailHydration: input.identity
      ? input.identity.identitySource.includes("cached-confirmed-identity")
        ? "confirmed_cache_reused"
        : input.identity.identitySource.includes("official-detail")
          ? "official_detail_confirmed"
          : "official_detail_unavailable"
      : "not_applicable",
    englishNameResolution: input.identity?.englishMarketName
      ? { status: "resolved", value: input.identity.englishMarketName }
      : { status: "unavailable", value: null },
    setMappingResolution: {
      japaneseSetCode: input.identity?.japaneseSetCode ?? null,
      englishSetName: input.identity?.englishSetName ?? null,
      priceChartingSetSlug: input.identity?.priceChartingSetSlug ?? null,
    },
    generatedCandidateProducts: input.identity?.priceChartingProductUrl
      ? [input.identity.priceChartingProductUrl]
      : [],
    rejectedCandidates:
      input.identity && !input.identity.priceChartingProductUrl
        ? [{ reason: "insufficient_confidence" }]
        : [],
    selectedProduct: selectedProduct
      ? {
          productId: selectedProduct.productId ?? input.identity?.priceChartingProductId ?? null,
          productUrl: selectedProduct.productUrl ?? input.identity?.priceChartingProductUrl ?? null,
          sourceUrl: selectedProduct.sourceUrl ?? null,
          setSlug: selectedProduct.setSlug ?? input.identity?.priceChartingSetSlug ?? null,
        }
      : null,
    selectedProductEvidence: selectedProduct
      ? {
          provider: selectedProduct.provider,
          matchConfidence: selectedProduct.matchConfidence,
          evidenceType: selectedProduct.evidenceType,
        }
      : null,
    providerAttempts:
      priced.providerAttempts ??
      priced.results.map((result) => ({
        provider: result.provider,
        status: result.ungradedUsd > 0 || (result.gradedPrices?.some((grade) => grade.grade.toLowerCase() !== "ungraded" && grade.value > 0) ?? false) ? "success" : "no_match",
        latencyMs: 0,
      })),
    providerTimeouts: (priced.providerAttempts ?? [])
      .filter((attempt) => attempt.status === "timeout")
      .map((attempt) => attempt.provider),
    circuitBreakerState: getMarketCircuitSnapshots([
      "www.pricecharting.com",
      "r.jina.ai",
      "api.magery.io",
    ]),
    cacheKeys: [input.cacheKey],
    totalElapsedMs: Date.now() - input.startedAt,
  };

  return { ...payload, diagnostics };
}

async function persistSelectedPriceChartingIdentity(
  identity: JapaneseMarketIdentity | null,
  priced: ResolvedPrice,
) {
  if (!identity || !isConfirmedJapaneseMarketIdentity(identity)) {
    return identity;
  }

  const exact = priced.results.find(
    (result) =>
      result.provider === "pricecharting-api" &&
      Boolean(result.productId || result.productUrl),
  );
  if (!exact) {
    return identity;
  }
  if (
    exact.productId === identity.priceChartingProductId &&
    exact.productUrl === identity.priceChartingProductUrl &&
    (exact.setSlug ?? identity.priceChartingSetSlug) === identity.priceChartingSetSlug
  ) {
    return identity;
  }

  return resolveJapaneseMarketIdentity(
    {
      ...identity,
      priceChartingProductId: exact.productId ?? identity.priceChartingProductId,
      priceChartingProductUrl: exact.productUrl ?? identity.priceChartingProductUrl,
      priceChartingSetSlug: exact.setSlug ?? identity.priceChartingSetSlug,
      identitySource: [...identity.identitySource, "pricecharting-discovery"],
    },
    {
      hydrateOfficialDetail: false,
      validatedPriceChartingIdentity: true,
    },
  );
}

/**
 * Block-resistant price lookup. Reads the local price cache first and, on a miss,
 * queries only the NON-BLOCKING API providers (never a scrape). Safe to call from
 * the list/detail UI without ever triggering an IP block.
 */
export async function GET(request: Request) {
  const startedAt = Date.now();
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
  const debug =
    params.get("debug") === "1" &&
    (process.env.NODE_ENV !== "production" || process.env.MARKET_DEBUG_ENABLED === "1");

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
  const canonical = await canonicalizeJapanesePriceQuery(query, {
    cardId: rawCardId,
    officialCardId: params.get("officialCardId"),
    number: rawNumber,
    browseIndex: params.get("browseIndex"),
    productId: params.get("priceChartingProductId"),
    productUrl: params.get("priceChartingProductUrl"),
    setSlug: params.get("priceChartingSetSlug"),
  });
  const resolvedQuery = canonical.query;
  resolvedQuery.setEnglishName ||= extractParentheticalEnglish(resolvedQuery.setName);
  let memoKey = memoryCacheKey(params, resolvedQuery.cacheIdentityKey);

  if (!hasConfirmedJapaneseCanonicalMarketIdentity(resolvedQuery.language, canonical.identity)) {
    const empty = sanitizeResolvedPrice({
      slug,
      ungradedUsd: 0,
      confidenceScore: 0,
      primaryProvider: "",
      results: [],
      fetchedAt: new Date().toISOString(),
    });
    const payload = withPriceRouteMetadata(empty, {
      identity: canonical.identity,
      receivedIdentity: canonical.receivedIdentity,
      debug,
      cacheStatus: "bypass",
      cacheKey: memoKey,
      startedAt,
      identityIncomplete: true,
      candidateOfficialCardIds: canonical.candidateOfficialCardIds,
      printDisambiguation: canonical.printDisambiguation,
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store", "X-Price-Status": "identity_incomplete" },
    });
  }

  if (!isWarm && !debug) {
    const memoized = readCachedResponse<ReturnType<typeof withPriceRouteMetadata>>(memoKey);

    if (memoized) {
      return NextResponse.json(memoized, {
        headers: { "Cache-Control": EDGE_CACHE_CONTROL, "X-Memory-Cache": "hit" },
      });
    }
  }

  // FAST PATH for Japanese cards: one PriceCharting console page prices the
  // whole set (base prints AND secret rares), file-cached and in-flight-deduped.
  // Answering from it collapses a set browse from 81 slow per-card scrapes into
  // a single upstream fetch — the per-card pipeline stays as the fallback.
  if (!isWarm && resolvedQuery.language === "ja") {
    const setGuide = await lookupPriceChartingSetGuidePrice(resolvedQuery).catch(() => null);

    if (setGuide?.ungradedUsd) {
      const priced = sanitizeResolvedPrice({
        slug: resolvedQuery.slug,
        ungradedUsd: setGuide.ungradedUsd,
        confidenceScore: setGuide.confidenceScore,
        primaryProvider: setGuide.provider,
        results: [setGuide],
        fetchedAt: setGuide.fetchedAt,
      });

      if (priced.ungradedUsd > 0) {
        canonical.identity = await persistSelectedPriceChartingIdentity(
          canonical.identity,
          priced,
        );
        if (canonical.identity) {
          resolvedQuery.cacheIdentityKey = buildJapaneseMarketCacheKey(
            canonical.identity,
            "price",
          );
          memoKey = memoryCacheKey(params, resolvedQuery.cacheIdentityKey);
        }
        const payload = withPriceRouteMetadata(priced, {
          identity: canonical.identity,
          receivedIdentity: canonical.receivedIdentity,
          debug,
          cacheStatus: "miss",
          cacheKey: memoKey,
          startedAt,
        });
        void writeCachedPrice(
          resolvedQuery.cacheIdentityKey
            ? { ...priced, slug: resolvedQuery.cacheIdentityKey }
            : priced,
          {
          language: resolvedQuery.language,
          setCode: resolvedQuery.setCode,
          },
        );
        if (!debug) {
          writeCachedResponse(memoKey, payload, MEMORY_TTL_MS);
        }

        return NextResponse.json(payload, {
          headers: { "Cache-Control": EDGE_CACHE_CONTROL, "X-Price-Source": "set-guide" },
        });
      }
    }
  }

  try {
    const resolved = await resolvePrice(
      resolvedQuery,
      isWarm ? { refresh: true, ttlMs: 0, allowScrape: true } : {},
    );
    const priced = sanitizeResolvedPrice(await applyJapaneseGuideFallback(resolvedQuery, resolved));
    canonical.identity = await persistSelectedPriceChartingIdentity(
      canonical.identity,
      priced,
    );
    if (canonical.identity) {
      resolvedQuery.cacheIdentityKey = buildJapaneseMarketCacheKey(
        canonical.identity,
        "price",
      );
      memoKey = memoryCacheKey(params, resolvedQuery.cacheIdentityKey);
    }
    const payload = withPriceRouteMetadata(priced, {
      identity: canonical.identity,
      receivedIdentity: canonical.receivedIdentity,
      debug,
      cacheStatus: isWarm ? "bypass" : "miss",
      cacheKey: memoKey,
      startedAt,
    });
    const hasPrice = priced.ungradedUsd > 0;

    if (hasPrice && !debug) {
      writeCachedResponse(memoKey, payload, MEMORY_TTL_MS);
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": hasPrice && !isWarm ? EDGE_CACHE_CONTROL : "no-store",
      },
    });
  } catch (error) {
    console.error("price lookup failed", { slug, error });
    const failed = sanitizeResolvedPrice({
      slug,
      ungradedUsd: 0,
      confidenceScore: 0,
      primaryProvider: "",
      results: [],
      fetchedAt: new Date().toISOString(),
    });
    return NextResponse.json(
      {
        ...withPriceRouteMetadata(failed, {
          identity: canonical.identity,
          receivedIdentity: canonical.receivedIdentity,
          debug,
          cacheStatus: "bypass",
          cacheKey: memoKey,
          startedAt,
        }),
        status: "provider_error",
        ...(debug
          ? { error: error instanceof Error ? error.message : "Unknown provider error" }
          : {}),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
