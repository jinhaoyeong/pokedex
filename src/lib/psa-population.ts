import {
  classifyLocalizedPriceChartingSetSlug,
  getEnglishParallelSetMarketProfile,
  getHeadlineMarketPriceUsd,
  getLocalizedSetMarketProfile,
  getPriceChartingSetSlugVariants,
  getSetMarketAliases,
  isTrustedCatalogMarketPrice,
  shouldPreserveCatalogMarketPrice,
} from "@/lib/localized-set-market";
import {
  hasPopulationTable,
  usesEnglishParallelPsaPopulation,
} from "@/lib/psa-population-attribution";
import { fetchMarketText } from "@/lib/market/http-client";
import {
  classifySoldCompJunk,
  filterJunkSoldComps,
  soldCompJunkRejectLabel,
  type SoldCompJunkOptions,
} from "@/lib/market/sold-comp-hygiene";
import {
  classifyMarketHistory,
  mergeMarketHistoryPointType,
} from "@/lib/market/market-history";
import { hasRetryableMarketSourceFailure } from "@/lib/market/cache-policy";
import { buildMarketCardIdentity } from "@/lib/market/card-identity";
import {
  fetchPriceChartingMarketPrice,
  parsePriceChartingPublicPagePrices,
  parsePriceChartingPublicPageSales,
} from "@/lib/market/pricecharting-provider";
import { findPsa10Usd, gradedCeilingRawUsd } from "@/lib/price/sanity";
import { priceCacheSlugAliases } from "@/lib/price/price-cache-keys";
import { findNmMarketUsd, sanitizeNmMarketUsd } from "@/lib/price/priced-payload";
import { flagThinGradedPrices } from "@/lib/price/thin-grades";
import { resolvePriceChartingSetSlugs } from "@/lib/pricecharting-set-discovery";
import {
  isPopulationCacheEntryFresh,
  populationCacheTtlMs,
  readPopulationCacheEntry,
  writePopulationCacheEntry,
} from "@/lib/grading/population-cache.server";
import {
  buildPopulationKey,
  isPopulationFresh,
  readStoredPopulation,
  writeStoredPopulation,
  type PopulationIdentity,
  type StoredPopulation,
} from "@/lib/psa-population-store.server";
import {
  fetchPublicPageText,
  isPublicPageCircuitOpen,
} from "@/lib/public-page-fetch";
import {
  filterSalesForFinish,
  mageryFinishQueryToken,
  productUrlMatchesFinish,
  withPriceChartingFinishSuffixes,
} from "@/lib/card-finish";
import type {
  CardFinishId,
  GradedPrice,
  GradingService,
  MarketEvidence,
  MarketConfidence,
  MarketSourceStatus,
  MarketHistoryPointType,
  MarketHistorySummary,
  PopulationBreakdown,
  PriceConsensus,
  PriceConsensusSource,
  PricePoint,
  PsaPopulationSnapshot,
  SaleRecord,
  SoldCompReport,
  TcgCard,
} from "@/types/pokemon";

type ExternalMarketLookupOptions = {
  setCode?: string;
  language?: string;
  isJapanese?: boolean;
  englishCardName?: string;
  /** Exact PriceCharting identity resolved by the canonical identity cache. */
  productId?: string;
  productUrl?: string;
  setSlug?: string;
  /** Cache-shaped aliases accepted so callers can forward JapaneseMarketIdentity directly. */
  priceChartingProductId?: string;
  priceChartingProductUrl?: string;
  priceChartingSetSlug?: string;
  identityVersion?: number;
  officialCardId?: string;
  /**
   * Print finish so PriceCharting population, Magery sold comps, and last-sold
   * stay on non-holo vs holo vs reverse instead of blending those markets.
   */
  finish?: CardFinishId;
  /**
   * When false, never HTML-scrape PriceCharting (search/set-browse path).
   * Defaults to true so detail/warmer callers can still fill gaps.
   */
  allowScrape?: boolean;
};

type LivePsaDataLookupOptions = ExternalMarketLookupOptions & {
  skipSoldComps?: boolean;
};

const fetchHtml = fetchPublicPageText;
const fetchPopulationHtml = (url: string) =>
  fetchPublicPageText(url, 43_200, { readerFirst: false, preferHtml: true, priority: true });
// Budgets that cap how long the live market gather can block. Core (price, population,
// graded values) is returned fast; sold comps load with a larger budget in the background.
const CORE_SOURCE_BUDGET_MS = 6_500;
const FULL_SOURCE_BUDGET_MS = 8_000;
// Magery can take 15–20s. Card detail must paint pop/slabs inside 8s, so the
// first sold-comp pass is capped; leftover comps still merge if they arrive.
const SOLD_COMP_SOURCE_BUDGET_MS = 8_000;
const POPULATION_SOURCE_BUDGET_MS = 6_500;

const WHOLE_GRADES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
const HALF_GRADES = ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1"] as const;
const PSA_GRADES = WHOLE_GRADES.map((grade) => `PSA ${grade}`);
const BGS_GRADES = [
  "BGS 10 Black",
  ...HALF_GRADES.map((grade) => `BGS ${grade}`),
];
const CGC_GRADES = ["CGC 10 Pristine", ...HALF_GRADES.map((grade) => `CGC ${grade}`)];
const SGC_GRADES = HALF_GRADES.map((grade) => `SGC ${grade}`);
const TAG_GRADES = WHOLE_GRADES.map((grade) => `TAG ${grade}`);

const SOLD_COMP_GRADES = [
  "Ungraded",
  ...PSA_GRADES,
  ...BGS_GRADES,
  ...CGC_GRADES,
  ...SGC_GRADES,
  ...TAG_GRADES,
] as const;

type LivePsaDataResult = {
  psaPopulation: PsaPopulationSnapshot;
  population: PsaPopulationSnapshot;
  gradedPrices: GradedPrice[];
  priceHistory?: PricePoint[];
  marketHistory?: MarketHistorySummary;
  populationBreakdown?: PopulationBreakdown;
  recentSales?: SaleRecord[];
  evidenceSummary: NonNullable<TcgCard["evidenceSummary"]>;
  sourceStatus: MarketSourceStatus[];
  marketEvidence: MarketEvidence[];
  priceConsensus?: PriceConsensus;
  nmMarketUsd?: number | null;
};

async function readCachedResolvedPrice(slugs: string[]) {
  if (!slugs.length) {
    return null;
  }

  try {
    const { readCachedPriceBySlugs } = await import("@/lib/price/price-cache.server");
    return await readCachedPriceBySlugs(slugs);
  } catch {
    return null;
  }
}

function writeGradingConsensusIntoPriceCache(input: {
  result: LivePsaDataResult;
  cardName: string;
  cardNumber: string;
  options: LivePsaDataLookupOptions;
  nmMarketUsd?: number | null;
}) {
  const ungraded =
    input.result.gradedPrices.find((price) => price.grade === "Ungraded")?.value ??
    input.result.priceConsensus?.finalEstimateUsd ??
    0;
  const slabs = input.result.gradedPrices.filter(
    (price) => price.grade.toLowerCase() !== "ungraded" && price.value > 0,
  );
  if (!(ungraded > 0) && slabs.length === 0) {
    return;
  }

  const slugs = priceCacheSlugAliases({
    slug: "",
    language: input.options.language ?? "en",
    setCode: input.options.setCode,
    collectorNumber: input.cardNumber,
    officialCardId: input.options.officialCardId,
  });
  if (!slugs.length) {
    return;
  }

  const usedPriceCharting = input.result.sourceStatus.some(
    (status) =>
      /pricecharting/i.test(status.source) &&
      (status.state === "ready" || status.state === "cached" || status.state === "fallback"),
  );
  const provider = usedPriceCharting ? "pricecharting-api" : "ebay";
  const fetchedAt = new Date().toISOString();
  const resolved = {
    slug: slugs[0],
    ungradedUsd: ungraded > 0 ? ungraded : 0,
    confidenceScore: input.result.priceConsensus?.confidenceScore ?? 0.7,
    primaryProvider: provider,
    nmMarketUsd: input.nmMarketUsd ?? null,
    results: [
      {
        provider,
        sourceLabel: "Grading market consensus",
        ungradedUsd: ungraded > 0 ? ungraded : 0,
        confidenceScore: input.result.priceConsensus?.confidenceScore ?? 0.7,
        matchConfidence: 0.9,
        evidenceType: (input.result.recentSales?.length ?? 0) > 0 ? "sold_comp" as const : "guide_snapshot" as const,
        gradedPrices: input.result.gradedPrices.filter((price) => price.value > 0),
        sales: input.result.recentSales,
        sampleCount: input.result.recentSales?.length || input.result.priceConsensus?.sampleCount || 1,
        fetchedAt,
      },
    ],
    fetchedAt,
  };

  void import("@/lib/price/price-cache.server")
    .then(({ writeCachedPrice }) => {
      for (const slug of slugs) {
        void writeCachedPrice(
          { ...resolved, slug },
          { language: input.options.language, setCode: input.options.setCode },
        );
      }
    })
    .catch(() => undefined);
}

type ConsensusObservation = PriceConsensusSource & {
  weight: number;
};

type RejectedReasonCounts = Record<string, number>;

type SoldCompParseResult = {
  accepted: SaleRecord[];
  rejected: number;
  rejectedReasonCounts: RejectedReasonCounts;
};

function isStrictAttributedPriceChartingSale(sale: SaleRecord) {
  const productUrl = sale.sourceUrl?.trim() ?? "";

  return Boolean(
    sale.evidenceType === "sold_comp" &&
      /^PriceCharting completed\b/i.test(sale.source) &&
      /^https?:\/\/(?:www\.)?pricecharting\.com\/game\//i.test(productUrl) &&
      sale.listingUrl?.trim() &&
      Number.isFinite(Date.parse(sale.date)) &&
      Number.isFinite(sale.price) &&
      sale.price > 0,
  );
}

function canonicalSoldListingKey(listingUrl?: string) {
  const rawUrl = listingUrl?.trim();
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const ebayItemId = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?#]|$)/i)?.[1];
    const explicitItemId =
      ebayItemId ??
      url.searchParams.get("item") ??
      url.searchParams.get("itemId") ??
      url.searchParams.get("listingId");

    if (explicitItemId) {
      return `listing:${hostname}:${explicitItemId.toLowerCase()}`;
    }

    for (const parameter of [
      "campid",
      "customid",
      "mkcid",
      "mkevt",
      "mkrid",
      "siteid",
      "toolid",
      "utm_campaign",
      "utm_medium",
      "utm_source",
    ]) {
      url.searchParams.delete(parameter);
    }

    url.hash = "";
    url.hostname = hostname;
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return `url:${rawUrl.toLowerCase()}`;
  }
}

function soldCompDedupeKey(sale: SaleRecord) {
  return (
    canonicalSoldListingKey(sale.listingUrl) ??
    [
      "facts",
      sale.date,
      sale.condition.toLowerCase(),
      Math.round(sale.price * 100),
      normalizeCardName(sale.title).toLowerCase(),
    ].join(":")
  );
}

function soldCompEvidenceRank(sale: SaleRecord) {
  return (
    (/^PriceCharting completed\b/i.test(sale.source) ? 1_000 : 0) +
    (sale.listingUrl ? 100 : 0) +
    (sale.sourceUrl ? 40 : 0) +
    (sale.seller ? 10 : 0) +
    Math.round((sale.confidenceScore ?? 0) * 10)
  );
}

/** Merge independently parsed sold feeds without double-counting the same listing. */
export function mergeAttributedSoldComps(
  magerySales: SaleRecord[],
  priceChartingSales: SaleRecord[],
  junkOptions?: SoldCompJunkOptions,
) {
  const candidates = filterJunkSoldComps(
    [
      ...magerySales,
      ...priceChartingSales.filter(isStrictAttributedPriceChartingSale),
    ],
    junkOptions,
  ).sort((left, right) => {
    const evidenceDifference = soldCompEvidenceRank(right) - soldCompEvidenceRank(left);
    if (evidenceDifference !== 0) {
      return evidenceDifference;
    }

    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
  const deduped = new Map<string, SaleRecord>();

  for (const sale of candidates) {
    const key = soldCompDedupeKey(sale);
    if (!deduped.has(key)) {
      deduped.set(key, sale);
    }
  }

  return [...deduped.values()].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.condition.localeCompare(right.condition) ||
      left.price - right.price ||
      left.title.localeCompare(right.title) ||
      left.source.localeCompare(right.source),
  );
}

type PriceChartingPopulationResult = {
  population: PsaPopulationSnapshot;
  gradedPrices: Map<string, GradedPrice>;
  discoveredItemUrls?: string[];
  matchScore?: number;
  sourceKind: "item" | "set_index";
  sales?: SaleRecord[];
};

const MARKET_RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
type MarketResultRuntime = {
  cache: Map<string, { expiresAt: number; value: LivePsaDataResult }>;
  inFlight: Map<string, Promise<LivePsaDataResult | null>>;
};
const globalMarketResultRuntime = globalThis as typeof globalThis & {
  __pokedexMarketResultRuntime?: MarketResultRuntime;
};
const marketResultRuntime =
  globalMarketResultRuntime.__pokedexMarketResultRuntime ??
  (globalMarketResultRuntime.__pokedexMarketResultRuntime = {
    cache: new Map(),
    inFlight: new Map(),
  });
const marketResultCache = marketResultRuntime.cache;

function nowIso() {
  return new Date().toISOString();
}

const IMPORT_MARKET_LABELS: Record<string, string> = {
  ja: "Japanese",
  ko: "Korean",
  "zh-tw": "Chinese",
  "zh-cn": "Chinese",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  "pt-br": "Portuguese",
  "pt-pt": "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  id: "Indonesian",
  th: "Thai",
};

function isEnglishParallelPriceChartingPopulationResult(
  result: PriceChartingPopulationResult | null | undefined,
  setCode: string | undefined,
) {
  if (!result) {
    return false;
  }

  if (usesEnglishParallelPsaPopulation(result.population)) {
    return true;
  }

  if (!setCode) {
    return false;
  }

  const sourceUrls = [
    result.population.sourceUrl,
    ...[...result.gradedPrices.values()].map((price) => price.sourceUrl),
  ].filter((url): url is string => Boolean(url));

  return sourceUrls.some(
    (url) =>
      classifyLocalizedPriceChartingSetSlug(setCode, url) === "english_parallel",
  );
}

function cleanLookupIdentityField(value?: string) {
  const cleanValue = value?.trim();
  return cleanValue || undefined;
}

function canonicalPriceChartingProductUrl(value?: string) {
  const cleanValue = cleanLookupIdentityField(value);
  if (!cleanValue) {
    return undefined;
  }

  try {
    const url = new URL(cleanValue);
    if (
      !/(^|\.)pricecharting\.com$/i.test(url.hostname) ||
      !/^\/game\/[^/]+\/[^/]+\/?$/i.test(url.pathname)
    ) {
      return undefined;
    }

    url.protocol = "https:";
    url.hostname = "www.pricecharting.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function priceChartingIdentityFields(options: ExternalMarketLookupOptions) {
  return {
    productId: cleanLookupIdentityField(
      options.productId ?? options.priceChartingProductId,
    ),
    productUrl: canonicalPriceChartingProductUrl(
      options.productUrl ?? options.priceChartingProductUrl,
    ),
    setSlug: cleanLookupIdentityField(
      options.setSlug ?? options.priceChartingSetSlug,
    ),
  };
}

function marketCacheKey(
  setName: string,
  cardName: string,
  cardNumber: string,
  rawMarketPriceUsd?: number,
  setTotal?: number,
  cardRarity?: string,
  options: LivePsaDataLookupOptions = {},
) {
  const exactIdentity = priceChartingIdentityFields(options);

  return [
    "v25-core-keeps-pc-sales",
    options.skipSoldComps ? "core" : "full",
    (options.language ?? "en").toLowerCase(),
    (options.setCode ?? "").toLowerCase(),
    normalizeCardName(setName).toLowerCase(),
    normalizeCardName(cardName).toLowerCase(),
    cardNumber.trim().toLowerCase(),
    typeof setTotal === "number" ? setTotal : "",
    normalizeCardName(cardRarity ?? "").toLowerCase(),
    typeof rawMarketPriceUsd === "number" && Number.isFinite(rawMarketPriceUsd)
      ? rawMarketPriceUsd.toFixed(2)
      : "",
    exactIdentity.productId?.toLowerCase() ?? "",
    exactIdentity.productUrl?.toLowerCase() ?? "",
    exactIdentity.setSlug?.toLowerCase() ?? "",
    options.officialCardId?.trim().toLowerCase() ?? "",
    Number.isFinite(options.identityVersion) ? Math.trunc(options.identityVersion!) : "",
    options.finish ?? "",
  ].join("|");
}

function shouldUseAppMarketCache() {
  return process.env.MARKET_DATA_CACHE !== "false";
}

function cloneMarketResult(result: LivePsaDataResult): LivePsaDataResult {
  return structuredClone(result);
}

function shouldSkipCachingIncompleteJapanesePopulation(
  result: LivePsaDataResult,
  options: { language?: string; setCode?: string },
) {
  const language = options.language?.toLowerCase();
  const setCode = options.setCode?.trim().toUpperCase() ?? "";

  if (language !== "ja" || !setCode) {
    return false;
  }

  const profile = getLocalizedSetMarketProfile(setCode);

  if (!profile?.priceChartingSlug) {
    return false;
  }

  return !hasPopulationTable(result.psaPopulation);
}

/**
 * A "signal" result earns the long TTL. Empty results — and Japanese results
 * whose population table came back incomplete for a set that should have one —
 * are still cached, but only as short-lived negative entries so a bot-walled
 * source is not re-scraped on every view yet self-heals within hours.
 */
function marketResultHasSignal(
  result: LivePsaDataResult,
  options: { language?: string; setCode?: string },
) {
  return (
    hasMarketDataBeyondCatalog(result) &&
    !shouldSkipCachingIncompleteJapanesePopulation(result, options)
  );
}

function hasStrongNonCatalogSlabValues(result: LivePsaDataResult) {
  return result.gradedPrices.some(
    (price) =>
      price.grade !== "Ungraded" &&
      price.value > 0 &&
      (price.evidenceType !== "guide_snapshot" ||
        (price.saleCount ?? 0) > 0 ||
        price.populationCount > 1),
  );
}

function shouldBypassCachedThinMarketResult(result: LivePsaDataResult) {
  return (
    isThinPublicPopulationSnapshot(result.psaPopulation) ||
    (!hasPopulationSignal(result.psaPopulation) &&
      !(result.recentSales?.length ?? 0) &&
      !hasStrongNonCatalogSlabValues(result))
  );
}

function annotateCachedMarketResult(value: LivePsaDataResult): LivePsaDataResult {
  value.sourceStatus = [
    {
      source: "App market cache",
      state: "cached",
      confidence: "medium",
      confidenceScore: 0.7,
      fetchedAt: nowIso(),
      note: "Returned a recent server-side market result to keep the card detail fast and avoid repeated public/API calls.",
    },
    ...value.sourceStatus,
  ];
  value.evidenceSummary = {
    ...value.evidenceSummary,
    sourceStatus: value.sourceStatus,
  };
  return value;
}

async function readCachedMarketResult(
  cacheKey: string,
  options: { language?: string; setCode?: string } = {},
): Promise<LivePsaDataResult | null> {
  if (!shouldUseAppMarketCache()) {
    return null;
  }

  const cached = marketResultCache.get(cacheKey);

  if (cached) {
    if (cached.expiresAt > Date.now()) {
      if (shouldBypassCachedThinMarketResult(cached.value)) {
        marketResultCache.delete(cacheKey);
        return null;
      }
      return annotateCachedMarketResult(cloneMarketResult(cached.value));
    }

    marketResultCache.delete(cacheKey);
  }

  // Warm-instance miss: fall through to the persistent Supabase cache so a
  // fresh serverless instance still skips the 20-40s scrape.
  const entry = await readPopulationCacheEntry<LivePsaDataResult>(cacheKey, "market_result");

  if (!entry || !isPopulationCacheEntryFresh(entry)) {
    return null;
  }

  if (shouldBypassCachedThinMarketResult(entry.payload)) {
    return null;
  }

  const remainingTtlMs = populationCacheTtlMs(entry.hasSignal) - entry.ageMs;
  marketResultCache.set(cacheKey, {
    expiresAt:
      Date.now() + Math.max(0, Math.min(MARKET_RESULT_CACHE_TTL_MS, remainingTtlMs)),
    value: cloneMarketResult(entry.payload),
  });

  return annotateCachedMarketResult(cloneMarketResult(entry.payload));
}

function writeCachedMarketResult(
  cacheKey: string,
  value: LivePsaDataResult,
  options: { language?: string; setCode?: string } = {},
) {
  if (!shouldUseAppMarketCache()) {
    return;
  }

  // A deadline/circuit/provider failure is retryable state, not negative
  // identity evidence. Do not freeze the partial failure in process or DB.
  if (hasRetryableMarketSourceFailure(value.sourceStatus)) {
    return;
  }

  const hasSignal = marketResultCacheHasSignal(value, options);
  marketResultCache.set(cacheKey, {
    expiresAt:
      Date.now() + Math.min(MARKET_RESULT_CACHE_TTL_MS, populationCacheTtlMs(hasSignal)),
    value: cloneMarketResult(value),
  });

  // Best-effort persistent write; never blocks the response.
  void writePopulationCacheEntry(cacheKey, "market_result", value, {
    hasSignal,
    language: options.language ?? null,
    setCode: options.setCode ?? null,
  });
}

function hasMarketDataBeyondCatalog(result: LivePsaDataResult) {
  return (
    (hasPopulationSignal(result.psaPopulation) &&
      !isThinPublicPopulationSnapshot(result.psaPopulation)) ||
    hasStrongNonCatalogSlabValues(result) ||
    (result.recentSales?.length ?? 0) > 0 ||
    result.marketEvidence.some((evidence) => evidence.evidenceType !== "catalog") ||
    Boolean(
      result.priceConsensus?.sources.some(
        (source) => source.evidenceType !== "catalog",
      ),
    )
  );
}

/**
 * Population + guide snapshots alone must not lock a 7-day cache when sold comps
 * came back empty — that freezes chart.all_projected / sold.shortfall for hours
 * after a Magery outage. Treat sold-empty market results as short-TTL negatives.
 */
function marketResultHasDurableSoldSignal(result: LivePsaDataResult) {
  if ((result.recentSales?.length ?? 0) > 0) {
    return true;
  }

  const soldStatus = result.sourceStatus.find(
    (status) => status.source === "Public sold-listing comps",
  );

  // ready with sampleCount>0 is durable; no_match/failed/missing means retry soon.
  return Boolean(soldStatus && soldStatus.state === "ready" && (soldStatus.sampleCount ?? 0) > 0);
}

/**
 * Pending / empty population must not earn the long TTL — otherwise a PriceCharting
 * circuit trip freezes pop.pending for hours and the validator keeps WARNing.
 */
function marketResultHasDurablePopulationSignal(result: LivePsaDataResult) {
  const population = result.psaPopulation;
  if (!population) {
    return false;
  }

  if (population.status === "pending") {
    return false;
  }

  return hasPopulationSignal(population);
}

function marketResultCacheHasSignal(
  result: LivePsaDataResult,
  options: { language?: string; setCode?: string },
) {
  return (
    marketResultHasSignal(result, options) &&
    marketResultHasDurableSoldSignal(result) &&
    marketResultHasDurablePopulationSignal(result)
  );
}

function sourceStatus({
  source,
  state,
  confidence = "low",
  confidenceScore = 0.35,
  note,
  sourceUrl,
  latencyMs,
  sampleCount,
  warning,
}: {
  source: string;
  state: MarketSourceStatus["state"];
  confidence?: MarketConfidence;
  confidenceScore?: number;
  note: string;
  sourceUrl?: string;
  latencyMs?: number;
  sampleCount?: number;
  warning?: string;
}): MarketSourceStatus {
  return {
    source,
    state,
    confidence,
    confidenceScore,
    fetchedAt: nowIso(),
    note,
    sourceUrl,
    latencyMs,
    sampleCount,
    warning,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown source error";
}

function slugify(text: string) {
  return text
    .replace(/[\u2605\u2606]/g, " star ")
    .replace(/Γÿà|γÿà|â˜…|â˜†|★|☆/g, " star ")
    .replace(/[★☆]/g, " star ")
    .normalize("NFKD")
    // Drop combining accents so "Pokémon"/"Flabébé" slug as "pokemon"/"flabebe",
    // not "poke-mon"/"flabe-be".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "-s")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function priceChartingSlugify(text: string) {
  return slugify(text).replace(/-star\b/g, "-gold-star");
}

/** PriceCharting keeps literal ampersands in card slugs (e.g. arceus-&-dialga-&-palkia-gx). */
function priceChartingAmpersandSlug(text: string) {
  return normalizeCardName(text)
    .toLowerCase()
    .replace(/\s*&\s*/g, "-&-")
    .replace(/[^a-z0-9&-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function priceChartingSetSlugVariants(
  setName: string,
  options: ExternalMarketLookupOptions = {},
) {
  const { setSlug } = priceChartingIdentityFields(options);
  return [
    ...new Set(
      [setSlug, ...getPriceChartingSetSlugVariants(setName, options)]
        .map((slug) => slug?.trim().replace(/^\/+|\/+$/g, ""))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ];
}

function isMostlyNonLatinCardName(text: string) {
  const letters = text.replace(/[^a-zA-Z\u00C0-\u024F\u3040-\u30FF\u4E00-\u9FFF]/g, "");

  if (!letters.length) {
    return true;
  }

  const latin = (letters.match(/[a-zA-Z\u00C0-\u024F]/g) ?? []).length;
  return latin / letters.length < 0.35;
}

function isWeakPriceChartingNameSlug(nameSlug: string) {
  const cleaned = nameSlug.trim().toLowerCase();

  return (
    !cleaned ||
    cleaned.length < 3 ||
    /^&/.test(cleaned) ||
    /^-&/.test(cleaned) ||
    /^(gx|ex|v|vmax|vstar|sr|rr|ar|sar|csr)$/.test(cleaned)
  );
}

function cardNameSlugVariantsForExternalApis(
  cardName: string,
  preferred: "standard" | "pricecharting" = "standard",
  options: ExternalMarketLookupOptions = {},
) {
  const englishName = options.englishCardName?.trim();
  const primaryName =
    englishName && (isMostlyNonLatinCardName(cardName) || !/[a-z]/i.test(cardName))
      ? englishName
      : cardName;
  const normalized = normalizeCardName(primaryName);
  const marketAliases = marketCardNameAliases(normalized);
  const candidates = marketAliases.flatMap((alias) => {
    const starAlias = /\bgold star\b/i.test(alias)
      ? alias.replace(/\bgold star\b/i, "Star")
      : alias.replace(/\bstar\b/i, "Gold Star");
    const ampersandSlug = alias.includes("&") ? priceChartingAmpersandSlug(alias) : "";
    const ampersandStarSlug =
      starAlias.includes("&") && starAlias !== alias
        ? priceChartingAmpersandSlug(starAlias)
        : "";

    return preferred === "pricecharting"
      ? [
          ampersandSlug,
          priceChartingSlugify(alias),
          slugify(alias),
          ampersandStarSlug,
          priceChartingSlugify(starAlias),
          slugify(starAlias),
        ]
      : [
          // TCGFish product paths use "and", not literal "&". Prefer those first
          // so TAG TEAM names do not burn the URL budget on 404 ampersand slugs.
          slugify(alias.replace(/\s*&\s*/g, " and ")),
          slugify(alias.replace(/\s*&\s*/g, " ")),
          slugify(alias),
          ampersandSlug,
          priceChartingSlugify(alias),
          ampersandStarSlug,
          slugify(starAlias),
          priceChartingSlugify(starAlias),
        ];
  });

  return [...new Set(candidates.filter((candidate) => !isWeakPriceChartingNameSlug(candidate)))];
}

function marketCardNameAliases(cardName: string) {
  const normalized = normalizeCardName(cardName);
  const aliases: string[] = [];
  const push = (value: string) => {
    const cleanValue = normalizeCardName(value);
    if (cleanValue && !aliases.some((alias) => alias.toLowerCase() === cleanValue.toLowerCase())) {
      aliases.push(cleanValue);
    }
  };
  const strippedDescriptors = normalized
    .replace(
      /\b(?:alternate\s+art|special\s+illustration\s+rare|illustration\s+rare|rare\s+holo|holo|promo|full\s+art)\b/gi,
      " ",
    )
    .replace(/\b(?:neo\s+genesis|expedition(?:\s+base\s+set)?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Pokemon TCG API often appends finish words ("Arceus VSTAR Gold") that
  // PriceCharting/TCGFish omit from the product slug ("arceus-vstar-gg70").
  // Never strip "Gold Star" — that is a real card identity.
  const withoutTrailingFinish = /\bgold\s+star\b/i.test(normalized)
    ? strippedDescriptors
    : strippedDescriptors.replace(/\s+\b(?:gold|silver|rainbow)\s*$/i, "").trim();
  // TAG TEAM / & names: PriceCharting often uses literal "&", TCGFish often uses "and".
  const ampersandAsAnd = withoutTrailingFinish.replace(/\s*&\s*/g, " and ");
  const ampersandCompact = withoutTrailingFinish.replace(/\s*&\s*/g, " ");

  if (/\b1st\s+edition\b/i.test(normalized)) {
    push(strippedDescriptors);
  }

  push(withoutTrailingFinish);
  push(ampersandAsAnd);
  push(ampersandCompact);
  push(strippedDescriptors);
  push(normalized);

  // Lone ★ / trailing "Star" (not "Gold Star") — guides often use the base name
  // when set + collector number identify the print (e.g. POP5 Umbreon ★).
  if (!/\bgold\s+star\b/i.test(normalized)) {
    const withoutLoneStar = normalized.replace(/\s+star\s*$/i, "").trim();
    if (withoutLoneStar && withoutLoneStar.toLowerCase() !== normalized.toLowerCase()) {
      push(withoutLoneStar);
    }
  }

  return aliases;
}

function promoCollectorNumberParts(collectorNumber: string) {
  const trimmed = collectorNumber.trim();
  const match = trimmed.match(/^([A-Za-z]{2,5})[-\s]?(\d{1,3})([A-Za-z]?)$/);

  if (!match) {
    return null;
  }

  const prefix = match[1].toLowerCase();
  const rawNumber = match[2];
  const number = rawNumber.replace(/^0+/, "") || rawNumber;
  const suffix = (match[3] ?? "").toLowerCase();

  return { prefix, rawNumber, number, suffix };
}

function promoCollectorNumberTokenVariants(collectorNumber: string) {
  const parts = promoCollectorNumberParts(collectorNumber);

  if (!parts) {
    return [];
  }

  const { prefix, rawNumber, number, suffix } = parts;
  const variants = new Set<string>([
    `${prefix}${rawNumber}${suffix}`,
    `${prefix}${number.padStart(3, "0")}${suffix}`,
    `${prefix}${number.padStart(2, "0")}${suffix}`,
    `${prefix}${number}${suffix}`,
    `${number}${suffix}`,
    number,
    `${prefix}${number}${suffix}`.toUpperCase(),
    `${number}${suffix}`.toUpperCase(),
  ]);

  if (suffix) {
    variants.add(`${number}${suffix}`);
    variants.add(`${prefix}${number}${suffix}`);
  }

  return [...variants].map((variant) => variant.trim().replace(/^#/, "")).filter(Boolean);
}

export function numberSlugVariantsForExternalApis(
  collectorNumber: string,
  setTotal?: number,
): string[] {
  const raw = collectorNumber.trim();
  const primary = slugify(raw.replace(/^0+/, ""));
  const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
  const variants = new Set<string>([primary]);
  const baseNumber = parts[0]?.replace(/^0+/, "") || raw.replace(/^0+/, "") || raw;
  const promoParts = promoCollectorNumberParts(raw);

  for (const promoVariant of promoCollectorNumberTokenVariants(raw)) {
    variants.add(slugify(promoVariant));
  }

  if (parts.length === 2) {
    const a = baseNumber || "0";
    const b = parts[1].replace(/^0+/, "") || "0";
    const flipped = slugify(`${b}/${a}`);
    variants.add(slugify(`${a}/${b}`));

    if (flipped !== primary) {
      variants.add(flipped);
    }
  }

  if (typeof setTotal === "number" && Number.isFinite(setTotal) && setTotal > 0) {
    variants.add(slugify(`${baseNumber}/${setTotal}`));
  }

  if (baseNumber) {
    variants.add(slugify(baseNumber));
    variants.add(slugify(baseNumber.padStart(3, "0")));
  }

  const ordered = [...variants];

  // PriceCharting promo item URLs keep the era prefix and 3-digit body:
  // `/pikachu-swsh020`, `/luxray-swsh023`. Catalog numbers sometimes arrive as
  // SWSH23 / 23; those must not be probed first or the 4s pop budget expires
  // on 404s before the real URL is tried.
  if (promoParts) {
    const padded3 = slugify(
      `${promoParts.prefix}${promoParts.number.padStart(3, "0")}${promoParts.suffix}`,
    );
    const rawSlug = slugify(raw);
    const padPromoToThreeDigits = /^(swsh|sv|sm|xy|bw)$/.test(promoParts.prefix);
    const preferred = (padPromoToThreeDigits ? [padded3, rawSlug] : [rawSlug, padded3]).filter(
      (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
    );

    return [...preferred, ...ordered.filter((variant) => !preferred.includes(variant))];
  }

  if (baseNumber) {
    const baseSlug = slugify(baseNumber);

    if (baseSlug && ordered[0] !== baseSlug) {
      return [baseSlug, ...ordered.filter((variant) => variant !== baseSlug)];
    }
  }

  return ordered;
}

function buildPriceChartingPopulationItemUrls(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
) {
  const { productUrl } = priceChartingIdentityFields(options);
  const exactItemUrl = productUrl
    ? toPriceChartingPopulationItemUrl(productUrl)
    : undefined;
  const setSlugs = priceChartingSetSlugVariants(setName, options);
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting", options);
  const numberSlugs = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const urls = setSlugs.flatMap((setSlug) =>
    nameSlugs.flatMap((nameSlug) =>
      numberSlugs.flatMap((numberSlug) => {
        const baseUrl = `https://www.pricecharting.com/pop/item/${setSlug}/${nameSlug}-${numberSlug}`;
        return withPriceChartingFinishSuffixes(baseUrl, options.finish);
      }),
    ),
  );

  const exactUrls = exactItemUrl
    ? withPriceChartingFinishSuffixes(exactItemUrl, options.finish).filter((url) =>
        productUrlMatchesFinish(url, options.finish),
      )
    : [];

  return [...new Set([...exactUrls, ...urls].filter((url): url is string => Boolean(url)))].slice(
    0,
    8,
  );
}

function retryableFailureState(error: unknown): MarketSourceStatus["state"] {
  const message = errorMessage(error).toLowerCase();
  if (/budget exceeded|timed?\s*out|timeout|aborted/.test(message)) {
    return "timeout";
  }
  if (/circuit open|cooldown|cooling down/.test(message)) {
    return "circuit_open";
  }
  return "provider_error";
}

function buildPriceChartingSetPopulationUrls(
  setName: string,
  options: ExternalMarketLookupOptions = {},
) {
  return priceChartingSetSlugVariants(setName, options)
    .map((setSlug) => `https://www.pricecharting.com/pop/set/${setSlug}`)
    .slice(0, 4);
}

function buildTcgFishCardUrl(setSlug: string, nameSlug: string, collectorNumberSlug: string) {
  return `https://www.tcgfish.net/pokemon-set/${setSlug}/${nameSlug}-${collectorNumberSlug}`;
}

function isLikelyBotWallHtml(html: string) {
  return html.length < 12_000 && /\bjust a moment\b/i.test(html);
}

function pendingPsaPopulation(url: string, note: string): PsaPopulationSnapshot {
  return {
    status: "pending",
    totalCertified: null,
    grades: [],
    source: "Population source unavailable",
    fetchedAt: new Date().toISOString(),
    sourceUrl: url,
    note,
    service: "PSA",
    confidence: "low",
    confidenceScore: 0.2,
    evidenceType: "population",
    warning: "Population source did not expose usable counts.",
  };
}

function gradeService(grade: string): GradingService {
  if (grade === "Ungraded") return "RAW";
  if (grade.startsWith("PSA")) return "PSA";
  if (grade.startsWith("BGS") || grade.startsWith("BECKETT")) return "BGS";
  if (grade.startsWith("CGC")) return "CGC";
  if (grade.startsWith("SGC")) return "SGC";
  if (grade.startsWith("TAG")) return "TAG";
  return "RAW";
}

function confidenceFromScore(score: number): MarketConfidence {
  if (score >= 0.78) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function soldCompConfidence(sales: SaleRecord[], snapshot?: GradedPrice) {
  const saleCount = sales.length;
  const hasSnapshot = Boolean(snapshot?.value && snapshot.value > 0);
  const score = Math.min(
    0.95,
    saleCount >= 6 ? 0.9 : saleCount >= 3 ? 0.78 : saleCount >= 2 ? 0.62 : hasSnapshot ? 0.48 : 0.34,
  );

  return {
    confidence: confidenceFromScore(score),
    confidenceScore: score,
  };
}

function guideConfidence(source?: string) {
  const score = source?.includes("TCGFish") ? 0.58 : 0.52;
  return {
    confidence: confidenceFromScore(score),
    confidenceScore: score,
  };
}

function priceSnapshotPriority(price: GradedPrice) {
  const source = price.source ?? "";
  const isPsa = /^PSA\s+\d+/i.test(price.grade);
  const isUngraded = price.grade === "Ungraded";

  if (source.includes("PriceCharting population")) {
    return isPsa ? 96 : 78;
  }

  if (source.includes("PriceCharting PSA price guide")) {
    return isPsa ? 90 : 72;
  }

  if (source.includes("PriceCharting API")) {
    return isPsa ? 86 : 74;
  }

  if (source.includes("TCGFish")) {
    return isPsa ? 76 : 66;
  }

  if (source.includes("PriceCharting extended grader")) {
    return isPsa ? 72 : 64;
  }

  if (source.includes("PriceCharting graded guide")) {
    return isPsa ? 70 : 60;
  }

  if (isUngraded && source.includes("catalog")) {
    return 68;
  }

  return isPsa ? 56 : 48;
}

function shouldPreferIncomingPriceSnapshot(
  incoming: GradedPrice,
  current?: GradedPrice,
) {
  if (!current) {
    return true;
  }

  const priorityDelta = priceSnapshotPriority(incoming) - priceSnapshotPriority(current);

  if (priorityDelta !== 0) {
    return priorityDelta > 0;
  }

  return (incoming.confidenceScore ?? 0) > (current.confidenceScore ?? 0);
}

function reconcileSnapshotPrices(
  candidates: GradedPrice[],
  selected: Map<string, GradedPrice>,
) {
  const byGrade = new Map<string, GradedPrice[]>();

  for (const price of candidates) {
    if (!(price.value > 0)) {
      continue;
    }

    const list = byGrade.get(price.grade) ?? [];
    list.push(price);
    byGrade.set(price.grade, list);
  }

  const reconciled = new Map(selected);

  for (const [grade, prices] of byGrade.entries()) {
    if (prices.length < 2) {
      continue;
    }

    const values = prices.map((price) => price.value).sort((left, right) => left - right);
    const low = values[0];
    const high = values[values.length - 1];

    if (high / Math.max(low, 1) < 4) {
      continue;
    }

    const medianValue = median(values);
    const preferred =
      prices.find((price) => /public guide/i.test(price.source ?? "")) ??
      prices.find((price) => !/population/i.test(price.source ?? "")) ??
      prices.reduce((best, price) =>
        priceSnapshotPriority(price) > priceSnapshotPriority(best) ? price : best,
      );

    reconciled.set(grade, {
      ...preferred,
      value: Math.round(medianValue * 100) / 100,
      source: `${preferred.source ?? "Guide snapshot"} (robust median)`,
      confidence: "medium",
      confidenceScore: Math.min(preferred.confidenceScore ?? 0.56, 0.62),
      warning: `Multiple ${grade} guide snapshots disagreed (${values.map((value) => `$${value}`).join(" vs ")}); using median $${Math.round(medianValue * 100) / 100}.`,
    });
  }

  return reconciled;
}

function sourceWeightFromConfidence(score: number) {
  if (score >= 0.88) return 1.3;
  if (score >= 0.75) return 1.1;
  if (score >= 0.6) return 0.95;
  if (score >= 0.5) return 0.8;
  return 0.62;
}

function weightedAverageConsensus(observations: ConsensusObservation[]) {
  const totalWeight = observations.reduce((sum, item) => sum + item.weight, 0);

  if (!totalWeight) {
    return 0;
  }

  return (
    observations.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
  );
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function catalogLooksLikePlaceholderAgainstValues(
  catalogValueUsd: number,
  evidenceValues: number[],
  ratio = 0.25,
) {
  if (!(catalogValueUsd >= 1)) {
    return false;
  }

  const baseline = robustMedian(
    evidenceValues.filter((value) => Number.isFinite(value) && value > 0),
  );

  return baseline >= 500 && catalogValueUsd < baseline * ratio;
}

function incrementRejectedReason(reasons: RejectedReasonCounts, reason: string) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function mergeRejectedReasonCounts(
  left: RejectedReasonCounts,
  right: RejectedReasonCounts,
) {
  const merged = { ...left };

  for (const [reason, count] of Object.entries(right)) {
    merged[reason] = (merged[reason] ?? 0) + count;
  }

  return merged;
}

function sortedSalesByRecency(sales: SaleRecord[]) {
  return [...sales].sort(compareSaleRecency);
}

function compareSaleRecency(left: SaleRecord, right: SaleRecord) {
  return chartTimelineSortKey(right.date) - chartTimelineSortKey(left.date);
}

function recencyWeightedAverage(sales: SaleRecord[]) {
  if (!sales.length) {
    return 0;
  }

  const sorted = sortedSalesByRecency(sales);
  const latestTime = Math.max(...sorted.map((sale) => chartTimelineSortKey(sale.date)));
  let totalWeight = 0;
  let weightedSum = 0;

  for (const sale of sorted) {
    const saleTime = chartTimelineSortKey(sale.date);
    const daysOld = Number.isFinite(saleTime) && Number.isFinite(latestTime)
      ? Math.max(0, (latestTime - saleTime) / 86_400_000)
      : 30;
    const recencyWeight = 1 / (1 + daysOld / 21);
    const confidenceWeight = 0.55 + (sale.confidenceScore ?? 0.45);
    const weight = recencyWeight * confidenceWeight;
    weightedSum += sale.price * weight;
    totalWeight += weight;
  }

  return totalWeight ? weightedSum / totalWeight : average(sorted.map((sale) => sale.price));
}

function buildSoldCompReport({
  grade,
  sales,
  rejectedCount,
  rejectedReasonCounts,
  snapshot,
}: {
  grade: string;
  sales: SaleRecord[];
  rejectedCount: number;
  rejectedReasonCounts: RejectedReasonCounts;
  snapshot?: GradedPrice;
}): SoldCompReport | undefined {
  if (!sales.length) {
    return undefined;
  }

  const sorted = sortedSalesByRecency(sales);
  const recentSales = sorted.slice(0, 8);
  const prices = recentSales.map((sale) => sale.price).filter((price) => Number.isFinite(price) && price > 0);

  if (!prices.length) {
    return undefined;
  }

  const latest = sorted[0];
  const medianUsd = robustMedian(prices);
  const averageUsd = average(prices);
  const trimmedPrices = prices.filter(
    (price) => price >= medianUsd / 2.8 && price <= medianUsd * 2.8,
  );
  const trustedPrices = trimmedPrices.length ? trimmedPrices : prices;
  const trimmedAverageUsd = average(trustedPrices);
  const recencyWeightedUsd = recencyWeightedAverage(recentSales);
  const suspiciousSignals: string[] = [];
  let suspiciousCount = prices.length - trustedPrices.length;
  const snapshotLooksLikeCatalogPlaceholder =
    snapshot?.evidenceType === "catalog" &&
    catalogLooksLikePlaceholderAgainstValues(snapshot.value, trustedPrices.length ? trustedPrices : prices);

  if (suspiciousCount > 0) {
    suspiciousSignals.push(`${suspiciousCount} accepted comp${suspiciousCount === 1 ? "" : "s"} ignored as price outliers.`);
  }

  if (latest && prices.length >= 2 && (latest.price > medianUsd * 2.4 || latest.price < medianUsd / 2.4)) {
    suspiciousCount += 1;
    suspiciousSignals.push("Latest sale is far from the recent median, so it was not allowed to control the price.");
  }

  if (
    snapshot?.value &&
    snapshot.value > 0 &&
    prices.length <= 2 &&
    (averageUsd > snapshot.value * 3.8 || averageUsd < snapshot.value / 3.8)
  ) {
    suspiciousCount += 1;
    suspiciousSignals.push(
      snapshotLooksLikeCatalogPlaceholder
        ? "Catalog snapshot looks like a placeholder compared with accepted market evidence."
        : "Thin sold sample disagrees strongly with the public market snapshot.",
    );
  }

  const depth = trustedPrices.length;
  let calculatedValueUsd =
    depth >= 4
      ? medianUsd * 0.36 + trimmedAverageUsd * 0.29 + recencyWeightedUsd * 0.35
      : depth >= 2
        ? medianUsd * 0.46 + trimmedAverageUsd * 0.34 + recencyWeightedUsd * 0.2
        : prices[0];

  if (snapshot?.value && snapshot.value > 0 && depth < 4 && !snapshotLooksLikeCatalogPlaceholder) {
    const snapshotWeight = depth <= 1 ? 0.42 : 0.24;
    calculatedValueUsd = calculatedValueUsd * (1 - snapshotWeight) + snapshot.value * snapshotWeight;
  }

  const sourceDepthScore = depth >= 6 ? 0.9 : depth >= 4 ? 0.82 : depth >= 2 ? 0.68 : 0.42;
  const rejectionPenalty = Math.min(0.18, rejectedCount * 0.01 + suspiciousCount * 0.035);
  const confidenceScore = Math.max(0.28, Math.min(0.94, sourceDepthScore - rejectionPenalty));

  return {
    grade,
    acceptedCount: depth,
    rejectedCount,
    suspiciousCount,
    latestPriceUsd: latest?.price ?? null,
    latestSoldAt: latest?.date ?? null,
    averageUsd: roundMoney(averageUsd),
    medianUsd: roundMoney(medianUsd),
    trimmedAverageUsd: roundMoney(trimmedAverageUsd),
    recencyWeightedUsd: roundMoney(recencyWeightedUsd),
    calculatedValueUsd: roundMoney(calculatedValueUsd),
    lowUsd: roundMoney(Math.min(...trustedPrices)),
    highUsd: roundMoney(Math.max(...trustedPrices)),
    confidence: confidenceFromScore(confidenceScore),
    confidenceScore,
    method:
      "Calculated from recent accepted sold comps using median, trimmed average, and recency-weighted average. The latest sale is used as evidence only, not as the market price.",
    suspiciousSignals,
    rejectedReasonCounts,
  };
}

function filterConsensusOutliers(observations: ConsensusObservation[]) {
  if (observations.length <= 2) {
    return observations;
  }

  const baseline = robustMedian(observations.map((item) => item.value));
  const filtered = observations.filter(
    (item) => item.value >= baseline / 2.8 && item.value <= baseline * 2.8,
  );

  return filtered.length ? filtered : observations;
}

function buildRawPriceConsensus({
  catalogValueUsd,
  soldSales,
  soldReport,
  snapshotCandidates,
  isJapanese = false,
}: {
  catalogValueUsd: number;
  soldSales: SaleRecord[];
  soldReport?: SoldCompReport;
  snapshotCandidates: GradedPrice[];
  isJapanese?: boolean;
}): PriceConsensus | undefined {
  const observations: ConsensusObservation[] = [];

  if (catalogValueUsd >= 1) {
    const confidenceScore = isJapanese ? 0.34 : 0.64;
    observations.push({
      source: "PokemonTCG catalog market",
      value: catalogValueUsd,
      confidence: confidenceFromScore(confidenceScore),
      confidenceScore,
      evidenceType: "catalog",
      note: isJapanese
        ? "Localized catalog baseline. Japanese import prices usually need PriceCharting or sold-comp confirmation."
        : "Live raw market value from the catalog feed. Useful as a baseline, but less authoritative than fresh sold comps.",
      weight: sourceWeightFromConfidence(confidenceScore),
    });
  }

  if (soldSales.length) {
    const fallbackConfidenceScore = Math.min(
      0.94,
      soldSales.length >= 6
        ? 0.9
        : soldSales.length >= 4
          ? 0.84
          : soldSales.length >= 2
            ? 0.72
            : 0.46,
    );
    const confidenceScore = soldReport?.confidenceScore ?? fallbackConfidenceScore;
    observations.push({
      source: "Magery sold listings",
      value: soldReport?.calculatedValueUsd ?? robustMedian(soldSales.map((sale) => sale.price)),
      confidence: confidenceFromScore(confidenceScore),
      confidenceScore,
      evidenceType: "sold_comp",
      sampleCount: soldSales.length,
      sourceUrl: soldSales[0]?.listingUrl,
      note:
        soldSales.length >= 2
          ? "Calculated from accepted public sold listings with median, trimmed average, and recency weighting after title and outlier checks."
          : "Only one accepted public sold listing was available, so this source is blended with reference evidence and lightly weighted.",
      weight: sourceWeightFromConfidence(confidenceScore),
    });
  }

  for (const snapshot of snapshotCandidates) {
    if (snapshot.grade !== "Ungraded" || !(snapshot.value > 0)) {
      continue;
    }

    if (/catalog/i.test(snapshot.source ?? "")) {
      continue;
    }

    const isPriceChartingGuide = /pricecharting/i.test(snapshot.source ?? "");
    const evidenceType =
      snapshot.evidenceType === "catalog" && isPriceChartingGuide
        ? "guide_snapshot"
        : (snapshot.evidenceType ?? "guide_snapshot");
    const confidenceScore = isJapanese && isPriceChartingGuide
      ? Math.max(snapshot.confidenceScore ?? 0.52, 0.7)
      : (snapshot.confidenceScore ??
        (snapshot.source?.includes("TCGFish") ? 0.58 : 0.52));
    observations.push({
      source: snapshot.source ?? "Public market snapshot",
      value: snapshot.value,
      confidence: snapshot.confidence ?? confidenceFromScore(confidenceScore),
      confidenceScore,
      evidenceType,
      sampleCount: snapshot.saleCount,
      sourceUrl: snapshot.sourceUrl,
      note:
        snapshot.warning ??
        "Public guide snapshot used as supporting evidence when sold-comp depth is limited.",
      weight: sourceWeightFromConfidence(confidenceScore),
    });
  }

  const uniqueObservations = observations.filter(
    (item, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.source === item.source &&
          candidate.evidenceType === item.evidenceType &&
          Math.abs(candidate.value - item.value) < 0.0001,
      ) === index,
  );

  if (!uniqueObservations.length) {
    return undefined;
  }

  const soldAnchor =
    soldReport && soldReport.acceptedCount >= 4 && soldReport.confidenceScore >= 0.68
      ? soldReport.calculatedValueUsd
      : undefined;
  const soldAnchorLower =
    typeof soldAnchor === "number" && soldReport
      ? Math.max(soldAnchor / 2.2, soldReport.lowUsd / 1.35)
      : undefined;
  const soldAnchorUpper =
    typeof soldAnchor === "number" && soldReport
      ? Math.min(soldAnchor * 2.2, soldReport.highUsd * 1.25)
      : undefined;
  const anchoredObservations =
    typeof soldAnchor === "number" && soldAnchor > 0
      ? uniqueObservations.filter(
          (item) =>
            item.evidenceType === "sold_comp" ||
            (typeof soldAnchorLower === "number" &&
              typeof soldAnchorUpper === "number" &&
              item.value >= soldAnchorLower &&
              item.value <= soldAnchorUpper),
        )
      : uniqueObservations;
  const filteredObservations = filterConsensusOutliers(
    anchoredObservations.length ? anchoredObservations : uniqueObservations,
  );
  let finalEstimateUsd = Math.round(weightedAverageConsensus(filteredObservations) * 100) / 100;
  let confidenceScoreCap = 0.95;
  const methodologyNotes: string[] = [];
  // Keep the headline raw price consistent with the catalog value that Card Dex / search
  // displays. Public guide snapshots alone (no robust sold-comp evidence) must not pull the
  // displayed market price far from the catalog price — unless the catalog value is clearly a
  // placeholder/rarity floor and independent Japanese-market guides agree on a higher price.
  if (catalogValueUsd >= 1 && soldSales.length < 2) {
    const rawGuideValues = snapshotCandidates
      .filter((item) => {
        if (item.grade !== "Ungraded" || !(item.value > 0)) {
          return false;
        }

        const source = (item.source ?? "").toLowerCase();
        return (
          item.evidenceType === "guide_snapshot" ||
          item.evidenceType === "sold_comp" ||
          /pricecharting|tcgfish|magery|sold/i.test(source)
        );
      })
      .map((item) => item.value)
      .sort((left, right) => left - right);
    const lowGuide = rawGuideValues[0] ?? 0;
    const highGuide = rawGuideValues[rawGuideValues.length - 1] ?? 0;
    const guidesCorroborate =
      rawGuideValues.length >= 2 && lowGuide > 0 && highGuide / lowGuide <= 1.6;
    const certifiedGuideValues = snapshotCandidates
      .filter((item) => {
        if (item.grade === "Ungraded" || !(item.value > 0)) {
          return false;
        }

        const source = (item.source ?? "").toLowerCase();
        return (
          item.evidenceType === "guide_snapshot" ||
          /pricecharting|tcgfish|graded guide|population/i.test(source)
        );
      })
      .map((item) => item.value)
      .sort((left, right) => left - right);
    const soldValues = soldSales.map((sale) => sale.price).filter((value) => value > 0);
    const soldMedian = robustMedian(soldValues);
    const lowestCertifiedGuide = certifiedGuideValues[0] ?? 0;
    const certifiedGuideSupportsSold =
      soldMedian > 0 &&
      lowestCertifiedGuide > 0 &&
      Math.max(soldMedian, lowestCertifiedGuide) /
        Math.max(Math.min(soldMedian, lowestCertifiedGuide), 1) <=
        2.2;
    const catalogLooksLikeRawGuidePlaceholder = catalogValueUsd < lowGuide * 0.45;
    const catalogLooksLikeSoldPlaceholder =
      soldMedian > 0 &&
      catalogLooksLikePlaceholderAgainstValues(catalogValueUsd, [soldMedian]) &&
      (certifiedGuideSupportsSold || rawGuideValues.length > 0);
    const catalogLooksLikeCertifiedPlaceholder =
      soldMedian > 0 &&
      certifiedGuideSupportsSold &&
      catalogLooksLikePlaceholderAgainstValues(catalogValueUsd, [lowestCertifiedGuide]);
    const catalogLooksLikePlaceholder =
      catalogLooksLikeRawGuidePlaceholder ||
      catalogLooksLikeSoldPlaceholder ||
      catalogLooksLikeCertifiedPlaceholder;
    const soldReferenceValue = soldReport?.calculatedValueUsd ?? soldMedian;
    const placeholderEvidenceEstimate = robustMedian(
      [soldReferenceValue, ...rawGuideValues].filter((value) => value > 0),
    );
    const rawGuideMedian = robustMedian(rawGuideValues);
    const catalogLooksLikeHighOutlier =
      rawGuideMedian > 0 &&
      catalogValueUsd > Math.max(rawGuideMedian * 4, rawGuideMedian + 100) &&
      (certifiedGuideValues.length > 0 || rawGuideValues.length >= 1);
    const applyPlaceholderEstimate = () => {
      if (!(placeholderEvidenceEstimate > 0)) {
        return false;
      }

      finalEstimateUsd = Math.round(placeholderEvidenceEstimate * 100) / 100;
      confidenceScoreCap = Math.min(confidenceScoreCap, soldSales.length > 0 ? 0.46 : 0.52);
      methodologyNotes.push(
        "Catalog baseline looked like a placeholder against sold and grading evidence, so it was not allowed to anchor the raw estimate.",
      );
      return true;
    };
    const applyHighOutlierGuideEstimate = () => {
      if (!(rawGuideMedian > 0)) {
        return false;
      }

      finalEstimateUsd = Math.round(rawGuideMedian * 100) / 100;
      confidenceScoreCap = Math.min(confidenceScoreCap, 0.56);
      methodologyNotes.push(
        "Catalog baseline looked like a high outlier against public raw and graded guide evidence, so the independent raw guide was used instead.",
      );
      return true;
    };

    if (isJapanese) {
      const priceChartingGuides = snapshotCandidates
        .filter(
          (item) =>
            item.grade === "Ungraded" &&
            item.value > 0 &&
            /pricecharting/i.test(item.source ?? ""),
        )
        .map((item) => item.value)
        .sort((left, right) => left - right);
      const pcLow = priceChartingGuides[0] ?? 0;

      if (pcLow > 0) {
        const pcMedian = robustMedian(priceChartingGuides);
        // A lone, uncorroborated guide (common while PriceCharting is rate-limited
        // and only a stale/mismatched snapshot remains) must not crater the estimate
        // far below the catalog baseline. Require ≥2 guides or a sold comp before
        // accepting a >45% collapse below the catalog; otherwise keep the catalog.
        // Threshold matches shouldPreserveCatalogMarketPrice (0.55) so a lone
        // mismatched guide cannot pull detail far below search/list pricing.
        const guideMedianCorroborated =
          priceChartingGuides.length >= 2 || soldSales.length >= 1;
        const collapsesCatalog = catalogValueUsd >= 1 && pcMedian < catalogValueUsd * 0.55;
        finalEstimateUsd =
          Math.round(
            (collapsesCatalog && !guideMedianCorroborated ? catalogValueUsd : pcMedian) * 100,
          ) / 100;
      } else if (catalogLooksLikePlaceholder && applyPlaceholderEstimate()) {
        // Applied above.
      } else if (catalogLooksLikeRawGuidePlaceholder && lowGuide > 0) {
        finalEstimateUsd =
          Math.round(
            (guidesCorroborate ? Math.max(finalEstimateUsd, lowGuide) : lowGuide) * 100,
          ) / 100;
      } else if (!catalogLooksLikePlaceholder && rawGuideValues.length === 0) {
        finalEstimateUsd = Math.round(catalogValueUsd * 100) / 100;
      }
    } else if (catalogLooksLikeHighOutlier && applyHighOutlierGuideEstimate()) {
      // Applied above.
    } else if (catalogLooksLikePlaceholder && applyPlaceholderEstimate()) {
      // Applied above.
    } else if (catalogLooksLikeRawGuidePlaceholder && lowGuide > 0) {
      finalEstimateUsd =
        Math.round(
          (guidesCorroborate
            ? Math.max(finalEstimateUsd, lowGuide)
            : lowGuide) * 100,
        ) / 100;
    } else if (!catalogLooksLikePlaceholder) {
      finalEstimateUsd = Math.round(catalogValueUsd * 100) / 100;
    }
  }
  const totalWeight = filteredObservations.reduce((sum, item) => sum + item.weight, 0);
  const sourceCount = filteredObservations.length;
  const sampleCount = soldSales.length;
  const soldWeightShare =
    totalWeight > 0
      ? filteredObservations
          .filter((item) => item.evidenceType === "sold_comp")
          .reduce((sum, item) => sum + item.weight, 0) / totalWeight
      : 0;
  const diversityBonus = Math.min(0.12, Math.max(0, sourceCount - 1) * 0.04);
  const computedConfidenceScore = Math.min(
    0.95,
    filteredObservations.reduce(
      (sum, item) => sum + item.confidenceScore * (item.weight / totalWeight),
      0,
    ) +
      diversityBonus +
      soldWeightShare * 0.08,
  );
  const confidenceScore = Math.min(confidenceScoreCap, computedConfidenceScore);

  return {
    finalEstimateUsd,
    confidence: confidenceFromScore(confidenceScore),
    confidenceScore,
    sourceCount,
    sampleCount,
    methodology: [
      "Weighted consensus across trusted public sources. Accepted sold listings are reduced into a median/average/recency-weighted report before being blended with catalog and public guide snapshots.",
      ...methodologyNotes,
    ].join(" "),
    sources: filteredObservations
      .sort((left, right) => right.weight - left.weight)
      .map(({ weight: _weight, ...source }) => source),
    ...(soldReport ? { salesReport: soldReport } : {}),
  };
}

function robustMedian(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const baseline = median(values);
  const filtered = values.filter((value) => value >= baseline / 2.8 && value <= baseline * 2.8);
  return median(filtered.length ? filtered : values);
}

function reconcileSoldPriceWithSnapshot(sales: SaleRecord[], snapshot: GradedPrice | undefined) {
  const compMedian = robustMedian(sales.map((sale) => sale.price));

  if (!snapshot?.value || !Number.isFinite(snapshot.value) || snapshot.value <= 0) {
    return compMedian;
  }

  const n = sales.length;

  if (n >= 6) {
    return compMedian;
  }

  const towardSnapshot = n <= 1 ? 0.42 : n === 2 ? 0.32 : 0.22;
  return compMedian * (1 - towardSnapshot) + snapshot.value * towardSnapshot;
}

const CATALOG_CHART_LABELS = ["30d", "7d", "1d", "trend", "now"] as const;

function chartTimelineSortKey(date: string): number {
  const catalogIndex = CATALOG_CHART_LABELS.indexOf(date as (typeof CATALOG_CHART_LABELS)[number]);

  if (catalogIndex >= 0) {
    return 1_000_000_000_000 + catalogIndex;
  }

  const parsed = Date.parse(date);

  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  return 1_000_000_000_900;
}

export function mergePriceHistoryWithCatalog(
  catalog: PricePoint[],
  salesBased: PricePoint[],
): PricePoint[] {
  if (!catalog.length) {
    return [...salesBased].sort(
      (left, right) => chartTimelineSortKey(left.date) - chartTimelineSortKey(right.date),
    );
  }

  if (!salesBased.length) {
    return catalog;
  }

  const byDate = new Map<string, PricePoint>();

  for (const point of catalog) {
    byDate.set(point.date, {
      ...point,
      gradeValues: point.gradeValues ? { ...point.gradeValues } : undefined,
    });
  }

  for (const point of salesBased) {
    const existing = byDate.get(point.date);

    if (!existing) {
      byDate.set(point.date, {
        ...point,
        gradeValues: point.gradeValues ? { ...point.gradeValues } : undefined,
      });
      continue;
    }

    byDate.set(point.date, {
      ...existing,
      value: point.value > 0 ? point.value : existing.value,
      gradeValues: {
        ...(existing.gradeValues ?? {}),
        ...(point.gradeValues ?? {}),
      },
      // A real sale on a date outranks guide/projection support on the same
      // row. The previous OR made a real observation look projected forever.
      pointType: mergeMarketHistoryPointType(existing.pointType, point.pointType),
      isProjected:
        mergeMarketHistoryPointType(existing.pointType, point.pointType) === "sold"
          ? false
          : Boolean(existing.isProjected || point.isProjected),
    });
  }

  return [...byDate.values()].sort(
    (left, right) => chartTimelineSortKey(left.date) - chartTimelineSortKey(right.date),
  );
}

function normalizeCardName(text: string) {
  return text
    .replace(/[\u2605\u2606]/g, " Star ")
    .replace(/[★☆]/g, " Star ")
    .replace(/Γÿà|γÿà|â˜…|â˜†|★|☆/g, " Star ")
    .normalize("NFKD")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const value = Number.parseInt(hex, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeWhitespace(text: string) {
  return normalizeCardName(decodeHtmlEntities(text)).replace(/\s+/g, " ").trim();
}

function stripHtml(text: string) {
  return normalizeWhitespace(text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function stripHtmlToLines(text: string) {
  return decodeHtmlEntities(text)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:tr|td|th|div|p|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function toAbsoluteUrl(path: string) {
  if (path.startsWith("http")) {
    return path;
  }

  return `https://magery.com${path}`;
}

function toPriceChartingAbsoluteUrl(path: string) {
  const trimmed = decodeHtmlEntities(path.trim());

  if (trimmed.startsWith("http")) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return `https://www.pricecharting.com${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

function normalizePriceChartingPopulationUrl(path: string) {
  const absolute = toPriceChartingAbsoluteUrl(path)
    .replace("/game/", "/pop/item/")
    .split("?")[0]
    .split("#")[0];

  return absolute.replace(/&/g, "%26");
}

function toPriceChartingPopulationItemUrl(path: string) {
  return normalizePriceChartingPopulationUrl(path);
}

function toPriceChartingGameUrl(path: string) {
  return toPriceChartingAbsoluteUrl(path)
    .replace("/pop/item/", "/game/")
    .split("?")[0]
    .split("#")[0]
    .replace(/&/g, "%26");
}

function marketIdentityForPriceChartingSales(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal: number | undefined,
  options: ExternalMarketLookupOptions,
) {
  return buildMarketCardIdentity({
    name: cardName,
    englishName: options.englishCardName ?? cardName,
    setName,
    setCode: options.setCode,
    collectorNumber: cardNumber,
    setPrintedTotal: setTotal,
    language: options.language,
    finish: options.finish,
    productId: options.productId ?? options.priceChartingProductId,
    productUrl: options.productUrl ?? options.priceChartingProductUrl,
    setSlug: options.setSlug ?? options.priceChartingSetSlug,
  });
}

async function attachPriceChartingCompletedSales(
  candidate: PriceChartingPopulationResult,
  identity: ReturnType<typeof buildMarketCardIdentity>,
  sourceUrl: string,
): Promise<PriceChartingPopulationResult> {
  if (candidate.sales?.length) {
    return candidate;
  }

  const gameUrl = toPriceChartingGameUrl(
    candidate.population.sourceUrl ?? sourceUrl,
  );

  if (!/\/game\//i.test(gameUrl) || /\/pop\//i.test(gameUrl)) {
    return candidate;
  }

  try {
    const html = await fetchPublicPageText(gameUrl, 43_200, {
      readerFirst: false,
      preferHtml: true,
      priority: true,
    });
    const sales = parsePriceChartingPublicPageSales(html, gameUrl, identity);
    if (sales.length) {
      return { ...candidate, sales };
    }
  } catch {
    // Population/slab paint must not wait on a missing completed-sales table.
  }

  return candidate;
}

function parseUsd(value: string) {
  return Number.parseFloat(value.replace(/[^0-9.]/g, ""));
}

function parseInteger(value: string | undefined) {
  const parsed = Number.parseInt((value ?? "").replace(/[^0-9]/g, ""), 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectorNumberTokenCandidates(cardNumber: string, setTotal?: number) {
  const normalized = normalizeCardName(cardNumber).toLowerCase();
  const [baseRaw = normalized] = normalized.split("/");
  const stripNumericLeadingZeros = (value: string) => value.replace(/^0+(?=\d)/, "");
  const base = stripNumericLeadingZeros(baseRaw.trim());
  const compactBase = base.replace(/[^a-z0-9]/g, "");
  const compactRaw = normalized.replace(/[^a-z0-9]/g, "");
  const candidates = new Set<string>([
    normalized,
    base,
    compactBase,
    compactRaw,
    ...promoCollectorNumberTokenVariants(cardNumber),
  ]);

  if (typeof setTotal === "number" && setTotal > 0) {
    candidates.add(`${base}/${setTotal}`);
    candidates.add(`${compactBase}${setTotal}`);
  }

  return [...candidates]
    .map((candidate) => candidate.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function hasCollectorNumberToken(title: string, cardNumber: string, setTotal?: number) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const titleTokens = new Set(tokenizeForMatching(title));

  for (const candidate of collectorNumberTokenCandidates(cardNumber, setTotal)) {
    const compact = candidate.replace(/[^a-z0-9]/g, "");

    if (compact && titleTokens.has(compact)) {
      return true;
    }

    if (
      /^[0-9]+$/.test(compact) &&
      new RegExp(`#\\s*0*${escapeRegExp(compact)}\\b`, "i").test(normalizedTitle)
    ) {
      return true;
    }

    if (
      compact &&
      /[a-z]/i.test(compact) &&
      new RegExp(`#?\\s*${escapeRegExp(compact)}\\b`, "i").test(normalizedTitle.replace(/\s+/g, ""))
    ) {
      return true;
    }
  }

  return false;
}

function scorePopulationRowTitle(
  rowTitle: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
) {
  if (!hasCollectorNumberToken(rowTitle, cardNumber, setTotal)) {
    return 0;
  }

  const rowTokens = new Set(tokenizeForMatching(rowTitle));
  const nameTokens = tokenizeForMatching(cardName).filter(
    (token) => !collectorNumberTokenCandidates(cardNumber, setTotal).includes(token),
  );
  let matchedNameTokens = 0;
  let score = 12;

  for (const token of nameTokens) {
    if (rowTokens.has(token)) {
      matchedNameTokens += 1;
      score += token.length <= 2 ? 2 : 3;
    } else if (token.length > 2) {
      score -= 1;
    }
  }

  if (nameTokens.length && matchedNameTokens / nameTokens.length < 0.55) {
    return 0;
  }

  if (
    normalizeCardName(rowTitle)
      .toLowerCase()
      .includes(normalizeCardName(cardName).toLowerCase())
  ) {
    score += 4;
  }

  return score;
}

const CARD_VARIANT_TOKENS = [
  "vstar",
  "vmax",
  "gx",
  "ex",
  "lv",
  "prime",
  "break",
  "radiant",
  "tag team",
] as const;

function scorePopulationRowTitleByName(rowTitle: string, cardName: string) {
  const rowTokens = new Set(tokenizeForMatching(rowTitle));
  const nameTokens = tokenizeForMatching(cardName);
  let matchedNameTokens = 0;
  let score = 8;
  const rowLower = normalizeCardName(rowTitle).toLowerCase();
  const nameLower = normalizeCardName(cardName).toLowerCase();

  for (const token of nameTokens) {
    if (rowTokens.has(token)) {
      matchedNameTokens += 1;
      score += token.length <= 2 ? 2 : 3;
    } else if (token.length > 2) {
      score -= 1;
    }
  }

  if (!nameTokens.length || matchedNameTokens / nameTokens.length < 0.55) {
    return 0;
  }

  if (rowLower.includes(nameLower)) {
    score += 4;
  } else {
    score -= 8;
  }

  for (const variant of CARD_VARIANT_TOKENS) {
    if (rowLower.includes(variant) && !nameLower.includes(variant)) {
      score -= 24;
    }
  }

  return Math.max(0, score);
}

function extractCollectorNumberFromRowTitle(rowTitle: string) {
  const match = rowTitle.match(/#\s*0*([0-9]+)\b/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function isSecretRareCollectorNumber(cardNumber: string, setTotal?: number) {
  const normalized = normalizeCardName(cardNumber).toLowerCase();
  const [baseRaw = normalized] = normalized.split("/");
  const base = Number.parseInt(baseRaw.replace(/\D/g, ""), 10);

  if (!Number.isFinite(base) || base <= 0) {
    return false;
  }

  if (typeof setTotal === "number" && setTotal > 0) {
    return base > setTotal;
  }

  return false;
}

function gradeTokenRegex(grade: string | number) {
  return String(grade).replace(".", "\\.?");
}

function hasServiceGrade(title: string, servicePattern: string, grade: string | number) {
  const token = gradeTokenRegex(grade);
  const serviceThenGrade = new RegExp(`\\b${servicePattern}\\b[\\s:#-]{0,10}\\b${token}\\b`, "i");
  const gradeThenService = new RegExp(`\\b${token}\\b[\\s:#-]{0,10}\\b${servicePattern}\\b`, "i");

  return serviceThenGrade.test(title) || gradeThenService.test(title);
}

function hasBadSaleTitleSignals(
  title: string,
  options?: { cardName?: string; rarity?: string },
) {
  return classifySoldCompJunk(title, options);
}

function tokenizeForMatching(text: string) {
  return normalizeCardName(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

// Suffix/qualifier tokens that are shared across many different cards and so
// carry no identifying signal when matching a card to a population page.
const CARD_NAME_MATCH_STOPWORDS = new Set([
  "ex",
  "gx",
  "vmax",
  "vstar",
  "tag",
  "team",
  "lvx",
  "the",
  "and",
  "pokemon",
  "card",
]);

// Tokens that unambiguously describe a DIFFERENT card variant when present in
// the URL slug but absent from the card name (e.g. "mega" in slug but plain
// "Gardevoir ex" as the card name means the slug is for Mega Gardevoir-EX, a
// separate entry with different graded prices). If any of these appear in the
// slug and NOT in the card-name tokens, reject the URL as a wrong-card match.
const CARD_VARIANT_QUALIFIERS = new Set([
  "mega",
  "break",
  "prism",
  "radiant",
  "origin",
  "alolan",
  "galarian",
  "hisuian",
  "paldean",
  "shining",
]);

function significantCardNameTokens(text: string) {
  return tokenizeForMatching(text).filter(
    (token) => token.length >= 3 && !CARD_NAME_MATCH_STOPWORDS.has(token),
  );
}

/**
 * If the card name starts with a single-letter possessive prefix (e.g. "N's",
 * "E's"), return that letter lowercased. Returns null otherwise.
 * These prefixes are critical disambiguators: "N's Zoroark ex" must NOT match
 * a plain "Zoroark ex" URL on PriceCharting.
 */
function possessivePrefixLetter(cardName: string): string | null {
  return cardName.trim().match(/^([A-Za-z])'s?\s+/)?.[1]?.toLowerCase() ?? null;
}

/**
 * Guards against collector-number collisions: a discovered PriceCharting
 * /pop/item/<set>/<name>-<number> URL is only trustworthy if its name slug
 * shares a meaningful token with the card we are actually looking up. This
 * stops e.g. "Marnie's Grimmsnarl ex #287" from inheriting the PSA prices of a
 * "Paldean Wooper #287" that happens to share the number in a wrongly-resolved
 * set. Returns true when the URL can't be parsed or neither side has a
 * comparable token, so it never rejects a match it cannot actually disprove.
 *
 * Also rejects URLs where the slug has a variant qualifier (like "mega",
 * "break", "prism") that is absent from the card name — these indicate a
 * fundamentally different card form, not just a numbering variant.
 */
function priceChartingItemUrlMatchesCardName(
  itemUrl: string,
  cardName: string,
  englishCardName?: string,
): boolean {
  const match = itemUrl.match(/\/pop\/item\/[^/]+\/([^/?#]+)/i);

  if (!match) {
    return true;
  }

  const nameSlug = match[1].replace(/-?\d[\d/]*$/g, " ").replace(/-/g, " ");
  const slugTokens = new Set(significantCardNameTokens(nameSlug));

  if (!slugTokens.size) {
    return true;
  }

  const cardTokens = [
    ...significantCardNameTokens(cardName),
    ...(englishCardName ? significantCardNameTokens(englishCardName) : []),
  ];

  if (!cardTokens.length) {
    return true;
  }

  const cardTokenSet = new Set(cardTokens);

  // Reject if the slug has an exclusive variant qualifier that the card name
  // doesn't — "mega-gardevoir-ex" vs "Gardevoir ex" is a different card.
  for (const slugTok of slugTokens) {
    if (CARD_VARIANT_QUALIFIERS.has(slugTok) && !cardTokenSet.has(slugTok)) {
      return false;
    }
  }

  // Reject if the card has a single-letter possessive prefix (e.g. "N's") that
  // is absent from the URL slug. "N's Zoroark ex" must not match a plain
  // "Zoroark ex" URL — the possessive owner is the primary disambiguator.
  const namePrefix = possessivePrefixLetter(cardName);
  const englishPrefix = englishCardName ? possessivePrefixLetter(englishCardName) : null;
  const requiredPrefix = namePrefix ?? englishPrefix;
  if (requiredPrefix) {
    // The slug tokens include single characters from the raw name slug (before
    // the >= 3 length filter), so rebuild slug tokens without the length filter.
    const slugRawTokens = new Set(tokenizeForMatching(nameSlug));
    if (!slugRawTokens.has(requiredPrefix)) {
      return false;
    }
  }

  return cardTokens.some((token) => slugTokens.has(token));
}

function priceChartingMarketUrlMatchesLookup(
  url: string,
  setName: string,
  cardName: string,
  options: ExternalMarketLookupOptions & { englishCardName?: string } = {},
) {
  const pathMatch = url.match(/\/(?:game|pop\/item)\/([^/]+)\/([^/?#]+)/i);

  if (!pathMatch) {
    return true;
  }

  const [, urlSetSlug, nameAndNumberSlug] = pathMatch;
  const allowedSetSlugs = new Set(
    priceChartingSetSlugVariants(setName, options).map((slug) => slug.toLowerCase()),
  );

  if (allowedSetSlugs.size) {
    const normalizedUrlSet = urlSetSlug.toLowerCase();
    const setMatches = [...allowedSetSlugs].some(
      (slug) =>
        slug === normalizedUrlSet ||
        normalizedUrlSet.endsWith(slug) ||
        slug.endsWith(normalizedUrlSet),
    );

    if (!setMatches) {
      return false;
    }
  }

  return priceChartingItemUrlMatchesCardName(
    `https://www.pricecharting.com/pop/item/${urlSetSlug}/${nameAndNumberSlug}`,
    cardName,
    options.englishCardName,
  );
}

function setAliasTokens(
  setName: string,
  options: ExternalMarketLookupOptions & { setCode?: string } = {},
) {
  const normalizedSetName = normalizeCardName(setName);
  const aliases = new Set<string>([normalizedSetName, ...getSetMarketAliases(setName, options)]);
  const popMatch = normalizedSetName.match(/\bpop(?:\s+series)?\s*(\d+)\b/i);

  if (popMatch) {
    const popNumber = popMatch[1];
    aliases.add(`POP ${popNumber}`);
    aliases.add(`POP${popNumber}`);
    aliases.add(`POP Series ${popNumber}`);
    aliases.add(`Pokemon Organized Play ${popNumber}`);
  }

  return [...aliases].flatMap((alias) => tokenizeForMatching(alias));
}

function rarityIdentityGroups(text: string | undefined) {
  const normalized = normalizeCardName(text ?? "").toLowerCase();
  const groups = new Set<string>();

  if (!normalized) {
    return groups;
  }

  if (/\b(special illustration rare|special art rare|sir|sar)\b/.test(normalized)) {
    // Listings often shorten SIR to "illustration rare" / "IR"; treat those as
    // compatible with special-illustration so identity checks don't reject them.
    groups.add("special-illustration");
    groups.add("illustration");
  } else if (/\b(illustration rare|art rare|ir|ar)\b/.test(normalized)) {
    groups.add("illustration");
  }

  if (/\b(hyper rare|hr|gold rare|gold)\b/.test(normalized)) {
    groups.add("hyper");
  }

  if (/\b(secret rare|sr)\b/.test(normalized)) {
    groups.add("secret");
  }

  if (/\b(ultra rare|ur)\b/.test(normalized)) {
    groups.add("ultra");
  }

  if (/\b(double rare|rr)\b/.test(normalized)) {
    groups.add("double");
  }

  if (/\b(amazing rare)\b/.test(normalized)) {
    groups.add("amazing");
  }

  if (/\b(radiant rare|radiant)\b/.test(normalized)) {
    groups.add("radiant");
  }

  if (/\b(rare holo|holo rare|holofoil)\b/.test(normalized)) {
    groups.add("holo");
  }

  return groups;
}

function hasConflictingRarityMarker(title: string, cardRarity?: string) {
  const expectedGroups = rarityIdentityGroups(cardRarity);

  if (!expectedGroups.size) {
    return false;
  }

  const titleGroups = rarityIdentityGroups(title);

  if (!titleGroups.size) {
    return false;
  }

  return ![...titleGroups].some((group) => expectedGroups.has(group));
}

function isPromoCompatibleSet(setName: string) {
  const normalizedSetName = normalizeCardName(setName).toLowerCase();

  return /\bpop\b|\bpromo\b|black star promo|pokemon organized play/.test(normalizedSetName);
}

function toIsoDate(label: string) {
  const date = new Date(label);

  if (Number.isNaN(date.getTime())) {
    return label;
  }

  return date.toISOString().slice(0, 10);
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

/**
 * Magery titles often use PSA verbal shorthand between the service and the
 * numeric grade ("PSA VG 3", "PSA NM-MT 8", "PSA GEM MT 10"). The plain
 * `PSA <n>` matcher misses those and falls through to Ungraded — which then
 * pollutes raw sold medians and chart last-real points (e.g. Base Charizard
 * "PSA VG 3" $349.99 counted as Ungraded → chart.last_point_divergence).
 */
const PSA_VERBAL_GRADE_LABELS =
  "(?:GEM\\s*MINT|GEM\\s*MT|MINT|NM[-\\s]?MT|NM|NEAR\\s*MINT|EX[-\\s]?MT|EX|EXCELLENT|VG[-\\s]?EX|VG|VERY\\s*GOOD|GOOD|FAIR|POOR|AUTH(?:ENTIC)?)";

/** Sentinel: graded listing whose numeric grade could not be parsed. Not Ungraded. */
const UNPARSED_GRADED_CONDITION = "__GRADED_UNPARSED__";

function detectSaleCondition(title: string) {
  const normalizedTitle = title.toUpperCase();

  for (const grade of WHOLE_GRADES) {
    if (hasServiceGrade(normalizedTitle, "PSA", grade)) {
      return `PSA ${grade}`;
    }
  }

  // PSA + verbal label + numeric grade (service → label → number, or reverse).
  for (const grade of WHOLE_GRADES) {
    const token = gradeTokenRegex(grade);
    const serviceLabelGrade = new RegExp(
      `\\bPSA\\b[\\s:#-]{0,10}${PSA_VERBAL_GRADE_LABELS}[\\s:#-]{0,10}\\b${token}\\b`,
      "i",
    );
    const gradeLabelService = new RegExp(
      `\\b${token}\\b[\\s:#-]{0,10}${PSA_VERBAL_GRADE_LABELS}[\\s:#-]{0,10}\\bPSA\\b`,
      "i",
    );
    if (serviceLabelGrade.test(normalizedTitle) || gradeLabelService.test(normalizedTitle)) {
      return `PSA ${grade}`;
    }
  }

  // PSA Authentic / PSA + verbal label without a number / "PSA graded" slab
  // language — keep out of Ungraded so raw medians and charts stay clean.
  if (
    /\bPSA\b/.test(normalizedTitle) &&
    (/\bAUTH(?:ENTIC)?\b/.test(normalizedTitle) ||
      new RegExp(`\\bPSA\\b[\\s:#-]{0,10}${PSA_VERBAL_GRADE_LABELS}\\b`, "i").test(
        normalizedTitle,
      ) ||
      /\b(GRADED|SLAB)\b/.test(normalizedTitle))
  ) {
    return UNPARSED_GRADED_CONDITION;
  }

  if (/\b(BGS|BECKETT)\b/.test(normalizedTitle) && /BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle))
    return "BGS 10 Black";

  for (const grade of HALF_GRADES) {
    if (hasServiceGrade(normalizedTitle, "(?:BGS|BECKETT)", grade)) {
      return `BGS ${grade}`;
    }
  }

  if (/\bCGC\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle) && /PRIST/i.test(normalizedTitle))
    return "CGC 10 Pristine";

  for (const grade of HALF_GRADES) {
    if (hasServiceGrade(normalizedTitle, "CGC", grade)) {
      return `CGC ${grade}`;
    }

    if (hasServiceGrade(normalizedTitle, "SGC", grade)) {
      return `SGC ${grade}`;
    }
  }

  for (const grade of WHOLE_GRADES) {
    if (hasServiceGrade(normalizedTitle, "TAG", grade)) {
      return `TAG ${grade}`;
    }

  }

  // Other grader mentions without a parseable grade must not land in Ungraded.
  if (
    /\b(BGS|BECKETT|CGC|SGC|TAG)\b/.test(normalizedTitle) &&
    /\b(GRADED|SLAB|BLACK\s+LABEL|PRISTINE|GEM)\b/.test(normalizedTitle)
  ) {
    return UNPARSED_GRADED_CONDITION;
  }

  return "Ungraded";
}

function hasConflictingCollectorTotal(title: string, setTotal?: number, cardRarity?: string) {
  if (!(typeof setTotal === "number" && setTotal > 0)) {
    return false;
  }

  // Classic Collection reprints keep the original set fraction on the card face
  // (e.g. 4/102) even though the subset only has 25 cards.
  if (allowsCelebrationsSubsetMarker(cardRarity)) {
    return false;
  }

  for (const match of title.matchAll(/\b(\d{1,3})\/(\d{1,3})\b/g)) {
    const total = Number.parseInt(match[2], 10);

    if (total > 0 && total !== setTotal) {
      return true;
    }
  }

  return false;
}

function collectorNumberVariantSet(cardNumber: string, setTotal?: number) {
  const cardNumberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const numberWithTotal =
    typeof setTotal === "number" && setTotal > 0
      ? `${cardNumberBase}/${setTotal}`.toLowerCase()
      : "";

  return new Set(
    [
      cardNumber.toLowerCase(),
      cardNumberBase.toLowerCase(),
      numberWithTotal,
      ...promoCollectorNumberTokenVariants(cardNumber).map((variant) => variant.toLowerCase()),
    ].filter(Boolean),
  );
}

function isRelevantSaleTitle(
  title: string,
  cardName: string,
  cardNumber: string,
  setName: string,
  setTotal?: number,
  cardRarity?: string,
  options: ExternalMarketLookupOptions & { setCode?: string } = {},
) {
  if (hasConflictingRarityMarker(title, cardRarity)) {
    return false;
  }

  if (hasConflictingCollectorTotal(title, setTotal, cardRarity)) {
    return false;
  }

  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const collectorNumbers = extractCollectorNumbers(title);
  const collectorVariants = collectorNumberVariantSet(cardNumber, setTotal);

  const nameMatchCount = nameTokens.filter((token) => titleTokens.has(token)).length;
  const hasCardNumber =
    [...collectorVariants].some((variant) => titleTokens.has(variant)) ||
    collectorNumbers.some((number) => collectorVariants.has(number));

  const signals = saleIdentitySignals(
    title,
    cardName,
    cardNumber,
    setName,
    setTotal,
    cardRarity,
    options,
  );
  const setEvidence = signals.hasSetSignal || signals.hasExactNumberWithTotal;
  const importLabel = options.language ? IMPORT_MARKET_LABELS[options.language] : undefined;
  const regionalImportMatch =
    Boolean(importLabel) &&
    options.language !== "en" &&
    signals.hasExactNumberWithTotal &&
    hasCardNumber &&
    nameMatchCount >= Math.min(2, nameTokens.length) &&
    new RegExp(`\\b${importLabel}\\b`, "i").test(title);

  return (
    regionalImportMatch ||
    (nameMatchCount >= Math.min(2, nameTokens.length) && hasCardNumber && setEvidence) ||
    isStrongVintageSaleTitle(title, cardName, cardNumber, setName, setTotal, cardRarity, options)
  );
}

function extractCollectorNumbers(title: string) {
  const numbers = new Set<string>();

  for (const match of title.matchAll(/\b(\d{1,3}(?:\/\d{1,3})?)\b/g)) {
    numbers.add(match[1].toLowerCase());
  }

  for (const match of title.matchAll(
    /\b((?:xy|sm|swsh|sv|bw|dp|ex|hgss)\s*-?\s*\d{1,3}[a-z]?)\b/gi,
  )) {
    numbers.add(match[1].replace(/\s+/g, "").toLowerCase());
  }

  for (const match of title.matchAll(/#\s*((?:xy|sm|swsh|sv|bw|dp|ex|hgss)\s*-?\s*\d{1,3}[a-z]?)\b/gi)) {
    numbers.add(match[1].replace(/\s+/g, "").toLowerCase());
  }

  return [...numbers];
}

function saleIdentitySignals(
  title: string,
  cardName: string,
  cardNumber: string,
  setName: string,
  setTotal?: number,
  cardRarity?: string,
  options: ExternalMarketLookupOptions & { setCode?: string } = {},
) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const normalizedCardName = normalizeCardName(cardName).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const setTokens = setAliasTokens(setName, options).filter((token) => token.length > 2);
  const cardNumberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const numberWithTotal =
    typeof setTotal === "number" && setTotal > 0
      ? `${cardNumberBase}/${setTotal}`.toLowerCase()
      : "";
  const collectorNumbers = extractCollectorNumbers(normalizedTitle);
  const collectorVariants = collectorNumberVariantSet(cardNumber, setTotal);
  const nameMatchCount = nameTokens.filter((token) => titleTokens.has(token)).length;
  const hasCardNumber =
    [...collectorVariants].some((variant) => titleTokens.has(variant)) ||
    collectorNumbers.some((number) => collectorVariants.has(number));
  const hasExactNumberWithTotal = numberWithTotal
    ? collectorNumbers.includes(numberWithTotal)
    : false;
  const hasSetSignal =
    setTokens.some((token) => titleTokens.has(token)) ||
    normalizedTitle.includes(normalizedSetName);
  const hasStarSignal =
    /\bgold\s+star\b|\bstar\b/.test(normalizedTitle) ||
    /\bgold\s+star\b|\bstar\b/.test(normalizedCardName);
  const hasRarityConflict = hasConflictingRarityMarker(title, cardRarity);
  const hasRaritySignal =
    rarityIdentityGroups(cardRarity).size > 0 &&
    [...rarityIdentityGroups(title)].some((group) => rarityIdentityGroups(cardRarity).has(group));

  return {
    collectorNumbers,
    hasCardNumber,
    hasExactNumberWithTotal,
    hasRarityConflict,
    hasRaritySignal,
    hasSetSignal,
    hasStarSignal,
    nameMatchCount,
    requiredNameMatches: Math.min(2, nameTokens.length),
  };
}

/**
 * Wizards-era / early EX sets where Magery titles often omit the set name and
 * only carry "Charizard #4 PSA 9" / "4/102" / "WOTC" / "1999". Requiring a set
 * token for these rejects the majority of real sold comps.
 */
function isVintageWotcSet(setName: string) {
  const normalized = normalizeCardName(setName).toLowerCase();
  return (
    /\b(base set(?:\s*2)?|jungle|fossil|team rocket|gym heroes|gym challenge|neo (genesis|discovery|revelation|destiny)|legendary collection|expedition|aquapolis|skyridge|southern islands)\b/.test(
      normalized,
    ) ||
    /\b(ex (ruby|sapphire|dragon|team magma|team aqua|hidden legends|firered|leafgreen|team rocket returns|deoxys|emerald|unseen forces|delta species|legend maker|holon phantoms|crystal guardians|dragon frontiers|power keepers))\b/.test(
      normalized,
    )
  );
}

function hasVintageEraSignal(title: string) {
  const normalized = normalizeCardName(title).toLowerCase();
  return (
    /\b(wotc|wizards(?:\s+of\s+the\s+coast)?|shadowless|unlimited|1st\s*edition|first\s*edition)\b/.test(
      normalized,
    ) || /\b(1999|2000|2001|2002|2003)\b/.test(normalized)
  );
}

function isStrongVintageSaleTitle(
  title: string,
  cardName: string,
  cardNumber: string,
  setName: string,
  setTotal?: number,
  cardRarity?: string,
  options: ExternalMarketLookupOptions & { setCode?: string } = {},
) {
  const signals = saleIdentitySignals(
    title,
    cardName,
    cardNumber,
    setName,
    setTotal,
    cardRarity,
    options,
  );

  if (signals.hasRarityConflict) {
    return false;
  }

  if (signals.nameMatchCount < Math.max(1, signals.requiredNameMatches)) {
    return false;
  }

  if (!signals.hasCardNumber) {
    return false;
  }

  if (signals.hasSetSignal || signals.hasExactNumberWithTotal || signals.hasStarSignal) {
    return true;
  }

  // Vintage Magery titles frequently omit set tokens ("Charizard #4 PSA 9").
  // Accept name + collector number when the set is WOTC-era and the title carries
  // an era cue, or when there is no conflicting set marker on a WOTC-era card.
  if (isVintageWotcSet(setName) && hasVintageEraSignal(title)) {
    return true;
  }

  if (
    isVintageWotcSet(setName) &&
    signals.hasCardNumber &&
    signals.nameMatchCount >= signals.requiredNameMatches &&
    !hasConflictingSetMarker(title, setName, cardRarity)
  ) {
    return true;
  }

  return false;
}

function scoreSaleTitle(
  title: string,
  cardName: string,
  cardNumber: string,
  setName: string,
  setTotal?: number,
  cardRarity?: string,
  options: ExternalMarketLookupOptions & { setCode?: string } = {},
) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const setTokens = setAliasTokens(setName, options).filter((token) => token.length > 2);
  const collectorNumbers = extractCollectorNumbers(normalizedTitle);
  const collectorVariants = collectorNumberVariantSet(cardNumber, setTotal);
  const identitySignals = saleIdentitySignals(
    title,
    cardName,
    cardNumber,
    setName,
    setTotal,
    cardRarity,
    options,
  );
  let score = 0;

  score += nameTokens.filter((token) => titleTokens.has(token)).length * 4;

  if (collectorNumbers.some((number) => collectorVariants.has(number))) {
    score += 8;
  } else if ([...collectorVariants].some((variant) => collectorNumbers.includes(variant))) {
    score += 6;
  } else if (collectorNumbers.length) {
    score -= 6;
  }

  if (identitySignals.hasExactNumberWithTotal) {
    score += 4;
  }

  if (identitySignals.hasStarSignal) {
    score += 3;
  }

  if (isVintageWotcSet(setName) && hasVintageEraSignal(title)) {
    score += 3;
  }

  if (identitySignals.hasRaritySignal) {
    score += 3;
  }

  if (identitySignals.hasRarityConflict) {
    score -= 12;
  }

  const matchedSetTokens = setTokens.filter((token) => titleTokens.has(token)).length;
  score += matchedSetTokens * 2;

  if (normalizedTitle.includes(normalizedSetName)) {
    score += 4;
  }

  const conflictPhrases = [
    "celebrations",
    "classic collection",
    "black star promo",
    "sv promo",
    "promo",
  ];
  const classicCollectionCard = allowsCelebrationsSubsetMarker(cardRarity);

  for (const phrase of conflictPhrases) {
    if (
      normalizedTitle.includes(phrase) &&
      !normalizedSetName.includes(phrase) &&
      !(phrase === "promo" && isPromoCompatibleSet(setName)) &&
      !(
        classicCollectionCard &&
        (phrase === "classic collection" || phrase === "celebrations")
      )
    ) {
      score -= 5;
    }
  }

  return score;
}

function allowsCelebrationsSubsetMarker(cardRarity?: string) {
  return /classic collection/i.test(normalizeCardName(cardRarity ?? ""));
}

function hasConflictingSetMarker(title: string, setName: string, cardRarity?: string) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const promoCompatibleSet = isPromoCompatibleSet(setName);
  const classicCollectionCard = allowsCelebrationsSubsetMarker(cardRarity);
  const conflictPhrases = [
    "celebrations",
    "classic collection",
    "black star promo",
    "sv promo",
  ];

  return conflictPhrases.some((phrase) => {
    if (!normalizedTitle.includes(phrase)) {
      return false;
    }

    if (normalizedSetName.includes(phrase)) {
      return false;
    }

    if (
      classicCollectionCard &&
      (phrase === "classic collection" || phrase === "celebrations")
    ) {
      return false;
    }

    return !(phrase === "promo" && promoCompatibleSet);
  });
}

function buildSoldCompQueries(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  cardRarity?: string,
  options: { setCode?: string; isJapanese?: boolean; language?: string; finish?: CardFinishId } = {},
) {
  const normalizedName = normalizeCardName(cardName);
  const normalizedSetName = normalizeCardName(setName);
  const normalizedRarity = normalizeCardName(cardRarity ?? "");
  const numberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const setCodeMatch = normalizedSetName.match(/\b(?:pop|ex|dp|platinum|hgss|bw|xy|sm|swsh|sv)\s*(\d+)\b/i);
  const shortSetName = setCodeMatch ? `${setCodeMatch[0].replace(/\s+/g, " ")}` : normalizedSetName;
  const popMatch = normalizedSetName.match(/\bpop(?:\s+series)?\s*(\d+)\b/i);
  const setAliases = new Set<string>([normalizedSetName, shortSetName]);

  if (popMatch) {
    const popNumber = popMatch[1];
    setAliases.add(`POP ${popNumber}`);
    setAliases.add(`POP${popNumber}`);
    setAliases.add(`POP Series ${popNumber}`);
    setAliases.add(`Pokemon Organized Play ${popNumber}`);
  }

  if (/\bbase set\b/i.test(normalizedSetName) && !/\bbase set\s*2\b/i.test(normalizedSetName)) {
    setAliases.add("Base");
    setAliases.add("WOTC");
    setAliases.add("Wizards");
    setAliases.add("Base Set Unlimited");
    setAliases.add("Base Set Shadowless");
  }

  if (/\bjungle\b|\bfossil\b|\bteam rocket\b|\bgym (heroes|challenge)\b|\bneo\b/i.test(normalizedSetName)) {
    setAliases.add("WOTC");
    setAliases.add("Wizards");
  }

  if (isPromoCompatibleSet(normalizedSetName)) {
    setAliases.add("Black Star Promo");
    setAliases.add("Pokemon Promo");
    const eraMatch = normalizedSetName.match(/\b(xy|sm|swsh|sv|bw|dp|ex|hgss)\b/i);
    if (eraMatch) {
      setAliases.add(`${eraMatch[1].toUpperCase()} Promo`);
      setAliases.add(`${eraMatch[1].toUpperCase()} Black Star Promo`);
    }
  }

  if (/celebrations/i.test(normalizedSetName)) {
    setAliases.add("Celebrations");
    setAliases.add("Pokemon Celebrations");

    if (/classic collection/i.test(normalizedRarity)) {
      setAliases.add("Celebrations Classic Collection");
      setAliases.add("Classic Collection");
    }
  }

  const numberWithTotal =
    typeof setTotal === "number" && setTotal > 0 ? `${numberBase}/${setTotal}` : "";
  const queries = new Set<string>([
    `Pokemon ${normalizedName} ${cardNumber} ${normalizedSetName}`.trim(),
    `Pokemon ${normalizedName} ${numberBase} ${normalizedSetName}`.trim(),
    numberWithTotal
      ? `Pokemon ${normalizedName} ${numberWithTotal} ${normalizedSetName}`.trim()
      : "",
    shortSetName !== normalizedSetName
      ? `Pokemon ${normalizedName} ${numberBase} ${shortSetName}`.trim()
      : "",
    numberWithTotal && shortSetName !== normalizedSetName
      ? `Pokemon ${normalizedName} ${numberWithTotal} ${shortSetName}`.trim()
      : "",
    `Pokemon ${normalizedName} ${cardNumber}`.trim(),
    `Pokemon ${normalizedName} ${numberBase}`.trim(),
  ]);

  const promoParts = promoCollectorNumberParts(cardNumber);
  if (promoParts) {
    const promoId = `${promoParts.prefix}${promoParts.number}${promoParts.suffix}`.toUpperCase();
    const promoIdLower = promoId.toLowerCase();
  for (const alias of setAliases) {
      queries.add(`Pokemon ${normalizedName} ${promoId} ${alias}`.trim());
      queries.add(`Pokemon ${normalizedName} #${promoId} ${alias}`.trim());
      queries.add(`Pokemon ${normalizedName} ${promoIdLower} ${alias}`.trim());
    }
    queries.add(`Pokemon ${normalizedName} ${promoId} Promo`.trim());
    queries.add(`Pokemon ${normalizedName} #${promoId} Black Star Promo`.trim());
    if (promoParts.suffix) {
      queries.add(`Pokemon ${normalizedName} ${promoParts.number}${promoParts.suffix} Promo`.trim());
    }
  }

  for (const alias of setAliases) {
    queries.add(`Pokemon ${normalizedName} ${numberBase} ${alias}`.trim());
    if (numberWithTotal) {
      queries.add(`Pokemon ${normalizedName} ${numberWithTotal} ${alias}`.trim());
    }
    if (normalizedRarity) {
      queries.add(`Pokemon ${normalizedName} ${numberBase} ${alias} ${normalizedRarity}`.trim());
      if (numberWithTotal) {
        queries.add(`Pokemon ${normalizedName} ${numberWithTotal} ${alias} ${normalizedRarity}`.trim());
      }
    }
  }

  if (/\bstar\b/i.test(normalizedName)) {
    const goldStarName = normalizedName.replace(/\bstar\b/i, "Gold Star");
    queries.add(`Pokemon ${goldStarName} ${cardNumber} ${normalizedSetName}`.trim());
    queries.add(`Pokemon ${goldStarName} ${numberBase} ${normalizedSetName}`.trim());
    if (numberWithTotal) {
      queries.add(`Pokemon ${goldStarName} ${numberWithTotal} ${normalizedSetName}`.trim());
    }
    if (shortSetName !== normalizedSetName) {
      queries.add(`Pokemon ${goldStarName} ${numberBase} ${shortSetName}`.trim());
      if (numberWithTotal) {
        queries.add(`Pokemon ${goldStarName} ${numberWithTotal} ${shortSetName}`.trim());
      }
    }
    for (const alias of setAliases) {
      queries.add(`Pokemon ${goldStarName} ${numberBase} ${alias}`.trim());
      if (numberWithTotal) {
        queries.add(`Pokemon ${goldStarName} ${numberWithTotal} ${alias}`.trim());
      }
    }
    queries.add(`Pokemon ${goldStarName} ${cardNumber}`.trim());
    queries.add(`Pokemon ${goldStarName} ${numberBase}`.trim());
  }

  const importLabel =
    (options.language && IMPORT_MARKET_LABELS[options.language]) ||
    (options.isJapanese ? "Japanese" : null) ||
    (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(cardName) ||
    /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(setName)
      ? options.language && IMPORT_MARKET_LABELS[options.language]
        ? IMPORT_MARKET_LABELS[options.language]
        : /[\uac00-\ud7af]/.test(cardName + setName)
          ? "Korean"
          : "Japanese"
      : null);

  if (importLabel) {
    const setCode = options.setCode?.trim() || "";
    const numberWithTotal =
      typeof setTotal === "number" && setTotal > 0
        ? `${numberBase}/${setTotal}`
        : cardNumber;
    const strictJapaneseQueries =
      importLabel === "Japanese" && setCode
        ? [
            `${normalizedName} ${setCode} ${numberBase} Japanese`.trim(),
            `Pokemon ${normalizedName} ${setCode} ${numberBase} Japanese`.trim(),
            `${setCode} ${numberBase} Japanese`.trim(),
            `Pokemon ${setCode} ${numberBase} Japanese`.trim(),
            numberWithTotal && numberWithTotal !== numberBase
              ? `${normalizedName} ${setCode} ${numberWithTotal} Japanese`.trim()
              : "",
            numberWithTotal && numberWithTotal !== numberBase
              ? `Pokemon ${normalizedName} ${setCode} ${numberWithTotal} Japanese`.trim()
              : "",
            numberWithTotal && numberWithTotal !== numberBase
              ? `${setCode} ${numberWithTotal} Japanese`.trim()
              : "",
            numberWithTotal && numberWithTotal !== numberBase
              ? `Pokemon ${setCode} ${numberWithTotal} Japanese`.trim()
              : "",
          ]
        : [];
    const regionalQueries = [
      ...strictJapaneseQueries,
      `Pokemon ${importLabel} ${normalizedName} ${setCode} ${numberWithTotal} ${normalizedSetName}`.trim(),
      `Pokemon ${importLabel} ${setCode} ${numberWithTotal}`.trim(),
      `Pokemon ${importLabel} ${normalizedName} ${numberWithTotal}`.trim(),
      `Pokemon ${importLabel} ${normalizedName} ${numberWithTotal} ${normalizedSetName}${normalizedRarity ? ` ${normalizedRarity}` : ""}`.trim(),
      setCode
        ? `Pokemon ${importLabel} ${setCode} ${numberBase} ${normalizedSetName}`.trim()
        : "",
    ];

    for (const query of regionalQueries) {
      if (query.trim()) {
        queries.add(query.trim());
      }
    }
  }

  const setCode = options.setCode?.trim().toUpperCase();
  if (setCode) {
    for (const alias of setAliases) {
      queries.add(`Pokemon ${normalizedName} ${setCode} ${numberBase} ${alias}`.trim());
      if (numberWithTotal) {
        queries.add(`Pokemon ${normalizedName} ${setCode} ${numberWithTotal} ${alias}`.trim());
      }
      if (normalizedRarity) {
        queries.add(
          `Pokemon ${normalizedName} ${setCode} ${numberWithTotal || numberBase} ${alias} ${normalizedRarity}`.trim(),
        );
      }
    }
    queries.add(`Pokemon ${normalizedName} ${setCode} ${numberWithTotal || numberBase}`.trim());
    queries.add(`PSA ${normalizedName} ${setCode} ${numberWithTotal || numberBase}`.trim());
  }

  const finishToken = mageryFinishQueryToken(options.finish);
  if (finishToken) {
    for (const query of [...queries]) {
      if (query) {
        queries.add(`${query} ${finishToken}`.trim());
      }
    }
  }

  return rankSoldCompQueries([...queries].filter(Boolean), {
    cardName,
    cardNumber,
    setName,
    setTotal,
    setCode,
    cardRarity,
  });
}

function rankSoldCompQueries(
  queries: string[],
  {
    cardName,
    cardNumber,
    setName,
    setTotal,
    setCode,
    cardRarity,
  }: {
    cardName: string;
    cardNumber: string;
    setName: string;
    setTotal?: number;
    setCode?: string;
    cardRarity?: string;
  },
) {
  const numberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const numberWithTotal =
    typeof setTotal === "number" && setTotal > 0 ? `${numberBase}/${setTotal}` : "";
  const normalizedName = normalizeCardName(cardName).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const normalizedRarity = normalizeCardName(cardRarity ?? "").toLowerCase();
  const normalizedSetCode = setCode?.trim().toLowerCase() ?? "";

  const scoreQuery = (query: string) => {
    const normalized = normalizeCardName(query).toLowerCase();
    let score = 0;

    if (numberWithTotal && normalized.includes(numberWithTotal)) {
      score += 12;
    } else if (normalized.includes(numberBase.toLowerCase())) {
      score += 4;
    }

    if (normalizedSetCode && normalized.includes(normalizedSetCode)) {
      score += 8;
    }

    if (normalized.includes(normalizedSetName)) {
      score += 6;
    }

    if (normalizedName && normalized.includes(normalizedName)) {
      score += 5;
    }

    if (normalizedRarity && normalized.includes(normalizedRarity)) {
      score += 3;
    }

    if (/\bpsa\b/.test(normalized)) {
      score += 2;
    }

    if (/\bjapanese\b/.test(normalized)) {
      score += 10;
    }

    if (
      normalizedSetCode &&
      normalized.includes(normalizedSetCode) &&
      normalized.includes(numberBase.toLowerCase()) &&
      /\bjapanese\b/.test(normalized)
    ) {
      score += 14;
    }

    return score;
  };

  return [...new Set(queries)].sort((left, right) => scoreQuery(right) - scoreQuery(left));
}

function parseTcgFishPopulation(html: string, url: string): PsaPopulationSnapshot {
  let totalCertified = null;
  const totalPopMatch = html.match(/Total population: \\",\\"([0-9,]+)\\",\\" copies/);
  const text = stripHtml(html);

  if (totalPopMatch) {
    totalCertified = parseInt(totalPopMatch[1].replace(/,/g, ""), 10);
  } else {
    const totalPopFallback =
      html.match(/Total population: <!-- -->([0-9,]+)<!-- --> copies/) ??
      text.match(/\bTotal population:\s*([0-9,]+)\s+copies\b/i) ??
      text.match(/\bPSA Population\s+([0-9,]+)\b/i);

    if (totalPopFallback) {
      totalCertified = parseInt(totalPopFallback[1].replace(/,/g, ""), 10);
    }
  }

  const grades: PsaPopulationSnapshot["grades"] = [];

  for (const grade of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
    const patterns = [
      new RegExp(
        `PSA(?:\\s|<!-- -->)*${grade}[\\s\\S]{0,220}?ecom-population-section-value[^>]*>([0-9,]+)<`,
        "i",
      ),
      new RegExp(
        `children":\\["PSA ","${grade}"\\][\\s\\S]{0,220}?children":"([0-9,]+)"`,
        "i",
      ),
      new RegExp(`\\bPSA\\s*${grade}\\s+([0-9,]+)\\b`, "i"),
    ];

    const match = patterns
      .map((pattern) => html.match(pattern) ?? text.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));

    if (match?.[1]) {
      grades.push({
        grade: `PSA ${grade}`,
        count: parseInt(match[1].replace(/,/g, ""), 10),
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.7,
        evidenceType: "population",
        sourceUrl: url,
      });
      continue;
    }
  }

  const hasRealCensus =
    grades.length > 0 || (typeof totalCertified === "number" && totalCertified > 0);

  return {
    status: hasRealCensus ? "verified" : "pending",
    totalCertified: hasRealCensus ? totalCertified : null,
    grades,
    source: "TCGFish public population page",
    fetchedAt: new Date().toISOString(),
    sourceUrl: url,
    note: "PSA population is extracted from a public card population page and normalized into our own grade-by-grade model.",
    service: "PSA",
    confidence: grades.length ? "medium" : "low",
    confidenceScore: grades.length ? 0.7 : 0.35,
    evidenceType: "population",
  };
}

function parsePriceChartingPopulationJson(
  html: string,
  url: string,
): PriceChartingPopulationResult | null {
  // Item reports expose pop_price_data; game pages expose pop_data (counts only).
  const match =
    html.match(/VGPC\.pop_price_data\s*=\s*(\{[\s\S]*?\});/) ??
    html.match(/VGPC\.pop_data\s*=\s*(\{[\s\S]*?\});/);

  if (!match) {
    return null;
  }

  let data: { psa?: number[]; cgc?: number[]; prices?: number[] };

  try {
    data = JSON.parse(match[1]) as { psa?: number[]; cgc?: number[]; prices?: number[] };
  } catch {
    return null;
  }

  const psaCounts = data.psa ?? [];
  const cgcCounts = data.cgc ?? [];
  const priceCents = data.prices ?? [];

  if (psaCounts.length < 10 && cgcCounts.length < 10) {
    return null;
  }

  const psaTotal = psaCounts.reduce((sum, count) => sum + (count ?? 0), 0);
  const cgcTotal = cgcCounts.reduce((sum, count) => sum + (count ?? 0), 0);
  const hasPsa = psaTotal > 0;
  const hasCgc = cgcTotal > 0;
  const grades: PsaPopulationSnapshot["grades"] = [];
  const gradedPrices = new Map<string, GradedPrice>();

  for (let index = 0; index < 10; index += 1) {
    const gradeNum = index + 1;
    const psaCount = psaCounts[index] ?? 0;
    const cgcCount = cgcCounts[index] ?? 0;
    const rawPrice = priceCents[index] ?? 0;

    if (psaCount > 0) {
      const gradeLabel = `PSA ${gradeNum}`;
      grades.push({
        grade: gradeLabel,
        count: psaCount,
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.72,
        evidenceType: "population",
        sourceUrl: url,
      });
    }

    if (rawPrice > 0) {
      const gradeLabel = `PSA ${gradeNum}`;
      gradedPrices.set(gradeLabel, {
        grade: gradeLabel,
        value: rawPrice / 100,
        populationCount: psaCount,
        source: "PriceCharting population PSA price snapshot",
        saleCount: 0,
        lastSoldAt: null,
        service: "PSA",
        confidence: psaCount <= 1 ? "low" : "medium",
        confidenceScore: psaCount <= 1 ? 0.42 : 0.66,
        evidenceType: "guide_snapshot",
        sourceUrl: url,
        warning:
          "Exact public PSA population report price snapshot; accepted sold comps still take precedence when available.",
      });
    }

    if (cgcCount > 0) {
      grades.push({
        grade: `CGC ${gradeNum}`,
        count: cgcCount,
        service: "CGC",
        confidence: "medium",
        confidenceScore: 0.68,
        evidenceType: "population",
        sourceUrl: url,
        warning: !hasPsa
          ? "PSA column was empty on the item report; this row is CGC-only for this grade."
          : undefined,
      });
    }
  }

  const totalCertified = psaTotal + cgcTotal;

  if (!grades.length && gradedPrices.size === 0) {
    return null;
  }

  return {
    population: {
      status: grades.length ? "verified" : "pending",
      totalCertified: totalCertified > 0 ? totalCertified : null,
      grades,
      source: "PriceCharting public population report",
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      note: grades.length
        ? hasPsa && hasCgc
          ? "PSA and CGC grade counts were parsed separately from PriceCharting's embedded population report data."
          : hasPsa
            ? "PSA grade counts were parsed from PriceCharting's embedded population report data."
            : "CGC grade counts were parsed from PriceCharting's embedded population report because this card has no PSA submissions in the item report."
        : "PriceCharting's item report exposed slab guide prices but no PSA/CGC census rows for this print.",
      service: hasPsa && !hasCgc ? "PSA" : hasCgc && !hasPsa ? "CGC" : undefined,
      confidence: grades.length ? "medium" : "low",
      confidenceScore: hasPsa ? 0.72 : grades.length ? 0.68 : 0.4,
      evidenceType: "population",
      warning: hasCgc && !hasPsa
        ? "This card has zero PSA submissions in the item report; use the CGC filter to view CGC-only counts."
        : !grades.length
          ? "No PSA/CGC population census was published on this item report."
          : undefined,
    },
    gradedPrices,
    sourceKind: "item",
  };
}

function populationServiceTotals(snapshot: PsaPopulationSnapshot) {
  const psaGrades = snapshot.grades.filter((grade) => /^PSA\s+\d/.test(grade.grade));
  const cgcGrades = snapshot.grades.filter((grade) => /^CGC\s+\d/.test(grade.grade));
  const combinedGrades = snapshot.grades.filter((grade) => grade.grade.startsWith("PSA+CGC"));
  const psaTotal = psaGrades.reduce((sum, grade) => sum + grade.count, 0);
  const cgcTotal = cgcGrades.reduce((sum, grade) => sum + grade.count, 0);
  const combinedTotal = combinedGrades.reduce((sum, grade) => sum + grade.count, 0);

  return {
    psaGrades,
    cgcGrades,
    combinedGrades,
    psaTotal,
    cgcTotal,
    combinedTotal,
    effectiveTotal: psaTotal + cgcTotal + combinedTotal,
  };
}

function isPsaPopulationNegligible(psaTotal: number, cgcTotal: number) {
  return cgcTotal >= 10 && psaTotal < Math.max(3, Math.round(cgcTotal * 0.12));
}

function isThinPublicPopulationSnapshot(snapshot: PsaPopulationSnapshot) {
  const { psaGrades, cgcGrades, combinedGrades, effectiveTotal } =
    populationServiceTotals(snapshot);
  const onlyCgcGrades =
    cgcGrades.length > 0 && psaGrades.length === 0 && combinedGrades.length === 0;

  return (
    (snapshot.grades.length <= 1 && effectiveTotal <= 1) ||
    (onlyCgcGrades && effectiveTotal <= 1)
  );
}

function isPlausibleParsedPopulation(snapshot: PsaPopulationSnapshot) {
  if (!snapshot.grades.length) {
    return false;
  }

  const { psaTotal, cgcTotal, combinedTotal, effectiveTotal } =
    populationServiceTotals(snapshot);
  const positiveGrades = snapshot.grades.filter((grade) => grade.count > 0);

  if (effectiveTotal <= 0) {
    return false;
  }

  if (
    psaTotal > 0 &&
    cgcTotal === 0 &&
    combinedTotal === 0 &&
    positiveGrades.length === 1 &&
    psaTotal <= 3
  ) {
    return false;
  }

  if (typeof snapshot.totalCertified === "number" && snapshot.totalCertified > 0) {
    return (
      effectiveTotal <= snapshot.totalCertified &&
      effectiveTotal >= snapshot.totalCertified * 0.85
    );
  }

  return positiveGrades.length >= 2 || effectiveTotal >= 5;
}

function parsePriceChartingPopulation(
  html: string,
  url: string,
): PriceChartingPopulationResult {
  const jsonResult = parsePriceChartingPopulationJson(html, url);

  if (jsonResult) {
    return jsonResult;
  }

  const text = stripHtml(html);
  const grades: PsaPopulationSnapshot["grades"] = [];
  const gradedPrices = new Map<string, GradedPrice>();
  const parsedGradeLabels = new Set<string>();

  const pushRow = ({
    grade,
    count,
    rowTotal,
    value,
    service,
  }: {
    grade: number;
    count: number;
    rowTotal: number;
    value: number | null;
    service: GradingService;
  }) => {
    const gradeLabel = service === "CGC" ? `CGC ${grade}` : `PSA ${grade}`;

    if (parsedGradeLabels.has(gradeLabel) || rowTotal < count || rowTotal <= 0) {
      return;
    }

    parsedGradeLabels.add(gradeLabel);
    grades.push({
      grade: gradeLabel,
      count,
      service,
      confidence: "medium",
      confidenceScore: 0.62,
      evidenceType: "population",
      sourceUrl: url,
    });

    if (value != null && Number.isFinite(value) && value > 0) {
      gradedPrices.set(gradeLabel, {
        grade: gradeLabel,
        value,
        populationCount: count,
        source:
          service === "CGC"
            ? "PriceCharting population CGC price snapshot"
            : "PriceCharting population PSA price snapshot",
        saleCount: 0,
        lastSoldAt: null,
        service,
        confidence: "medium",
        confidenceScore: 0.66,
        evidenceType: "guide_snapshot",
        sourceUrl: url,
        warning:
          service === "CGC"
            ? "CGC guide price parsed from the exact public population report; accepted sold comps still take precedence when available."
            : "Exact public PSA population report price snapshot; accepted sold comps still take precedence when available.",
      });
    }
  };

  const markdownRowRegex =
    /\|\s*(10|9|8|7|6|5|4|3|2|1)\s*\|\s*(-|[0-9][0-9,]*)\s*\|\s*(-|[0-9][0-9,]*)\s*\|\s*(-|[0-9][0-9,]*)\s*\|\s*(?:\$([0-9,.]+))?\s*\|/g;

  for (const match of text.matchAll(markdownRowRegex)) {
    const grade = parseInteger(match[1]);
    const psaCount = match[2] === "-" ? 0 : parseInteger(match[2]);
    const cgcCount = match[3] === "-" ? 0 : parseInteger(match[3]);
    const rowTotal = match[4] === "-" ? psaCount + cgcCount : parseInteger(match[4]);
    const value = match[5] ? parseUsd(match[5]) : null;

    if (psaCount > 0) {
      pushRow({
        grade,
        count: psaCount,
        rowTotal,
        value,
        service: "PSA",
      });
    }

    if (cgcCount > 0) {
      pushRow({
        grade,
        count: cgcCount,
        rowTotal,
        value: psaCount > 0 ? null : value,
        service: "CGC",
      });
    }
  }

  for (const grade of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
    const rowMatch = text.match(
      new RegExp(
        `(?:^|\\s)${grade}\\s+(-|[0-9][0-9,]*)\\s+(-|[0-9][0-9,]*)\\s+([0-9][0-9,]*)(?:\\s+\\$([0-9,.]+))?(?=\\s|$)`,
        "i",
      ),
    );

    if (!rowMatch) {
      continue;
    }

    const psaCount = rowMatch[1] === "-" ? 0 : parseInteger(rowMatch[1]);
    const cgcCount = rowMatch[2] === "-" ? 0 : parseInteger(rowMatch[2]);
    const rowTotal = parseInteger(rowMatch[3]);

    if (psaCount + cgcCount <= 0 || rowTotal < psaCount + cgcCount) {
      continue;
    }

    if (psaCount > 0) {
      pushRow({
        grade,
        count: psaCount,
        rowTotal,
        value: rowMatch[4] ? parseUsd(rowMatch[4]) : null,
        service: "PSA",
      });
    }

    if (cgcCount > 0) {
      pushRow({
        grade,
        count: cgcCount,
        rowTotal,
        value: psaCount > 0 || !rowMatch[4] ? null : parseUsd(rowMatch[4]),
        service: "CGC",
      });
    }
  }

  const pushGuideOnlyPrice = (gradeLabel: string, value: number | null, service: GradingService = "PSA") => {
    if (value == null || !Number.isFinite(value) || value <= 0 || gradedPrices.has(gradeLabel)) {
      return;
    }

    gradedPrices.set(gradeLabel, {
      grade: gradeLabel,
      value,
      populationCount: 0,
      source: "PriceCharting population PSA price snapshot",
      saleCount: 0,
      lastSoldAt: null,
      service: gradeService(gradeLabel) ?? service,
      confidence: "medium",
      confidenceScore: 0.6,
      evidenceType: "guide_snapshot",
      sourceUrl: url,
      warning:
        "Grade guide price parsed from a public population report with no certified counts for this grade.",
    });
  };

  const dashPriceRowRegex =
    /\|\s*(10|9|8|7|6|5|4|3|2|1)\s*\|\s*-\s*\|\s*-\s*\|\s*-\s*\|\s*\$([0-9,.]+)\s*\|/g;

  for (const match of text.matchAll(dashPriceRowRegex)) {
    pushGuideOnlyPrice(`PSA ${match[1]}`, parseUsd(match[2]));
  }

  for (const grade of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
    const dashMatch = text.match(
      new RegExp(
        `(?:^|\\s)${grade}\\s+-\\s+-\\s+-\\s+\\$([0-9,.]+)(?=\\s|$)`,
        "i",
      ),
    );

    if (dashMatch) {
      pushGuideOnlyPrice(`PSA ${grade}`, parseUsd(dashMatch[1]));
    }
  }

  const totalMatch =
    text.match(/\|\s*Total\s*\|\s*([0-9,]+)\s*\|\s*(?:-|[0-9,]+)\s*\|\s*([0-9,]+)/i) ??
    text.match(/\bTotal\s+(-|[0-9,]+)\s+(-|[0-9,]+)\s+([0-9,]+)/i);
  const totalCertified = totalMatch
    ? parseInteger(totalMatch[totalMatch.length - 1])
    : grades.reduce((sum, grade) => sum + grade.count, 0) || null;

  const population: PsaPopulationSnapshot = {
    status: grades.length || typeof totalCertified === "number" ? "verified" : "pending",
    totalCertified,
    grades,
    source: "PriceCharting public population report",
    fetchedAt: new Date().toISOString(),
    sourceUrl: url,
    note: "PSA population was extracted from PriceCharting's public population table when embedded report data was unavailable.",
    service: "PSA",
    confidence: grades.length ? "medium" : "low",
    confidenceScore: grades.length ? 0.62 : 0.35,
    evidenceType: "population",
  };

  if (!isPlausibleParsedPopulation(population)) {
    return {
      population: {
        ...population,
        status: "pending",
        totalCertified: grades.length
          ? grades.reduce((sum, grade) => sum + grade.count, 0) || null
          : null,
        grades: grades.length ? grades : [],
        confidence: gradedPrices.size > 0 ? "low" : "low",
        confidenceScore: gradedPrices.size > 0 ? 0.34 : 0.2,
        warning:
          gradedPrices.size > 0
            ? "Population counts were unavailable, but grade guide prices were parsed from the public population report."
            : "The public population page did not expose a trustworthy grade table for this card.",
      },
      gradedPrices,
      sourceKind: "item",
    };
  }

  return {
    population,
    gradedPrices,
    sourceKind: "item",
  };
}

function parsePriceChartingSetPopulationIndex(
  html: string,
  url: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
): PriceChartingPopulationResult | null {
  let best:
    | (PriceChartingPopulationResult & {
        rowTitle: string;
      })
    | null = null;

  const considerRow = (rowTitle: string, href: string, counts: number[]) => {
    const matchScore = scorePopulationRowTitle(rowTitle, cardName, cardNumber, setTotal);

    if (matchScore <= 0) {
      return;
    }

    if (counts.length < 6) {
      return;
    }

    const [grade6, grade7, grade8, grade9, grade10, totalCertified] = counts;
    const rowGrades = [
      { grade: "PSA+CGC 10", count: grade10 },
      { grade: "PSA+CGC 9", count: grade9 },
      { grade: "PSA+CGC 8", count: grade8 },
      { grade: "PSA+CGC 7", count: grade7 },
      { grade: "PSA+CGC 6", count: grade6 },
    ].filter((grade) => grade.count >= 0);
    const discoveredItemUrl = toPriceChartingPopulationItemUrl(href);
    const population: PsaPopulationSnapshot = {
      status: rowGrades.length || totalCertified > 0 ? "verified" : "pending",
      totalCertified: totalCertified > 0 ? totalCertified : rowGrades.reduce((sum, grade) => sum + grade.count, 0) || null,
      grades: rowGrades.map((grade) => ({
        ...grade,
        confidence: "medium" as const,
        confidenceScore: 0.52,
        evidenceType: "population" as const,
        sourceUrl: url,
      })),
      source: "PriceCharting set population index",
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      note:
        "Combined PSA/CGC grade counts were found by matching the card inside PriceCharting's free set-level population index. The index exposes grades 6-10 and is mainly used to discover the exact PSA item report.",
      confidence: "medium",
      confidenceScore: 0.52,
      evidenceType: "population",
      warning: "Set-level population rows are combined PSA/CGC counts. Exact item reports are preferred when available.",
    };
    const candidate: PriceChartingPopulationResult & { rowTitle: string } = {
      population,
      gradedPrices: new Map(),
      discoveredItemUrls: [discoveredItemUrl],
      matchScore,
      sourceKind: "set_index",
      rowTitle,
    };

    if (
      !best ||
      (candidate.matchScore ?? 0) + populationQualityScore(candidate.population) >
        (best.matchScore ?? 0) + populationQualityScore(best.population)
    ) {
      best = candidate;
    }
  };

  const markdownRowRegex =
    /\|\s*(?:\[[^\]]*\]\([^)]+\)\s*\|\s*)?\[([^\]]+#[^\]]+)\]\(([^)]+)\)\s*\|\s*([0-9][0-9,]*)\s*\|\s*([0-9][0-9,]*)\s*\|\s*([0-9][0-9,]*)\s*\|\s*([0-9][0-9,]*)\s*\|\s*([0-9][0-9,]*)\s*\|\s*([0-9][0-9,]*)\s*\|/g;

  for (const match of html.matchAll(markdownRowRegex)) {
    considerRow(
      normalizeWhitespace(match[1]),
      match[2],
      [match[3], match[4], match[5], match[6], match[7], match[8]].map(parseInteger),
    );
  }

  const anchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const href = match[1];
    const rowTitle = normalizeWhitespace(stripHtml(match[2]));

    if (!rowTitle.includes("#")) {
      continue;
    }

    const rowStart = (match.index ?? 0) + match[0].length;
    const rowTail = html.slice(rowStart, rowStart + 1_200);
    const rowText =
      stripHtml(rowTail).split(/\b(?:Collection|Wishlist|Compare|Image)\b/i)[0] ??
      stripHtml(rowTail);
    const counts = [...rowText.matchAll(/\b[0-9][0-9,]*\b/g)]
      .map((countMatch) => parseInteger(countMatch[0]))
      .filter((count) => Number.isFinite(count));

    considerRow(rowTitle, href, counts);
  }

  return best;
}

type EnglishParallelPopulationMatch = {
  rowTitle: string;
  discoveredItemUrl: string;
  matchScore: number;
  collectorNumber: number;
};

function collectEnglishParallelPopulationMatches(
  html: string,
  cardName: string,
): EnglishParallelPopulationMatch[] {
  const matches: EnglishParallelPopulationMatch[] = [];

  const considerRow = (rowTitle: string, href: string) => {
    const matchScore = scorePopulationRowTitleByName(rowTitle, cardName);

    if (matchScore <= 0) {
      return;
    }

    matches.push({
      rowTitle,
      discoveredItemUrl: toPriceChartingPopulationItemUrl(href),
      matchScore,
      collectorNumber: extractCollectorNumberFromRowTitle(rowTitle),
    });
  };

  const markdownRowRegex =
    /\|\s*(?:\[[^\]]*\]\([^)]+\)\s*\|\s*)?\[([^\]]+#[^\]]+)\]\(([^)]+)\)\s*\|/g;

  for (const match of html.matchAll(markdownRowRegex)) {
    considerRow(normalizeWhitespace(match[1]), match[2]);
  }

  const anchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const rowTitle = normalizeWhitespace(stripHtml(match[2]));

    if (!rowTitle.includes("#")) {
      continue;
    }

    considerRow(rowTitle, match[1]);
  }

  return matches;
}

function chooseBestEnglishParallelPopulationMatch(
  matches: EnglishParallelPopulationMatch[],
  cardNumber: string,
  setTotal?: number,
) {
  if (!matches.length) {
    return null;
  }

  const maxScore = Math.max(...matches.map((match) => match.matchScore));
  const topTier = matches.filter((match) => match.matchScore >= maxScore - 2);
  const secretRare = isSecretRareCollectorNumber(cardNumber, setTotal);

  if (secretRare) {
    return [...topTier].sort((left, right) => right.collectorNumber - left.collectorNumber)[0] ?? null;
  }

  return [...topTier].sort((left, right) => right.matchScore - left.matchScore)[0] ?? null;
}

function englishParallelSetSlugVariants(profile: {
  englishParallelPriceChartingSlug?: string;
  englishParallelPriceChartingSlugAliases?: string[];
}) {
  return [
    ...new Set(
      [profile.englishParallelPriceChartingSlug, ...(profile.englishParallelPriceChartingSlugAliases ?? [])]
        .map((slug) => slug?.trim())
        .filter(Boolean),
    ),
  ] as string[];
}

async function fetchEnglishParallelPsaPopulationFromSetSlug(
  englishSetSlug: string,
  profile: ReturnType<typeof getEnglishParallelSetMarketProfile>,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
): Promise<PriceChartingPopulationResult | null> {
  if (!profile) {
    return null;
  }

  const englishSetName = profile.englishParallelSetName ?? "English parallel";
  const setIndexUrl = `https://www.pricecharting.com/pop/set/${englishSetSlug}`;

  let html: string;

  try {
    html = await fetchPopulationHtml(setIndexUrl);
  } catch {
    html = "";
  }

  const matches = html ? collectEnglishParallelPopulationMatches(html, cardName) : [];
  const bestMatch = chooseBestEnglishParallelPopulationMatch(matches, cardNumber, setTotal);
  let itemParsed = bestMatch?.discoveredItemUrl
    ? await tryParsePriceChartingPopulationUrl(bestMatch.discoveredItemUrl)
    : null;

  if (!itemParsed || !hasPopulationSignal(itemParsed.population)) {
    const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting", {
      englishCardName: cardName,
    });
    const numberSlugs = numberSlugVariantsForExternalApis(cardNumber, setTotal);
    const directGameUrls = [
      ...new Set(
        nameSlugs.flatMap((nameSlug) =>
          numberSlugs.map(
            (numberSlug) =>
              `https://www.pricecharting.com/game/${englishSetSlug}/${nameSlug}-${numberSlug}`,
          ),
        ),
      ),
    ].slice(0, 8);

    for (const gameUrl of directGameUrls) {
      try {
        const gameHtml = await fetchHtml(gameUrl);
        const resolved = await resolvePriceChartingGuideCandidates(
          gameHtml,
          gameUrl,
          cardName,
          cardNumber,
        );

        const populationUrls = [...resolved.discoveredPopulationUrls];

        for (const followUpUrl of resolved.followUpUrls.slice(0, 3)) {
          try {
            const followUpHtml = await fetchHtml(followUpUrl);
            populationUrls.push(...extractPriceChartingPopulationLinks(followUpHtml));
          } catch {
            continue;
          }
        }

        for (const populationUrl of [...new Set(populationUrls)].slice(0, 4)) {
          const parsed = await tryParsePriceChartingPopulationUrl(populationUrl);

          if (parsed && hasPopulationSignal(parsed.population)) {
            itemParsed = parsed;
            break;
          }
        }

        if (itemParsed && hasPopulationSignal(itemParsed.population)) {
          break;
        }

        if (resolved.prices.size > 0) {
          const guidePopulation: PsaPopulationSnapshot = {
            status: "verified",
            totalCertified: null,
            grades: [],
            source: "PriceCharting public guide",
            fetchedAt: new Date().toISOString(),
            sourceUrl: gameUrl,
            note: "Recovered graded guide snapshots from a direct English parallel game page.",
            service: "PSA",
            confidence: "medium",
            confidenceScore: 0.58,
            evidenceType: "guide_snapshot",
          };

          itemParsed = {
            population: guidePopulation,
            gradedPrices: resolved.prices,
            matchScore: scorePriceChartingGameLinkCandidate(gameUrl, cardName, cardNumber),
            sourceKind: "item",
          };
          break;
        }

        for (const followUpUrl of resolved.followUpUrls.slice(0, 3)) {
          try {
            const followUpHtml = await fetchHtml(followUpUrl);
            const followUpResolved = await resolvePriceChartingGuideCandidates(
              followUpHtml,
              followUpUrl,
              cardName,
              cardNumber,
            );

            for (const populationUrl of followUpResolved.discoveredPopulationUrls.slice(0, 2)) {
              const parsed = await tryParsePriceChartingPopulationUrl(populationUrl);

              if (parsed && hasPopulationSignal(parsed.population)) {
                itemParsed = parsed;
                break;
              }
            }

            if (itemParsed && hasPopulationSignal(itemParsed.population)) {
              break;
            }

            if (followUpResolved.prices.size > 0) {
              itemParsed = {
                population: {
                  status: "verified",
                  totalCertified: null,
                  grades: [],
                  source: "PriceCharting public guide",
                  fetchedAt: new Date().toISOString(),
                  sourceUrl: followUpUrl,
                  note: "Recovered graded guide snapshots from a ranked English parallel follow-up page.",
                  service: "PSA",
                  confidence: "medium",
                  confidenceScore: 0.58,
                  evidenceType: "guide_snapshot",
                },
                gradedPrices: followUpResolved.prices,
                matchScore: scorePriceChartingGameLinkCandidate(followUpUrl, cardName, cardNumber),
                sourceKind: "item",
              };
              break;
            }
          } catch {
            continue;
          }
        }

        if (itemParsed) {
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!itemParsed) {
    return null;
  }

  const hasPopulationTable = hasPopulationSignal(itemParsed.population);
  const hasGuidePrices = itemParsed.gradedPrices.size > 0;

  if (!hasPopulationTable && !hasGuidePrices) {
    return null;
  }

  if (hasPopulationTable) {
    const { psaTotal } = populationServiceTotals(itemParsed.population);

    if (psaTotal < 10 && !hasGuidePrices) {
      return null;
    }
  }

  const finalized = hasPopulationTable
    ? finalizePriceChartingPopulationSnapshot(itemParsed.population)
    : itemParsed.population;
  const localizedName = profile.englishName;
  const rowTitle = bestMatch?.rowTitle ?? cardName;

  return {
    ...itemParsed,
    population: {
      ...finalized,
      source: `PriceCharting PSA population (English ${englishSetName} parallel)`,
      note: `PSA population from the English ${englishSetName} parallel print. Japanese ${localizedName} cards are often cross-referenced in PSA census by the international release.`,
      warning: hasPopulationTable
        ? `Japanese PSA submissions for this print are minimal in PriceCharting. PSA counts reflect the English ${englishSetName} parallel (${rowTitle}).`
        : `Guide prices from the English ${englishSetName} parallel print; Japanese PSA census counts were unavailable.`,
      attribution: "english_parallel_psa",
      confidence: "medium",
      confidenceScore: 0.7,
    },
    matchScore: bestMatch?.matchScore ?? itemParsed.matchScore,
    sourceKind: "item",
  };
}

async function fetchEnglishParallelPsaPopulation(
  setCode: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
): Promise<PriceChartingPopulationResult | null> {
  const profile = getEnglishParallelSetMarketProfile(setCode);

  if (!profile?.englishParallelPriceChartingSlug) {
    return null;
  }

  for (const englishSetSlug of englishParallelSetSlugVariants(profile)) {
    const result = await fetchEnglishParallelPsaPopulationFromSetSlug(
      englishSetSlug,
      profile,
      cardName,
      cardNumber,
      setTotal,
    );

    if (result) {
      return result;
    }
  }

  return null;
}

function populationQualityScore(snapshot: PsaPopulationSnapshot) {
  const { effectiveTotal } = populationServiceTotals(snapshot);
  const positiveGrades = snapshot.grades.filter((grade) => grade.count > 0).length;
  const gradeCoverageScore = positiveGrades * 12;
  const totalScore =
    typeof snapshot.totalCertified === "number"
      ? Math.min(24, Math.log10(Math.max(snapshot.totalCertified, 1)) * 8)
      : Math.min(24, Math.log10(Math.max(effectiveTotal, 1)) * 8);
  const confidenceScore = (snapshot.confidenceScore ?? 0.35) * 10;

  return gradeCoverageScore + totalScore + confidenceScore;
}

function priceChartingPopulationCandidateScore(candidate: PriceChartingPopulationResult) {
  const trustedItem =
    candidate.sourceKind === "item" &&
    isPlausibleParsedPopulation(candidate.population) &&
    (candidate.population.confidenceScore ?? 0) >= 0.7;

  return (
    populationQualityScore(candidate.population) +
    candidate.gradedPrices.size * 3 +
    (trustedItem ? 14 : candidate.sourceKind === "item" ? 4 : 0) +
    (candidate.matchScore ?? 0) / 4
  );
}

function chooseBestPriceChartingPopulationResult(
  candidates: PriceChartingPopulationResult[],
) {
  return [...candidates]
    .filter((candidate) => {
      if (!hasPopulationSignal(candidate.population) && candidate.gradedPrices.size === 0) {
        return false;
      }

      if (
        candidate.sourceKind === "item" &&
        hasPopulationSignal(candidate.population) &&
        !isPlausibleParsedPopulation(candidate.population)
      ) {
        return false;
      }

      return true;
    })
    .sort(
      (left, right) =>
        priceChartingPopulationCandidateScore(right) -
        priceChartingPopulationCandidateScore(left),
    )[0] ?? null;
}

function shouldPreferPopulationSnapshot(
  incoming: PsaPopulationSnapshot,
  current: PsaPopulationSnapshot,
) {
  if (!hasPopulationSignal(incoming)) {
    return false;
  }

  if (!hasPopulationSignal(current)) {
    return true;
  }

  return populationQualityScore(incoming) > populationQualityScore(current) + 2;
}

function shouldPreferJapanesePriceChartingPopulation(
  incoming: PriceChartingPopulationResult,
  current: PsaPopulationSnapshot,
  setCode?: string,
) {
  if (!hasPopulationSignal(incoming.population)) {
    return false;
  }

  const profile = setCode ? getLocalizedSetMarketProfile(setCode) : undefined;

  if (
    incoming.sourceKind === "item" &&
    isPlausibleParsedPopulation(incoming.population) &&
    (profile?.priceChartingSlug || (incoming.matchScore ?? 0) >= 72)
  ) {
    return true;
  }

  if (incoming.sourceKind === "set_index") {
    return !hasPopulationSignal(current);
  }

  return shouldPreferPopulationSnapshot(incoming.population, current);
}

export { usesEnglishParallelPsaPopulation } from "@/lib/psa-population-attribution";

function finalizePriceChartingPopulationSnapshot(
  snapshot: PsaPopulationSnapshot,
): PsaPopulationSnapshot {
  const { psaGrades, cgcGrades, combinedGrades, psaTotal, cgcTotal } =
    populationServiceTotals(snapshot);

  if (isThinPublicPopulationSnapshot(snapshot)) {
    return {
      ...snapshot,
      status: "pending",
      grades: [],
      totalCertified: null,
      confidence: "low",
      confidenceScore: Math.min(snapshot.confidenceScore ?? 0.32, 0.32),
      warning:
        "The public population report exposed only a very thin partial census row, so it is not treated as a certified population table.",
      note:
        "Public population evidence was too thin to trust as a complete certified population table.",
    };
  }

  if (psaGrades.length > 0 && cgcGrades.length > 0) {
    const totalCertified = psaTotal + cgcTotal;

    return {
      ...snapshot,
      grades: [...psaGrades, ...cgcGrades].sort(
        (left, right) => gradeSortKey(right.grade) - gradeSortKey(left.grade),
      ),
      totalCertified: totalCertified > 0 ? totalCertified : snapshot.totalCertified,
      service: undefined,
      warning:
        "PSA and CGC population are reported separately. Use All, PSA, or CGC filters above.",
    };
  }

  if (combinedGrades.length > 0 && !psaGrades.length && !cgcGrades.length) {
    return {
      ...snapshot,
      warning:
        snapshot.warning ??
        "Set-index population combines PSA and CGC for grades 6-10. Use the All filter for combined counts.",
    };
  }

  if (cgcGrades.length > 0) {
    return {
      ...snapshot,
      grades: cgcGrades,
      totalCertified: cgcTotal > 0 ? cgcTotal : snapshot.totalCertified,
      service: "CGC",
      warning:
        snapshot.warning ??
        "No PSA submissions were found in the public report. CGC population is shown.",
    };
  }

  if (psaGrades.length > 0) {
    return {
      ...snapshot,
      grades: psaGrades,
      totalCertified: psaTotal > 0 ? psaTotal : snapshot.totalCertified,
      service: "PSA",
    };
  }

  return {
    ...snapshot,
    grades: snapshot.grades.filter((grade) => !grade.grade.startsWith("PSA+CGC")),
  };
}

function reconcilePriceChartingPopulationCandidates(
  candidates: PriceChartingPopulationResult[],
) {
  const best = chooseBestPriceChartingPopulationResult(candidates);

  if (!best || best.sourceKind !== "item") {
    return best;
  }

  const setIndexCandidate = [...candidates]
    .filter((candidate) => candidate.sourceKind === "set_index")
    .sort(
      (left, right) =>
        priceChartingPopulationCandidateScore(right) -
        priceChartingPopulationCandidateScore(left),
    )[0];

  if (!setIndexCandidate || (setIndexCandidate.matchScore ?? 0) <= 0) {
    return best;
  }

  const itemTotals = populationServiceTotals(best.population);
  const setTotals = populationServiceTotals(setIndexCandidate.population);
  const itemEffective = itemTotals.effectiveTotal;
  const setEffective = setTotals.effectiveTotal;

  if (itemEffective < 5 && setEffective >= Math.max(20, itemEffective * 4)) {
    return setIndexCandidate;
  }

  return best;
}

async function resolveGuideSetSlugs(
  setName: string,
  options: ExternalMarketLookupOptions = {},
) {
  const staticSlugs = priceChartingSetSlugVariants(setName, options);

  if (options.language === "ja" || options.isJapanese) {
    const discovered = await resolvePriceChartingSetSlugs(setName, options).catch(() => []);
    return [...new Set([...discovered, ...staticSlugs])];
  }

  return staticSlugs;
}

async function tryParsePriceChartingPopulationUrl(
  url: string,
  salesIdentity?: ReturnType<typeof buildMarketCardIdentity>,
): Promise<PriceChartingPopulationResult | null> {
  try {
    const html = await fetchPopulationHtml(url);
    const parsed = parsePriceChartingPopulation(html, url);

    if (
      !hasPopulationSignal(parsed.population) &&
      parsed.gradedPrices.size === 0
    ) {
      return null;
    }

    if (
      parsed.sourceKind === "item" &&
      hasPopulationSignal(parsed.population) &&
      !isPlausibleParsedPopulation(parsed.population)
    ) {
      return null;
    }

    const sales = salesIdentity
      ? parsePriceChartingPublicPageSales(html, url, salesIdentity)
      : [];

    return sales.length ? { ...parsed, sales } : parsed;
  } catch {
    return null;
  }
}

async function fetchPriceChartingPopulationDirectPriority(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
): Promise<PriceChartingPopulationResult | null> {
  const salesIdentity = marketIdentityForPriceChartingSales(
    setName,
    cardName,
    cardNumber,
    setTotal,
    options,
  );
  const numberSlugs = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const itemUrls = buildPriceChartingPopulationItemUrls(
    setName,
    cardName,
    cardNumber,
    setTotal,
    options,
  );
  // Item reports are enough for pop + slab snapshots. Mixing /game/ alias slugs
  // here 404/429s PriceCharting and blanks the next card on the shared host lock.
  const directUrls = [...new Set(itemUrls)].slice(0, 4);

  if (directUrls[0]) {
    console.info("[market] PriceCharting pop first url", {
      cardName,
      cardNumber,
      numberSlugs: numberSlugs.slice(0, 4),
      url: directUrls[0],
    });
  }

  if (!directUrls.length) {
    return null;
  }

  const candidates: PriceChartingPopulationResult[] = [];
  const visited = new Set<string>();

  const isUsableItem = (candidate: PriceChartingPopulationResult) =>
    candidate.sourceKind === "item" &&
    (candidate.gradedPrices.size > 0 ||
      (hasPopulationSignal(candidate.population) &&
        isPlausibleParsedPopulation(candidate.population)));

  const finishItemMatch = async (
    candidate: PriceChartingPopulationResult,
    sourceUrl: string,
  ) => {
    if (isUsableItem(candidate)) {
      return attachPriceChartingCompletedSales(candidate, salesIdentity, sourceUrl);
    }

    return candidate;
  };

  const probeUrl = async (url: string) => {
    const normalized = toPriceChartingPopulationItemUrl(url);
    if (visited.has(normalized) && visited.has(url)) {
      return null;
    }
    visited.add(url);
    visited.add(normalized);

    // Game URLs that 404 into search lists need product follow-ups before /pop/item.
    if (/\/game\//i.test(url)) {
      try {
        const html = await fetchHtml(url);
        if (isPriceChartingSearchListPage(html)) {
          const followUps = rankPriceChartingGameLinks(
            extractPriceChartingGameLinks(html),
            cardName,
            cardNumber,
          )
            .slice(0, 3)
            .map((entry) => entry.url);

          for (const followUp of followUps) {
            for (const populationUrl of populationUrlsFromPriceChartingProductPage("", followUp)) {
              const followed = await tryParsePriceChartingPopulationUrl(
                populationUrl,
                salesIdentity,
              );
              if (followed) {
                const finished = await finishItemMatch(followed, followUp);
                candidates.push(finished);
                if (isUsableItem(finished)) {
                  return finished;
                }
              }
            }
          }
          return null;
        }

        const gameSales = parsePriceChartingPublicPageSales(html, url, salesIdentity);
        for (const populationUrl of populationUrlsFromPriceChartingProductPage(html, url)) {
          const parsed = await tryParsePriceChartingPopulationUrl(
            populationUrl,
            salesIdentity,
          );
          if (parsed) {
            const withSales =
              parsed.sales?.length || !gameSales.length
                ? parsed
                : { ...parsed, sales: gameSales };
            const finished = await finishItemMatch(withSales, url);
            candidates.push(finished);
            if (isUsableItem(finished)) {
              return finished;
            }
          }
        }
      } catch {
        // Fall through to direct pop/item probe below.
      }
    }

    const candidate = await tryParsePriceChartingPopulationUrl(url, salesIdentity);
    if (candidate) {
      const finished = await finishItemMatch(candidate, url);
      candidates.push(finished);
      return finished;
    }
    return candidate;
  };

  // Candidate URLs are ranked. Probe sequentially and stop on a plausible item
  // match instead of scheduling every slug variant before the first response.
  for (const url of directUrls) {
    const candidate = await probeUrl(url);

    if (candidate && isUsableItem(candidate)) {
      return candidate;
    }

    if (isPublicPageCircuitOpen(url)) {
      break;
    }
  }

  return reconcilePriceChartingPopulationCandidates(candidates);
}

// Population changes slowly; a 14-day local row is treated as fresh and served
// without any network. A separate "max age" guards against ever serving truly
// ancient data even if a refresh keeps failing.
const POPULATION_STORE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// Population counts change slowly (14d ok), but graded PRICES bundled with the
// pop scrape do not — only reuse the stored graded prices when very recent;
// otherwise let the live guide provide fresh values.
const POPULATION_STORE_GRADED_PRICE_TTL_MS = 24 * 60 * 60 * 1000;
const POPULATION_STORE_REFERENCE_GRADED_PRICE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function populationIdentity(
  setName: string,
  cardName: string,
  cardNumber: string,
  options: ExternalMarketLookupOptions,
): PopulationIdentity {
  return {
    setName,
    cardName,
    cardNumber,
    setCode: options.setCode,
    language: options.language,
    officialCardId: options.officialCardId,
    priceChartingProductId: priceChartingIdentityFields(options).productId,
    identityVersion: options.identityVersion,
    finish: options.finish,
  };
}

function populationStoreIdentityCandidates(identity: PopulationIdentity): PopulationIdentity[] {
  const candidates = [identity];

  if (identity.setCode) {
    candidates.push({ ...identity, setCode: undefined });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = buildPopulationKey(candidate);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function storedGradedPricesForAge(stored: StoredPopulation): Map<string, GradedPrice> {
  if (stored.ageMs < POPULATION_STORE_GRADED_PRICE_TTL_MS) {
    return new Map(stored.gradedPrices);
  }

  if (stored.ageMs > POPULATION_STORE_REFERENCE_GRADED_PRICE_TTL_MS) {
    return new Map();
  }

  return new Map(
    stored.gradedPrices.map(([grade, price]) => [
      grade,
      {
        ...price,
        source: price.source?.includes("stored reference")
          ? price.source
          : `${price.source ?? "Stored graded market"} (stored reference)`,
        confidence: "low" as const,
        confidenceScore: Math.min(price.confidenceScore ?? 0.42, 0.42),
        warning:
          "Stored grade guide snapshot is older than 24 hours; use it as a reference until fresh guide data returns.",
      },
    ]),
  );
}

/**
 * Local-first population fetch. Reads the self-hosted SQLite store first and
 * serves a fresh row with zero network; otherwise scrapes live and writes the
 * parsed snapshot back to the store. The recovery path (extraItemUrls present)
 * bypasses the store so freshly discovered URLs are always honoured.
 */
async function fetchPriceChartingPopulationWithVariants(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
  extraItemUrls: string[] = [],
): Promise<PriceChartingPopulationResult | null> {
  const canUseStore = extraItemUrls.length === 0;
  const identity = populationIdentity(setName, cardName, cardNumber, options);
  const storeKey = buildPopulationKey(identity);

  if (canUseStore) {
    for (const candidateIdentity of populationStoreIdentityCandidates(identity)) {
      const stored = await readStoredPopulation(buildPopulationKey(candidateIdentity));

      if (
        stored &&
        isPopulationFresh(stored.fetchedAt, POPULATION_STORE_TTL_MS) &&
        hasPopulationSignal(stored.snapshot)
      ) {
        // Serve population counts local-first. Stored grade prices are fresh for
        // 24h; after that they can still keep the grade panel informative, but
        // only as low-confidence reference snapshots.
        return {
          population: stored.snapshot,
          gradedPrices: storedGradedPricesForAge(stored),
          sourceKind: stored.sourceKind,
          matchScore: stored.matchScore,
        };
      }
    }
  }

  // When PriceCharting is cooling down, skip the scrape burst and keep any
  // local-store miss as a soft miss — callers already fall back to TCGFish.
  if (isPublicPageCircuitOpen("https://www.pricecharting.com/")) {
    return null;
  }

  const result = await fetchPriceChartingPopulationWithVariantsUncached(
    setName,
    cardName,
    cardNumber,
    setTotal,
    options,
    extraItemUrls,
  );

  if (
    canUseStore &&
    result &&
    hasPopulationSignal(result.population) &&
    (result.sourceKind !== "item" || isPlausibleParsedPopulation(result.population))
  ) {
    // Best-effort persistence only; never block the response on a write.
    void writeStoredPopulation(storeKey, identity, {
      snapshot: {
        ...result.population,
        fetchedAt: result.population.fetchedAt ?? new Date().toISOString(),
      },
      gradedPrices: [...result.gradedPrices.entries()],
      sourceKind: result.sourceKind,
      matchScore: result.matchScore,
    });
  }

  return result;
}

async function fetchPriceChartingPopulationWithVariantsUncached(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
  extraItemUrls: string[] = [],
): Promise<PriceChartingPopulationResult | null> {
  const discoveredPriorityUrls = [
    ...new Set(extraItemUrls.map((url) => toPriceChartingPopulationItemUrl(url))),
  ].filter((url) =>
    priceChartingMarketUrlMatchesLookup(url, setName, cardName, options),
  );
  const extraCandidates: PriceChartingPopulationResult[] = [];
  for (const url of discoveredPriorityUrls.slice(0, 3)) {
    const candidate = await tryParsePriceChartingPopulationUrl(url);
    if (candidate) {
      extraCandidates.push(candidate);
    }

    if (
      candidate &&
      hasPopulationSignal(candidate.population) &&
      (candidate.sourceKind !== "item" ||
        isPlausibleParsedPopulation(candidate.population))
    ) {
      break;
    }

    if (isPublicPageCircuitOpen(url)) {
      break;
    }
  }
  const extraPriority = reconcilePriceChartingPopulationCandidates(extraCandidates);

  if (
    extraPriority &&
    hasPopulationSignal(extraPriority.population) &&
    (extraPriority.sourceKind !== "item" ||
      isPlausibleParsedPopulation(extraPriority.population))
  ) {
    return extraPriority;
  }

  const directPriority = await fetchPriceChartingPopulationDirectPriority(
    setName,
    cardName,
    cardNumber,
    setTotal,
    options,
  );

  const mergedDirectPriority = reconcilePriceChartingPopulationCandidates(
    [extraPriority, directPriority].filter(
      (candidate): candidate is PriceChartingPopulationResult => Boolean(candidate),
    ),
  );

  if (
    mergedDirectPriority &&
    hasPopulationSignal(mergedDirectPriority.population) &&
    (mergedDirectPriority.sourceKind !== "item" ||
      isPlausibleParsedPopulation(mergedDirectPriority.population))
  ) {
    return mergedDirectPriority;
  }

  // Ranked item URLs already missed. Extra 404s on alias set slugs trip
  // PriceCharting's 429 circuit and blank the next card-detail lookup.
  if (!options.isJapanese && options.language !== "ja") {
    return mergedDirectPriority;
  }

  const directUrls = buildPriceChartingPopulationItemUrls(
    setName,
    cardName,
    cardNumber,
    setTotal,
    options,
  );
  const setIndexUrls = buildPriceChartingSetPopulationUrls(setName, options);
  const candidates: PriceChartingPopulationResult[] = mergedDirectPriority
    ? [mergedDirectPriority]
    : extraPriority
      ? [extraPriority]
      : directPriority
        ? [directPriority]
        : [];

  const remainingDirectUrls = directUrls.slice(8, 12);
  let firstError: unknown;
  let fulfilledCount = 0;

  for (const url of remainingDirectUrls) {
    try {
      const html = await fetchPopulationHtml(url);
      fulfilledCount += 1;
      const parsed = parsePriceChartingPopulation(html, url);

      if (
        parsed.population.totalCertified !== null ||
        parsed.population.grades.length ||
        parsed.gradedPrices.size
      ) {
        candidates.push(parsed);
      }
    } catch (error) {
      firstError ??= error;
    }

    if (isPublicPageCircuitOpen(url)) {
      break;
    }
  }

  for (const url of setIndexUrls.slice(0, 3)) {
    try {
      const html = await fetchPopulationHtml(url);
      fulfilledCount += 1;
      const parsed = parsePriceChartingSetPopulationIndex(
        html,
        url,
        cardName,
        cardNumber,
        setTotal,
      );

      if (parsed) {
        candidates.push(parsed);
        break;
      }
    } catch (error) {
      firstError ??= error;
    }

    if (isPublicPageCircuitOpen(url)) {
      break;
    }
  }

  const discoveredUrls = [
    ...new Set(candidates.flatMap((candidate) => candidate.discoveredItemUrls ?? [])),
  ].filter((url) => !directUrls.includes(url)).slice(0, 6);

  for (const url of discoveredUrls.slice(0, 3)) {
    try {
      const html = await fetchPopulationHtml(url);
      fulfilledCount += 1;
      const parsed = parsePriceChartingPopulation(html, url);

      if (
        parsed.population.totalCertified !== null ||
        parsed.population.grades.length ||
        parsed.gradedPrices.size
      ) {
        candidates.push({
          ...parsed,
          matchScore: 20,
        });

        if (hasPopulationSignal(parsed.population)) {
          break;
        }
      }
    } catch (error) {
      firstError ??= error;
    }

    if (isPublicPageCircuitOpen(url)) {
      break;
    }
  }

  const best = reconcilePriceChartingPopulationCandidates(candidates);

  if (best) {
    return best;
  }

  if (fulfilledCount === 0 && firstError) {
    throw firstError;
  }

  return null;
}

async function loadBestTcgFishPage(
  setSlugs: string[],
  nameSlugs: string[],
  cardNumber: string,
  setTotal?: number,
): Promise<{ html: string; url: string } | null> {
  const variants = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  // Try every plausible set slug, not just the first — a mismatched set name
  // (e.g. a mini-set or renamed promo set) must not zero out the whole source.
  // Bounded so a wide slug fan-out can't blow the fetch budget.
  const urls = [
    ...new Set(
      setSlugs.flatMap((setSlug) =>
        nameSlugs.flatMap((nameSlug) =>
          variants.map((variant) => buildTcgFishCardUrl(setSlug, nameSlug, variant)),
        ),
      ),
    ),
  ].slice(0, 10);
  let best: { html: string; url: string; score: number } | null = null;
  let firstUsable: { html: string; url: string } | null = null;
  let firstError: unknown;
  let fulfilledCount = 0;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    let html: string;
    try {
      html = await fetchHtml(url);
      fulfilledCount += 1;
    } catch (error) {
      firstError ??= error;
      if (isPublicPageCircuitOpen(url)) {
        break;
      }
      continue;
    }

    if (isLikelyBotWallHtml(html)) {
      continue;
    }

    firstUsable ??= { html, url };
    const previewPopulation = parseTcgFishPopulation(html, url);
    const previewSnapshots = parseTcgFishGradeSnapshots(html, previewPopulation);
    const score =
      previewPopulation.grades.length * 14 +
      (typeof previewPopulation.totalCertified === "number" ? 10 : 0) +
      previewSnapshots.size * 5 +
      (html.includes("ecom-population") ? 4 : 0);

    if (!best || score > best.score) {
      best = { html, url, score };
    }

    if (
      previewPopulation.grades.length >= 2 ||
      (previewPopulation.grades.length >= 1 &&
        typeof previewPopulation.totalCertified === "number")
    ) {
      return { html, url };
    }
  }

  if (best && best.score > 0) {
    return { html: best.html, url: best.url };
  }

  if (fulfilledCount === 0 && firstError) {
    throw firstError;
  }

  return firstUsable;
}

async function mergePriceChartingGuidesFromVariants(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
) {
  if (isPublicPageCircuitOpen("https://www.pricecharting.com/")) {
    return { prices: new Map<string, GradedPrice>(), discoveredPopulationUrls: [] as string[] };
  }

  const variants = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting", options);
  const setSlugs = await resolveGuideSetSlugs(setName, options);
  const urls = setSlugs.flatMap((setSlug) =>
    nameSlugs.flatMap((nameSlug) =>
      variants.map(
        (variant) =>
          `https://www.pricecharting.com/game/${setSlug}/${nameSlug}-${variant}`,
      ),
    ),
  );
  const priorityUrls = [
    ...new Set(
      setSlugs.flatMap((setSlug) =>
        nameSlugs.flatMap((nameSlug) =>
          variants
            .slice(0, 2)
            .map(
              (variant) =>
                `https://www.pricecharting.com/game/${setSlug}/${nameSlug}-${variant}`,
            ),
        ),
      ),
    ),
  ];
  const orderedUrls = [...new Set([...priorityUrls, ...urls])].slice(0, 6);
  const merged = new Map<string, GradedPrice>();
  const discoveredPopulationUrls = new Set<string>();
  const followUpUrls = new Set<string>();
  let firstError: unknown;
  let fulfilledCount = 0;

  for (let index = 0; index < orderedUrls.length; index += 1) {
    const url = orderedUrls[index];
    let html: string;
    try {
      html = await fetchHtml(url);
      fulfilledCount += 1;
    } catch (error) {
      firstError ??= error;
      if (isPublicPageCircuitOpen(url)) {
        break;
      }
      continue;
    }

    const resolved = await resolvePriceChartingGuideCandidates(
      html,
      url,
      cardName,
      cardNumber,
    );

    for (const populationUrl of resolved.discoveredPopulationUrls) {
      discoveredPopulationUrls.add(populationUrl);
    }

    for (const url of resolved.followUpUrls) {
      followUpUrls.add(url);
    }

    for (const [grade, price] of resolved.prices.entries()) {
      if (shouldPreferIncomingPriceSnapshot(price, merged.get(grade))) {
        merged.set(grade, price);
      }
    }

    if (
      merged.size >= 3 ||
      (merged.has("Ungraded") &&
        [...merged.keys()].some((grade) => /^PSA (?:9|10)$/i.test(grade)))
    ) {
      break;
    }
  }

  const rankedFollowUps = rankPriceChartingGameLinks([...followUpUrls], cardName, cardNumber)
    .slice(0, 2)
    .map((entry) => entry.url)
    .filter((url) => priceChartingMarketUrlMatchesLookup(url, setName, cardName, options));

  if (rankedFollowUps.length) {
    for (const url of rankedFollowUps) {
      let html: string;
      try {
        html = await fetchHtml(url);
        fulfilledCount += 1;
      } catch (error) {
        firstError ??= error;
        if (isPublicPageCircuitOpen(url)) {
          break;
        }
        continue;
      }

      for (const populationUrl of populationUrlsFromPriceChartingProductPage(html, url)) {
        discoveredPopulationUrls.add(populationUrl);
      }

      for (const [grade, price] of parsePriceChartingGradedGuide(
        html,
        url,
      ).entries()) {
        if (shouldPreferIncomingPriceSnapshot(price, merged.get(grade))) {
          merged.set(grade, price);
        }
      }

      if (merged.size >= 3) {
        break;
      }
    }
  }

  // Every direct guide URL missed — usually a set-slug mismatch (renamed set,
  // odd promo naming, mini-sets like Pokemon Rumble). Fall back to
  // PriceCharting's own search, which resolves naming variations server-side:
  // first "Set + Name + #Number", then just "Name + #Number" with no set.
  if (merged.size === 0) {
    const numberBase =
      cardNumber.split("/")[0]?.trim().replace(/^0+/, "") || cardNumber.trim();
    const searchQueries = [
      ...new Set(
        [
          ["pokemon", setName, cardName, numberBase ? `#${numberBase}` : ""]
            .filter(Boolean)
            .join(" "),
          numberBase ? ["pokemon", cardName, `#${numberBase}`].join(" ") : "",
        ]
          .map((query) => query.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      ),
    ];

    for (const query of searchQueries) {
      const searchUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`;

      try {
        const searchHtml = await fetchHtml(searchUrl);
        const resolved = await resolvePriceChartingGuideCandidates(
          searchHtml,
          searchUrl,
          cardName,
          cardNumber,
        );

        for (const populationUrl of resolved.discoveredPopulationUrls) {
          discoveredPopulationUrls.add(populationUrl);
        }

        for (const [grade, price] of resolved.prices.entries()) {
          if (shouldPreferIncomingPriceSnapshot(price, merged.get(grade))) {
            merged.set(grade, price);
          }
        }

        // A search list page yields candidate /game/ links instead of prices.
        // Follow only strong candidates: score >= 14 requires the collector
        // number plus at least one name token, so the set-less query can't
        // wander onto a different card that shares the number.
        const searchFollowUps = rankPriceChartingGameLinks(
          resolved.followUpUrls,
          cardName,
          cardNumber,
        )
          .filter((entry) => entry.score >= 14)
          .slice(0, 2)
          .map((entry) => entry.url);

        for (const followUpUrl of searchFollowUps) {
          let followUpHtml: string;
          try {
            followUpHtml = await fetchHtml(followUpUrl);
            fulfilledCount += 1;
          } catch {
            if (isPublicPageCircuitOpen(followUpUrl)) {
              break;
            }
            continue;
          }

          for (const populationUrl of extractPriceChartingPopulationLinks(followUpHtml)) {
            discoveredPopulationUrls.add(populationUrl);
          }

          for (const [grade, price] of parsePriceChartingGradedGuide(
            followUpHtml,
            followUpUrl,
          ).entries()) {
            if (shouldPreferIncomingPriceSnapshot(price, merged.get(grade))) {
              merged.set(grade, price);
            }
          }

          if (merged.size >= 3) {
            break;
          }
        }
      } catch {
        continue;
      }

      if (merged.size > 0) {
        break;
      }
    }
  }

  if (merged.size === 0 && fulfilledCount === 0 && firstError) {
    throw firstError;
  }

  return {
    prices: merged,
    discoveredPopulationUrls: [...discoveredPopulationUrls],
  };
}

function priceNearLabel(text: string, labelRegex: string): number | null {
  const match = text.match(new RegExp(`${labelRegex}[\\s\\S]{0,140}?\\$([0-9,.]+)`, "i"));

  if (!match) {
    return null;
  }

  const value = parseUsd(match[1]);

  return Number.isFinite(value) && value > 0 ? value : null;
}

function splitMarkdownTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => normalizeWhitespace(cell.replace(/\[[^\]]*]\([^)]+\)/g, " ")));
}

function parseGuideCellUsd(cell: string) {
  const match = cell.match(/\$([0-9,.]+)/);

  return match?.[1] ? parseUsd(match[1]) : null;
}

function normalizePriceGuideLabelToGrade(label: string): {
  grade: string;
  warning?: string;
} | null {
  const cleanLabel = normalizeWhitespace(label.replace(/\[[^\]]*]\([^)]+\)/g, " "));

  if (!cleanLabel || cleanLabel === "+") {
    return null;
  }

  if (/^Ungraded$/i.test(cleanLabel)) {
    return { grade: "Ungraded" };
  }

  const psaMatch = cleanLabel.match(/^PSA\s*(10|9|8|7|6|5|4|3|2|1)$/i);
  if (psaMatch) {
    return { grade: `PSA ${psaMatch[1]}` };
  }

  const genericGradeMatch = cleanLabel.match(/^Grade\s*(10|9\.5|9|8|7|6|5|4|3|2|1)$/i);
  if (genericGradeMatch) {
    const grade = genericGradeMatch[1];

    if (grade.includes(".")) {
      return {
        grade: `BGS ${grade}`,
        warning:
          "PriceCharting reports this as a generic half-grade guide price; shown under BGS-style half grades as secondary evidence.",
      };
    }

    return { grade: `PSA ${grade}` };
  }

  const bgsBlackMatch = cleanLabel.match(/^(?:BGS|Beckett)\s*10\s*(?:Black\s*Label|Black)$/i);
  if (bgsBlackMatch) {
    return { grade: "BGS 10 Black" };
  }

  const bgsMatch = cleanLabel.match(/^(?:BGS|Beckett)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)$/i);
  if (bgsMatch) {
    return { grade: `BGS ${bgsMatch[1]}` };
  }

  const cgcPristineMatch = cleanLabel.match(/^CGC\s*10\s*Pristine$/i);
  if (cgcPristineMatch) {
    return { grade: "CGC 10 Pristine" };
  }

  const cgcMatch = cleanLabel.match(/^CGC\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)$/i);
  if (cgcMatch) {
    return { grade: `CGC ${cgcMatch[1]}` };
  }

  const sgcMatch = cleanLabel.match(/^SGC\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)$/i);
  if (sgcMatch) {
    return { grade: `SGC ${sgcMatch[1]}` };
  }

  const tagMatch = cleanLabel.match(/^TAG\s*(10|9|8|7|6|5|4|3|2|1)$/i);
  if (tagMatch) {
    return { grade: `TAG ${tagMatch[1]}` };
  }

  return null;
}

function guidePriceSource(grade: string) {
  if (grade === "Ungraded") {
    return "PriceCharting raw price guide snapshot";
  }

  if (grade.startsWith("PSA")) {
    return "PriceCharting PSA price guide snapshot";
  }

  return "PriceCharting extended grader guide snapshot";
}

function guidePriceConfidenceScore(grade: string, warning?: string) {
  if (grade.startsWith("PSA")) {
    return 0.68;
  }

  if (grade === "Ungraded") {
    return 0.62;
  }

  return warning ? 0.48 : 0.58;
}

function extractPriceChartingPopulationLinks(html: string) {
  const urls = new Set<string>();

  for (const match of html.matchAll(/\/pop\/item\/[a-z0-9%-]+(?:\/[a-z0-9%-]+)+/gi)) {
    urls.add(toPriceChartingPopulationItemUrl(match[0]));
  }

  return [...urls];
}

/** Prefer explicit /pop/item links, otherwise convert a product /game/ URL. */
function populationUrlsFromPriceChartingProductPage(html: string, productUrl: string) {
  const urls = extractPriceChartingPopulationLinks(html);
  const fromProduct = toPriceChartingPopulationItemUrl(productUrl);

  if (/\/pop\/item\//i.test(fromProduct) && !urls.includes(fromProduct)) {
    urls.unshift(fromProduct);
  }

  return [...new Set(urls)];
}

function populationUrlsFromGuidePrices(prices: Map<string, GradedPrice> | GradedPrice[]) {
  const entries = prices instanceof Map ? [...prices.values()] : prices;
  const urls = new Set<string>();

  for (const price of entries) {
    const sourceUrl = price.sourceUrl?.trim();
    if (!sourceUrl || !/pricecharting\.com/i.test(sourceUrl)) {
      continue;
    }

    urls.add(toPriceChartingPopulationItemUrl(sourceUrl));
  }

  return [...urls];
}

const PRICECHARTING_VARIANT_MARKERS = [
  "prerelease staff",
  "staff",
  "prerelease",
  "build-a-bear",
  "winner",
  "stamped",
  "staff stamped",
] as const;

function isPriceChartingSearchListPage(html: string, text = stripHtml(html)) {
  return (
    /\bfound\s+\d+\s+items?\b/i.test(text) ||
    /\bsearch revised\b/i.test(text) ||
    /\bno results found\b/i.test(text) ||
    /\|\s*title\s*\|\s*set\s*\|\s*ungraded/i.test(text) ||
    /<title>[^<]*\blist\b/i.test(html)
  );
}

function extractPriceChartingGameLinks(html: string) {
  const links = new Set<string>();

  for (const match of html.matchAll(
    /href="((?:https?:\/\/(?:www\.)?pricecharting\.com)?\/game\/pokemon[^"?#]+)"/gi,
  )) {
    const absolute = toPriceChartingAbsoluteUrl(match[1]).split("?")[0].split("#")[0];
    if (/\/game\/pokemon/i.test(absolute)) {
      links.add(absolute);
    }
  }

  return [...links];
}

function scorePriceChartingGameLinkCandidate(
  url: string,
  cardName: string,
  cardNumber: string,
) {
  const slug = url.split("/").pop() ?? "";
  const slugText = slug.replace(/-/g, " ");
  const normalizedName = normalizeCardName(cardName).toLowerCase();
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const slugTokens = new Set(tokenizeForMatching(slugText));
  let score = 0;

  for (const token of nameTokens) {
    if (slugTokens.has(token)) {
      score += token.length <= 2 ? 2 : 4;
    }
  }

  if (slugText.includes(normalizedName.replace(/[^a-z0-9]+/g, " "))) {
    score += 6;
  }

  if (hasCollectorNumberToken(slugText, cardNumber)) {
    score += 10;
  } else if (score >= 12) {
    // Pokemon TCG API ids sometimes use set-total slots (236) while PriceCharting
    // keeps the printed number (221). Strong name matches still count.
    score += 5;
  }

  for (const marker of PRICECHARTING_VARIANT_MARKERS) {
    if (slugText.includes(marker) && !normalizedName.includes(marker)) {
      score -= 12;
    }
  }

  if (/\bex\b/.test(slugText) && !/\bex\b/.test(normalizedName)) {
    score -= 4;
  }

  return score;
}

function rankPriceChartingGameLinks(links: string[], cardName: string, cardNumber: string) {
  return [...new Set(links)]
    .map((url) => ({
      url,
      score: scorePriceChartingGameLinkCandidate(url, cardName, cardNumber),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

async function resolvePriceChartingGuideCandidates(
  html: string,
  url: string,
  cardName: string,
  cardNumber: string,
) {
  const discoveredPopulationUrls = extractPriceChartingPopulationLinks(html);
  const prices = new Map<string, GradedPrice>();
  const followUpUrls: string[] = [];

  if (isPriceChartingSearchListPage(html)) {
    followUpUrls.push(
      ...rankPriceChartingGameLinks(extractPriceChartingGameLinks(html), cardName, cardNumber)
        .slice(0, 4)
        .map((entry) => entry.url),
    );
    return { prices, followUpUrls, discoveredPopulationUrls };
  }

  for (const [grade, price] of parsePriceChartingGradedGuide(html, url).entries()) {
    prices.set(grade, price);
  }

  // Real product pages often only expose a "POP Report" control. Always derive
  // the matching /pop/item URL from the product path so population recovery
  // does not depend on an in-page href being present.
  if (prices.size > 0) {
    for (const populationUrl of populationUrlsFromPriceChartingProductPage(html, url)) {
      discoveredPopulationUrls.push(populationUrl);
    }
  }

  return {
    prices,
    followUpUrls,
    discoveredPopulationUrls: [...new Set(discoveredPopulationUrls)],
  };
}

function parsePriceGuideSingleGradeRows(
  textWithLines: string,
  push: (grade: string, value: number | null, warning?: string) => void,
) {
  for (const line of textWithLines.split("\n")) {
    const cells = splitMarkdownTableCells(line);

    if (cells.length < 2) {
      continue;
    }

    const normalized = normalizePriceGuideLabelToGrade(cells[0]);

    if (!normalized) {
      continue;
    }

    const value = parseGuideCellUsd(cells[1]);

    if (value != null) {
      push(normalized.grade, value, normalized.warning);
    }
  }
}

function parsePriceGuideMarkdownTables(
  textWithLines: string,
  push: (grade: string, value: number | null, warning?: string) => void,
) {
  const lines = textWithLines.split("\n");

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index];

    if (!headerLine.includes("|") || !/\b(?:Ungraded|PSA\s*10|Grade\s*[1-9])/i.test(headerLine)) {
      continue;
    }

    const headers = splitMarkdownTableCells(headerLine);
    const priceLineIndex = lines.findIndex((line, lineIndex) => {
      return lineIndex > index && lineIndex <= index + 3 && line.includes("$");
    });

    if (priceLineIndex < 0) {
      continue;
    }

    const priceCells = splitMarkdownTableCells(lines[priceLineIndex]);
    const gradeHeaders = headers
      .map((header, headerIndex) => ({
        header,
        headerIndex,
        normalized: normalizePriceGuideLabelToGrade(header),
      }))
      .filter((entry) => entry.normalized);

    for (const entry of gradeHeaders) {
      const value = parseGuideCellUsd(priceCells[entry.headerIndex] ?? "");

      if (value == null) {
        continue;
      }

      push(entry.normalized!.grade, value, entry.normalized!.warning);
    }
  }
}

function parsePriceGuideCurrentList(
  textWithLines: string,
  push: (grade: string, value: number | null, warning?: string) => void,
) {
  for (const line of textWithLines.split("\n")) {
    const match = line.match(
      /^(Ungraded|Grade\s*(?:10|9\.5|9|8|7|6|5|4|3|2|1)|PSA\s*10|BGS\s*10\s*Black|BGS\s*10|CGC\s*10\s*Pristine|CGC\s*10|SGC\s*10|TAG\s*10)\s*(?:-|(\$[0-9,.]+))/i,
    );

    if (!match) {
      continue;
    }

    const normalized = normalizePriceGuideLabelToGrade(match[1]);

    if (!normalized) {
      continue;
    }

    push(
      normalized.grade,
      match[2] ? parseGuideCellUsd(match[2]) : null,
      normalized.warning,
    );
  }
}

function parsePriceChartingHtmlPriceIds(
  html: string,
  push: (grade: string, value: number | null, warning?: string) => void,
) {
  // PriceCharting product pages expose the guide grid via stable element ids.
  // Prefer these over markdown/near-label heuristics that confuse search pages
  // and population counts with dollar prices.
  const fields: Array<{ id: string; grade: string }> = [
    { id: "used_price", grade: "Ungraded" },
    { id: "complete_price", grade: "PSA 7" },
    { id: "new_price", grade: "PSA 8" },
    { id: "graded_price", grade: "PSA 9" },
    { id: "box_only_price", grade: "PSA 9.5" },
    { id: "manual_only_price", grade: "PSA 10" },
  ];

  for (const field of fields) {
    const match = html.match(
      new RegExp(
        `id=["']${field.id}["'][\\s\\S]{0,320}?class=["']price js-price["'][^>]*>\\s*\\$([0-9,.]+)`,
        "i",
      ),
    );

    if (!match?.[1]) {
      continue;
    }

    push(field.grade, parseUsd(match[1]));
  }
}

function parsePriceChartingGradedGuide(html: string, url?: string): Map<string, GradedPrice> {
  const prices = new Map<string, GradedPrice>();
  const text = stripHtml(html);
  const textWithLines = stripHtmlToLines(html);
  const guideLookupText = text.split(/\bAll eBay only\b/i)[0] ?? text;

  if (text.length < 200 || /just a moment/i.test(text)) {
    return prices;
  }

  // Never treat PriceCharting search/list pages as a product guide — they expose
  // another card's "Low Price" that looks like a single Ungraded snapshot.
  if (isPriceChartingSearchListPage(html, text)) {
    return prices;
  }

  const push = (grade: string, value: number | null, warning?: string) => {
    if (value == null || !Number.isFinite(value) || value <= 0 || prices.has(grade)) {
      return;
    }

    const confidenceScore = guidePriceConfidenceScore(grade, warning);

    prices.set(grade, {
      grade,
      value,
      populationCount: 0,
      source: guidePriceSource(grade),
      saleCount: 0,
      lastSoldAt: null,
      service: gradeService(grade),
      confidence: confidenceFromScore(confidenceScore),
      confidenceScore,
      evidenceType: grade === "Ungraded" ? "catalog" : "guide_snapshot",
      sourceUrl: url,
      warning:
        warning ??
        (grade.startsWith("PSA")
          ? "PSA guide snapshot used as reference evidence when accepted sold-comp depth is limited."
          : "Secondary grader guide snapshot used after PSA price evidence."),
    });
  };

  parsePriceChartingHtmlPriceIds(html, push);
  parsePriceGuideMarkdownTables(textWithLines, push);
  parsePriceGuideCurrentList(textWithLines, push);
  parsePriceGuideSingleGradeRows(textWithLines, push);

  if (!prices.has("Ungraded")) {
    push("Ungraded", priceNearLabel(guideLookupText, "\\bUngraded\\b"));
  }

  if (prices.size < 3) {
    const ungradedValue = prices.get("Ungraded")?.value;

    for (const gradeNum of WHOLE_GRADES) {
      const grade = `PSA ${gradeNum}`;

      if (!prices.has(grade)) {
        const nearby = priceNearLabel(guideLookupText, `\\bPSA\\s*${gradeNum}\\b`);

        if (
          nearby != null &&
          !(ungradedValue != null && Math.abs(nearby - ungradedValue) < 0.01)
        ) {
          push(grade, nearby);
        }
      }
    }
  }

  return prices;
}

function parseTcgFishGradeSnapshots(
  html: string,
  population: PsaPopulationSnapshot,
): Map<string, GradedPrice> {
  const prices = new Map<string, GradedPrice>();
  const text = stripHtml(html);
  const priceRegex =
    /class="grade-badge[^>]*>([^<]+)<\/div>.*?class="grade-price-info"><span>\$([0-9,.]+)<\/span><\/div>/g;

  const pushSnapshot = (gradeLabel: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0 || prices.has(gradeLabel)) {
      return;
    }

    const populationCount = resolvePopulationCountForGrade(population, gradeLabel);

    prices.set(gradeLabel, {
      grade: gradeLabel,
      value,
      populationCount,
      source: "TCGFish market snapshot",
      saleCount: 0,
      lastSoldAt: null,
      service: gradeService(gradeLabel),
      confidence: "medium",
      confidenceScore: 0.58,
      evidenceType: gradeLabel === "Ungraded" ? "catalog" : "guide_snapshot",
      sourceUrl: population.sourceUrl,
      warning: "Market snapshot used as reference evidence.",
    });
  };

  for (const match of html.matchAll(priceRegex)) {
    const gradeLabel = normalizeWhitespace(match[1]);
    const value = parseUsd(match[2]);

    pushSnapshot(gradeLabel, value);
  }

  const rawMatch =
    text.match(/\bUngraded\s+Raw card\s+\$([0-9,.]+)/i) ??
    text.match(/\$([0-9,.]+)\s+Raw card\b/i);

  if (rawMatch?.[1]) {
    pushSnapshot("Ungraded", parseUsd(rawMatch[1]));
  }

  for (const grade of WHOLE_GRADES) {
    const gradeMatch = text.match(
      new RegExp(`\\bPSA\\s*${grade}\\b(?:\\s+[A-Za-z][A-Za-z\\s]{0,30})?\\s+\\$([0-9,.]+)`, "i"),
    );

    if (gradeMatch?.[1]) {
      pushSnapshot(`PSA ${grade}`, parseUsd(gradeMatch[1]));
    }
  }

  return prices;
}

const SALE_LANGUAGE_MARKERS: Array<{ lang: string; test: RegExp }> = [
  { lang: "ja", test: /\bjapanese\b|\bjpn\b|\bnihongo\b/i },
  { lang: "ko", test: /\bkorean\b|\bkor\b/i },
  { lang: "zh", test: /\bchinese\b|\btraditional chinese\b|\bsimplified chinese\b/i },
  { lang: "de", test: /\bgerman\b|\bdeutsch\b/i },
  { lang: "fr", test: /\bfrench\b|\bfran[c\u00e7]ais\b/i },
  { lang: "it", test: /\bitalian\b|\bitaliano\b/i },
  { lang: "es", test: /\bspanish\b|\bespa[n\u00f1]ol\b/i },
  { lang: "pt", test: /\bportuguese\b|\bportugu[e\u00ea]s\b/i },
  { lang: "nl", test: /\bdutch\b|\bnederlands\b/i },
  { lang: "ru", test: /\brussian\b/i },
  { lang: "pl", test: /\bpolish\b|\bpolski\b/i },
  { lang: "th", test: /\bthai\b/i },
  { lang: "id", test: /\bindonesian\b/i },
];

function normalizeSaleLanguage(language?: string): string {
  if (!language) {
    return "en";
  }

  const lower = language.toLowerCase();

  if (lower.startsWith("pt")) {
    return "pt";
  }

  if (lower.startsWith("zh")) {
    return "zh";
  }

  return lower;
}

/**
 * Rejects sold listings whose language clearly differs from the card being priced, so an
 * English card never pulls Japanese/Korean/other-language comps (and vice versa).
 */
function listingLanguageConflicts(title: string, language?: string): boolean {
  const target = normalizeSaleLanguage(language);
  const hasHiraKata = /[\u3040-\u30ff]/.test(title);
  const hasHangul = /[\uac00-\ud7af]/.test(title);
  const hasKanji = /[\u3400-\u9fff]/.test(title);
  const markerLangs = new Set<string>();

  for (const marker of SALE_LANGUAGE_MARKERS) {
    if (marker.test.test(title)) {
      markerLangs.add(marker.lang);
    }
  }

  if (hasHangul) {
    markerLangs.add("ko");
  }

  if (hasHiraKata) {
    markerLangs.add("ja");
  }

  if (target === "en") {
    // English target: any explicit foreign-language word or any Asian script is a mismatch.
    return markerLangs.size > 0 || hasHiraKata || hasHangul || hasKanji;
  }

  // Non-English target: reject only when the listing explicitly claims a different language.
  for (const lang of markerLangs) {
    if (lang !== target) {
      return true;
    }
  }

  return false;
}

function parseMagerySales(
  html: string,
  cardName: string,
  cardNumber: string,
  setName: string,
  setTotal?: number,
  cardRarity?: string,
  options: ExternalMarketLookupOptions & { setCode?: string } = {},
): SoldCompParseResult {
  const language = options.language;
  const sales: SaleRecord[] = [];
  let rejected = 0;
  const rejectedReasonCounts: RejectedReasonCounts = {};
  const reject = (reason: string) => {
    rejected += 1;
    incrementRejectedReason(rejectedReasonCounts, reason);
  };

  const cardChunks = html.split(/<div class="result-card"/i).slice(1);

  for (const chunk of cardChunks) {
    if (!/status-sold/i.test(chunk) || !/card-price sold/i.test(chunk)) {
      continue;
    }

    const itemId = chunk.match(/data-item-id="(\d+)"/i)?.[1];
    const title = stripHtml(
      chunk.match(/class="card-title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "",
    );
    const saleDate = normalizeWhitespace(
      chunk.match(/class="card-meta-date"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/i)?.[1] ?? "",
    );
    const price = parseUsd(chunk.match(/class="card-price sold">\$([^<]+)/i)?.[1] ?? "");
    const seller = normalizeWhitespace(
      chunk.match(/class="seller-link"[^>]*>[\s\S]*?Seller:\s*([^<]+)/i)?.[1] ?? "",
    );
    const listingHref =
      chunk.match(/href="([^"]+)"[\s\S]*?class="view-listing-btn"/i)?.[1] ??
      chunk.match(/class="view-listing-btn"[\s\S]*?href="([^"]+)"/i)?.[1] ??
      (itemId ? `/vl.php?id=${itemId}&src=nsearch` : "");

    if (!title) {
      reject("missing listing title");
      continue;
    }

    const junkReason = hasBadSaleTitleSignals(title, { cardName, rarity: cardRarity });
    if (junkReason) {
      reject(soldCompJunkRejectLabel(junkReason));
      continue;
    }

    if (listingLanguageConflicts(title, language)) {
      reject("language mismatch");
      continue;
    }

    if (!isRelevantSaleTitle(title, cardName, cardNumber, setName, setTotal, cardRarity, options)) {
      reject("identity mismatch");
      continue;
    }

    if (hasConflictingSetMarker(title, setName, cardRarity)) {
      reject("conflicting set marker");
      continue;
    }

    const condition = detectSaleCondition(title);
    const relevanceScore = scoreSaleTitle(
      title,
      cardName,
      cardNumber,
      setName,
      setTotal,
      cardRarity,
      options,
    );

    if (!Number.isFinite(price) || price <= 0) {
      reject("invalid sold price");
      continue;
    }

    if (relevanceScore < 10) {
      reject("low identity score");
      continue;
    }

    // Graded listing whose numeric grade could not be parsed — never accept as
    // Ungraded (would poison raw medians / chart last-real points).
    if (condition === UNPARSED_GRADED_CONDITION) {
      reject("graded title without parseable grade");
      continue;
    }

    const listingUrl = toAbsoluteUrl(listingHref);
    sales.push({
      date: toIsoDate(saleDate),
      title,
      condition,
      price,
      source: "Magery public sold comps",
      seller,
      listingUrl,
      sourceUrl: listingUrl,
      service: gradeService(condition),
      confidence: relevanceScore >= 18 ? "high" : relevanceScore >= 13 ? "medium" : "low",
      confidenceScore: Math.min(0.92, Math.max(0.42, relevanceScore / 24)),
      evidenceType: "sold_comp",
    });
  }

  return { accepted: sales, rejected, rejectedReasonCounts };
}

async function fetchSoldComps(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  cardRarity?: string,
  options: { setCode?: string; isJapanese?: boolean; language?: string; finish?: CardFinishId } = {},
) {
  const dedupedSales = new Map<string, SaleRecord>();
  let rejected = 0;
  let rejectedReasonCounts: RejectedReasonCounts = {};
  let fetchAttempts = 0;
  let fetchFailures = 0;
  const queries = buildSoldCompQueries(
    setName,
    cardName,
    cardNumber,
    setTotal,
    cardRarity,
    options,
  ).slice(0, 12);
  // Magery is particularly sensitive to bursts. Probe one ranked query at a
  // time and stop immediately when the shared host circuit opens.
  const SOLD_COMP_QUERY_CONCURRENCY = 1;
  const SOLD_COMP_ACCEPTED_TARGET = 12;

  for (
    let batchStart = 0;
    batchStart < queries.length && dedupedSales.size < SOLD_COMP_ACCEPTED_TARGET;
    batchStart += SOLD_COMP_QUERY_CONCURRENCY
  ) {
    const batch = queries.slice(batchStart, batchStart + SOLD_COMP_QUERY_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (query) => {
        const url = `https://magery.com/w?q=${encodeURIComponent(query)}`;
        const html = await fetchHtml(url);
        return parseMagerySales(html, cardName, cardNumber, setName, setTotal, cardRarity, {
          setCode: options.setCode,
          language: options.language,
        });
      }),
    );

    for (const outcome of results) {
      fetchAttempts += 1;

      if (outcome.status !== "fulfilled") {
        fetchFailures += 1;
        continue;
      }

      const parsedSales = outcome.value;
      rejected += parsedSales.rejected;
      rejectedReasonCounts = mergeRejectedReasonCounts(
        rejectedReasonCounts,
        parsedSales.rejectedReasonCounts,
      );

      for (const sale of parsedSales.accepted) {
        dedupedSales.set(
          `${sale.date}-${sale.title}-${sale.price}-${sale.condition}`,
          sale,
        );
      }
    }

    if (isPublicPageCircuitOpen("https://magery.com/")) {
      break;
    }
  }

  const accepted = [...dedupedSales.values()]
    .sort((left, right) => {
      const scoreDelta =
        scoreSaleTitle(right.title, cardName, cardNumber, setName, setTotal, cardRarity, {
          setCode: options.setCode,
          language: options.language,
        }) -
        scoreSaleTitle(left.title, cardName, cardNumber, setName, setTotal, cardRarity, {
          setCode: options.setCode,
          language: options.language,
        });

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return right.date.localeCompare(left.date);
    })
    .slice(0, 56);

  // All Magery queries failing (timeout / circuit open) is a source outage, not
  // a true identity no_match — surface that so audits mark INCONCLUSIVE/failed
  // and the short-TTL cache can retry instead of locking empty sold comps.
  if (accepted.length === 0 && fetchAttempts > 0 && fetchFailures === fetchAttempts) {
    throw new Error(
      `Magery sold-comp fetch failed for all ${fetchAttempts} quer${fetchAttempts === 1 ? "y" : "ies"} (timeouts or circuit open)`,
    );
  }

  return { accepted, rejected, rejectedReasonCounts };
}

function safeIsoDateFromLabel(label: string) {
  const parsed = Date.parse(label);

  if (Number.isNaN(parsed)) {
    return label;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function isoDaysAgoUtc(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function buildPriceHistoryFromMarketTimeline({
  salesByGrade,
  gradedPrices,
  snapshotDate = nowIso().slice(0, 10),
}: {
  salesByGrade: Map<string, SaleRecord[]>;
  gradedPrices: GradedPrice[];
  snapshotDate?: string;
}): PricePoint[] {
  const dateMap = new Map<
    string,
    {
      gradeValues: Record<string, number>;
      isProjected?: boolean;
      pointType?: MarketHistoryPointType;
    }
  >();
  const latestSaleDateByGrade = new Map<string, string>();
  const referenceByGrade = new Map(
    gradedPrices
      .filter((price) => Number.isFinite(price.value) && price.value > 0)
      .map((price) => [price.grade, price.value] as const),
  );

  for (const [grade, sales] of salesByGrade.entries()) {
    const grouped = new Map<string, number[]>();

    for (const sale of sales) {
      const saleDate = safeIsoDateFromLabel(sale.date);
      const dateSales = grouped.get(saleDate) ?? [];
      dateSales.push(sale.price);
      grouped.set(saleDate, dateSales);

      const latestSaleDate = latestSaleDateByGrade.get(grade);
      if (!latestSaleDate || chartTimelineSortKey(saleDate) > chartTimelineSortKey(latestSaleDate)) {
        latestSaleDateByGrade.set(grade, saleDate);
      }
    }

    for (const [date, prices] of grouped.entries()) {
      const entry = dateMap.get(date) ?? { gradeValues: {} };
      const reference = referenceByGrade.get(grade);
      // Thin Ungraded days are especially noisy (condition mix / mis-graded
      // comps). Tighten the band vs the tile so a 2-sale spike cannot become
      // the chart's last real point and trip chart.last_point_divergence.
      const band =
        grade === "Ungraded" && prices.length <= 2 && reference && reference > 0
          ? 2
          : 8;
      const filteredPrices =
        reference && reference > 0
          ? prices.filter((price) => price >= reference / band && price <= reference * band)
          : prices;

      if (!filteredPrices.length) {
        continue;
      }

      entry.gradeValues[grade] = robustMedian(filteredPrices);
      entry.pointType = "sold";
      entry.isProjected = false;
      dateMap.set(date, entry);
    }
  }

  // When sold comps are thin, seed a short guide-snapshot timeline so the chart
  // is not a single isProjected point. Prefer lastSoldAt dates from graded
  // tiles; otherwise place current guide values on a 30/14/7/1/0 day ladder.
  const realPointCount = [...dateMap.values()].filter((entry) => !entry.isProjected).length;
  if (realPointCount < 6) {
    const guideGrades = gradedPrices.filter(
      (price) =>
        Number.isFinite(price.value) &&
        price.value > 0 &&
        (price.evidenceType === "guide_snapshot" ||
          price.evidenceType === "sold_comp" ||
          price.evidenceType === "catalog"),
    );

    for (const price of guideGrades) {
      if (price.lastSoldAt) {
        const saleDate = safeIsoDateFromLabel(price.lastSoldAt);
        const entry = dateMap.get(saleDate) ?? { gradeValues: {} };
        if (typeof entry.gradeValues[price.grade] !== "number") {
          entry.gradeValues[price.grade] = price.value;
          entry.pointType = mergeMarketHistoryPointType(
            entry.pointType,
            price.evidenceType === "sold_comp" ? "sold" : "guide-snapshot",
          );
          entry.isProjected = entry.pointType === "sold" ? false : entry.isProjected;
          dateMap.set(saleDate, entry);
        }
      }
    }

    // Guide-ladder points are explicitly projected — they improve chart density
    // for the UI but must not count as sold-backed history for accuracy rubrics.
    if ([...dateMap.values()].filter((entry) => !entry.isProjected).length < 6) {
      const ungraded =
        guideGrades.find((price) => price.grade === "Ungraded") ??
        gradedPrices.find((price) => price.grade === "Ungraded" && price.value > 0);
      const psa10 = guideGrades.find((price) => /PSA 10/i.test(price.grade));

      for (const daysAgo of [30, 14, 7, 1, 0]) {
        const date = daysAgo === 0 ? snapshotDate : isoDaysAgoUtc(daysAgo);
        const existing = dateMap.get(date);
        if (existing && !existing.isProjected && Object.keys(existing.gradeValues).length) {
          continue;
        }
        const entry = existing ?? {
          gradeValues: {},
          isProjected: true,
          pointType: "projected" as const,
        };
        if (ungraded && typeof entry.gradeValues.Ungraded !== "number") {
          entry.gradeValues.Ungraded = ungraded.value;
        }
        if (psa10 && typeof entry.gradeValues[psa10.grade] !== "number") {
          entry.gradeValues[psa10.grade] = psa10.value;
        }
        if (Object.keys(entry.gradeValues).length) {
          dateMap.set(date, {
            ...entry,
            isProjected: existing && !existing.isProjected ? existing.isProjected : true,
            pointType: existing?.pointType ?? "projected",
          });
        }
      }
    }
  }

  const projectedEntry = dateMap.get(snapshotDate) ?? { gradeValues: {}, isProjected: true };
  let projectedCount = 0;

  for (const price of gradedPrices) {
    if (!Number.isFinite(price.value) || price.value <= 0) {
      continue;
    }

    const latestSaleDate = latestSaleDateByGrade.get(price.grade);

    if (latestSaleDate && chartTimelineSortKey(latestSaleDate) >= chartTimelineSortKey(snapshotDate)) {
      continue;
    }

    if (typeof projectedEntry.gradeValues[price.grade] !== "number") {
      projectedEntry.gradeValues[price.grade] = price.value;
      projectedCount += 1;
    }
  }

  if (projectedCount > 0) {
    // Only mark the snapshot row projected when it has no sale-backed grades yet.
    const existing = dateMap.get(snapshotDate);
    const hasSaleBackedGrades = Boolean(
      existing && Object.keys(existing.gradeValues).length > 0 && !existing.isProjected,
    );
    dateMap.set(snapshotDate, {
      ...projectedEntry,
      gradeValues: {
        ...(existing?.gradeValues ?? {}),
        ...projectedEntry.gradeValues,
      },
      isProjected: hasSaleBackedGrades ? existing?.isProjected : true,
      pointType: hasSaleBackedGrades ? existing?.pointType : "projected",
    });
  }

  // Carry forward the last known Ungraded into `value` on graded-only dates.
  // Magery often lands PSA/CGC comps on days with no raw sale; writing value:0
  // made the chart's last "real" point diverge 100% from the headline ungraded
  // (chart.last_point_divergence FAIL on EX Dragon Charizard ex, etc.).
  let lastUngraded: number | undefined;
  return [...dateMap.entries()]
    .sort(([left], [right]) => chartTimelineSortKey(left) - chartTimelineSortKey(right))
    .map(([date, entry]) => {
      const ungraded =
        typeof entry.gradeValues.Ungraded === "number" && entry.gradeValues.Ungraded > 0
          ? entry.gradeValues.Ungraded
          : undefined;
      if (ungraded != null) {
        lastUngraded = ungraded;
      }
      return {
        date,
        value: ungraded ?? lastUngraded ?? 0,
        gradeValues: entry.gradeValues,
        isProjected: entry.isProjected,
        pointType: entry.pointType ?? (entry.isProjected ? "projected" : "sold"),
      };
    });
}

function filterOutlierSales(sales: SaleRecord[], snapshot?: GradedPrice) {
  if (sales.length <= 2) {
    const highSale = Math.max(...sales.map((sale) => sale.price), 0);
    // A guide that is <1/8 of a four-figure sale is too weak to corroborate it
    // (likely stale/mismatched). Keep the snapshot usable otherwise so thin
    // samples can still be rejected against independent guide medians.
    const hasUsableSnapshot =
      Boolean(snapshot?.value && snapshot.value >= 1) &&
      !(highSale >= 1000 && snapshot!.value < highSale / 8);

    if (!hasUsableSnapshot) {
      if (sales.length === 1 && snapshot?.value && snapshot.value >= 25) {
        const ratio = sales[0].price / snapshot.value;
        if (ratio > 8 || ratio < 1 / 8) {
          return [];
        }
      }

      if (sales.length === 1) {
        const loneSale = sales[0];
        const numericGrade = Number.parseFloat(
          String(loneSale.condition ?? "").match(/(\d+(?:\.\d+)?)/)?.[1] ?? "0",
        );
        const uncorroboratedCap =
          numericGrade >= 10 ? 50_000 : numericGrade >= 9 ? 8_000 : numericGrade >= 7 ? 3_000 : 1_500;

        if (loneSale.price > uncorroboratedCap) {
          return [];
        }
      }

      if (sales.length === 2) {
        const sorted = [...sales].sort((left, right) => left.price - right.price);
        const [low, high] = sorted;

        // Prefer the lower sale when a lone four-figure print is 6×+ the peer —
        // the high print is more often a wrong-match / BIN outlier than truth.
        if (high.price >= 1000 && high.price / Math.max(low.price, 1) >= 6) {
          return [low];
        }
      }

      return sales;
    }

    // Thin samples (n≤2) must stay close to the guide. A prior 6× band let a
    // single $9999 Magery hit become PSA 10 for Call of Legends Groudon while
    // PriceCharting/TCGFish guides sat near $2008 (ratio ~5). Cap at 2.5× for
    // n=1 and 3.5× for n=2 so sold_comp still wins when corroborated.
    const tolerance = sales.length === 1 ? 2.5 : snapshot!.value >= 1000 ? 3.5 : 3;
    return sales.filter(
      (sale) => sale.price >= snapshot!.value / tolerance && sale.price <= snapshot!.value * tolerance,
    );
  }

  const baseline = robustMedian(sales.map((sale) => sale.price));
  return sales.filter((sale) => sale.price >= baseline / 3 && sale.price <= baseline * 3);
}

function isThinUncorroboratedGrade(sales: SaleRecord[], snapshot?: GradedPrice) {
  if (sales.length !== 1) {
    return false;
  }

  if (!snapshot?.value || snapshot.value <= 0) {
    return true;
  }

  const salePrice = sales[0].price;
  return salePrice < snapshot.value / 4 || salePrice > snapshot.value * 4;
}

function gradeSortKey(grade: string) {
  if (grade === "Ungraded") {
    return 0;
  }

  const serviceOrder: Record<string, number> = {
    PSA: 1,
    BGS: 2,
    BECKETT: 2,
    CGC: 3,
    SGC: 4,
    TAG: 5,
  };
  const service = grade.match(/^[A-Z]+/)?.[0] ?? "ZZZ";
  const gradeNumber = Number.parseFloat(grade.match(/\d+(?:\.\d+)?/)?.[0] ?? "0");
  const specialOffset = /BLACK|PRISTINE/i.test(grade) ? -0.25 : 0;

  return (serviceOrder[service] ?? 8) * 100 + (10 - gradeNumber) + specialOffset;
}

function sortGradedPricesList(prices: GradedPrice[]) {
  return [...prices].sort((left, right) => {
    return gradeSortKey(left.grade) - gradeSortKey(right.grade);
  });
}

function hasPopulationSignal(snapshot: PsaPopulationSnapshot) {
  // totalCertified === 0 with no grade rows is an empty parse, not a real census.
  return (
    snapshot.grades.length > 0 ||
    (typeof snapshot.totalCertified === "number" && snapshot.totalCertified > 0)
  );
}

function resolvePopulationCountForGrade(
  population: PsaPopulationSnapshot,
  gradeLabel: string,
) {
  const exact = population.grades.find((grade) => grade.grade === gradeLabel);

  if (exact) {
    return exact.count;
  }

  const psaMatch = gradeLabel.match(/^PSA\s+(\d+(?:\.\d+)?)/);

  if (psaMatch) {
    const combined = population.grades.find(
      (grade) => grade.grade === `PSA+CGC ${psaMatch[1]}`,
    );

    if (combined) {
      return combined.count;
    }

    const cgc = population.grades.find((grade) => grade.grade === `CGC ${psaMatch[1]}`);

    if (cgc) {
      return cgc.count;
    }
  }

  return 0;
}

function applyPopulationCountsToGradedPrices(
  prices: GradedPrice[],
  population: PsaPopulationSnapshot,
) {
  for (const price of prices) {
    if (!price.grade.startsWith("PSA")) {
      continue;
    }

    const resolved = resolvePopulationCountForGrade(population, price.grade);

    if (resolved > 0) {
      price.populationCount = resolved;
    }
  }
}

export function shouldPreferIncomingPopulation(
  incoming: PsaPopulationSnapshot,
  current: PsaPopulationSnapshot,
) {
  if (hasPopulationSignal(incoming)) {
    return true;
  }

  if (!hasPopulationSignal(current)) {
    return true;
  }

  return false;
}

export function mergeCatalogAndLiveGradedPrices(
  catalog: GradedPrice[],
  live: GradedPrice[],
): GradedPrice[] {
  const merged = new Map<string, GradedPrice>();

  for (const price of catalog) {
    merged.set(price.grade, price);
  }

  for (const price of live) {
    const existing = merged.get(price.grade);
    merged.set(price.grade, {
      ...existing,
      ...price,
      populationCount: price.populationCount || existing?.populationCount || 0,
    });
  }

  return sortGradedPricesList([...merged.values()]);
}

function isCatalogOnlyConsensus(consensus: PriceConsensus) {
  return (
    (consensus.sampleCount ?? 0) === 0 &&
    !consensus.sources.some((source) => source.evidenceType !== "catalog")
  );
}

function catalogPlaceholderValueFromConsensus(consensus: PriceConsensus) {
  const catalogValues = consensus.sources
    .filter((source) => source.evidenceType === "catalog" && source.value > 0)
    .map((source) => source.value);
  const nonCatalogValues = consensus.sources
    .filter((source) => source.evidenceType !== "catalog" && source.value > 0)
    .map((source) => source.value);

  if (!catalogValues.length || !nonCatalogValues.length) {
    return 0;
  }

  const lowCatalogValue = Math.min(...catalogValues);
  if (catalogLooksLikePlaceholderAgainstValues(lowCatalogValue, nonCatalogValues)) {
    return lowCatalogValue;
  }

  const highCatalogValue = Math.max(...catalogValues);
  const baseline = robustMedian(nonCatalogValues);
  return baseline > 0 && highCatalogValue > Math.max(baseline * 4, baseline + 100)
    ? highCatalogValue
    : 0;
}

function stabilizedCatalogOnlyPrice(card: TcgCard, rawEstimateUsd: number) {
  if (!(rawEstimateUsd > 0) || !card.priceHistory.length) {
    return null;
  }

  const baselineCandidates = card.priceHistory
    .map((point) => point.value)
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value > 0 &&
        Math.abs(value - rawEstimateUsd) > Math.max(rawEstimateUsd * 0.04, 1),
    );
  const baseline = robustMedian(baselineCandidates);

  if (!(baseline > 0)) {
    return null;
  }

  const highSpike = rawEstimateUsd > Math.max(baseline * 1.8, baseline + 500);
  const lowCollapse = baseline > 100 && rawEstimateUsd < baseline / 4;

  return highSpike || lowCollapse ? roundMoney(baseline) : null;
}

function stabilizeCatalogOnlyHistory(
  history: PricePoint[],
  rawEstimateUsd: number,
  stabilizedEstimateUsd: number,
) {
  const spikeThreshold = Math.max(stabilizedEstimateUsd * 1.8, stabilizedEstimateUsd + 500);
  const collapseThreshold = stabilizedEstimateUsd / 4;

  return history.map((point) => {
    const valueIsOutlier =
      point.value > spikeThreshold ||
      (stabilizedEstimateUsd > 100 && point.value > 0 && point.value < collapseThreshold) ||
      Math.abs(point.value - rawEstimateUsd) <= Math.max(rawEstimateUsd * 0.04, 1);
    const nextGradeValues = point.gradeValues
      ? Object.fromEntries(
          Object.entries(point.gradeValues).map(([grade, value]) => {
            if (grade !== "Ungraded") {
              return [grade, value];
            }

            const gradeValueIsOutlier =
              value > spikeThreshold ||
              (stabilizedEstimateUsd > 100 && value > 0 && value < collapseThreshold) ||
              Math.abs(value - rawEstimateUsd) <= Math.max(rawEstimateUsd * 0.04, 1);

            return [grade, gradeValueIsOutlier ? stabilizedEstimateUsd : value];
          }),
        )
      : point.gradeValues;

    return {
      ...point,
      value: valueIsOutlier ? stabilizedEstimateUsd : point.value,
      gradeValues: nextGradeValues,
    };
  });
}

export function mergeLiveMarketDataIntoCard(
  card: TcgCard,
  psaData: {
    psaPopulation: PsaPopulationSnapshot;
    gradedPrices: GradedPrice[];
    priceHistory?: PricePoint[];
    marketHistory?: MarketHistorySummary;
    populationBreakdown?: PopulationBreakdown;
    recentSales?: SaleRecord[];
    evidenceSummary?: TcgCard["evidenceSummary"];
    sourceStatus?: MarketSourceStatus[];
    marketEvidence?: MarketEvidence[];
    priceConsensus?: PriceConsensus;
    nmMarketUsd?: number | null;
  },
) {
  const catalogPriceHistory = [...card.priceHistory];
  const catalogGraded = [...card.gradedPrices];

  if (shouldPreferIncomingPopulation(psaData.psaPopulation, card.psaPopulation)) {
    card.psaPopulation = psaData.psaPopulation;
    card.gradingPopulation = psaData.psaPopulation;
  }

  if (psaData.populationBreakdown) {
    card.populationBreakdown = psaData.populationBreakdown;
  }

  card.gradedPrices = mergeCatalogAndLiveGradedPrices(catalogGraded, psaData.gradedPrices);

  if (!card.gradedPrices.some((price) => price.grade === "Ungraded")) {
    const catalogUngraded = catalogGraded.find((price) => price.grade === "Ungraded");
    if (catalogUngraded) {
      card.gradedPrices = sortGradedPricesList([catalogUngraded, ...card.gradedPrices]);
    }
  }

  if (psaData.priceHistory?.length) {
    card.priceHistory = mergePriceHistoryWithCatalog(catalogPriceHistory, psaData.priceHistory);
  }

  if (psaData.recentSales?.length) {
    card.recentSales = psaData.recentSales;
  }

  if (psaData.evidenceSummary) {
    card.evidenceSummary = psaData.evidenceSummary;
  }

  if (psaData.sourceStatus) {
    card.sourceStatus = psaData.sourceStatus;
  }

  if (psaData.marketEvidence) {
    card.marketEvidence = psaData.marketEvidence;
  }

  if (psaData.priceConsensus) {
    const catalogPriceUsd = card.marketPriceUsd;
    const catalogTrusted = isTrustedCatalogMarketPrice(card);
    let nextConsensus = psaData.priceConsensus;
    const rawConsensusEstimate = nextConsensus.finalEstimateUsd;
    const catalogOnlyConsensus = isCatalogOnlyConsensus(nextConsensus);
    const catalogPlaceholderValue = catalogPlaceholderValueFromConsensus(nextConsensus);
    const consensusRejectsCatalogBaseline = /catalog baseline looked like/i.test(
      nextConsensus.methodology,
    );
    const stabilizedEstimate = catalogOnlyConsensus
      ? stabilizedCatalogOnlyPrice(card, rawConsensusEstimate)
      : null;

    if (
      !consensusRejectsCatalogBaseline &&
      shouldPreserveCatalogMarketPrice(catalogPriceUsd, nextConsensus.finalEstimateUsd, {
        soldCompCount: nextConsensus.sampleCount,
        catalogTrusted,
        isJapanese: card.language === "ja",
      })
    ) {
      nextConsensus = {
        ...nextConsensus,
        finalEstimateUsd: catalogPriceUsd,
        methodology: `${nextConsensus.methodology} Catalog sold-comp baseline preserved over weaker guide snapshots.`,
      };
    }

    if (catalogOnlyConsensus) {
      nextConsensus = {
        ...nextConsensus,
        finalEstimateUsd: stabilizedEstimate ?? nextConsensus.finalEstimateUsd,
        confidence: "low",
        confidenceScore: Math.min(nextConsensus.confidenceScore, stabilizedEstimate ? 0.38 : 0.44),
        methodology: `${nextConsensus.methodology} Catalog-only result is treated as low confidence until guide, population-price, or sold-comp evidence corroborates it.`,
      };

      if (stabilizedEstimate) {
        card.priceHistory = stabilizeCatalogOnlyHistory(
          card.priceHistory,
          rawConsensusEstimate,
          stabilizedEstimate,
        );
      }
    }

    if (!catalogOnlyConsensus && catalogPlaceholderValue > 0 && nextConsensus.finalEstimateUsd > 0) {
      card.priceHistory = stabilizeCatalogOnlyHistory(
        card.priceHistory,
        catalogPlaceholderValue,
        nextConsensus.finalEstimateUsd,
      );
    }

    card.priceConsensus = nextConsensus;

    const ungradedIndex = card.gradedPrices.findIndex((price) => price.grade === "Ungraded");
    if (ungradedIndex >= 0) {
      const current = card.gradedPrices[ungradedIndex];
      card.gradedPrices[ungradedIndex] = {
        ...current,
        value: nextConsensus.finalEstimateUsd,
        source: "Consensus estimate across trusted sources",
        confidence: nextConsensus.confidence,
        confidenceScore: nextConsensus.confidenceScore,
        saleCount:
          nextConsensus.sampleCount > 0 ? nextConsensus.sampleCount : current.saleCount,
        warning:
          catalogOnlyConsensus
            ? "Catalog-only estimate; use population and grade references until guide or sold-comp evidence corroborates raw value."
            : nextConsensus.confidence === "low"
              ? "Consensus is based on thin or weakly corroborated evidence."
            : undefined,
      };
    }

    card.marketPriceUsd = getHeadlineMarketPriceUsd(card);
  }

  if (typeof psaData.nmMarketUsd === "number" && psaData.nmMarketUsd > 0) {
    card.nmMarketUsd = psaData.nmMarketUsd;
  }

  const marketHistory =
    psaData.marketHistory ??
    classifyMarketHistory(card.priceHistory, card.recentSales);
  card.marketHistory = marketHistory;
  card.marketHistoryStatus = marketHistory.status;
  card.historyUnavailable = marketHistory.historyUnavailable;
}

function isExtendedGraderSnapshotLabel(grade: string) {
  return grade === "Ungraded" || /^(PSA|BGS|BECKETT|CGC|TAG|SGC)\b/i.test(grade);
}

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<PromiseSettledResult<T>> {
  return Promise.race([
    promise.then(
      (value): PromiseSettledResult<T> => ({ status: "fulfilled", value }),
      (reason): PromiseSettledResult<T> => ({ status: "rejected", reason }),
    ),
    new Promise<PromiseSettledResult<T>>((resolve) =>
      setTimeout(
        () => resolve({ status: "rejected", reason: new Error("source budget exceeded") }),
        ms,
      ),
    ),
  ]);
}

export async function fetchLivePsaData(
  setName: string,
  cardName: string,
  cardNumber: string,
  rawMarketPriceUsd?: number,
  setTotal?: number,
  cardRarity?: string,
  options: LivePsaDataLookupOptions = {},
): Promise<LivePsaDataResult | null> {
  const cacheKey = marketCacheKey(
    setName,
    cardName,
    cardNumber,
    rawMarketPriceUsd,
    setTotal,
    cardRarity,
    options,
  );
  const existing = marketResultRuntime.inFlight.get(cacheKey);
  if (existing) {
    const shared = await existing;
    return shared ? cloneMarketResult(shared) : null;
  }

  const request = fetchLivePsaDataUncached(
    setName,
    cardName,
    cardNumber,
    rawMarketPriceUsd,
    setTotal,
    cardRarity,
    options,
  ).finally(() => {
    marketResultRuntime.inFlight.delete(cacheKey);
  });
  marketResultRuntime.inFlight.set(cacheKey, request);

  const result = await request;
  return result ? cloneMarketResult(result) : null;
}

async function fetchLivePsaDataUncached(
  setName: string,
  cardName: string,
  cardNumber: string,
  rawMarketPriceUsd?: number,
  setTotal?: number,
  cardRarity?: string,
  options: LivePsaDataLookupOptions = {},
): Promise<LivePsaDataResult | null> {
  const cacheKey = marketCacheKey(
    setName,
    cardName,
    cardNumber,
    rawMarketPriceUsd,
    setTotal,
    cardRarity,
    options,
  );
  const cachedResult = await readCachedMarketResult(cacheKey, {
    language: options.language,
    setCode: options.setCode,
  });

  if (cachedResult) {
    return cachedResult;
  }

  const marketUsd =
    typeof rawMarketPriceUsd === "number" && Number.isFinite(rawMarketPriceUsd)
      ? rawMarketPriceUsd
      : 0;
  const lookupCardName = options.englishCardName?.trim() || cardName;
  const normalizedCardName = normalizeCardName(lookupCardName);
  const normalizedSetName = normalizeCardName(setName);
  const exactPriceChartingIdentity = priceChartingIdentityFields(options);
  const marketLookupOptions: ExternalMarketLookupOptions = {
    setCode: options.setCode,
    language: options.language,
    officialCardId: options.officialCardId,
    priceChartingProductId: priceChartingIdentityFields(options).productId,
    identityVersion: options.identityVersion,
    isJapanese: options.isJapanese,
    englishCardName: options.englishCardName,
    ...exactPriceChartingIdentity,
  };
  const setSlugVariants = await resolvePriceChartingSetSlugs(
    normalizedSetName,
    marketLookupOptions,
  );
  const setSlug = setSlugVariants[0] ?? slugify(normalizedSetName);
  const isJapaneseLookup = options.isJapanese ?? options.language === "ja";
  const nameSlugs = cardNameSlugVariantsForExternalApis(normalizedCardName, "standard", marketLookupOptions);
  const effectiveNameSlugs =
    nameSlugs.length > 0
      ? nameSlugs
      : options.setCode
        ? [slugify(options.setCode)]
        : [slugify(normalizedCardName)].filter(Boolean);
  const primaryNumberSlug = numberSlugVariantsForExternalApis(cardNumber, setTotal)[0] ?? slugify(cardNumber);
  const primaryTcgUrl = buildTcgFishCardUrl(
    setSlug,
    effectiveNameSlugs[0] ?? slugify(normalizedCardName),
    primaryNumberSlug,
  );
  const soldCompOptions = {
    setCode: options.setCode,
    isJapanese: options.isJapanese ?? options.language === "ja",
    language: options.language,
    finish: options.finish,
  };
  const skipSoldComps = options.skipSoldComps === true;
  const coreBudgetMs = skipSoldComps ? CORE_SOURCE_BUDGET_MS : FULL_SOURCE_BUDGET_MS;
  const priceChartingMarketInput = {
    name: lookupCardName,
    englishName: options.englishCardName ?? lookupCardName,
    setName,
    setCode: options.setCode,
    collectorNumber: cardNumber,
    setTotal,
    language: options.language,
    rarity: cardRarity,
    finish: options.finish,
    ...exactPriceChartingIdentity,
  };
  const hasExactPriceChartingIdentity = Boolean(
    exactPriceChartingIdentity.productId ||
      exactPriceChartingIdentity.productUrl ||
      exactPriceChartingIdentity.setSlug,
  );
  const exactPriceChartingMarketOutcomePromise = hasExactPriceChartingIdentity
    ? settleWithin(fetchPriceChartingMarketPrice(priceChartingMarketInput), coreBudgetMs)
    : Promise.resolve({
        status: "fulfilled" as const,
        value: null,
      });
  const soldOutcomePromise: Promise<
    PromiseSettledResult<Awaited<ReturnType<typeof fetchSoldComps>>>
  > = skipSoldComps
    ? Promise.resolve({
        status: "fulfilled",
        value: { accepted: [], rejected: 0, rejectedReasonCounts: {} },
      })
    : settleWithin(
        fetchSoldComps(
          setName,
          lookupCardName,
          cardNumber,
          setTotal,
          cardRarity,
          soldCompOptions,
        ),
        SOLD_COMP_SOURCE_BUDGET_MS,
      );
  const tcgFishSetSlugs = [...new Set([setSlug, ...setSlugVariants.slice(0, 3)])];
  const gatherStartedAt = Date.now();
  const [populationOutcome, exactPriceChartingMarketOutcome] = await Promise.all([
    settleWithin(
      fetchPriceChartingPopulationWithVariants(
        setName,
        lookupCardName,
        cardNumber,
        setTotal,
        marketLookupOptions,
      ),
      Math.min(coreBudgetMs, isJapaneseLookup ? 7_000 : POPULATION_SOURCE_BUDGET_MS),
    ),
    exactPriceChartingMarketOutcomePromise,
  ]);
  const initialPopulationResult =
    populationOutcome.status === "fulfilled" ? populationOutcome.value : null;
  const initialPopulationIsEnglishParallel =
    isJapaneseLookup &&
    isEnglishParallelPriceChartingPopulationResult(
      initialPopulationResult,
      options.setCode,
    );
  const populationGuidePrices =
    populationOutcome.status === "fulfilled" && !initialPopulationIsEnglishParallel
      ? initialPopulationResult?.gradedPrices ?? new Map<string, GradedPrice>()
      : new Map<string, GradedPrice>();
  const populationHasSignal =
    populationOutcome.status === "fulfilled" &&
    !initialPopulationIsEnglishParallel &&
    Boolean(initialPopulationResult) &&
    hasPopulationSignal(initialPopulationResult!.population);
  const populationHasGuidePrices = populationGuidePrices.size >= 1;
  let tcgFishSkipped = false;
  let tcgOutcome: PromiseSettledResult<Awaited<ReturnType<typeof loadBestTcgFishPage>>>;
  if (populationHasSignal || (skipSoldComps && populationHasGuidePrices)) {
    tcgFishSkipped = true;
    tcgOutcome = { status: "fulfilled", value: null };
  } else {
    const remainingCoreMs = Math.max(1_200, coreBudgetMs - (Date.now() - gatherStartedAt));
    tcgOutcome = await settleWithin(
      loadBestTcgFishPage(tcgFishSetSlugs, effectiveNameSlugs, cardNumber, setTotal),
      remainingCoreMs,
    );
  }
  const remainingGuideMs = Math.max(0, coreBudgetMs - (Date.now() - gatherStartedAt));
  const guideOutcome: PromiseSettledResult<
    Awaited<ReturnType<typeof mergePriceChartingGuidesFromVariants>>
  > =
    populationHasGuidePrices ||
    (skipSoldComps && populationHasSignal) ||
    remainingGuideMs < 400
      ? {
          status: "fulfilled",
          value: {
            prices: populationGuidePrices,
            discoveredPopulationUrls: [],
          },
        }
      : await settleWithin(
          mergePriceChartingGuidesFromVariants(
            setName,
            lookupCardName,
            cardNumber,
            setTotal,
            marketLookupOptions,
          ),
          remainingGuideMs,
        );
  const soldOutcome = await soldOutcomePromise;

  let priceChartingMarketAttempted = hasExactPriceChartingIdentity;
  let priceChartingMarketFailure: unknown =
    exactPriceChartingMarketOutcome.status === "rejected"
      ? exactPriceChartingMarketOutcome.reason
      : undefined;
  let priceChartingMarket =
    exactPriceChartingMarketOutcome.status === "fulfilled"
      ? exactPriceChartingMarketOutcome.value
      : null;
  const guideResult = guideOutcome.status === "fulfilled" ? guideOutcome.value : null;
  const discoveredPopulationUrls = [
    ...new Set([
      ...(priceChartingMarket?.productUrl ? [priceChartingMarket.productUrl] : []),
      ...(guideResult?.discoveredPopulationUrls ?? []),
      ...populationUrlsFromGuidePrices(guideResult?.prices ?? new Map()),
    ]),
  ];
  let resolvedPopulationOutcome = populationOutcome;
  const remainingGatherMs = Math.max(0, coreBudgetMs - (Date.now() - gatherStartedAt));

  if (
    remainingGatherMs >= 800 &&
    discoveredPopulationUrls.length &&
    !populationHasGuidePrices &&
    (populationOutcome.status !== "fulfilled" ||
      !populationOutcome.value ||
      !hasPopulationSignal(populationOutcome.value.population))
  ) {
    const recoveredPopulation = await settleWithin(
      fetchPriceChartingPopulationWithVariants(
        setName,
        lookupCardName,
        cardNumber,
        setTotal,
        marketLookupOptions,
        discoveredPopulationUrls,
      ),
      remainingGatherMs,
    );

    if (recoveredPopulation.status === "fulfilled" && recoveredPopulation.value) {
      resolvedPopulationOutcome = recoveredPopulation;
    }
  }

  if (
    remainingGatherMs >= 800 &&
    !priceChartingMarket &&
    !populationHasGuidePrices &&
    discoveredPopulationUrls.length
  ) {
    priceChartingMarketAttempted = true;
    const discoveredProductUrl = discoveredPopulationUrls.find((url) => {
      try {
        return /^\/game\/[^/]+\/[^/]+\/?$/i.test(new URL(url).pathname);
      } catch {
        return false;
      }
    });
    const recoveredMarket = await settleWithin(
      fetchPriceChartingMarketPrice({
        ...priceChartingMarketInput,
        productUrl: discoveredProductUrl,
        setSlug,
      }),
      coreBudgetMs,
    );

    if (recoveredMarket.status === "fulfilled") {
      priceChartingMarket = recoveredMarket.value;
    } else {
      priceChartingMarketFailure = recoveredMarket.reason;
    }
  }

  let psaPopulation: PsaPopulationSnapshot;
  let englishParallelPopulation: PopulationBreakdown["englishParallel"];
  const snapshotPrices = new Map<string, GradedPrice>();
  const snapshotCandidates: GradedPrice[] = [];
  const sourceStatuses: MarketSourceStatus[] = [];
  const marketEvidence: MarketEvidence[] = [];
  const tcgLoaded = tcgOutcome.status === "fulfilled" ? tcgOutcome.value : null;
  const rememberSnapshotPrice = (price: GradedPrice) => {
    snapshotCandidates.push(price);

    if (shouldPreferIncomingPriceSnapshot(price, snapshotPrices.get(price.grade))) {
      snapshotPrices.set(price.grade, price);
    }
  };

  if (marketUsd >= 1) {
    const catalogConfidence = isJapaneseLookup ? 0.34 : 0.64;
    const catalogSnapshot: GradedPrice = {
      grade: "Ungraded",
      value: marketUsd,
      populationCount: 0,
      source: "PokemonTCG catalog market baseline",
      saleCount: 0,
      lastSoldAt: null,
      service: "RAW",
      confidence: isJapaneseLookup ? "low" : "medium",
      confidenceScore: catalogConfidence,
      evidenceType: "catalog",
      warning: isJapaneseLookup
        ? "Localized catalog baseline may not reflect the Japanese print market. PriceCharting and sold comps take priority."
        : "Catalog market value is used as a baseline and to reject wildly mismatched public sold listings.",
    };
    rememberSnapshotPrice(catalogSnapshot);
    sourceStatuses.push(
      sourceStatus({
        source: "PokemonTCG/Cardmarket catalog",
        state: "ready",
        confidence: "medium",
        confidenceScore: 0.64,
        note: "Catalog market value is available and used as a raw-price baseline.",
        sampleCount: 1,
      }),
    );
    marketEvidence.push({
      id: "catalog-ungraded",
      source: "PokemonTCG/Cardmarket catalog",
      evidenceType: "catalog",
      grade: "Ungraded",
      priceUsd: marketUsd,
      confidence: "medium",
      confidenceScore: 0.64,
      note: "Catalog market value used as a baseline and outlier guard.",
      warning: "Catalog snapshot",
    });
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "PokemonTCG/Cardmarket catalog",
        state: "no_match",
        confidence: "low",
        confidenceScore: 0.25,
        note: "The catalog did not provide a usable current raw market value.",
      }),
    );
  }

  let tcgFishPopulation: PsaPopulationSnapshot | null = null;

  if (tcgFishSkipped) {
    psaPopulation = pendingPsaPopulation(
      primaryTcgUrl,
      "TCGFish skipped because PriceCharting population already verified.",
    );
    sourceStatuses.push(
      sourceStatus({
        source: "TCGFish public page",
        state: "disabled",
        confidence: "low",
        confidenceScore: 0.2,
        note: "Skipped because PriceCharting population already has a verified census.",
        sourceUrl: primaryTcgUrl,
      }),
    );
  } else if (tcgLoaded) {
    tcgFishPopulation = parseTcgFishPopulation(tcgLoaded.html, tcgLoaded.url);
    psaPopulation = tcgFishPopulation;
    const fishSnapshots = parseTcgFishGradeSnapshots(tcgLoaded.html, psaPopulation);
    sourceStatuses.push(
      sourceStatus({
        source: "TCGFish public page",
        state:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0
            ? "ready"
            : "no_match",
        confidence:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0
            ? "medium"
            : "low",
        confidenceScore:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0 ? 0.7 : 0.28,
        note:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0
            ? "Public TCGFish page parsed for PSA population and grade guide snapshots."
            : "A public page loaded, but it did not expose usable population or price fields.",
        sourceUrl: tcgLoaded.url,
        sampleCount: psaPopulation.grades.length + fishSnapshots.size,
      }),
    );

    for (const [grade, price] of fishSnapshots.entries()) {
      rememberSnapshotPrice(price);
      marketEvidence.push({
        id: `tcgfish-${slugify(grade)}`,
        source: "TCGFish public page",
        evidenceType: price.evidenceType ?? "guide_snapshot",
        grade,
        priceUsd: price.value,
        sourceUrl: price.sourceUrl,
        confidence: price.confidence ?? "medium",
        confidenceScore: price.confidenceScore ?? 0.58,
        note: "Public TCGFish snapshot used for grade guide evidence.",
        warning: price.warning,
      });
    }
  } else {
    psaPopulation = pendingPsaPopulation(
      primaryTcgUrl,
      "TCGFish did not return a usable card page (network, blocking page, or unknown slug).",
    );
    sourceStatuses.push(
      sourceStatus({
        source: "TCGFish public page",
        state:
          tcgOutcome.status === "rejected"
            ? retryableFailureState(tcgOutcome.reason)
            : "no_match",
        confidence: "low",
        confidenceScore: 0.24,
        note: "The public fallback page did not return usable card data.",
        sourceUrl: primaryTcgUrl,
        warning:
          tcgOutcome.status === "rejected"
            ? errorMessage(tcgOutcome.reason)
            : undefined,
      }),
    );
  }

  if (guideOutcome.status === "fulfilled") {
    const guidePrices = guideResult?.prices ?? new Map<string, GradedPrice>();
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public guide",
        state: guidePrices.size > 0 ? "ready" : "no_match",
        confidence: guidePrices.size > 0 ? "medium" : "low",
        confidenceScore: guidePrices.size > 0 ? 0.52 : 0.24,
        note:
          guidePrices.size > 0
            ? "Public PriceCharting guide values were parsed for graded snapshots."
            : "No usable public guide prices were found for this card.",
        sampleCount: guidePrices.size,
      }),
    );
    for (const [grade, price] of guidePrices.entries()) {
      rememberSnapshotPrice(price);
      marketEvidence.push({
        id: `pricecharting-public-${slugify(grade)}`,
        source: "PriceCharting public guide",
        evidenceType: price.evidenceType ?? "guide_snapshot",
        grade,
        priceUsd: price.value,
        sourceUrl: price.sourceUrl,
        confidence: price.confidence ?? "medium",
        confidenceScore: price.confidenceScore ?? 0.52,
        note: "Public PriceCharting guide snapshot used as supporting evidence.",
        warning: price.warning ?? "Snapshot only",
      });
    }

    if (guidePrices.size === 0 && !priceChartingMarketAttempted) {
      priceChartingMarketAttempted = true;
      try {
        priceChartingMarket = await fetchPriceChartingMarketPrice(
          priceChartingMarketInput,
        );
      } catch (error) {
        priceChartingMarketFailure = error;
        // Keep the no_match status when the public-page fallback is unavailable.
      }
    }

    if (priceChartingMarket?.gradedPrices?.length) {
      const psaGuides = priceChartingMarket.gradedPrices.filter(
        (price) => /^PSA\s/i.test(price.grade) && price.value > 0,
      );

      if (
        psaGuides.length > 0 &&
        (priceChartingMarket.sourceLabel ?? "")
          .toLowerCase()
          .includes("pricecharting")
      ) {
        if (guidePrices.size === 0) {
          sourceStatuses[sourceStatuses.length - 1] = sourceStatus({
            source: "PriceCharting public guide",
            state: "fallback",
            confidence: "low",
            confidenceScore: Math.min(
              priceChartingMarket.confidenceScore ?? 0.42,
              0.42,
            ),
            note: "Recovered exact public guide snapshots from the PriceCharting product page after the legacy parser found no stronger market evidence.",
            sourceUrl: priceChartingMarket.sourceUrl,
            sampleCount: priceChartingMarket.gradedPrices.length,
          });
        }

        for (const price of priceChartingMarket.gradedPrices) {
          rememberSnapshotPrice(price);
          marketEvidence.push({
            id: `pricecharting-product-${slugify(price.grade)}`,
            source:
              priceChartingMarket.sourceLabel ?? "PriceCharting public page",
            evidenceType: price.evidenceType ?? "guide_snapshot",
            grade: price.grade,
            priceUsd: price.value,
            sourceUrl: price.sourceUrl ?? priceChartingMarket.sourceUrl,
            confidence: price.confidence ?? "medium",
            confidenceScore:
              price.confidenceScore ??
              priceChartingMarket.confidenceScore ??
              0.56,
            note: hasExactPriceChartingIdentity
              ? "Guide snapshot recovered from the cached exact PriceCharting product identity."
              : "Public PriceCharting page guide recovered after the legacy HTML parser missed this card layout.",
            warning: price.warning ?? "Snapshot only",
          });
        }
      }
    }
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public guide",
        state: retryableFailureState(guideOutcome.reason),
        confidence: "low",
        confidenceScore: 0.2,
        note: "The public guide fallback could not be checked.",
        warning: errorMessage(guideOutcome.reason),
      }),
    );

    if (
      priceChartingMarket?.gradedPrices?.length &&
      (priceChartingMarket.sourceLabel ?? "")
        .toLowerCase()
        .includes("pricecharting")
    ) {
      sourceStatuses[sourceStatuses.length - 1] = sourceStatus({
        source: "PriceCharting public guide",
        state: "fallback",
        confidence: "medium",
        confidenceScore: priceChartingMarket.confidenceScore ?? 0.56,
        note: "Recovered exact PriceCharting product-page guides after the legacy guide lookup failed.",
        sourceUrl: priceChartingMarket.sourceUrl,
        sampleCount: priceChartingMarket.gradedPrices.length,
      });

      for (const price of priceChartingMarket.gradedPrices) {
        rememberSnapshotPrice(price);
        marketEvidence.push({
          id: `pricecharting-product-${slugify(price.grade)}`,
          source: priceChartingMarket.sourceLabel,
          evidenceType: price.evidenceType ?? "guide_snapshot",
          grade: price.grade,
          priceUsd: price.value,
          sourceUrl: price.sourceUrl ?? priceChartingMarket.sourceUrl,
          confidence: price.confidence ?? "medium",
          confidenceScore:
            price.confidenceScore ?? priceChartingMarket.confidenceScore ?? 0.56,
          note: "Guide snapshot recovered from the cached exact PriceCharting product identity.",
          warning: price.warning ?? "Snapshot only",
        });
      }
    }
  }

  const cachedPrice = await readCachedResolvedPrice(
    priceCacheSlugAliases({
      slug: "",
      language: options.language ?? "en",
      setCode: options.setCode,
      collectorNumber: cardNumber,
      officialCardId: options.officialCardId,
    }),
  );
  const nmMarketUsd = sanitizeNmMarketUsd(
    cachedPrice?.ungradedUsd ?? 0,
    findNmMarketUsd(cachedPrice?.results),
  );
  const missingFeaturedSlabs = ["PSA 8", "PSA 9", "PSA 10"].some((grade) => {
    const current = snapshotPrices.get(grade);
    return !(current && current.value > 0);
  });
  if (cachedPrice && (guideOutcome.status !== "fulfilled" || missingFeaturedSlabs)) {
    let mergedCachedSlabs = 0;
    for (const providerResult of cachedPrice.results) {
      for (const price of providerResult.gradedPrices ?? []) {
        if (!(price.value > 0)) {
          continue;
        }
        rememberSnapshotPrice({
          ...price,
          source: providerResult.sourceLabel || "Cached market guide",
          evidenceType: price.evidenceType ?? "guide_snapshot",
        });
        mergedCachedSlabs += 1;
      }
    }
    if (mergedCachedSlabs > 0) {
      const guideIndex = sourceStatuses.findIndex(
        (status) => status.source === "PriceCharting public guide",
      );
      const guideState = guideIndex >= 0 ? sourceStatuses[guideIndex]?.state : undefined;
      const shouldMarkCached =
        guideState === "timeout" ||
        guideState === "circuit_open" ||
        guideState === "provider_error" ||
        guideState === "failed" ||
        guideOutcome.status !== "fulfilled";

      if (shouldMarkCached) {
        const recovered = sourceStatus({
          source: "PriceCharting public guide",
          state: "cached",
          confidence: "medium",
          confidenceScore: cachedPrice.confidenceScore || 0.56,
          note: "Reused cached PriceCharting / price-API slabs after the live guide lookup timed out.",
          sampleCount: mergedCachedSlabs,
        });
        if (guideIndex >= 0) {
          sourceStatuses[guideIndex] = recovered;
        } else {
          sourceStatuses.push(recovered);
        }
      }
    }
  }

  const resolvedPriceChartingPopulation =
    resolvedPopulationOutcome.status === "fulfilled" ? resolvedPopulationOutcome.value : null;
  const rejectedEnglishParallelPopulation = Boolean(
    isJapaneseLookup &&
      isEnglishParallelPriceChartingPopulationResult(
        resolvedPriceChartingPopulation,
        options.setCode,
      ),
  );
  const priceChartingPopulation = rejectedEnglishParallelPopulation
    ? null
    : resolvedPriceChartingPopulation;

  if (priceChartingPopulation) {
    const hasPriceChartingPopulation = hasPopulationSignal(priceChartingPopulation.population);
    const thinPriceChartingPopulation = isThinPublicPopulationSnapshot(
      priceChartingPopulation.population,
    );
    const usedPriceChartingPopulation = isJapaneseLookup
      ? shouldPreferJapanesePriceChartingPopulation(
          priceChartingPopulation,
          psaPopulation,
          options.setCode,
        )
      : shouldPreferPopulationSnapshot(priceChartingPopulation.population, psaPopulation);
    const isCombinedSetIndex = priceChartingPopulation.sourceKind === "set_index";

    if (usedPriceChartingPopulation) {
      psaPopulation = finalizePriceChartingPopulationSnapshot(
        priceChartingPopulation.population,
      );
    }

    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public population",
        state: hasPriceChartingPopulation
          ? thinPriceChartingPopulation
            ? "fallback"
            : "ready"
          : "no_match",
        confidence: hasPriceChartingPopulation
          ? thinPriceChartingPopulation
            ? "low"
            : priceChartingPopulation.population.confidence ?? "medium"
          : "low",
        confidenceScore: hasPriceChartingPopulation
          ? thinPriceChartingPopulation
            ? Math.min(priceChartingPopulation.population.confidenceScore ?? 0.32, 0.32)
            : priceChartingPopulation.population.confidenceScore ?? 0.62
          : 0.28,
        note: hasPriceChartingPopulation
          ? thinPriceChartingPopulation
            ? "Only a very thin partial public population row was exposed, so it is treated as fallback evidence instead of a certified population table."
            : usedPriceChartingPopulation
            ? isCombinedSetIndex
              ? "Matched the card in the free set population index and used combined PSA/CGC grade counts because no fuller PSA item report was available."
              : usesEnglishParallelPsaPopulation(psaPopulation)
                ? "Used PSA population from the English parallel release because Japanese PSA submissions are minimal in the public report."
                : "Matched the exact free item population report and used its grade counts."
            : "Population data was parsed, but another public source had a stronger grade-by-grade table."
          : "The public population page did not expose usable counts.",
        sourceUrl: priceChartingPopulation.population.sourceUrl,
        sampleCount: psaPopulation.grades.length,
        warning: psaPopulation.warning ?? priceChartingPopulation.population.warning,
      }),
    );

    for (const populationGrade of priceChartingPopulation.population.grades) {
      marketEvidence.push({
        id: `pricecharting-pop-${slugify(populationGrade.grade)}`,
        source: priceChartingPopulation.population.source,
        evidenceType: "population",
        grade: populationGrade.grade,
        sourceUrl:
          populationGrade.sourceUrl ?? priceChartingPopulation.population.sourceUrl,
        confidence: populationGrade.confidence ?? priceChartingPopulation.population.confidence ?? "medium",
        confidenceScore:
          populationGrade.confidenceScore ??
          priceChartingPopulation.population.confidenceScore ??
          0.6,
        note: priceChartingPopulation.population.note,
        warning: populationGrade.warning ?? priceChartingPopulation.population.warning,
      });
    }

    for (const price of priceChartingPopulation.gradedPrices.values()) {
      rememberSnapshotPrice(price);
      marketEvidence.push({
        id: `pricecharting-pop-price-${slugify(price.grade)}`,
        source: "PriceCharting public population",
        evidenceType: price.evidenceType ?? "guide_snapshot",
        grade: price.grade,
        priceUsd: price.value,
        sourceUrl: price.sourceUrl ?? priceChartingPopulation.population.sourceUrl,
        confidence: price.confidence ?? "medium",
        confidenceScore: price.confidenceScore ?? 0.56,
        note: price.grade.startsWith("PSA")
          ? "PSA guide price parsed from the exact public population report."
          : "Guide price parsed from the public population report.",
        warning: price.warning,
      });
    }

    const populationSourceUrl = priceChartingPopulation.population.sourceUrl?.trim();
    const needsGuideRecovery =
      populationSourceUrl &&
      priceChartingPopulation.gradedPrices.size === 0 &&
      !SOLD_COMP_GRADES.some(
        (grade) => grade !== "Ungraded" && (snapshotPrices.get(grade)?.value ?? 0) > 0,
      );

    if (needsGuideRecovery) {
      try {
        const html = await fetchMarketText(populationSourceUrl, {
          accept: "html",
          language: options.language,
          timeoutMs: 12_000,
        });
        let recoveredGuides = parsePriceChartingPublicPagePrices(html, populationSourceUrl);

        if (!recoveredGuides.length) {
          recoveredGuides = [...parsePriceChartingGradedGuide(html, populationSourceUrl).values()];
        }

        if (recoveredGuides.length) {
          sourceStatuses.push(
            sourceStatus({
              source: "PriceCharting public guide",
              state: "ready",
              confidence: "medium",
              confidenceScore: 0.58,
              note: "Recovered grade guide prices from the verified PriceCharting item page linked to the population report.",
              sourceUrl: populationSourceUrl,
              sampleCount: recoveredGuides.length,
            }),
          );

          for (const price of recoveredGuides) {
            rememberSnapshotPrice(price);
            marketEvidence.push({
              id: `pricecharting-pop-page-${slugify(price.grade)}`,
              source: "PriceCharting public page",
              evidenceType: price.evidenceType ?? "guide_snapshot",
              grade: price.grade,
              priceUsd: price.value,
              sourceUrl: price.sourceUrl ?? populationSourceUrl,
              confidence: price.confidence ?? "medium",
              confidenceScore: price.confidenceScore ?? 0.58,
              note: "Public PriceCharting page guide parsed from the verified population item URL.",
              warning: price.warning ?? "Snapshot only",
            });
          }
        }
      } catch {
        // Ignore guide recovery failures; population counts still stand.
      }
    }
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public population",
        state:
          populationOutcome.status === "rejected"
            ? retryableFailureState(populationOutcome.reason)
            : "no_match",
        confidence: "low",
        confidenceScore: 0.24,
        note: rejectedEnglishParallelPopulation
          ? "The matched population page belongs to the English parallel release, so it was excluded from Japanese population and grade-price fields."
          : "No free public population counts were available from PriceCharting.",
        sourceUrl: rejectedEnglishParallelPopulation
          ? resolvedPriceChartingPopulation?.population.sourceUrl
          : undefined,
        warning:
          populationOutcome.status === "rejected"
            ? errorMessage(populationOutcome.reason)
            : undefined,
      }),
    );
  }

  if (
    !hasPopulationSignal(psaPopulation) &&
    isJapaneseLookup &&
    options.setCode
  ) {
    const retryPopulation = await fetchPriceChartingPopulationDirectPriority(
      setName,
      lookupCardName,
      cardNumber,
      setTotal,
      marketLookupOptions,
    );

    if (
      retryPopulation &&
      hasPopulationSignal(retryPopulation.population) &&
      shouldPreferJapanesePriceChartingPopulation(
        retryPopulation,
        psaPopulation,
        options.setCode,
      )
    ) {
      psaPopulation = finalizePriceChartingPopulationSnapshot(retryPopulation.population);
      const thinRetryPopulation = isThinPublicPopulationSnapshot(retryPopulation.population);
      sourceStatuses.push(
        sourceStatus({
          source: "PriceCharting public population",
          state: thinRetryPopulation ? "fallback" : "ready",
          confidence: thinRetryPopulation
            ? "low"
            : retryPopulation.population.confidence ?? "medium",
          confidenceScore: thinRetryPopulation
            ? Math.min(retryPopulation.population.confidenceScore ?? 0.32, 0.32)
            : retryPopulation.population.confidenceScore ?? 0.66,
          note: thinRetryPopulation
            ? "Direct PriceCharting item lookup exposed only a thin partial population row, so it is kept as fallback evidence."
            : "Recovered grade counts from a direct PriceCharting item lookup after the timed batch pass did not return population.",
          sourceUrl: retryPopulation.population.sourceUrl,
          sampleCount: psaPopulation.grades.length,
          warning: psaPopulation.warning,
        }),
      );
    }
  }

  if (!hasPopulationSignal(psaPopulation) && !isJapaneseLookup) {
    const retryPopulation = await fetchPriceChartingPopulationDirectPriority(
      setName,
      lookupCardName,
      cardNumber,
      setTotal,
      marketLookupOptions,
    );

    if (retryPopulation && hasPopulationSignal(retryPopulation.population)) {
      psaPopulation = finalizePriceChartingPopulationSnapshot(retryPopulation.population);
      const thinRetryPopulation = isThinPublicPopulationSnapshot(retryPopulation.population);
      sourceStatuses.push(
        sourceStatus({
          source: "PriceCharting public population",
          state: thinRetryPopulation ? "fallback" : "ready",
          confidence: thinRetryPopulation
            ? "low"
            : retryPopulation.population.confidence ?? "medium",
          confidenceScore: thinRetryPopulation
            ? Math.min(retryPopulation.population.confidenceScore ?? 0.32, 0.32)
            : retryPopulation.population.confidenceScore ?? 0.66,
          note: thinRetryPopulation
            ? "Direct PriceCharting game/item lookup exposed only a thin partial population row, so it is kept as fallback evidence."
            : "Recovered grade counts from a direct PriceCharting game/item lookup after the timed batch pass did not return population.",
          sourceUrl: retryPopulation.population.sourceUrl,
          sampleCount: psaPopulation.grades.length,
          warning: psaPopulation.warning,
        }),
      );
    }
  }

  if (isJapaneseLookup && options.setCode) {
    const { psaTotal, cgcTotal } = populationServiceTotals(psaPopulation);
    const englishParallelProfile = getEnglishParallelSetMarketProfile(options.setCode);

    if (
      englishParallelProfile &&
      (!hasPopulationSignal(psaPopulation) ||
        psaTotal < 10 ||
        isPsaPopulationNegligible(psaTotal, cgcTotal))
    ) {
      const englishParallel = await fetchEnglishParallelPsaPopulation(
        options.setCode,
        lookupCardName,
        cardNumber,
        setTotal,
      );

      if (englishParallel) {
        englishParallelPopulation = {
          ...englishParallel.population,
          mappedFromSet:
            englishParallelProfile.englishParallelSetName ??
            englishParallelProfile.englishName ??
            "English parallel",
        };

        sourceStatuses.push(
          sourceStatus({
            source: "PriceCharting English parallel PSA",
            state: "ready",
            confidence: "medium",
            confidenceScore: 0.7,
            note: englishParallel.population.note,
            sourceUrl: englishParallel.population.sourceUrl,
            sampleCount: populationServiceTotals(englishParallel.population).psaGrades.length,
            warning: englishParallel.population.warning,
          }),
        );

      }
    }
  }

  // Legacy population rows may already carry English-parallel attribution. Do
  // not let them remain in the native slot (or contribute their grade guides)
  // while an old persistent cache ages out under the new cache namespace.
  if (isJapaneseLookup && usesEnglishParallelPsaPopulation(psaPopulation)) {
    const englishParallelProfile = options.setCode
      ? getEnglishParallelSetMarketProfile(options.setCode)
      : undefined;
    englishParallelPopulation ??= {
      ...psaPopulation,
      mappedFromSet:
        englishParallelProfile?.englishParallelSetName ??
        englishParallelProfile?.englishName ??
        "English parallel",
    };
    psaPopulation = pendingPsaPopulation(
      psaPopulation.sourceUrl ?? primaryTcgUrl,
      "No verified Japanese population table is available for this print.",
    );
  }

  if (
    tcgFishPopulation &&
    hasPopulationSignal(tcgFishPopulation) &&
    !usesEnglishParallelPsaPopulation(psaPopulation)
  ) {
    const currentTotals = populationServiceTotals(psaPopulation);
    const fishTotals = populationServiceTotals(tcgFishPopulation);

    if (
      fishTotals.psaTotal > currentTotals.psaTotal + 5 &&
      fishTotals.psaTotal >= currentTotals.effectiveTotal * 0.5
    ) {
      psaPopulation = tcgFishPopulation;
    } else if (shouldPreferPopulationSnapshot(tcgFishPopulation, psaPopulation)) {
      psaPopulation = tcgFishPopulation;
    }
  }

  const populationBreakdown: PopulationBreakdown | undefined = isJapaneseLookup
    ? {
        japanese: psaPopulation,
        ...(englishParallelPopulation
          ? { englishParallel: englishParallelPopulation }
          : {}),
      }
    : undefined;

  let allSales: SaleRecord[] = [];
  let rejectedSales = 0;
  let rejectedReasonCounts: RejectedReasonCounts = {};
  let magerySales: SaleRecord[] = [];
  // Core skips Magery only. PriceCharting completed sales are already on the
  // product page fetched for grades/population, so keep them on first paint.
  const populationSales =
    (resolvedPopulationOutcome.status === "fulfilled"
      ? resolvedPopulationOutcome.value?.sales
      : undefined) ??
    initialPopulationResult?.sales ??
    [];
  const priceChartingSaleCandidates = [
    ...(priceChartingMarket?.sales ?? []),
    ...populationSales,
  ];
  const priceChartingSales = priceChartingSaleCandidates.filter(
    isStrictAttributedPriceChartingSale,
  );
  const rejectedPriceChartingAttribution = Math.max(
    0,
    priceChartingSaleCandidates.length - priceChartingSales.length,
  );

  if (soldOutcome.status === "fulfilled") {
    const soldCompResult = soldOutcome.value;
    magerySales = soldCompResult.accepted;
    rejectedSales = soldCompResult.rejected;
    rejectedReasonCounts = soldCompResult.rejectedReasonCounts;
  }

  const soldCompJunkOptions = {
    cardName: lookupCardName,
    rarity: cardRarity,
  };
  const mageryCleanSales = filterSalesForFinish(
    filterJunkSoldComps(magerySales, soldCompJunkOptions),
    options.finish,
  );
  const priceChartingCleanSales = filterSalesForFinish(
    filterJunkSoldComps(
    priceChartingSales,
    soldCompJunkOptions,
    ),
    options.finish,
  );
  const junkRejectedSales =
    magerySales.length -
    mageryCleanSales.length +
    (priceChartingSales.length - priceChartingCleanSales.length);

  allSales = mergeAttributedSoldComps(
    mageryCleanSales,
    priceChartingCleanSales,
    soldCompJunkOptions,
  );
  const duplicateSales = Math.max(
    0,
    mageryCleanSales.length + priceChartingCleanSales.length - allSales.length,
  );
  rejectedSales += rejectedPriceChartingAttribution + duplicateSales + junkRejectedSales;
  if (rejectedPriceChartingAttribution > 0) {
    rejectedReasonCounts = {
      ...rejectedReasonCounts,
      "pricecharting attribution": rejectedPriceChartingAttribution,
    };
  }
  if (junkRejectedSales > 0) {
    rejectedReasonCounts = {
      ...rejectedReasonCounts,
      "sold-comp junk title": junkRejectedSales,
    };
  }
  if (duplicateSales > 0) {
    rejectedReasonCounts = {
      ...rejectedReasonCounts,
      "duplicate sold listing": duplicateSales,
    };
  }

  sourceStatuses.push(
    sourceStatus({
      source: "Public sold-listing comps",
      state:
        soldOutcome.status === "rejected"
          ? retryableFailureState(soldOutcome.reason)
          : allSales.length > 0
            ? "ready"
            : "no_match",
      confidence: allSales.length >= 3 ? "medium" : "low",
      confidenceScore:
        soldOutcome.status === "rejected"
          ? 0.2
          : allSales.length >= 6
            ? 0.78
            : allSales.length >= 3
              ? 0.62
              : allSales.length > 0
                ? 0.42
                : 0.24,
      note:
        soldOutcome.status === "rejected"
          ? "Magery sold-listing fallback could not be checked."
          : allSales.length > 0
            ? "Accepted sold listings after identity matching, grade detection, and deterministic cross-source deduplication."
            : "No sold listings passed identity matching for this card.",
      sampleCount: allSales.length,
      warning:
        soldOutcome.status === "rejected"
          ? errorMessage(soldOutcome.reason)
          : rejectedSales > 0
            ? `${rejectedSales} listing${rejectedSales === 1 ? "" : "s"} rejected or deduplicated as mismatched or weak evidence.`
            : undefined,
    }),
  );

  if (priceChartingMarketAttempted) {
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting completed sales",
        state: priceChartingMarketFailure
          ? retryableFailureState(priceChartingMarketFailure)
          : priceChartingSales.length > 0
            ? "ready"
            : "no_match",
        confidence: priceChartingSales.length >= 3 ? "medium" : "low",
        confidenceScore: priceChartingMarketFailure
          ? 0.2
          : priceChartingSales.length >= 3
            ? 0.72
            : priceChartingSales.length > 0
              ? 0.58
              : 0.24,
        note: priceChartingSales.length > 0
          ? "Accepted strictly identity-matched completed-sale rows from the exact PriceCharting product page."
          : "The PriceCharting product lookup returned no attributable completed-sale rows.",
        sourceUrl:
          priceChartingMarket?.productUrl ?? priceChartingMarket?.sourceUrl,
        sampleCount: priceChartingSales.length,
        warning: priceChartingMarketFailure
          ? errorMessage(priceChartingMarketFailure)
          : rejectedPriceChartingAttribution > 0
            ? `${rejectedPriceChartingAttribution} PriceCharting row${
                rejectedPriceChartingAttribution === 1 ? " was" : "s were"
              } excluded because product-page attribution was incomplete.`
            : undefined,
      }),
    );
  }

  const salesResults: { grade: string; sales: SaleRecord[] }[] = SOLD_COMP_GRADES.map((grade) => ({
    grade,
    sales: allSales.filter((sale) => sale.condition === grade),
  }));

  const salesByGrade = new Map<string, SaleRecord[]>(
    salesResults.map((result) => [result.grade, result.sales]),
  );
  const reconciledSnapshotPrices = reconcileSnapshotPrices(
    snapshotCandidates,
    snapshotPrices,
  );

  const gradedPrices: GradedPrice[] = [];
  let thinEvidenceCount = 0;
  let fallbackEvidenceCount = 0;
  const soldReportsByGrade = new Map<string, SoldCompReport>();

  for (const grade of SOLD_COMP_GRADES) {
    const snapshot = reconciledSnapshotPrices.get(grade);
    const rawGradeSales = salesByGrade.get(grade) ?? [];
    const sales = filterOutlierSales(rawGradeSales, snapshot);
    const priceOutliers = Math.max(0, rawGradeSales.length - sales.length);
    const gradeRejectedReasonCounts =
      priceOutliers > 0
        ? { ...rejectedReasonCounts, "price outlier": priceOutliers }
        : rejectedReasonCounts;
    const soldReport = buildSoldCompReport({
      grade,
      sales,
      rejectedCount: rejectedSales + priceOutliers,
      rejectedReasonCounts: gradeRejectedReasonCounts,
      snapshot,
    });
    if (soldReport) {
      soldReportsByGrade.set(grade, soldReport);
    }
    salesByGrade.set(grade, sales);

    if (sales.length) {
      if (isThinUncorroboratedGrade(sales, snapshot)) {
        thinEvidenceCount += 1;
        gradedPrices.push({
          grade,
          value: soldReport?.calculatedValueUsd ?? sales[0].price,
          populationCount: resolvePopulationCountForGrade(psaPopulation, grade),
          source: "Single sold comp blended with reference evidence",
          saleCount: 1,
          lastSoldAt: sales[0].date,
          service: gradeService(grade),
          confidence: soldReport?.confidence ?? "low",
          confidenceScore: soldReport?.confidenceScore ?? 0.38,
          evidenceType: "sold_comp",
          sourceUrl: sales[0].listingUrl,
          warning: "Only one uncorroborated sold comp was found; the displayed value is blended with reference evidence, not copied from the latest sale.",
        });
        continue;
      }

      const value = soldReport?.calculatedValueUsd ?? reconcileSoldPriceWithSnapshot(sales, snapshot);
      const confidence = soldCompConfidence(sales, snapshot);
      gradedPrices.push({
        grade,
        value,
        populationCount: resolvePopulationCountForGrade(psaPopulation, grade),
        source:
          sales.length >= 6
            ? "Engineered from public sold comps"
            : "Blended sold comps + market snapshot (thin sample)",
        saleCount: sales.length,
        lastSoldAt: sales[0]?.date ?? null,
        service: gradeService(grade),
        confidence: confidence.confidence,
        confidenceScore: confidence.confidenceScore,
        evidenceType: "sold_comp",
        sourceUrl: sales[0]?.listingUrl,
        warning:
          confidence.confidence === "low"
            ? "Thin sold-comp sample; value is calculated from median, average, and recency-weighted comps."
            : undefined,
      });
      continue;
    }

    if (snapshot) {
      fallbackEvidenceCount += 1;
      const confidence = guideConfidence(snapshot.source);
      gradedPrices.push({
        ...snapshot,
        populationCount:
          resolvePopulationCountForGrade(psaPopulation, snapshot.grade) ||
          snapshot.populationCount ||
          0,
        service: snapshot.service ?? gradeService(snapshot.grade),
        confidence: snapshot.confidence ?? confidence.confidence,
        confidenceScore: snapshot.confidenceScore ?? confidence.confidenceScore,
        evidenceType: snapshot.evidenceType ?? "guide_snapshot",
        warning: snapshot.warning ?? "No accepted sold comps for this grade; using public reference snapshot.",
      });
    }
  }

  applyPopulationCountsToGradedPrices(gradedPrices, psaPopulation);

  const includedSnapshotGrades = new Set(gradedPrices.map((price) => price.grade));

  for (const price of reconciledSnapshotPrices.values()) {
    if (
      !includedSnapshotGrades.has(price.grade) &&
      isExtendedGraderSnapshotLabel(price.grade)
    ) {
      gradedPrices.push(price);
      fallbackEvidenceCount += 1;
      includedSnapshotGrades.add(price.grade);
    }
  }

  if (
    marketUsd >= 1 &&
    !gradedPrices.some((price) => price.grade === "Ungraded")
  ) {
    gradedPrices.unshift({
      grade: "Ungraded",
      value: marketUsd,
      populationCount: 0,
      source: "PokemonTCG live market fallback",
      saleCount: 0,
      lastSoldAt: null,
      service: "RAW",
      confidence: "medium",
      confidenceScore: 0.55,
      evidenceType: "catalog",
      warning: "Catalog market price used because accepted public sold comps were unavailable.",
    });
    fallbackEvidenceCount += 1;
  }

  const recentSales = [...salesByGrade.values()]
    .flat()
    .sort((left, right) => right.date.localeCompare(left.date))
    .filter((sale, index, sales) => {
      return (
        sales.findIndex(
          (candidate) =>
            candidate.date === sale.date &&
            candidate.title === sale.title &&
            candidate.price === sale.price,
        ) === index
      );
    })
    .slice(0, 36);
  const filteredOutSales = Math.max(0, allSales.length - recentSales.length);

  for (const sale of recentSales) {
    marketEvidence.push({
      id: `sale-${slugify(sale.condition)}-${slugify(sale.date)}-${Math.round(sale.price * 100)}`,
      source: sale.source,
      evidenceType: "sold_comp",
      grade: sale.condition,
      priceUsd: sale.price,
      date: sale.date,
      title: sale.title,
      sourceUrl: sale.listingUrl ?? sale.sourceUrl,
      confidence: sale.confidence ?? "low",
      confidenceScore: sale.confidenceScore ?? 0.4,
      note: "Accepted sold listing after card identity and grade matching.",
      warning: sale.warning,
    });
  }

  const priceConsensus = buildRawPriceConsensus({
    catalogValueUsd: marketUsd,
    soldSales: salesByGrade.get("Ungraded") ?? [],
    soldReport: soldReportsByGrade.get("Ungraded"),
    snapshotCandidates,
    isJapanese: isJapaneseLookup,
  });

  if (priceConsensus) {
    const existingUngraded = gradedPrices.find((price) => price.grade === "Ungraded");

    if (existingUngraded) {
      existingUngraded.value = priceConsensus.finalEstimateUsd;
      existingUngraded.source = "Consensus estimate across trusted sources";
      existingUngraded.confidence = priceConsensus.confidence;
      existingUngraded.confidenceScore = priceConsensus.confidenceScore;
      existingUngraded.saleCount =
        priceConsensus.sampleCount > 0 ? priceConsensus.sampleCount : existingUngraded.saleCount;
      existingUngraded.warning =
        priceConsensus.confidence === "low"
          ? "Consensus is based on thin or weakly corroborated evidence."
          : undefined;
    } else {
      gradedPrices.unshift({
        grade: "Ungraded",
        value: priceConsensus.finalEstimateUsd,
        populationCount: 0,
        source: "Consensus estimate across trusted sources",
        saleCount: priceConsensus.sampleCount,
        lastSoldAt: (salesByGrade.get("Ungraded") ?? [])[0]?.date ?? null,
        service: "RAW",
        confidence: priceConsensus.confidence,
        confidenceScore: priceConsensus.confidenceScore,
        evidenceType: "sold_comp",
        sourceUrl: priceConsensus.sources.find((source) => source.evidenceType === "sold_comp")?.sourceUrl,
        warning:
          priceConsensus.confidence === "low"
            ? "Consensus is based on thin or weakly corroborated evidence."
            : undefined,
      });
    }
  }

  const psa10Usd = findPsa10Usd(gradedPrices);
  const ungradedIndex = gradedPrices.findIndex((price) => price.grade === "Ungraded");
  if (ungradedIndex >= 0 && psa10Usd > 0) {
    const currentUngraded = gradedPrices[ungradedIndex];
    const cappedRawUsd = gradedCeilingRawUsd(currentUngraded.value, psa10Usd);

    if (cappedRawUsd !== currentUngraded.value) {
      gradedPrices[ungradedIndex] = {
        ...currentUngraded,
        value: cappedRawUsd,
        confidence: "low",
        confidenceScore: Math.min(currentUngraded.confidenceScore ?? 0.4, 0.42),
        warning:
          "Raw value was capped below PSA 10 because the ungraded estimate exceeded the verified graded baseline.",
      };

      if (priceConsensus) {
        priceConsensus.finalEstimateUsd = cappedRawUsd;
        priceConsensus.confidence = "low";
        priceConsensus.confidenceScore = Math.min(priceConsensus.confidenceScore, 0.42);
        priceConsensus.methodology = `${priceConsensus.methodology} Raw estimate was capped to 45% of PSA 10 after a graded-ceiling sanity check.`;
      }
    }
  }

  const flaggedGradedPrices = flagThinGradedPrices(gradedPrices);
  gradedPrices.splice(0, gradedPrices.length, ...flaggedGradedPrices);

  const priceHistory = buildPriceHistoryFromMarketTimeline({
    salesByGrade,
    gradedPrices,
  });
  const marketHistory = classifyMarketHistory(priceHistory, recentSales);

  if (
    !hasPopulationSignal(psaPopulation) &&
    !gradedPrices.length &&
    !recentSales.length &&
    !(marketUsd > 0)
  ) {
    return null;
  }

  const finalSourceStatuses: MarketSourceStatus[] = sourceStatuses.map(
    (status): MarketSourceStatus => {
    if (status.source !== "Public sold-listing comps") {
      return status;
    }

    const retryableState = ["timeout", "circuit_open", "provider_error", "failed"].includes(
      status.state,
    );
    // Keep retryable source failures distinct from a validated no-match.
    const nextState: MarketSourceStatus["state"] =
      retryableState
        ? status.state
        : recentSales.length > 0
          ? "ready"
          : "no_match";

    const next: MarketSourceStatus = {
      ...status,
      state: nextState,
      sampleCount: recentSales.length,
      confidence: recentSales.length >= 3 ? "medium" : "low",
      confidenceScore:
        recentSales.length >= 6
          ? 0.78
          : recentSales.length >= 3
            ? 0.62
            : recentSales.length > 0
              ? 0.42
              : retryableState
                ? 0.2
                : 0.24,
      note:
        recentSales.length > 0
          ? "Accepted sold listings after identity matching, grade detection, and outlier checks."
          : retryableState
            ? status.note
            : "No sold listings passed final identity and outlier checks for this card.",
      warning:
        rejectedSales + filteredOutSales > 0
          ? `${rejectedSales + filteredOutSales} listing${
              rejectedSales + filteredOutSales === 1 ? "" : "s"
            } rejected as mismatched, altered, or weak evidence.`
          : status.warning,
    };
    return next;
  }).filter(
    (status, index, statuses) =>
      statuses.findIndex(
        (candidate) =>
          candidate.source === status.source && candidate.state === status.state,
      ) === index,
  );
  const finalMarketEvidence = marketEvidence.slice(0, 96);
  const headlineUngradedUsd =
    gradedPrices.find((price) => price.grade === "Ungraded")?.value ??
    priceConsensus?.finalEstimateUsd ??
    cachedPrice?.ungradedUsd ??
    0;
  const sanitizedNmMarketUsd = sanitizeNmMarketUsd(headlineUngradedUsd, nmMarketUsd);
  const result: LivePsaDataResult = {
    psaPopulation,
    population: psaPopulation,
    gradedPrices,
    priceHistory,
    marketHistory,
    populationBreakdown,
    recentSales,
    evidenceSummary: {
      accepted: recentSales.length,
      rejected: rejectedSales + filteredOutSales,
      thin: thinEvidenceCount,
      fallback: fallbackEvidenceCount,
      sourceStatus: finalSourceStatuses,
    },
    sourceStatus: finalSourceStatuses,
    marketEvidence: finalMarketEvidence,
    priceConsensus,
    nmMarketUsd: sanitizedNmMarketUsd,
  };

  writeCachedMarketResult(cacheKey, result, {
    language: options.language,
    setCode: options.setCode,
  });
  writeGradingConsensusIntoPriceCache({
    result,
    cardName: lookupCardName,
    cardNumber,
    options,
    nmMarketUsd: sanitizedNmMarketUsd,
  });
  return result;
}

async function fetchPriorityPriceChartingGuide(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
) {
  const variants = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting", options);
  const setSlugs = await resolveGuideSetSlugs(setName, options);
  const isJapanese = options.language === "ja" || options.isJapanese;
  const { productUrl } = priceChartingIdentityFields(options);
  const priorityUrls = [
    ...new Set(
      [
        productUrl,
        ...setSlugs.flatMap((setSlug) =>
          nameSlugs.flatMap((nameSlug) =>
            variants
              .slice(0, isJapanese ? 4 : 3)
              .map(
                (variant) =>
                  `https://www.pricecharting.com/game/${setSlug}/${nameSlug}-${variant}`,
              ),
          ),
        ),
      ].filter((url): url is string => Boolean(url)),
    ),
  ].slice(0, isJapanese ? 10 : 8);
  const merged = new Map<string, GradedPrice>();
  const visited = new Set<string>();

  const ingestGuideHtml = async (url: string) => {
    if (visited.has(url)) {
      return;
    }
    visited.add(url);

    const html = await fetchHtml(url);
    const resolved = await resolvePriceChartingGuideCandidates(html, url, cardName, cardNumber);

    for (const [grade, price] of resolved.prices.entries()) {
      if (shouldPreferIncomingPriceSnapshot(price, merged.get(grade))) {
        merged.set(grade, price);
      }
    }

    for (const followUpUrl of resolved.followUpUrls.slice(0, 4)) {
      if (merged.size >= 3) {
        break;
      }

      try {
        await ingestGuideHtml(followUpUrl);
      } catch {
        continue;
      }
    }
  };

  for (const url of priorityUrls) {
    try {
      await ingestGuideHtml(url);

      // Require a real grade grid (not a lone search-list Ungraded) before stopping.
      if (merged.size >= 3 && (merged.get("Ungraded")?.value ?? 0) > 0) {
        return merged;
      }
    } catch {
      continue;
    }
  }

  return merged;
}

export async function fetchQuickLocalizedGuidePrice(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
) {
  // Fastest first for localized cards: the shared SET-LEVEL guide snapshot. One
  // console-page fetch covers the whole set, so per-card lookups here are file
  // cache reads that fit comfortably inside the browse pass's ~800ms card race.
  try {
    const language = options.language ?? (options.isJapanese ? "ja" : "en");

    if (language !== "en") {
      const { lookupPriceChartingSetGuidePrice } = await import(
        "@/lib/market/pricecharting-set-guide.server"
      );
      const exactIdentity = priceChartingIdentityFields(options);
      const setGuide = await lookupPriceChartingSetGuidePrice({
        language,
        setCode: options.setCode,
        setName,
        setEnglishName: setName,
        collectorNumber: cardNumber,
        englishName:
          options.englishCardName?.trim() ||
          (/[a-z]/i.test(cardName) ? cardName : undefined),
        ...exactIdentity,
      });

      if (setGuide?.ungradedUsd) {
        return {
          ungradedUsd: setGuide.ungradedUsd,
          gradedPrices: setGuide.gradedPrices ?? [],
        };
      }
    }
  } catch {
    // Fall through to the per-card pipeline below.
  }

  // Prefer the block-resistant cache-first pipeline (same path as /api/price):
  // TCGdex / PokemonTCG / optional PriceCharting API — never HTML scrapes.
  // Set browse used to call the public-page scraper for every card and trip 429s.
  try {
    const { resolvePrice } = await import("@/lib/price/resolve.server");
    const language = options.language ?? (options.isJapanese ? "ja" : "en");
    const exactIdentity = priceChartingIdentityFields(options);
    const slugSeed = [
      options.setCode?.trim() || setName,
      cardNumber,
      cardName,
      language,
    ]
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const resolved = await resolvePrice(
      {
        slug: slugSeed || `guide-${cardNumber}`,
        language,
        setCode: options.setCode,
        setName,
        setEnglishName: setName,
        collectorNumber: cardNumber,
        name: cardName,
        englishName: options.englishCardName?.trim() || cardName,
        ...exactIdentity,
      },
      { allowScrape: false },
    );

    if (resolved.ungradedUsd > 0) {
      return {
        ungradedUsd: resolved.ungradedUsd,
        gradedPrices: resolved.results.flatMap((result) => result.gradedPrices ?? []),
      };
    }
  } catch {
    // Fall through to the scrape path only when APIs/cache miss entirely.
  }

  if (options.allowScrape === false) {
    return null;
  }

  // Scrape fallback is last-resort (detail/warmer style). Search/set-browse
  // callers race this with a short timeout, so a circuit-open host fails fast.
  const guides = await fetchPriorityPriceChartingGuide(
    setName,
    cardName,
    cardNumber,
    setTotal,
    options,
  );
  const ungraded = guides.get("Ungraded")?.value ?? 0;

  if (!(ungraded > 0)) {
    return null;
  }

  return {
    ungradedUsd: ungraded,
    gradedPrices: [...guides.values()],
  };
}

export async function fetchPriceChartingProductImageUrl(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
) {
  const variants = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting", options);
  const setSlugs = priceChartingSetSlugVariants(setName, options);
  const { productUrl } = priceChartingIdentityFields(options);
  const priorityUrls = [
    ...new Set(
      [
        productUrl,
        ...setSlugs.flatMap((setSlug) =>
          nameSlugs.flatMap((nameSlug) =>
            variants
              .slice(0, 2)
              .map(
                (variant) =>
                  `https://www.pricecharting.com/game/${setSlug}/${nameSlug}-${variant}`,
              ),
          ),
        ),
      ].filter((url): url is string => Boolean(url)),
    ),
  ].slice(0, 4);

  for (const url of priorityUrls) {
    try {
      const html = await fetchHtml(url);
      const match =
        html.match(
          /https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^"'\\s]+?\/1600\.jpg/i,
        ) ??
        html.match(
          /https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^"'\\s]+?\/240\.jpg/i,
        );

      if (match?.[0]) {
        return match[0];
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function getPrimaryPsaPopulationLabel(snapshot: PsaPopulationSnapshot) {
  const psa10 = snapshot.grades.find((grade) => grade.grade === "PSA 10");

  if (psa10) {
    return `PSA 10 Pop ${psa10.count.toLocaleString()}`;
  }

  const cgc10 = snapshot.grades.find((grade) => grade.grade === "CGC 10");

  if (cgc10) {
    return `CGC 10 Pop ${cgc10.count.toLocaleString()}`;
  }

  const psa9 = snapshot.grades.find((grade) => grade.grade === "PSA 9");

  if (psa9) {
    return `PSA 9 Pop ${psa9.count.toLocaleString()}`;
  }

  const cgc9 = snapshot.grades.find((grade) => grade.grade === "CGC 9");

  if (cgc9) {
    return `CGC 9 Pop ${cgc9.count.toLocaleString()}`;
  }

  if (typeof snapshot.totalCertified === "number") {
    const serviceLabel = snapshot.service === "CGC" ? "CGC" : "PSA";
    return `${serviceLabel} Total ${snapshot.totalCertified.toLocaleString()}`;
  }

  return "Population unavailable";
}
