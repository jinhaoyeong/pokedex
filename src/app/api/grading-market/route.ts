import { NextResponse } from "next/server";

import { fetchGradingMarketData } from "@/lib/grading-market";
import { resolveGradingMarketLookupCardName } from "@/lib/grading-market-lookup";
import type { CardLanguageCode, MarketSourceStatus } from "@/types/pokemon";

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
const LOCALIZED_CORE_GRADING_BUDGET_MS = 28_000;

const DEBUG_EVENT_URL = "http://127.0.0.1:7777/event";

function reportGradingMarketDebug(
  hypothesisId: "A" | "C" | "D" | "E",
  location: string,
  msg: string,
  data: Record<string, unknown>,
) {
  // #region debug-point A:grading-market-route
  void fetch(DEBUG_EVENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "grading-population-fetch",
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

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
    cardNumber: string;
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
    },
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
    gradedPrices: [],
    priceHistory: [],
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
  return Promise.race([
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
  const skipSoldComps = searchParams.get("mode") === "core";
  const debugMarket =
    searchParams.get("debug") === "1" || process.env.GRADING_MARKET_DEBUG === "1";

  if (!setName || !cardName || !cardNumber) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const lookupCardName = resolveGradingMarketLookupCardName({
    name: cardName,
    englishName: englishCardName ?? cardName,
    language: (language ?? "en") as CardLanguageCode,
  });
  const lookupEnglishCardName = englishCardName
    ? resolveGradingMarketLookupCardName({
        name: englishCardName,
        englishName: englishCardName,
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

    reportGradingMarketDebug(
      "D",
      "src/app/api/grading-market/route.ts:isChineseLanguage",
      "grading lookup returned early because the card language is unsupported for live identity matching",
      {
        setName,
        cardName,
        cardNumber,
        language,
        mode: searchParams.get("mode"),
      },
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

  if (lacksEnglishMarketIdentity(language, cardName, englishCardName)) {
    const payload = emptyGradingMarketPayload(
      undefined,
      noMatchStatus(
        "Localized grading lookup skipped because no English market identity was available for PriceCharting/TCGFish matching.",
        "Add an English card name mapping before attempting slab/population enrichment for this print.",
      ),
    );

    reportGradingMarketDebug(
      "D",
      "src/app/api/grading-market/route.ts:lacksEnglishMarketIdentity",
      "grading lookup returned early because no English market identity was available",
      {
        setName,
        cardName,
        cardNumber,
        language,
        englishCardName,
        mode: searchParams.get("mode"),
      },
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
      "v21-star-suffix-normalize",
      skipSoldComps ? "core" : "full",
      setName,
      lookupCardName,
      cardNumber,
      setCode ?? "",
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
        setName,
        lookupCardName,
        cardNumber,
        rawMarketPriceUsd ? Number(rawMarketPriceUsd) : undefined,
        setTotal ? Number(setTotal) : undefined,
        rarity ?? undefined,
        {
          setCode: setCode ?? undefined,
          isJapanese: language === "ja",
          language: language ?? undefined,
          englishCardName: lookupEnglishCardName ?? undefined,
          skipSoldComps,
        },
      ),
    );
    const data =
      skipSoldComps && isLocalizedLanguage(language)
        ? await withTimeout(requestPayload, LOCALIZED_CORE_GRADING_BUDGET_MS)
        : await requestPayload;
    const timedOutPayload =
      skipSoldComps && isLocalizedLanguage(language) && !data
        ? emptyGradingMarketPayload(undefined, [
            {
              source: "Grading market enrichment",
              state: "failed" as const,
              confidence: "low" as const,
              confidenceScore: 0.2,
              fetchedAt: new Date().toISOString(),
              note: "Localized core grading lookup exceeded the fast enrichment budget.",
              warning:
                "Retrying with full enrichment (grades, population, sold comps) instead of treating this as an identity miss.",
            },
          ])
        : null;

    const payload = data ?? timedOutPayload ?? emptyGradingMarketPayload();
    const hasSignal = Boolean(
      payload.psaPopulation ||
        payload.gradedPrices?.length ||
        payload.priceHistory?.length ||
        payload.recentSales?.length,
    );
    const debugSummary = summarizeGradingMarketPayload(payload, {
      setName,
      cardName,
      cardNumber,
      setCode,
      mode: searchParams.get("mode"),
    });

    reportGradingMarketDebug(
      timedOutPayload ? "A" : "C",
      "src/app/api/grading-market/route.ts:response",
      "grading market route resolved payload",
      {
        setName,
        cardName,
        cardNumber,
        language,
        mode: searchParams.get("mode"),
        skipSoldComps,
        usedTimedOutPayload: Boolean(timedOutPayload),
        hasSignal,
        counts: debugSummary.counts,
        sourceStates: (payload.sourceStatus ?? payload.evidenceSummary?.sourceStatus ?? []).map(
          (status) => ({
            source: status.source,
            state: status.state,
            confidence: status.confidence,
          }),
        ),
      },
    );

    if (debugMarket) {
      console.info("grading-market payload", debugSummary);
    }

    return NextResponse.json(debugMarket ? { ...payload, debugSummary } : payload, {
      headers: {
        "Cache-Control": hasSignal ? EDGE_CACHE_CONTROL : "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(emptyGradingMarketPayload(error), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
