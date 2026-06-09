import {
  getHeadlineMarketPriceUsd,
  getPriceChartingSetSlugVariants,
  getSetMarketAliases,
  isTrustedCatalogMarketPrice,
  shouldPreserveCatalogMarketPrice,
} from "@/lib/localized-set-market";
import type {
  GradedPrice,
  GradingService,
  MarketEvidence,
  MarketConfidence,
  MarketSourceStatus,
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
};

const PUBLIC_FETCH_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const PUBLIC_PAGE_TIMEOUT_MS = 10_000;
const PUBLIC_READER_TIMEOUT_MS = 6_000;
const PUBLIC_PAGE_MAX_ATTEMPTS = 1;
// Budgets that cap how long the live market gather can block. Core (price, population,
// graded values) is returned fast; sold comps load with a larger budget in the background.
const CORE_SOURCE_BUDGET_MS = 3_500;
const FULL_SOURCE_BUDGET_MS = 22_000;
const POPULATION_SOURCE_BUDGET_MS = 12_000;

const GRADING_KEYWORDS =
  /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|GRADED|SLAB|BLACK LABEL|PRISTINE|GEM MINT|AUTHENTIC)\b/i;

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
  recentSales?: SaleRecord[];
  evidenceSummary: NonNullable<TcgCard["evidenceSummary"]>;
  sourceStatus: MarketSourceStatus[];
  marketEvidence: MarketEvidence[];
  priceConsensus?: PriceConsensus;
};

type ConsensusObservation = PriceConsensusSource & {
  weight: number;
};

type RejectedReasonCounts = Record<string, number>;

type SoldCompParseResult = {
  accepted: SaleRecord[];
  rejected: number;
  rejectedReasonCounts: RejectedReasonCounts;
};

type PriceChartingPopulationResult = {
  population: PsaPopulationSnapshot;
  gradedPrices: Map<string, GradedPrice>;
  discoveredItemUrls?: string[];
  matchScore?: number;
  sourceKind: "item" | "set_index";
};

const MARKET_RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const marketResultCache = new Map<
  string,
  { expiresAt: number; value: LivePsaDataResult }
>();

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

function marketCacheKey(
  setName: string,
  cardName: string,
  cardNumber: string,
  rawMarketPriceUsd?: number,
  setTotal?: number,
  cardRarity?: string,
  language?: string,
  setCode?: string,
  skipSoldComps?: boolean,
) {
  return [
    "v12-headline-price-sync",
    skipSoldComps ? "core" : "full",
    (language ?? "en").toLowerCase(),
    (setCode ?? "").toLowerCase(),
    normalizeCardName(setName).toLowerCase(),
    normalizeCardName(cardName).toLowerCase(),
    cardNumber.trim().toLowerCase(),
    typeof setTotal === "number" ? setTotal : "",
    normalizeCardName(cardRarity ?? "").toLowerCase(),
    typeof rawMarketPriceUsd === "number" && Number.isFinite(rawMarketPriceUsd)
      ? rawMarketPriceUsd.toFixed(2)
      : "",
  ].join("|");
}

function shouldUseAppMarketCache() {
  return process.env.MARKET_DATA_CACHE !== "false";
}

function cloneMarketResult(result: LivePsaDataResult): LivePsaDataResult {
  return structuredClone(result);
}

function readCachedMarketResult(cacheKey: string): LivePsaDataResult | null {
  if (!shouldUseAppMarketCache()) {
    return null;
  }

  const cached = marketResultCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    marketResultCache.delete(cacheKey);
    return null;
  }

  const value = cloneMarketResult(cached.value);
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

function writeCachedMarketResult(cacheKey: string, value: LivePsaDataResult) {
  if (!shouldUseAppMarketCache()) {
    return;
  }

  marketResultCache.set(cacheKey, {
    expiresAt: Date.now() + MARKET_RESULT_CACHE_TTL_MS,
    value: cloneMarketResult(value),
  });
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

function centsToUsd(value: unknown) {
  const cents =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(cents) || cents <= 0) {
    return null;
  }

  return cents / 100;
}

function slugify(text: string) {
  return text
    .replace(/[\u2605\u2606]/g, " star ")
    .replace(/Γÿà|γÿà|â˜…|â˜†|★|☆/g, " star ")
    .replace(/[★☆]/g, " star ")
    .normalize("NFKD")
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
  return getPriceChartingSetSlugVariants(setName, options);
}

function cardNameSlugVariantsForExternalApis(
  cardName: string,
  preferred: "standard" | "pricecharting" = "standard",
) {
  const normalized = normalizeCardName(cardName);
  const starAlias = /\bgold star\b/i.test(normalized)
    ? normalized.replace(/\bgold star\b/i, "Star")
    : normalized.replace(/\bstar\b/i, "Gold Star");
  const ampersandSlug = normalized.includes("&") ? priceChartingAmpersandSlug(normalized) : "";
  const ampersandStarSlug =
    starAlias.includes("&") && starAlias !== normalized
      ? priceChartingAmpersandSlug(starAlias)
      : "";
  const candidates =
    preferred === "pricecharting"
      ? [
          ampersandSlug,
          priceChartingSlugify(normalized),
          slugify(normalized),
          ampersandStarSlug,
          priceChartingSlugify(starAlias),
          slugify(starAlias),
        ]
      : [
          ampersandSlug,
          slugify(normalized),
          priceChartingSlugify(normalized),
          ampersandStarSlug,
          slugify(starAlias),
          priceChartingSlugify(starAlias),
        ];

  return [...new Set(candidates.filter(Boolean))];
}

function numberSlugVariantsForExternalApis(
  collectorNumber: string,
  setTotal?: number,
): string[] {
  const raw = collectorNumber.trim();
  const primary = slugify(raw.replace(/^0+/, ""));
  const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
  const variants = new Set<string>([primary]);
  const baseNumber = parts[0]?.replace(/^0+/, "") || raw.replace(/^0+/, "") || raw;

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
  }

  const ordered = [...variants];

  if (baseNumber) {
    const baseSlug = slugify(baseNumber);

    if (baseSlug && ordered[0] !== baseSlug) {
      return [baseSlug, ...ordered.filter((variant) => variant !== baseSlug)];
    }
  }

  return ordered;
}

function buildPriceChartingGameUrl(
  setName: string,
  cardNameSlug: string,
  collectorNumberSlug: string,
  options: ExternalMarketLookupOptions = {},
) {
  const setSlug =
    priceChartingSetSlugVariants(setName, options)[0] ??
    `pokemon-${priceChartingSlugify(setName)}`;

  return `https://www.pricecharting.com/game/${setSlug}/${cardNameSlug}-${collectorNumberSlug}`;
}

function buildPriceChartingPopulationItemUrls(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
) {
  const setSlugs = priceChartingSetSlugVariants(setName, options);
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting");
  const numberSlugs = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const urls = setSlugs.flatMap((setSlug) =>
    nameSlugs.flatMap((nameSlug) =>
      numberSlugs.map(
        (numberSlug) =>
          `https://www.pricecharting.com/pop/item/${setSlug}/${nameSlug}-${numberSlug}`,
      ),
    ),
  );

  return [...new Set(urls)].slice(0, 18);
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
    suspiciousSignals.push("Thin sold sample disagrees strongly with the public market snapshot.");
  }

  const depth = trustedPrices.length;
  let calculatedValueUsd =
    depth >= 4
      ? medianUsd * 0.36 + trimmedAverageUsd * 0.29 + recencyWeightedUsd * 0.35
      : depth >= 2
        ? medianUsd * 0.46 + trimmedAverageUsd * 0.34 + recencyWeightedUsd * 0.2
        : prices[0];

  if (snapshot?.value && snapshot.value > 0 && depth < 4) {
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
}: {
  catalogValueUsd: number;
  soldSales: SaleRecord[];
  soldReport?: SoldCompReport;
  snapshotCandidates: GradedPrice[];
}): PriceConsensus | undefined {
  const observations: ConsensusObservation[] = [];

  if (catalogValueUsd >= 1) {
    const confidenceScore = 0.64;
    observations.push({
      source: "PokemonTCG catalog market",
      value: catalogValueUsd,
      confidence: confidenceFromScore(confidenceScore),
      confidenceScore,
      evidenceType: "catalog",
      note:
        "Live raw market value from the catalog feed. Useful as a baseline, but less authoritative than fresh sold comps.",
      weight: sourceWeightFromConfidence(confidenceScore),
    });
  }

  if (soldSales.length) {
    const confidenceScore = Math.min(
      0.94,
      soldSales.length >= 6
        ? 0.9
        : soldSales.length >= 4
          ? 0.84
          : soldSales.length >= 2
            ? 0.72
            : 0.46,
    );
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

    const confidenceScore =
      snapshot.confidenceScore ??
      (snapshot.source?.includes("TCGFish") ? 0.58 : 0.52);
    observations.push({
      source: snapshot.source ?? "Public market snapshot",
      value: snapshot.value,
      confidence: snapshot.confidence ?? confidenceFromScore(confidenceScore),
      confidenceScore,
      evidenceType: snapshot.evidenceType ?? "guide_snapshot",
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
  // Keep the headline raw price consistent with the catalog value that Card Dex / search
  // displays. Public guide snapshots alone (no robust sold-comp evidence) must not pull the
  // displayed market price far from the catalog price — unless the catalog value is clearly a
  // placeholder/rarity floor and independent Japanese-market guides agree on a higher price.
  if (catalogValueUsd >= 1 && soldSales.length < 2) {
    const guideValues = snapshotCandidates
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
    const lowGuide = guideValues[0] ?? 0;
    const highGuide = guideValues[guideValues.length - 1] ?? 0;
    const guidesCorroborate =
      guideValues.length >= 2 && lowGuide > 0 && highGuide / lowGuide <= 1.6;
    const catalogLooksLikePlaceholder = catalogValueUsd < lowGuide * 0.45;

    if (guidesCorroborate && catalogLooksLikePlaceholder) {
      finalEstimateUsd = Math.round(finalEstimateUsd * 100) / 100;
    } else {
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
  const confidenceScore = Math.min(
    0.95,
    filteredObservations.reduce(
      (sum, item) => sum + item.confidenceScore * (item.weight / totalWeight),
      0,
    ) +
      diversityBonus +
      soldWeightShare * 0.08,
  );

  return {
    finalEstimateUsd,
    confidence: confidenceFromScore(confidenceScore),
    confidenceScore,
    sourceCount,
    sampleCount,
    methodology:
      "Weighted consensus across trusted public sources. Accepted sold listings are reduced into a median/average/recency-weighted report before being blended with catalog and public guide snapshots.",
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
      isProjected: existing.isProjected || point.isProjected,
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
    .replace(/&#39;/g, "'")
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

function gradeTokenRegex(grade: string | number) {
  return String(grade).replace(".", "\\.?");
}

function hasServiceGrade(title: string, servicePattern: string, grade: string | number) {
  const token = gradeTokenRegex(grade);
  const serviceThenGrade = new RegExp(`\\b${servicePattern}\\b[\\s:#-]{0,10}\\b${token}\\b`, "i");
  const gradeThenService = new RegExp(`\\b${token}\\b[\\s:#-]{0,10}\\b${servicePattern}\\b`, "i");

  return serviceThenGrade.test(title) || gradeThenService.test(title);
}

function hasBadSaleTitleSignals(title: string) {
  return /\b(lot|bundle|collection|pack|packs|box|booster|case|set of|mystery|proxy|reprint|custom|digital|code card|altered)\b/i.test(title);
}

function tokenizeForMatching(text: string) {
  return normalizeCardName(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
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
    groups.add("special-illustration");
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

function matchesCondition(title: string, condition: string) {
  const normalizedTitle = title.toUpperCase();

  if (condition === "Ungraded") {
    return !GRADING_KEYWORDS.test(normalizedTitle);
  }

  const gradeMatch = condition.match(/^(PSA|BGS|CGC|SGC|TAG)\s+(\d+(?:\.5)?)/);

  if (gradeMatch) {
    const [, service, grade] = gradeMatch;
    const servicePattern = service === "BGS" ? "(?:BGS|BECKETT)" : service;

    if (!hasServiceGrade(normalizedTitle, servicePattern, grade)) {
      return false;
    }

    if (condition === "BGS 10") {
      return !/BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle);
    }

    if (condition === "CGC 10") {
      return !/PRIST/i.test(normalizedTitle);
    }

    return true;
  }

  if (condition === "BGS 10 Black") {
    return /\b(BGS|BECKETT)\b/.test(normalizedTitle) && /BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle);
  }

  if (condition === "BGS 10") {
    return (
      /\b(BGS|BECKETT)\b/.test(normalizedTitle) &&
      /\b10\b/.test(normalizedTitle) &&
      !/BLACK\s+LABEL|BLACK\b/i.test(normalizedTitle)
    );
  }

  if (condition === "BGS 9.5") {
    return /\b(BGS|BECKETT)\b/.test(normalizedTitle) && /\b9\.?5\b/.test(normalizedTitle);
  }

  if (condition === "CGC 10 Pristine") {
    return /\bCGC\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle) && /PRIST/i.test(normalizedTitle);
  }

  if (condition === "CGC 10") {
    return (
      /\bCGC\b/.test(normalizedTitle) &&
      /\b10\b/.test(normalizedTitle) &&
      !/PRIST/i.test(normalizedTitle)
    );
  }

  if (condition === "CGC 9.5") {
    return /\bCGC\b/.test(normalizedTitle) && /\b9\.?5\b/.test(normalizedTitle);
  }

  if (condition === "TAG 10") {
    return /\bTAG\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle);
  }

  if (condition === "SGC 10") {
    return /\bSGC\b/.test(normalizedTitle) && /\b10\b/.test(normalizedTitle);
  }

  return normalizedTitle.includes(condition.toUpperCase());
}

function detectSaleCondition(title: string) {
  const normalizedTitle = title.toUpperCase();

  for (const grade of WHOLE_GRADES) {
    if (hasServiceGrade(normalizedTitle, "PSA", grade)) {
      return `PSA ${grade}`;
    }
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

  return "Ungraded";
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

  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const cardNumberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const collectorNumbers = extractCollectorNumbers(title);
  const collectorVariants = new Set([
    cardNumber.toLowerCase(),
    cardNumberBase.toLowerCase(),
    ...(typeof setTotal === "number" && setTotal > 0
      ? [`${cardNumberBase}/${setTotal}`.toLowerCase()]
      : []),
  ]);

  const nameMatchCount = nameTokens.filter((token) => titleTokens.has(token)).length;
  const hasCardNumber =
    titleTokens.has(cardNumber.toLowerCase()) ||
    titleTokens.has(cardNumberBase.toLowerCase()) ||
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
    isStrongVintageSaleTitle(title, cardName, cardNumber, setName, setTotal, cardRarity)
  );
}

function extractCollectorNumbers(title: string) {
  return [...title.matchAll(/\b(\d{1,3}(?:\/\d{1,3})?)\b/g)].map((match) => match[1].toLowerCase());
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
  const collectorVariants = new Set([
    cardNumber.toLowerCase(),
    cardNumberBase.toLowerCase(),
    numberWithTotal,
  ].filter(Boolean));
  const nameMatchCount = nameTokens.filter((token) => titleTokens.has(token)).length;
  const hasCardNumber =
    titleTokens.has(cardNumber.toLowerCase()) ||
    titleTokens.has(cardNumberBase.toLowerCase()) ||
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

function isStrongVintageSaleTitle(
  title: string,
  cardName: string,
  cardNumber: string,
  setName: string,
  setTotal?: number,
  cardRarity?: string,
) {
  const signals = saleIdentitySignals(title, cardName, cardNumber, setName, setTotal, cardRarity);

  if (signals.hasRarityConflict) {
    return false;
  }

  if (signals.nameMatchCount < Math.max(1, signals.requiredNameMatches)) {
    return false;
  }

  if (!signals.hasCardNumber) {
    return false;
  }

  return signals.hasSetSignal || signals.hasExactNumberWithTotal || signals.hasStarSignal;
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
  const cardNumberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const collectorNumbers = extractCollectorNumbers(normalizedTitle);
  const collectorVariants = new Set([
    cardNumber.toLowerCase(),
    cardNumberBase.toLowerCase(),
    ...(typeof setTotal === "number" && setTotal > 0
      ? [`${cardNumberBase}/${setTotal}`.toLowerCase()]
      : []),
  ]);
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
  } else if (collectorNumbers.includes(cardNumberBase.toLowerCase())) {
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

  for (const phrase of conflictPhrases) {
    if (
      normalizedTitle.includes(phrase) &&
      !normalizedSetName.includes(phrase) &&
      !(phrase === "promo" && isPromoCompatibleSet(setName))
    ) {
      score -= 5;
    }
  }

  return score;
}

function hasConflictingSetMarker(title: string, setName: string) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const promoCompatibleSet = isPromoCompatibleSet(setName);
  const conflictPhrases = [
    "celebrations",
    "classic collection",
    "black star promo",
    "sv promo",
  ];

  return conflictPhrases.some(
    (phrase) =>
      normalizedTitle.includes(phrase) &&
      !normalizedSetName.includes(phrase) &&
      !(phrase === "promo" && promoCompatibleSet),
  );
}

async function fetchHtml(url: string) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PUBLIC_PAGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: PUBLIC_FETCH_HEADERS,
        next: { revalidate: 43_200 },
        signal: AbortSignal.timeout(PUBLIC_PAGE_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          try {
            return await fetchReaderText(url);
          } catch (readerError) {
            throw new Error(
              `Public page request failed: ${response.status}; reader fallback failed: ${errorMessage(readerError)}`,
            );
          }
        }

        const retriable =
          response.status === 429 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (retriable && attempt < PUBLIC_PAGE_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }

        throw new Error(`Public page request failed: ${response.status}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;

      if (attempt < PUBLIC_PAGE_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Public page request failed");
}

async function fetchReaderText(url: string) {
  const readerUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(readerUrl, {
    headers: {
      Accept: "text/plain, text/markdown, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": PUBLIC_FETCH_HEADERS["User-Agent"],
    },
    next: { revalidate: 43_200 },
    signal: AbortSignal.timeout(PUBLIC_READER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Reader fallback request failed: ${response.status}`);
  }

  const text = await response.text();

  if (text.length < 200 || isLikelyBotWallHtml(text)) {
    throw new Error("Reader fallback did not return usable text");
  }

  return text;
}

function buildSoldCompQueries(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  cardRarity?: string,
  options: { setCode?: string; isJapanese?: boolean; language?: string } = {},
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
    const regionalQueries = [
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

  return [...queries].filter(Boolean);
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

  return {
    status: grades.length || typeof totalCertified === "number" ? "verified" : "pending",
    totalCertified,
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
  const match = html.match(/VGPC\.pop_price_data\s*=\s*(\{[\s\S]*?\});/);

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
  const usePsaOnly = psaTotal > 0;
  const useCgcOnly = psaTotal === 0 && cgcTotal > 0;
  const grades: PsaPopulationSnapshot["grades"] = [];
  const gradedPrices = new Map<string, GradedPrice>();
  let totalCertified = 0;

  for (let index = 0; index < 10; index += 1) {
    const gradeNum = index + 1;
    const psaCount = psaCounts[index] ?? 0;
    const cgcCount = cgcCounts[index] ?? 0;
    const count = usePsaOnly ? psaCount : cgcCount;

    if (count <= 0) {
      continue;
    }

    const gradeLabel = usePsaOnly ? `PSA ${gradeNum}` : `CGC ${gradeNum}`;
    const service: GradingService = usePsaOnly ? "PSA" : "CGC";
    grades.push({
      grade: gradeLabel,
      count,
      service,
      confidence: usePsaOnly ? "medium" : "medium",
      confidenceScore: usePsaOnly ? 0.72 : 0.68,
      evidenceType: "population",
      sourceUrl: url,
      warning: useCgcOnly
        ? "PSA column was empty on the item report; counts are CGC submissions for this grade."
        : undefined,
    });
    totalCertified += count;

    const rawPrice = priceCents[index] ?? 0;

    if (usePsaOnly && psaCount > 0 && rawPrice > 0) {
      gradedPrices.set(gradeLabel, {
        grade: gradeLabel,
        value: rawPrice / 100,
        populationCount: psaCount,
        source: "PriceCharting population PSA price snapshot",
        saleCount: 0,
        lastSoldAt: null,
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.66,
        evidenceType: "guide_snapshot",
        sourceUrl: url,
        warning:
          "Exact public PSA population report price snapshot; accepted sold comps still take precedence when available.",
      });
    }
  }

  if (!grades.length) {
    return null;
  }

  return {
    population: {
      status: "verified",
      totalCertified: totalCertified > 0 ? totalCertified : null,
      grades,
      source: "PriceCharting public population report",
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      note: usePsaOnly
        ? "PSA grade counts were parsed from PriceCharting's embedded population report data."
        : "CGC grade counts were parsed from PriceCharting's embedded population report because this card has no PSA submissions in the item report.",
      service: usePsaOnly ? "PSA" : "CGC",
      confidence: usePsaOnly ? "medium" : "medium",
      confidenceScore: usePsaOnly ? 0.72 : 0.68,
      evidenceType: "population",
      warning: useCgcOnly
        ? "This card has zero PSA submissions in the item report; displayed counts are CGC population only."
        : undefined,
    },
    gradedPrices,
    sourceKind: "item",
  };
}

function isPlausibleParsedPopulation(snapshot: PsaPopulationSnapshot) {
  if (!snapshot.grades.length) {
    return false;
  }

  const gradeSum = snapshot.grades.reduce((sum, grade) => sum + grade.count, 0);

  if (gradeSum <= 0) {
    return false;
  }

  if (typeof snapshot.totalCertified === "number" && snapshot.totalCertified > 0) {
    return gradeSum <= snapshot.totalCertified && gradeSum >= snapshot.totalCertified * 0.85;
  }

  return snapshot.grades.length >= 3;
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
        source: "PriceCharting population PSA price snapshot",
        saleCount: 0,
        lastSoldAt: null,
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.66,
        evidenceType: "guide_snapshot",
        sourceUrl: url,
        warning:
          "Exact public PSA population report price snapshot; accepted sold comps still take precedence when available.",
      });
    }
  };

  const markdownRowRegex =
    /\|\s*(10|9|8|7|6|5|4|3|2|1)\s*\|\s*([0-9][0-9,]*)\s*\|\s*(?:-|[0-9][0-9,]*)\s*\|\s*([0-9][0-9,]*)\s*\|\s*(?:\$([0-9,.]+))?\s*\|/g;

  for (const match of text.matchAll(markdownRowRegex)) {
    pushRow({
      grade: parseInteger(match[1]),
      count: parseInteger(match[2]),
      rowTotal: parseInteger(match[3]),
      value: match[4] ? parseUsd(match[4]) : null,
      service: "PSA",
    });
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
    const count = psaCount > 0 ? psaCount : cgcCount;
    const service: GradingService = psaCount > 0 ? "PSA" : "CGC";

    if (count <= 0 || rowTotal < count) {
      continue;
    }

    pushRow({
      grade,
      count,
      rowTotal,
      value: rowMatch[4] ? parseUsd(rowMatch[4]) : null,
      service,
    });
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
        totalCertified: null,
        grades: [],
        confidence: "low",
        confidenceScore: 0.2,
        warning: "The public population page did not expose a trustworthy grade table for this card.",
      },
      gradedPrices: new Map(),
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

function populationQualityScore(snapshot: PsaPopulationSnapshot) {
  const gradeCoverageScore = snapshot.grades.length * 12;
  const totalScore = typeof snapshot.totalCertified === "number" ? 8 : 0;
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

async function tryParsePriceChartingPopulationUrl(
  url: string,
): Promise<PriceChartingPopulationResult | null> {
  try {
    const html = await fetchHtml(url);
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

    return parsed;
  } catch {
    return null;
  }
}

async function fetchPriceChartingPopulationWithVariants(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
): Promise<PriceChartingPopulationResult | null> {
  const directUrls = buildPriceChartingPopulationItemUrls(
    setName,
    cardName,
    cardNumber,
    setTotal,
    options,
  );
  const setIndexUrls = buildPriceChartingSetPopulationUrls(setName, options);
  const candidates: PriceChartingPopulationResult[] = [];

  for (const url of directUrls.slice(0, 4)) {
    const parsed = await tryParsePriceChartingPopulationUrl(url);

    if (!parsed) {
      continue;
    }

    candidates.push(parsed);

    if ((parsed.population.confidenceScore ?? 0) >= 0.68) {
      const best = chooseBestPriceChartingPopulationResult(candidates);

      if (best) {
        return best;
      }
    }
  }

  const remainingDirectUrls = directUrls.slice(4);
  const directResults = await Promise.allSettled(
    remainingDirectUrls.map((url) => fetchHtml(url)),
  );
  const setIndexResults = await Promise.allSettled(setIndexUrls.map((url) => fetchHtml(url)));
  const firstError = [...directResults, ...setIndexResults].find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )?.reason;
  const fulfilledCount = [...directResults, ...setIndexResults].filter(
    (result) => result.status === "fulfilled",
  ).length;

  for (let index = 0; index < remainingDirectUrls.length; index += 1) {
    const outcome = directResults[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const parsed = parsePriceChartingPopulation(outcome.value, remainingDirectUrls[index]);

    if (
      parsed.population.totalCertified !== null ||
      parsed.population.grades.length ||
      parsed.gradedPrices.size
    ) {
      candidates.push(parsed);
    }
  }

  for (let index = 0; index < setIndexUrls.length; index += 1) {
    const outcome = setIndexResults[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const parsed = parsePriceChartingSetPopulationIndex(
      outcome.value,
      setIndexUrls[index],
      cardName,
      cardNumber,
      setTotal,
    );

    if (parsed) {
      candidates.push(parsed);
    }
  }

  const discoveredUrls = [
    ...new Set(candidates.flatMap((candidate) => candidate.discoveredItemUrls ?? [])),
  ].filter((url) => !directUrls.includes(url)).slice(0, 6);

  if (discoveredUrls.length) {
    const discoveredResults = await Promise.allSettled(
      discoveredUrls.map((url) => fetchHtml(url)),
    );

    for (let index = 0; index < discoveredUrls.length; index += 1) {
      const outcome = discoveredResults[index];

      if (outcome.status !== "fulfilled") {
        continue;
      }

      const parsed = parsePriceChartingPopulation(outcome.value, discoveredUrls[index]);

      if (
        parsed.population.totalCertified !== null ||
        parsed.population.grades.length ||
        parsed.gradedPrices.size
      ) {
        candidates.push({
          ...parsed,
          matchScore: 20,
        });
      }
    }
  }

  const best = chooseBestPriceChartingPopulationResult(candidates);

  if (best) {
    return best;
  }

  if (fulfilledCount === 0 && firstError) {
    throw firstError;
  }

  return null;
}

async function loadBestTcgFishPage(
  setSlug: string,
  nameSlugs: string[],
  cardNumber: string,
  setTotal?: number,
): Promise<{ html: string; url: string } | null> {
  const variants = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const urls = nameSlugs.flatMap((nameSlug) =>
    variants.map((variant) => buildTcgFishCardUrl(setSlug, nameSlug, variant)),
  );
  const results = await Promise.allSettled(urls.map((url) => fetchHtml(url)));
  let best: { html: string; url: string; score: number } | null = null;
  const firstError = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )?.reason;
  const fulfilledCount = results.filter((result) => result.status === "fulfilled").length;

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const html = outcome.value;

    if (isLikelyBotWallHtml(html)) {
      continue;
    }

    const previewPopulation = parseTcgFishPopulation(html, urls[index]);
    const previewSnapshots = parseTcgFishGradeSnapshots(html, previewPopulation);
    const score =
      previewPopulation.grades.length * 14 +
      (typeof previewPopulation.totalCertified === "number" ? 10 : 0) +
      previewSnapshots.size * 5 +
      (html.includes("ecom-population") ? 4 : 0);

    if (!best || score > best.score) {
      best = { html, url: urls[index], score };
    }
  }

  if (best && best.score > 0) {
    return { html: best.html, url: best.url };
  }

  if (fulfilledCount === 0 && firstError) {
    throw firstError;
  }

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status === "fulfilled" && !isLikelyBotWallHtml(outcome.value)) {
      return { html: outcome.value, url: urls[index] };
    }
  }

  return null;
}

async function mergePriceChartingGuidesFromVariants(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
  options: ExternalMarketLookupOptions = {},
) {
  const variants = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting");
  const setSlugs = priceChartingSetSlugVariants(setName, options);
  const urls = setSlugs.flatMap((setSlug) =>
    nameSlugs.flatMap((nameSlug) =>
      variants.map(
        (variant) =>
          `https://www.pricecharting.com/game/${setSlug}/${nameSlug}-${variant}`,
      ),
    ),
  );
  const results = await Promise.allSettled(urls.map((url) => fetchHtml(url)));
  const merged = new Map<string, GradedPrice>();
  const firstError = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )?.reason;
  const fulfilledCount = results.filter((result) => result.status === "fulfilled").length;

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const guidePrices = parsePriceChartingGradedGuide(outcome.value, urls[index]);

    for (const [grade, price] of guidePrices.entries()) {
      if (shouldPreferIncomingPriceSnapshot(price, merged.get(grade))) {
        merged.set(grade, price);
      }
    }
  }

  if (fulfilledCount === 0 && firstError) {
    throw firstError;
  }

  return merged;
}

function priceChartingApiQuery(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
) {
  const numberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const numberWithTotal =
    typeof setTotal === "number" && setTotal > 0 ? `${numberBase}/${setTotal}` : "";

  return [
    "pokemon",
    normalizeCardName(cardName),
    numberWithTotal || `#${numberBase}`,
    normalizeCardName(setName),
  ]
    .filter(Boolean)
    .join(" ");
}

function pushPriceChartingApiPrice({
  prices,
  evidence,
  grade,
  value,
  sourceUrl,
}: {
  prices: Map<string, GradedPrice>;
  evidence: MarketEvidence[];
  grade: string;
  value: number | null;
  sourceUrl: string;
}) {
  if (value == null || !Number.isFinite(value) || value <= 0 || prices.has(grade)) {
    return;
  }

  prices.set(grade, {
    grade,
    value,
    populationCount: 0,
    source: "PriceCharting API current snapshot",
    saleCount: 0,
    lastSoldAt: null,
    service: gradeService(grade),
    confidence: "medium",
    confidenceScore: 0.66,
    evidenceType: grade === "Ungraded" ? "catalog" : "guide_snapshot",
    sourceUrl,
    warning:
      "Current guide snapshot from the API; it is not historic sold-listing data.",
  });
  evidence.push({
    id: `pricecharting-api-${slugify(grade)}`,
    source: "PriceCharting API",
    evidenceType: grade === "Ungraded" ? "catalog" : "guide_snapshot",
    grade,
    priceUsd: value,
    sourceUrl,
    confidence: "medium",
    confidenceScore: 0.66,
    note: "Current API value, used as reference evidence and not plotted as historic sold history.",
    warning: "Snapshot only",
  });
}

async function fetchPriceChartingApiSnapshot(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
): Promise<{
  gradedPrices: Map<string, GradedPrice>;
  sourceStatus: MarketSourceStatus;
  marketEvidence: MarketEvidence[];
}> {
  const token = process.env.PRICECHARTING_TOKEN?.trim();
  const gradedPrices = new Map<string, GradedPrice>();
  const marketEvidence: MarketEvidence[] = [];

  if (!token) {
    return {
      gradedPrices,
      marketEvidence,
      sourceStatus: sourceStatus({
        source: "PriceCharting API (optional)",
        state: "disabled",
        confidence: "low",
        confidenceScore: 0.2,
        note: "Paid API lookup skipped. Free public guide, population, catalog, and sold-listing sources are still checked.",
      }),
    };
  }

  const startedAt = Date.now();
  const query = priceChartingApiQuery(setName, cardName, cardNumber, setTotal);
  const url = new URL("https://www.pricecharting.com/api/product");
  url.searchParams.set("t", token);
  url.searchParams.set("q", query);
  const safeSourceUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(PUBLIC_PAGE_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`PriceCharting API request failed: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (data.status !== "success") {
      const apiMessage =
        typeof data["error-message"] === "string"
          ? data["error-message"]
          : "PriceCharting API returned no product.";
      return {
        gradedPrices,
        marketEvidence,
        sourceStatus: sourceStatus({
          source: "PriceCharting API",
          state: "no_match",
          confidence: "low",
          confidenceScore: 0.25,
          note: apiMessage,
          sourceUrl: safeSourceUrl,
          latencyMs: Date.now() - startedAt,
        }),
      };
    }

    const productName =
      typeof data["product-name"] === "string" ? data["product-name"] : "";
    const consoleName =
      typeof data["console-name"] === "string" ? data["console-name"] : "";
    const identityScore = scoreSaleTitle(
      `${productName} ${consoleName}`,
      cardName,
      cardNumber,
      setName,
      setTotal,
    );

    if (identityScore < 8) {
      return {
        gradedPrices,
        marketEvidence,
        sourceStatus: sourceStatus({
          source: "PriceCharting API",
          state: "no_match",
          confidence: "low",
          confidenceScore: 0.24,
          note: "The API returned a product, but it did not match the card identity strongly enough to trust.",
          sourceUrl: safeSourceUrl,
          latencyMs: Date.now() - startedAt,
          warning: `${productName} / ${consoleName}`,
        }),
      };
    }

    const sourceUrl =
      typeof data.id === "number" || typeof data.id === "string"
        ? safeSourceUrl
        : safeSourceUrl;

    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "Ungraded",
      value: centsToUsd(data["loose-price"]),
      sourceUrl,
    });
    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "PSA 10",
      value: centsToUsd(data["manual-only-price"]),
      sourceUrl,
    });
    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "PSA 9",
      value: centsToUsd(data["graded-price"]),
      sourceUrl,
    });
    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "PSA 8",
      value: centsToUsd(data["new-price"]),
      sourceUrl,
    });
    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "PSA 7",
      value: centsToUsd(data["cib-price"]),
      sourceUrl,
    });
    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "BGS 10",
      value: centsToUsd(data["bgs-10-price"]),
      sourceUrl,
    });
    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "CGC 10",
      value: centsToUsd(data["condition-17-price"]),
      sourceUrl,
    });
    pushPriceChartingApiPrice({
      prices: gradedPrices,
      evidence: marketEvidence,
      grade: "SGC 10",
      value: centsToUsd(data["condition-18-price"]),
      sourceUrl,
    });

    return {
      gradedPrices,
      marketEvidence,
      sourceStatus: sourceStatus({
        source: "PriceCharting API",
        state: gradedPrices.size ? "ready" : "no_match",
        confidence: gradedPrices.size ? "medium" : "low",
        confidenceScore: gradedPrices.size ? 0.66 : 0.3,
        note: gradedPrices.size
          ? "Current card guide values loaded through the official PriceCharting API."
          : "The API product matched, but it did not include usable card price fields.",
        sourceUrl,
        latencyMs: Date.now() - startedAt,
        sampleCount: gradedPrices.size,
      }),
    };
  } catch (error) {
    return {
      gradedPrices,
      marketEvidence,
      sourceStatus: sourceStatus({
        source: "PriceCharting API",
        state: "failed",
        confidence: "low",
        confidenceScore: 0.2,
        note: "The official API could not be reached, so public fallback sources were used.",
        sourceUrl: safeSourceUrl,
        latencyMs: Date.now() - startedAt,
        warning: errorMessage(error),
      }),
    };
  }
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

    headers.forEach((header, headerIndex) => {
      const normalized = normalizePriceGuideLabelToGrade(header);

      if (!normalized) {
        return;
      }

      push(normalized.grade, parseGuideCellUsd(priceCells[headerIndex] ?? ""), normalized.warning);
    });
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

function parsePriceChartingGradedGuide(html: string, url?: string): Map<string, GradedPrice> {
  const prices = new Map<string, GradedPrice>();
  const text = stripHtml(html);
  const textWithLines = stripHtmlToLines(html);
  const guideLookupText = text.split(/\bAll eBay only\b/i)[0] ?? text;

  if (text.length < 200 || /just a moment/i.test(text)) {
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

  parsePriceGuideMarkdownTables(textWithLines, push);
  parsePriceGuideCurrentList(textWithLines, push);

  push("Ungraded", priceNearLabel(guideLookupText, "\\bUngraded\\b"));

  for (const gradeNum of WHOLE_GRADES) {
    push(`PSA ${gradeNum}`, priceNearLabel(guideLookupText, `\\bPSA\\s*${gradeNum}\\b`));
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
  const blockRegex =
    /data-item-id="(\d+)"[\s\S]*?<div class="card-title"[^>]*><a href="[^"]+">([\s\S]*?)<\/a><\/div>[\s\S]*?<span class="card-meta-date">[\s\S]*?<span>([^<]+)<\/span><\/span><span class="card-status status-sold">Sold<\/span>[\s\S]*?<div class="card-price sold">\$([^<]+)<\/div>[\s\S]*?<a href="([^"]+)"[\s\S]*?class="seller-link"[\s\S]*?>[\s\S]*?Seller:\s*([^<]+?)\s*<\/a>[\s\S]*?<a href="([^"]+)"[\s\S]*?>[\s\S]*?View Listing/gi;

  const sales: SaleRecord[] = [];
  let rejected = 0;
  const rejectedReasonCounts: RejectedReasonCounts = {};
  const reject = (reason: string) => {
    rejected += 1;
    incrementRejectedReason(rejectedReasonCounts, reason);
  };

  for (const match of html.matchAll(blockRegex)) {
    const title = normalizeWhitespace(match[2]);

    if (hasBadSaleTitleSignals(title)) {
      reject("bundle/proxy/reprint/altered signal");
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

    if (hasConflictingSetMarker(title, setName)) {
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
    const price = parseUsd(match[4]);

    if (!Number.isFinite(price) || price <= 0) {
      reject("invalid sold price");
      continue;
    }

    if (relevanceScore < 10) {
      reject("low identity score");
      continue;
    }

    const listingUrl = toAbsoluteUrl(match[7]);
    sales.push({
      date: toIsoDate(normalizeWhitespace(match[3])),
      title,
      condition,
      price,
      source: "Magery public sold comps",
      seller: normalizeWhitespace(match[6]),
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
  options: { setCode?: string; isJapanese?: boolean; language?: string } = {},
) {
  const dedupedSales = new Map<string, SaleRecord>();
  let rejected = 0;
  let rejectedReasonCounts: RejectedReasonCounts = {};
  const queries = buildSoldCompQueries(
    setName,
    cardName,
    cardNumber,
    setTotal,
    cardRarity,
    options,
  );
  // Magery throttles request bursts: firing every query at once makes most requests
  // time out, which is why sold comps were coming back empty. Process the queries in
  // small concurrency batches and stop early once enough accepted comps are gathered.
  const SOLD_COMP_QUERY_CONCURRENCY = 3;
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
      if (outcome.status !== "fulfilled") {
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

  return { accepted, rejected, rejectedReasonCounts };
}

function safeIsoDateFromLabel(label: string) {
  const parsed = Date.parse(label);

  if (Number.isNaN(parsed)) {
    return label;
  }

  return new Date(parsed).toISOString().slice(0, 10);
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
  const dateMap = new Map<string, { gradeValues: Record<string, number>; isProjected?: boolean }>();
  const latestSaleDateByGrade = new Map<string, string>();

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
      entry.gradeValues[grade] = robustMedian(prices);
      dateMap.set(date, entry);
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
    dateMap.set(snapshotDate, {
      ...projectedEntry,
      isProjected: true,
    });
  }

  return [...dateMap.entries()]
    .sort(([left], [right]) => chartTimelineSortKey(left) - chartTimelineSortKey(right))
    .map(([date, entry]) => ({
      date,
      value: typeof entry.gradeValues.Ungraded === "number" ? entry.gradeValues.Ungraded : 0,
      gradeValues: entry.gradeValues,
      isProjected: entry.isProjected,
    }));
}

function filterOutlierSales(sales: SaleRecord[], snapshot?: GradedPrice) {
  if (sales.length <= 2) {
    const highSale = Math.max(...sales.map((sale) => sale.price), 0);
    const hasUsableSnapshot =
      Boolean(snapshot?.value && snapshot.value >= 1) &&
      !(highSale >= 1000 && snapshot!.value < highSale / 8);

    if (!hasUsableSnapshot) {
      if (sales.length === 2) {
        const sorted = [...sales].sort((left, right) => left.price - right.price);
        const [low, high] = sorted;

        if (high.price >= 1000 && high.price / Math.max(low.price, 1) >= 6) {
          return [high];
        }
      }

      return sales;
    }

    const tolerance = snapshot!.value >= 1000 ? 6 : 4;
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
  return snapshot.grades.length > 0 || typeof snapshot.totalCertified === "number";
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

export function mergeLiveMarketDataIntoCard(
  card: TcgCard,
  psaData: {
    psaPopulation: PsaPopulationSnapshot;
    gradedPrices: GradedPrice[];
    priceHistory?: PricePoint[];
    recentSales?: SaleRecord[];
    evidenceSummary?: TcgCard["evidenceSummary"];
    sourceStatus?: MarketSourceStatus[];
    marketEvidence?: MarketEvidence[];
    priceConsensus?: PriceConsensus;
  },
) {
  const catalogPriceHistory = [...card.priceHistory];
  const catalogGraded = [...card.gradedPrices];

  if (shouldPreferIncomingPopulation(psaData.psaPopulation, card.psaPopulation)) {
    card.psaPopulation = psaData.psaPopulation;
    card.gradingPopulation = psaData.psaPopulation;
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

    if (
      shouldPreserveCatalogMarketPrice(catalogPriceUsd, nextConsensus.finalEstimateUsd, {
        soldCompCount: nextConsensus.sampleCount,
        catalogTrusted,
      })
    ) {
      nextConsensus = {
        ...nextConsensus,
        finalEstimateUsd: catalogPriceUsd,
        methodology: `${nextConsensus.methodology} Catalog sold-comp baseline preserved over weaker guide snapshots.`,
      };
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
          nextConsensus.confidence === "low"
            ? "Consensus is based on thin or weakly corroborated evidence."
            : undefined,
      };
    }

    card.marketPriceUsd = getHeadlineMarketPriceUsd(card);
  }
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
  options: {
    setCode?: string;
    isJapanese?: boolean;
    englishCardName?: string;
    language?: string;
    skipSoldComps?: boolean;
  } = {},
): Promise<LivePsaDataResult | null> {
  const cacheKey = marketCacheKey(
    setName,
    cardName,
    cardNumber,
    rawMarketPriceUsd,
    setTotal,
    cardRarity,
    options.language,
    options.setCode,
    options.skipSoldComps,
  );
  const cachedResult = readCachedMarketResult(cacheKey);

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
  const marketLookupOptions: ExternalMarketLookupOptions = {
    setCode: options.setCode,
    language: options.language,
  };
  const setSlug =
    getPriceChartingSetSlugVariants(normalizedSetName, marketLookupOptions)[0] ??
    slugify(normalizedSetName);
  const nameSlugs = cardNameSlugVariantsForExternalApis(normalizedCardName);
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
  };
  const skipSoldComps = options.skipSoldComps === true;
  const coreBudgetMs = skipSoldComps ? CORE_SOURCE_BUDGET_MS : FULL_SOURCE_BUDGET_MS;
  const [priceChartingApiOutcome, tcgOutcome, guideOutcome, populationOutcome] = await Promise.all([
    settleWithin(fetchPriceChartingApiSnapshot(setName, lookupCardName, cardNumber, setTotal), coreBudgetMs),
    settleWithin(loadBestTcgFishPage(setSlug, effectiveNameSlugs, cardNumber, setTotal), coreBudgetMs),
    settleWithin(
      mergePriceChartingGuidesFromVariants(
        setName,
        lookupCardName,
        cardNumber,
        setTotal,
        marketLookupOptions,
      ),
      coreBudgetMs,
    ),
    settleWithin(
      fetchPriceChartingPopulationWithVariants(
        setName,
        lookupCardName,
        cardNumber,
        setTotal,
        marketLookupOptions,
      ),
      POPULATION_SOURCE_BUDGET_MS,
    ),
  ]);
  const soldOutcome: PromiseSettledResult<Awaited<ReturnType<typeof fetchSoldComps>>> = skipSoldComps
    ? { status: "fulfilled", value: { accepted: [], rejected: 0, rejectedReasonCounts: {} } }
    : await settleWithin(
        fetchSoldComps(setName, lookupCardName, cardNumber, setTotal, cardRarity, soldCompOptions),
        FULL_SOURCE_BUDGET_MS,
      );

  let psaPopulation: PsaPopulationSnapshot;
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
    const catalogSnapshot: GradedPrice = {
      grade: "Ungraded",
      value: marketUsd,
      populationCount: 0,
      source: "PokemonTCG catalog market baseline",
      saleCount: 0,
      lastSoldAt: null,
      service: "RAW",
      confidence: "medium",
      confidenceScore: 0.64,
      evidenceType: "catalog",
      warning:
        "Catalog market value is used as a baseline and to reject wildly mismatched public sold listings.",
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

  if (priceChartingApiOutcome.status === "fulfilled") {
    const priceChartingApi = priceChartingApiOutcome.value;
    sourceStatuses.push(priceChartingApi.sourceStatus);
    marketEvidence.push(...priceChartingApi.marketEvidence);

    for (const price of priceChartingApi.gradedPrices.values()) {
      rememberSnapshotPrice(price);
    }
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting API",
        state: "failed",
        confidence: "low",
        confidenceScore: 0.2,
        note: "The official API adapter failed before returning data.",
        warning: errorMessage(priceChartingApiOutcome.reason),
      }),
    );
  }

  if (tcgLoaded) {
    psaPopulation = parseTcgFishPopulation(tcgLoaded.html, tcgLoaded.url);
    const fishSnapshots = parseTcgFishGradeSnapshots(tcgLoaded.html, psaPopulation);
    sourceStatuses.push(
      sourceStatus({
        source: "TCGFish public page",
        state:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0
            ? "fallback"
            : "no_match",
        confidence:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0
            ? "medium"
            : "low",
        confidenceScore:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0 ? 0.7 : 0.28,
        note:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0
            ? "Public page parsed as a fallback source for PSA population and market snapshots."
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
        note: "Public snapshot used as fallback evidence when API-backed or sold-comp depth is limited.",
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
        state: tcgOutcome.status === "rejected" ? "failed" : "no_match",
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
    const guidePrices = guideOutcome.value;
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public guide",
        state: guidePrices.size > 0 ? "fallback" : "no_match",
        confidence: guidePrices.size > 0 ? "medium" : "low",
        confidenceScore: guidePrices.size > 0 ? 0.52 : 0.24,
        note:
          guidePrices.size > 0
            ? "Public guide page values were parsed as fallback snapshots."
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
        note: "Public guide snapshot used only as supporting evidence.",
        warning: price.warning ?? "Snapshot only",
      });
    }
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public guide",
        state: "failed",
        confidence: "low",
        confidenceScore: 0.2,
        note: "The public guide fallback could not be checked.",
        warning: errorMessage(guideOutcome.reason),
      }),
    );
  }

  const priceChartingPopulation =
    populationOutcome.status === "fulfilled" ? populationOutcome.value : null;

  if (priceChartingPopulation) {
    const hasPriceChartingPopulation = hasPopulationSignal(priceChartingPopulation.population);
    const usedPriceChartingPopulation = shouldPreferPopulationSnapshot(
      priceChartingPopulation.population,
      psaPopulation,
    );
    const isCombinedSetIndex = priceChartingPopulation.sourceKind === "set_index";

    if (usedPriceChartingPopulation) {
      psaPopulation = priceChartingPopulation.population;
    }

    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public population",
        state: hasPriceChartingPopulation ? "fallback" : "no_match",
        confidence: hasPriceChartingPopulation
          ? priceChartingPopulation.population.confidence ?? "medium"
          : "low",
        confidenceScore: hasPriceChartingPopulation
          ? priceChartingPopulation.population.confidenceScore ?? 0.62
          : 0.28,
        note: hasPriceChartingPopulation
          ? usedPriceChartingPopulation
            ? isCombinedSetIndex
              ? "Matched the card in the free set population index and used combined PSA/CGC grade counts because no fuller PSA item report was available."
              : "Matched the exact free item population report and used its PSA grade counts."
            : "Population data was parsed, but another public source had a stronger grade-by-grade table."
          : "The public population page did not expose usable counts.",
        sourceUrl: priceChartingPopulation.population.sourceUrl,
        sampleCount: priceChartingPopulation.population.grades.length,
        warning: priceChartingPopulation.population.warning,
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
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public population",
        state: populationOutcome.status === "rejected" ? "failed" : "no_match",
        confidence: "low",
        confidenceScore: 0.24,
        note: "No free public population counts were available from PriceCharting.",
        warning:
          populationOutcome.status === "rejected"
            ? errorMessage(populationOutcome.reason)
            : undefined,
      }),
    );
  }

  let allSales: SaleRecord[] = [];
  let rejectedSales = 0;
  let rejectedReasonCounts: RejectedReasonCounts = {};

  if (soldOutcome.status === "fulfilled") {
    const soldCompResult = soldOutcome.value;
    allSales = soldCompResult.accepted;
    rejectedSales = soldCompResult.rejected;
    rejectedReasonCounts = soldCompResult.rejectedReasonCounts;
    sourceStatuses.push(
      sourceStatus({
        source: "Public sold-listing comps",
        state: allSales.length > 0 ? "fallback" : "no_match",
        confidence: allSales.length >= 3 ? "medium" : "low",
        confidenceScore:
          allSales.length >= 6 ? 0.78 : allSales.length >= 3 ? 0.62 : allSales.length > 0 ? 0.42 : 0.24,
        note:
          allSales.length > 0
            ? "Accepted sold listings after identity matching, grade detection, and outlier checks."
            : "No sold listings passed identity matching for this card.",
        sampleCount: allSales.length,
        warning:
          rejectedSales > 0
            ? `${rejectedSales} listing${rejectedSales === 1 ? "" : "s"} rejected as mismatched or weak evidence.`
            : undefined,
      }),
    );
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "Public sold-listing comps",
        state: "failed",
        confidence: "low",
        confidenceScore: 0.2,
        note: "Sold-listing fallback could not be checked.",
        warning: errorMessage(soldOutcome.reason),
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

  const gradedPrices: GradedPrice[] = [];
  let thinEvidenceCount = 0;
  let fallbackEvidenceCount = 0;
  const soldReportsByGrade = new Map<string, SoldCompReport>();

  for (const grade of SOLD_COMP_GRADES) {
    const snapshot = snapshotPrices.get(grade);
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

  for (const price of snapshotPrices.values()) {
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

  const priceHistory = buildPriceHistoryFromMarketTimeline({
    salesByGrade,
    gradedPrices,
  });

  if (
    !hasPopulationSignal(psaPopulation) &&
    !gradedPrices.length &&
    !recentSales.length &&
    !(marketUsd > 0)
  ) {
    return null;
  }

  const finalSourceStatuses = sourceStatuses.map((status) => {
    if (status.source !== "Public sold-listing comps") {
      return status;
    }

    return {
      ...status,
      sampleCount: recentSales.length,
      note:
        recentSales.length > 0
          ? "Accepted sold listings after identity matching, grade detection, and outlier checks."
          : "No sold listings passed final identity and outlier checks for this card.",
      warning:
        rejectedSales + filteredOutSales > 0
          ? `${rejectedSales + filteredOutSales} listing${
              rejectedSales + filteredOutSales === 1 ? "" : "s"
            } rejected as mismatched, altered, or weak evidence.`
          : undefined,
    };
  }).filter(
    (status, index, statuses) =>
      statuses.findIndex(
        (candidate) =>
          candidate.source === status.source && candidate.state === status.state,
      ) === index,
  );
  const finalMarketEvidence = marketEvidence.slice(0, 96);
  const result: LivePsaDataResult = {
    psaPopulation,
    population: psaPopulation,
    gradedPrices,
    priceHistory,
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
  };

  writeCachedMarketResult(cacheKey, result);
  return result;
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
