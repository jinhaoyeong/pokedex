import { NextResponse } from "next/server";

import { fetchGradingMarketData } from "@/lib/grading-market";
import { resolveGradingMarketLookupCardName } from "@/lib/grading-market-lookup";
import {
  buildJapaneseMarketCacheKey,
  hasConfirmedJapaneseCanonicalMarketIdentity,
} from "@/lib/japanese-market-identity";
import { resolveJapaneseMarketIdentity } from "@/lib/japanese-market-identity.server";
import {
  findOfficialJapaneseBrowseSeedByCardId,
  findOfficialJapaneseBrowseSeedBySetIndex,
  type OfficialJapaneseBrowseSeedMatch,
} from "@/lib/official-japanese-browse.server";
import { resolveOfficialJapaneseBrowseMatchForMarket } from "@/lib/official-japanese-print-identity.server";
import { getMarketCircuitSnapshots } from "@/lib/market/host-governor";
import { hasBlockingGradingMarketIncomplete, hasRetryableMarketSourceFailure } from "@/lib/market/cache-policy";
import type {
  CardLanguageCode,
  JapaneseMarketIdentity,
  MarketSourceStatus,
} from "@/types/pokemon";

/**
 * Live grading/population/sold-comp enrichment scrapes several public sources and can
 * take 20-40s. The default serverless timeout was cutting it off, which made graded
 * prices, the population grid, and sold comps come back empty in production. Allow a
 * longer budget (capped by the hosting plan) so the panels actually populate.
 */
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// A populated enrichment payload is stable enough to hold at the CDN edge for
// an hour (stale for a day). Empty/failed payloads stay no-store so a
// transient scrape failure is never frozen for the full revalidate window.
const EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
// Japanese/Korean/Chinese core enrichment still needs PriceCharting/TCGFish
// public-page scrapes (often 8–20s). A 2s "fast identity" budget aborted those
// scrapes and returned a fake Grading-market-identity no_match, so JA card
// pages showed MARKET PENDING / NO MATCH forever unless the user manually
// opened sold-comps (which triggers mode=full). Give core enough time to finish
// when English identity is already known; sold comps stay deferred to full.
const LOCALIZED_CORE_GRADING_BUDGET_MS = 8_000;
const ENGLISH_CORE_GRADING_BUDGET_MS = 7_000;
const FULL_GRADING_BUDGET_MS = 8_000;

type GradingMarketPayloadSummaryInput = {
  psaPopulation?: {
    grades?: unknown[];
    totalCertified?: number | null;
    warning?: string;
    note?: string;
  } | null;
  gradedPrices?: Array<{ grade: string; value?: number | null }>;
  priceHistory?: unknown[];
  recentSales?: unknown[];
  populationBreakdown?: {
    japanese?: { grades?: unknown[]; totalCertified?: number | null } | null;
    englishParallel?: { grades?: unknown[]; totalCertified?: number | null } | null;
  } | null;
  marketHistory?: {
    status?: string;
    historyUnavailable?: boolean;
    realSaleCount?: number;
  } | null;
  evidenceSummary?: {
    accepted?: number;
    rejected?: number;
    thin?: number;
    fallback?: number;
    sourceStatus?: MarketSourceStatus[];
  };
  sourceStatus?: MarketSourceStatus[];
};

function summarizeGradingMarketPayload(
  data: GradingMarketPayloadSummaryInput,
  query: {
    setName: string;
    cardName: string;
    cardNumber: string | null;
    setCode?: string | null;
    mode?: string | null;
  },
) {
  const sourceStatus = data.sourceStatus ?? data.evidenceSummary?.sourceStatus ?? [];
  const gradedPrices = data.gradedPrices ?? [];
  const slabPrices = gradedPrices.filter(
    (price) => price.grade !== "Ungraded" && typeof price.value === "number" && price.value > 0,
  );

  return {
    query,
    counts: {
      gradedPrices: gradedPrices.length,
      slabPrices: slabPrices.length,
      populationGrades: data.psaPopulation?.grades?.length ?? 0,
      totalCertified: data.psaPopulation?.totalCertified ?? null,
      priceHistory: data.priceHistory?.length ?? 0,
      recentSales: data.recentSales?.length ?? 0,
      japanesePopulationGrades: data.populationBreakdown?.japanese?.grades?.length ?? 0,
      englishParallelPopulationGrades:
        data.populationBreakdown?.englishParallel?.grades?.length ?? 0,
    },
    marketHistory: data.marketHistory ?? null,
    sourceStatus: sourceStatus.map((status) => ({
      source: status.source,
      state: status.state,
      sampleCount: status.sampleCount ?? 0,
      sourceUrl: status.sourceUrl,
      warning: status.warning,
      note: status.note,
    })),
    populationWarning: data.psaPopulation?.warning,
    populationNote: data.psaPopulation?.note,
  };
}

function emptyGradingMarketPayload(error?: unknown, sourceStatusOverride?: MarketSourceStatus[]) {
  const sourceStatus =
    sourceStatusOverride ??
    (error
      ? [
        {
          source: "Grading market API",
          state: "failed" as const,
          confidence: "low" as const,
          confidenceScore: 0.15,
          fetchedAt: new Date().toISOString(),
          note: "Live grading, population, and sold-comp enrichment failed before source results could be returned.",
          warning: error instanceof Error ? error.message : "Unknown source error",
        },
      ]
      : []);

  return {
    psaPopulation: null,
    population: null,
    populationBreakdown: null,
    gradedPrices: [],
    priceHistory: [],
    marketHistory: {
      status: "unavailable" as const,
      historyUnavailable: true,
      realSaleCount: 0,
      note: "No real dated market history is available for this print.",
    },
    historyUnavailable: true,
    recentSales: [],
    evidenceSummary: {
      accepted: 0,
      rejected: 0,
      thin: 0,
      fallback: 0,
      sourceStatus,
    },
    sourceStatus,
    marketEvidence: [],
  };
}

function noMatchStatus(note: string, warning?: string): MarketSourceStatus[] {
  return [
    {
      source: "Grading market identity",
      state: "no_match",
      confidence: "low",
      confidenceScore: 0.12,
      fetchedAt: new Date().toISOString(),
      note,
      warning,
    },
  ];
}

function isChineseLanguage(language?: string | null) {
  return Boolean(language?.toLowerCase().startsWith("zh"));
}

function isLocalizedLanguage(language?: string | null) {
  return Boolean(language && language !== "en");
}

function lacksEnglishMarketIdentity(language: string | null, cardName: string, englishCardName?: string | null) {
  return isLocalizedLanguage(language) && !englishCardName?.trim() && !/[a-z]/i.test(cardName);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race<T | null>([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

/**
 * Concurrent requests for the same card share one in-flight enrichment run.
 * The scrape behind this route can take 20-40s, so duplicate core/full calls
 * from multiple tabs or rapid client retries would otherwise each pay it in
 * full. Scoped per server instance; entries are removed as soon as they settle.
 */
type GradingMarketData = Awaited<ReturnType<typeof fetchGradingMarketData>>;
type GradingMarketRouteRuntime = {
  inFlight: Map<string, Promise<GradingMarketData>>;
  settled: Map<string, { expiresAt: number; value: GradingMarketData }>;
};

const globalRuntime = globalThis as typeof globalThis & {
  __pokedexGradingMarketRouteRuntime?: GradingMarketRouteRuntime;
};
const gradingMarketRouteRuntime =
  globalRuntime.__pokedexGradingMarketRouteRuntime ??
  (globalRuntime.__pokedexGradingMarketRouteRuntime = {
    inFlight: new Map(),
    settled: new Map(),
  });
const SETTLED_SIGNAL_TTL_MS = 5 * 60_000;
const SETTLED_EMPTY_TTL_MS = 15_000;

function gradingDataHasSignal(data: GradingMarketData) {
  return Boolean(
    data?.psaPopulation ||
      data?.gradedPrices?.length ||
      data?.priceHistory?.length ||
      data?.recentSales?.length,
  );
}

function dedupedGradingMarketData(
  key: string,
  start: () => Promise<GradingMarketData>,
) {
  const cached = gradingMarketRouteRuntime.settled.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }
  if (cached) {
    gradingMarketRouteRuntime.settled.delete(key);
  }

  const existing = gradingMarketRouteRuntime.inFlight.get(key);

  if (existing) {
    return existing;
  }

  const request = start()
    .then((value) => {
      gradingMarketRouteRuntime.settled.set(key, {
        expiresAt:
          Date.now() + (gradingDataHasSignal(value) ? SETTLED_SIGNAL_TTL_MS : SETTLED_EMPTY_TTL_MS),
        value,
      });
      return value;
    })
    .finally(() => {
      gradingMarketRouteRuntime.inFlight.delete(key);
    });
  gradingMarketRouteRuntime.inFlight.set(key, request);
  return request;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const setName = searchParams.get("setName");
  const cardName = searchParams.get("cardName");
  const cardNumber = searchParams.get("cardNumber");
  const rawMarketPriceUsd = searchParams.get("rawMarketPriceUsd");
  const setTotal = searchParams.get("setTotal");
  const rarity = searchParams.get("rarity");
  const setCode = searchParams.get("setCode");
  const language = searchParams.get("language");
  const englishCardName = searchParams.get("englishCardName");
  const officialCardId = searchParams.get("officialCardId")?.trim() || null;
  const browseIndex = Number.parseInt(searchParams.get("browseIndex") ?? "", 10);
  const skipSoldComps = searchParams.get("mode") === "core";
  const debugMarket =
    (searchParams.get("debug") === "1" || process.env.GRADING_MARKET_DEBUG === "1") &&
    (process.env.NODE_ENV !== "production" || process.env.MARKET_DEBUG_ENABLED === "1");

  if (!setName || !cardName || (language !== "ja" && !cardNumber)) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const receivedIdentity = {
    officialCardId,
    browseIndex: Number.isFinite(browseIndex) ? browseIndex : null,
    japaneseName: cardName,
    englishMarketName: englishCardName,
    collectorNumber: cardNumber,
    japaneseSetCode: setCode,
    setName,
    priceChartingProductId: searchParams.get("priceChartingProductId"),
    priceChartingProductUrl: searchParams.get("priceChartingProductUrl"),
    priceChartingSetSlug: searchParams.get("priceChartingSetSlug"),
  };
  let canonicalIdentity: JapaneseMarketIdentity | null = null;
  let candidateOfficialCardIds: string[] = officialCardId ? [officialCardId] : [];
  let printDisambiguation: string | null = null;

  if (language === "ja") {
    let resolvedOfficialCardId = officialCardId;
    let seedMatch: OfficialJapaneseBrowseSeedMatch | null = resolvedOfficialCardId
      ? findOfficialJapaneseBrowseSeedByCardId(resolvedOfficialCardId)
      : null;

    // Preserve legacy repair for callers that encoded a browse position as an
    // official ID, but never use the collector-number parameter as an index.
    if (resolvedOfficialCardId && !seedMatch) {
      seedMatch = findOfficialJapaneseBrowseSeedBySetIndex(setCode ?? undefined, resolvedOfficialCardId);
      resolvedOfficialCardId = seedMatch?.item.cardID ?? resolvedOfficialCardId;
    }
    if (!resolvedOfficialCardId && !seedMatch) {
      const printResolution = await resolveOfficialJapaneseBrowseMatchForMarket({
        setCode: setCode ?? undefined,
        names: [cardName, englishCardName],
        printedCollectorNumber: cardNumber,
      });
      seedMatch = printResolution.match;
      resolvedOfficialCardId = seedMatch?.item.cardID ?? null;
      candidateOfficialCardIds = printResolution.candidateOfficialCardIds;
      printDisambiguation = printResolution.disambiguation;
    }

    if (resolvedOfficialCardId) {
      canonicalIdentity = await resolveJapaneseMarketIdentity({
        officialCardId: resolvedOfficialCardId,
      browseIndex: Number.isFinite(browseIndex)
        ? browseIndex
        : seedMatch
          ? seedMatch.setIndex + 1
          : null,
      browseItem: seedMatch?.item,
      japaneseName: cardName,
      englishMarketName: englishCardName,
      printedCollectorNumber: cardNumber,
      collectorNumberTotal: setTotal ? Number(setTotal) : null,
      japaneseSetCode: setCode,
      japaneseSetName: searchParams.get("japaneseSetName") ?? setName,
      englishSetName: searchParams.get("setEnglishName"),
      priceChartingProductId: searchParams.get("priceChartingProductId"),
      priceChartingProductUrl: searchParams.get("priceChartingProductUrl"),
      priceChartingSetSlug: searchParams.get("priceChartingSetSlug"),
        identitySource: ["caller-supplied"],
      });
    }
  }

  if (!hasConfirmedJapaneseCanonicalMarketIdentity(language, canonicalIdentity)) {
    const statuses: MarketSourceStatus[] = [
      {
        source: "Japanese market identity",
        state: "identity_incomplete",
        confidence: "low",
        confidenceScore: canonicalIdentity?.identityConfidence ?? 0,
        fetchedAt: new Date().toISOString(),
        note: canonicalIdentity
          ? "Official detail did not confirm a printed collector number, so market providers were not queried with an unsafe identity."
          : "No official Japanese card identity was supplied, so market providers were not queried with an unsafe identity.",
        warning: "This is retryable and is not cached as a permanent no-match.",
      },
    ];
    const empty = emptyGradingMarketPayload(undefined, statuses);
    return NextResponse.json(
      {
        ...empty,
        status: "identity_incomplete",
        identityStatus: canonicalIdentity?.identityStatus ?? null,
        marketIdentity: canonicalIdentity,
        candidateOfficialCardIds,
        printDisambiguation,
        ...(debugMarket
          ? {
              diagnostics: {
                receivedIdentity,
                canonicalIdentity,
                candidateOfficialCardIds,
                printDisambiguation,
                cacheStatus: "bypass",
                officialDetailHydration: "official_detail_unavailable",
                providerAttempts: [],
                providerTimeouts: [],
                circuitBreakerState: getMarketCircuitSnapshots([
                  "www.pricecharting.com",
                  "r.jina.ai",
                  "api.magery.io",
                ]),
                cacheKeys: canonicalIdentity
                  ? [buildJapaneseMarketCacheKey(canonicalIdentity, "grading")]
                  : [],
                totalElapsedMs: Date.now() - startedAt,
              },
            }
          : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const effectiveSetName = canonicalIdentity?.englishSetName ?? setName;
  const effectiveCardName = canonicalIdentity?.englishMarketName ?? cardName;
  const effectiveCardNumber = canonicalIdentity?.printedCollectorNumber ?? cardNumber ?? "";
  const effectiveSetCode = canonicalIdentity?.japaneseSetCode ?? setCode;
  const effectiveEnglishName = canonicalIdentity?.englishMarketName ?? englishCardName;

  const lookupCardName = resolveGradingMarketLookupCardName({
    name: effectiveCardName,
    englishName: effectiveEnglishName ?? effectiveCardName,
    language: (language ?? "en") as CardLanguageCode,
  });
  const lookupEnglishCardName = effectiveEnglishName
    ? resolveGradingMarketLookupCardName({
        name: effectiveEnglishName,
        englishName: effectiveEnglishName,
        language: "en",
      })
    : lookupCardName;

  if (isChineseLanguage(language)) {
    const payload = emptyGradingMarketPayload(
      undefined,
      noMatchStatus(
        "Chinese grading and population lookups are not routed to a reliable PriceCharting/TCGFish identity today.",
        "Returning early so the UI can show the empty-state fallback instead of waiting on scraper retries.",
      ),
    );

    return NextResponse.json(
      debugMarket
        ? {
            ...payload,
            debugSummary: summarizeGradingMarketPayload(payload, {
              setName,
              cardName,
              cardNumber,
              setCode,
              mode: searchParams.get("mode"),
            }),
          }
        : payload,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (lacksEnglishMarketIdentity(language, effectiveCardName, effectiveEnglishName)) {
    const payload = emptyGradingMarketPayload(
      undefined,
      noMatchStatus(
        "Localized grading lookup skipped because no English market identity was available for PriceCharting/TCGFish matching.",
        "Add an English card name mapping before attempting slab/population enrichment for this print.",
      ),
    );

    return NextResponse.json(
      debugMarket
        ? {
            ...payload,
            debugSummary: summarizeGradingMarketPayload(payload, {
              setName,
              cardName,
              cardNumber,
              setCode,
              mode: searchParams.get("mode"),
            }),
          }
        : payload,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const dedupeKey = [
      "v23-price-memory",
      skipSoldComps ? "core" : "full",
      canonicalIdentity
        ? buildJapaneseMarketCacheKey(canonicalIdentity, "grading")
        : "native-identity",
      effectiveSetName,
      lookupCardName,
      effectiveCardNumber,
      effectiveSetCode ?? "",
      language ?? "",
      lookupEnglishCardName ?? "",
      rawMarketPriceUsd ?? "",
      setTotal ?? "",
      rarity ?? "",
    ]
      .map((part) => part.trim().toLowerCase())
      .join("|");
    const requestPayload = dedupedGradingMarketData(dedupeKey, () =>
      fetchGradingMarketData(
        effectiveSetName,
        lookupCardName,
        effectiveCardNumber,
        rawMarketPriceUsd ? Number(rawMarketPriceUsd) : undefined,
        setTotal ? Number(setTotal) : undefined,
        rarity ?? undefined,
        {
          setCode: effectiveSetCode ?? undefined,
          isJapanese: language === "ja",
          language: language ?? undefined,
          englishCardName: lookupEnglishCardName ?? undefined,
          productId: canonicalIdentity?.priceChartingProductId ?? undefined,
          productUrl: canonicalIdentity?.priceChartingProductUrl ?? undefined,
          setSlug: canonicalIdentity?.priceChartingSetSlug ?? undefined,
          identityVersion: canonicalIdentity?.identityVersion,
          officialCardId: canonicalIdentity?.officialCardId,
          skipSoldComps,
        },
      ),
    );
    const gradingBudgetMs = skipSoldComps
      ? isLocalizedLanguage(language)
        ? LOCALIZED_CORE_GRADING_BUDGET_MS
        : ENGLISH_CORE_GRADING_BUDGET_MS
      : FULL_GRADING_BUDGET_MS;
    const data = await withTimeout(requestPayload, gradingBudgetMs);
    const fallbackPayload = emptyGradingMarketPayload(undefined, [
        {
          source: "Grading market enrichment",
          state: "timeout" as const,
          confidence: "low" as const,
          confidenceScore: 0.2,
          fetchedAt: new Date().toISOString(),
          note: skipSoldComps
            ? "Core grading lookup exceeded the card-detail budget."
            : "Full grading lookup exceeded the card-detail budget.",
          warning: "Showing whatever market data is already available instead of blocking the page.",
        },
      ]);
    const payload = (data ?? fallbackPayload) as typeof fallbackPayload;
    const timedOutPayload = data ? null : payload;
    const hasSignal = Boolean(
      payload.psaPopulation ||
        payload.gradedPrices?.length ||
        payload.priceHistory?.length ||
        payload.recentSales?.length,
    );
    const hasRetryableProviderFailure = hasRetryableMarketSourceFailure(
      payload.sourceStatus,
    );
    const debugSummary = summarizeGradingMarketPayload(payload, {
      setName: effectiveSetName,
      cardName: effectiveCardName,
      cardNumber: effectiveCardNumber,
      setCode: effectiveSetCode,
      mode: searchParams.get("mode"),
    });
    const responseStatus = timedOutPayload
      ? "timeout"
      : hasSignal
        ? payload.marketHistory?.historyUnavailable ||
          hasBlockingGradingMarketIncomplete(payload.sourceStatus)
          ? "partial"
          : "success"
        : "no_match";
    const diagnostics = debugMarket
      ? {
          receivedIdentity,
          canonicalIdentity,
          candidateOfficialCardIds,
          printDisambiguation,
          cacheStatus: "route_cache_or_provider_cache_checked",
          officialDetailHydration: canonicalIdentity
            ? canonicalIdentity.identitySource.includes("cached-confirmed-identity")
              ? "confirmed_cache_reused"
              : "official_detail_confirmed"
            : "not_applicable",
          englishNameResolution: canonicalIdentity?.englishMarketName
            ? { status: "resolved", value: canonicalIdentity.englishMarketName }
            : { status: "not_applicable_or_unavailable", value: null },
          setMappingResolution: canonicalIdentity
            ? {
                japaneseSetCode: canonicalIdentity.japaneseSetCode,
                englishSetName: canonicalIdentity.englishSetName,
                priceChartingSetSlug: canonicalIdentity.priceChartingSetSlug,
              }
            : null,
          generatedCandidateProducts: canonicalIdentity?.priceChartingProductUrl
            ? [canonicalIdentity.priceChartingProductUrl]
            : [],
          rejectedCandidates:
            canonicalIdentity && !canonicalIdentity.priceChartingProductUrl
              ? [{ reason: "insufficient_confidence" }]
              : [],
          selectedProduct: canonicalIdentity?.priceChartingProductUrl
            ? {
                productId: canonicalIdentity.priceChartingProductId,
                productUrl: canonicalIdentity.priceChartingProductUrl,
                setSlug: canonicalIdentity.priceChartingSetSlug,
              }
            : null,
          providerAttempts: (payload.sourceStatus ?? []).map((status: MarketSourceStatus) => ({
            source: status.source,
            state: status.state,
            latencyMs: status.latencyMs,
            sampleCount: status.sampleCount,
          })),
          providerTimeouts: (payload.sourceStatus ?? [])
            .filter(
              (status: MarketSourceStatus) =>
                status.state === "timeout" || /timeout|budget/i.test(status.warning ?? ""),
            )
            .map((status: MarketSourceStatus) => status.source),
          circuitBreakerState: getMarketCircuitSnapshots([
            "www.pricecharting.com",
            "r.jina.ai",
            "api.magery.io",
          ]),
          cacheKeys: canonicalIdentity
            ? [buildJapaneseMarketCacheKey(canonicalIdentity, "grading")]
            : [dedupeKey],
          totalElapsedMs: Date.now() - startedAt,
        }
      : null;

    if (debugMarket) {
      console.info("grading-market payload", debugSummary);
    }

    return NextResponse.json(
      {
        ...payload,
        status: responseStatus,
        identityStatus: canonicalIdentity?.identityStatus ?? null,
        marketIdentity: canonicalIdentity,
        historyUnavailable:
          payload.marketHistory?.historyUnavailable ??
          (payload.priceHistory?.length ? undefined : true),
        ...(debugMarket ? { debugSummary, diagnostics } : {}),
      },
      {
      headers: {
        // Partial data is useful, but a provider timeout/circuit/error must be
        // retried rather than frozen at the edge for an hour.
        "Cache-Control":
          hasSignal && !hasRetryableProviderFailure ? EDGE_CACHE_CONTROL : "no-store",
      },
      },
    );
  } catch (error) {
    return NextResponse.json(emptyGradingMarketPayload(error), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
