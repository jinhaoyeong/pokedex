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
  TcgCard,
} from "@/types/pokemon";

const PUBLIC_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const PUBLIC_PAGE_TIMEOUT_MS = 12_000;
const PUBLIC_PAGE_MAX_ATTEMPTS = 2;

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

const MARKET_RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const marketResultCache = new Map<
  string,
  { expiresAt: number; value: LivePsaDataResult }
>();

function nowIso() {
  return new Date().toISOString();
}

function marketCacheKey(
  setName: string,
  cardName: string,
  cardNumber: string,
  rawMarketPriceUsd?: number,
  setTotal?: number,
) {
  return [
    "v2-vintage-matcher",
    normalizeCardName(setName).toLowerCase(),
    normalizeCardName(cardName).toLowerCase(),
    cardNumber.trim().toLowerCase(),
    typeof setTotal === "number" ? setTotal : "",
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

function cardNameSlugVariantsForExternalApis(
  cardName: string,
  preferred: "standard" | "pricecharting" = "standard",
) {
  const normalized = normalizeCardName(cardName);
  const starAlias = /\bgold star\b/i.test(normalized)
    ? normalized.replace(/\bgold star\b/i, "Star")
    : normalized.replace(/\bstar\b/i, "Gold Star");
  const candidates =
    preferred === "pricecharting"
      ? [
          priceChartingSlugify(normalized),
          slugify(normalized),
          priceChartingSlugify(starAlias),
          slugify(starAlias),
        ]
      : [
          slugify(normalized),
          priceChartingSlugify(normalized),
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

  return [...variants];
}

function buildPriceChartingGameUrl(
  setName: string,
  cardNameSlug: string,
  collectorNumberSlug: string,
) {
  const setSlug = `pokemon-${priceChartingSlugify(setName)}`;

  return `https://www.pricecharting.com/game/${setSlug}/${cardNameSlug}-${collectorNumberSlug}`;
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
  snapshotCandidates,
}: {
  catalogValueUsd: number;
  soldSales: SaleRecord[];
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
      value: robustMedian(soldSales.map((sale) => sale.price)),
      confidence: confidenceFromScore(confidenceScore),
      confidenceScore,
      evidenceType: "sold_comp",
      sampleCount: soldSales.length,
      sourceUrl: soldSales[0]?.listingUrl,
      note:
        soldSales.length >= 2
          ? "Estimated from accepted public last-sold listings after title matching and outlier filtering."
          : "Only one accepted public last-sold listing was available, so this source is lightly weighted.",
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

  const filteredObservations = filterConsensusOutliers(uniqueObservations);
  const finalEstimateUsd = Math.round(weightedAverageConsensus(filteredObservations) * 100) / 100;
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
      "Weighted consensus across trusted public sources. Accepted sold listings are prioritized, then corroborated against catalog and public guide snapshots.",
    sources: filteredObservations
      .sort((left, right) => right.weight - left.weight)
      .map(({ weight: _weight, ...source }) => source),
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

function toAbsoluteUrl(path: string) {
  if (path.startsWith("http")) {
    return path;
  }

  return `https://magery.com${path}`;
}

function parseUsd(value: string) {
  return Number.parseFloat(value.replace(/[^0-9.]/g, ""));
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

function setAliasTokens(setName: string) {
  const normalizedSetName = normalizeCardName(setName);
  const aliases = new Set<string>([normalizedSetName]);
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
) {
  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const setTokens = setAliasTokens(setName).filter((token) => token.length > 2);
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
  const hasSetSignal = setTokens.some((token) => titleTokens.has(token));

  return (
    (nameMatchCount >= Math.min(2, nameTokens.length) && hasCardNumber) ||
    (nameMatchCount >= 2 && hasSetSignal) ||
    isStrongVintageSaleTitle(title, cardName, cardNumber, setName, setTotal)
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
) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const normalizedCardName = normalizeCardName(cardName).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const setTokens = setAliasTokens(setName).filter((token) => token.length > 2);
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

  return {
    collectorNumbers,
    hasCardNumber,
    hasExactNumberWithTotal,
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
) {
  const signals = saleIdentitySignals(title, cardName, cardNumber, setName, setTotal);

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
) {
  const normalizedTitle = normalizeCardName(title).toLowerCase();
  const normalizedSetName = normalizeCardName(setName).toLowerCase();
  const titleTokens = new Set(tokenizeForMatching(title));
  const nameTokens = tokenizeForMatching(cardName).filter((token) => token.length > 2);
  const setTokens = setAliasTokens(setName).filter((token) => token.length > 2);
  const cardNumberBase = cardNumber.split("/")[0]?.replace(/^0+/, "") || cardNumber;
  const collectorNumbers = extractCollectorNumbers(normalizedTitle);
  const collectorVariants = new Set([
    cardNumber.toLowerCase(),
    cardNumberBase.toLowerCase(),
    ...(typeof setTotal === "number" && setTotal > 0
      ? [`${cardNumberBase}/${setTotal}`.toLowerCase()]
      : []),
  ]);
  const identitySignals = saleIdentitySignals(title, cardName, cardNumber, setName, setTotal);
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

function buildSoldCompQueries(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
) {
  const normalizedName = normalizeCardName(cardName);
  const normalizedSetName = normalizeCardName(setName);
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

  return [...queries].filter(Boolean);
}

function parseTcgFishPopulation(html: string, url: string): PsaPopulationSnapshot {
  let totalCertified = null;
  const totalPopMatch = html.match(/Total population: \\",\\"([0-9,]+)\\",\\" copies/);

  if (totalPopMatch) {
    totalCertified = parseInt(totalPopMatch[1].replace(/,/g, ""), 10);
  } else {
    const totalPopFallback = html.match(/Total population: <!-- -->([0-9,]+)<!-- --> copies/);

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
    ];

    const match = patterns
      .map((pattern) => html.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));

    if (match?.[1]) {
      grades.push({
        grade: `PSA ${grade}`,
        count: parseInt(match[1].replace(/,/g, ""), 10),
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.66,
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
    confidenceScore: grades.length ? 0.66 : 0.35,
    evidenceType: "population",
  };
}

function parsePriceChartingPopulation(
  html: string,
  url: string,
): {
  population: PsaPopulationSnapshot;
  gradedPrices: Map<string, GradedPrice>;
} {
  const text = stripHtml(html);
  const grades: PsaPopulationSnapshot["grades"] = [];
  const gradedPrices = new Map<string, GradedPrice>();

  for (const grade of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
    const rowMatch = text.match(
      new RegExp(`(?:^|\\s)${grade}\\s+([0-9,]+)\\s+(?:-|[0-9,]+)\\s+([0-9,]+)\\s+\\$([0-9,.]+)`, "i"),
    );

    if (!rowMatch) {
      continue;
    }

    const count = parseInt(rowMatch[1].replace(/,/g, ""), 10);
    const value = parseUsd(rowMatch[3]);
    const gradeLabel = `PSA ${grade}`;

    grades.push({
      grade: gradeLabel,
      count,
      service: "PSA",
      confidence: "medium",
      confidenceScore: 0.62,
      evidenceType: "population",
      sourceUrl: url,
    });

    if (Number.isFinite(value) && value > 0) {
      gradedPrices.set(gradeLabel, {
        grade: gradeLabel,
        value,
        populationCount: count,
        source: "PriceCharting population snapshot",
        saleCount: 0,
        lastSoldAt: null,
        service: "PSA",
        confidence: "medium",
        confidenceScore: 0.56,
        evidenceType: "guide_snapshot",
        sourceUrl: url,
      });
    }
  }

  const totalMatch = text.match(/\bTotal\s+([0-9,]+)\s+(?:-|[0-9,]+)\s+([0-9,]+)/i);
  const totalCertified = totalMatch
    ? parseInt(totalMatch[1].replace(/,/g, ""), 10)
    : grades.reduce((sum, grade) => sum + grade.count, 0) || null;

  return {
    population: {
      status: grades.length || typeof totalCertified === "number" ? "verified" : "pending",
      totalCertified,
      grades,
      source: "PriceCharting public population report",
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      note: "PSA population was extracted from PriceCharting's public population table when the primary population page did not expose grade counts.",
      service: "PSA",
      confidence: grades.length ? "medium" : "low",
      confidenceScore: grades.length ? 0.62 : 0.35,
      evidenceType: "population",
    },
    gradedPrices,
  };
}

async function fetchPriceChartingPopulationWithVariants(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
): Promise<{
  population: PsaPopulationSnapshot;
  gradedPrices: Map<string, GradedPrice>;
} | null> {
  const setSlug = `pokemon-${priceChartingSlugify(setName)}`;
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting");
  const urls = nameSlugs.flatMap((nameSlug) =>
    numberSlugVariantsForExternalApis(cardNumber, setTotal).map(
      (numberSlug) => `https://www.pricecharting.com/pop/item/${setSlug}/${nameSlug}-${numberSlug}`,
    ),
  );
  const results = await Promise.allSettled(urls.map((url) => fetchHtml(url)));

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const parsed = parsePriceChartingPopulation(outcome.value, urls[index]);

    if (
      parsed.population.totalCertified !== null ||
      parsed.population.grades.length ||
      parsed.gradedPrices.size
    ) {
      return parsed;
    }
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
) {
  const variants = numberSlugVariantsForExternalApis(cardNumber, setTotal);
  const nameSlugs = cardNameSlugVariantsForExternalApis(cardName, "pricecharting");
  const urls = nameSlugs.flatMap((nameSlug) =>
    variants.map((variant) => buildPriceChartingGameUrl(setName, nameSlug, variant)),
  );
  const results = await Promise.allSettled(urls.map((url) => fetchHtml(url)));
  const merged = new Map<string, GradedPrice>();

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = results[index];

    if (outcome.status !== "fulfilled") {
      continue;
    }

    const guidePrices = parsePriceChartingGradedGuide(outcome.value);

    for (const [grade, price] of guidePrices.entries()) {
      if (!merged.has(grade)) {
        merged.set(grade, price);
      }
    }
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

function parsePriceChartingGradedGuide(html: string): Map<string, GradedPrice> {
  const prices = new Map<string, GradedPrice>();
  const text = stripHtml(html);

  if (text.length < 200 || /just a moment/i.test(text)) {
    return prices;
  }

  const push = (grade: string, value: number | null) => {
    if (value == null || !Number.isFinite(value) || value <= 0 || prices.has(grade)) {
      return;
    }

    prices.set(grade, {
      grade,
      value,
      populationCount: 0,
      source: "PriceCharting graded guide snapshot",
      saleCount: 0,
      lastSoldAt: null,
      service: gradeService(grade),
      confidence: "medium",
      confidenceScore: 0.52,
      evidenceType: grade === "Ungraded" ? "catalog" : "guide_snapshot",
      warning: "Reference snapshot used because sold-comp depth may be limited.",
    });
  };

  push("Ungraded", priceNearLabel(text, "\\bUngraded\\b"));

  for (const gradeNum of WHOLE_GRADES) {
    push(`PSA ${gradeNum}`, priceNearLabel(text, `\\bPSA\\s*${gradeNum}\\b`));
  }

  push(
    "BGS 10 Black",
    priceNearLabel(text, "\\bBGS\\s*10[^$]{0,60}?(?:Black\\s*Label|Black)\\b") ??
      priceNearLabel(text, "\\bBeckett\\s*10[^$]{0,60}?(?:Black\\s*Label|Black)\\b"),
  );
  for (const grade of HALF_GRADES) {
    push(
      `BGS ${grade}`,
      priceNearLabel(
        text,
        `\\bBGS\\s*${grade.replace(".", "\\.?")}\\b(?!\\s*(?:Black|Black\\s*Label))`,
      ) ??
        priceNearLabel(
          text,
          `\\bBeckett\\s*${grade.replace(".", "\\.?")}\\b(?!\\s*(?:Black|Black\\s*Label))`,
        ),
    );
  }

  push(
    "CGC 10 Pristine",
    priceNearLabel(text, "\\bCGC\\s*10[^$]{0,50}?Pristine\\b") ??
      priceNearLabel(text, "\\bCGC\\s*Pristine\\b"),
  );
  for (const grade of HALF_GRADES) {
    push(
      `CGC ${grade}`,
      priceNearLabel(
        text,
        `\\bCGC\\s*${grade.replace(".", "\\.?")}\\b(?!\\s*Pristine)`,
      ),
    );
    push(`SGC ${grade}`, priceNearLabel(text, `\\bSGC\\s*${grade.replace(".", "\\.?")}\\b`));
  }

  for (const grade of WHOLE_GRADES) {
    push(`TAG ${grade}`, priceNearLabel(text, `\\bTAG\\s*${grade}\\b`));
  }

  return prices;
}

function parseTcgFishGradeSnapshots(
  html: string,
  population: PsaPopulationSnapshot,
): Map<string, GradedPrice> {
  const prices = new Map<string, GradedPrice>();
  const priceRegex =
    /class="grade-badge[^>]*>([^<]+)<\/div>.*?class="grade-price-info"><span>\$([0-9,.]+)<\/span><\/div>/g;

  for (const match of html.matchAll(priceRegex)) {
    const gradeLabel = normalizeWhitespace(match[1]);
    const value = parseUsd(match[2]);
    const populationCount =
      population.grades.find((grade) => grade.grade === gradeLabel)?.count ?? 0;

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
  }

  return prices;
}

function parseMagerySales(
  html: string,
  cardName: string,
  cardNumber: string,
  setName: string,
  setTotal?: number,
): { accepted: SaleRecord[]; rejected: number } {
  const blockRegex =
    /data-item-id="(\d+)"[\s\S]*?<div class="card-title"[^>]*><a href="[^"]+">([\s\S]*?)<\/a><\/div>[\s\S]*?<span class="card-meta-date">[\s\S]*?<span>([^<]+)<\/span><\/span><span class="card-status status-sold">Sold<\/span>[\s\S]*?<div class="card-price sold">\$([^<]+)<\/div>[\s\S]*?<a href="([^"]+)"[\s\S]*?class="seller-link"[\s\S]*?>[\s\S]*?Seller:\s*([^<]+?)\s*<\/a>[\s\S]*?<a href="([^"]+)"[\s\S]*?>[\s\S]*?View Listing/gi;

  const sales: SaleRecord[] = [];
  let rejected = 0;

  for (const match of html.matchAll(blockRegex)) {
    const title = normalizeWhitespace(match[2]);

    if (hasBadSaleTitleSignals(title)) {
      rejected += 1;
      continue;
    }

    if (!isRelevantSaleTitle(title, cardName, cardNumber, setName, setTotal)) {
      rejected += 1;
      continue;
    }

    if (hasConflictingSetMarker(title, setName)) {
      rejected += 1;
      continue;
    }

    const condition = detectSaleCondition(title);
    const relevanceScore = scoreSaleTitle(title, cardName, cardNumber, setName, setTotal);
    const price = parseUsd(match[4]);

    if (relevanceScore < 10 || !Number.isFinite(price) || price <= 0) {
      rejected += 1;
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

  return { accepted: sales, rejected };
}

async function fetchSoldComps(
  setName: string,
  cardName: string,
  cardNumber: string,
  setTotal?: number,
) {
  const dedupedSales = new Map<string, SaleRecord>();
  let rejected = 0;
  const queries = buildSoldCompQueries(setName, cardName, cardNumber, setTotal);
  const results = await Promise.allSettled(
    queries.map(async (query) => {
      const url = `https://magery.com/w?q=${encodeURIComponent(query)}`;
      const html = await fetchHtml(url);
      return parseMagerySales(html, cardName, cardNumber, setName, setTotal);
    }),
  );

  for (const outcome of results) {
    if (outcome.status !== "fulfilled") {
      continue;
    }

    const parsedSales = outcome.value;
    rejected += parsedSales.rejected;

    for (const sale of parsedSales.accepted) {
      dedupedSales.set(
        `${sale.date}-${sale.title}-${sale.price}-${sale.condition}`,
        sale,
      );
    }
  }

  const accepted = [...dedupedSales.values()]
    .sort((left, right) => {
      const scoreDelta =
        scoreSaleTitle(right.title, cardName, cardNumber, setName, setTotal) -
        scoreSaleTitle(left.title, cardName, cardNumber, setName, setTotal);

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return right.date.localeCompare(left.date);
    })
    .slice(0, 56);

  return { accepted, rejected };
}

function buildPriceHistoryFromSales(salesByGrade: Map<string, SaleRecord[]>): PricePoint[] {
  const dateMap = new Map<string, Record<string, number>>();

  for (const [grade, sales] of salesByGrade.entries()) {
    const grouped = new Map<string, number[]>();

    for (const sale of sales) {
      const dateSales = grouped.get(sale.date) ?? [];
      dateSales.push(sale.price);
      grouped.set(sale.date, dateSales);
    }

    for (const [date, prices] of grouped.entries()) {
      const valuesForDate = dateMap.get(date) ?? {};
      valuesForDate[grade] = robustMedian(prices);
      dateMap.set(date, valuesForDate);
    }
  }

  return [...dateMap.entries()]
    .sort(([left], [right]) => chartTimelineSortKey(left) - chartTimelineSortKey(right))
    .map(([date, gradeValues]) => ({
      date,
      value: typeof gradeValues.Ungraded === "number" ? gradeValues.Ungraded : 0,
      gradeValues,
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
    card.priceConsensus = psaData.priceConsensus;
    card.marketPriceUsd = psaData.priceConsensus.finalEstimateUsd;

    const ungradedIndex = card.gradedPrices.findIndex((price) => price.grade === "Ungraded");
    if (ungradedIndex >= 0) {
      const current = card.gradedPrices[ungradedIndex];
      card.gradedPrices[ungradedIndex] = {
        ...current,
        value: psaData.priceConsensus.finalEstimateUsd,
        source: "Consensus estimate across trusted sources",
        confidence: psaData.priceConsensus.confidence,
        confidenceScore: psaData.priceConsensus.confidenceScore,
        saleCount:
          psaData.priceConsensus.sampleCount > 0
            ? psaData.priceConsensus.sampleCount
            : current.saleCount,
        warning:
          psaData.priceConsensus.confidence === "low"
            ? "Consensus is based on thin or weakly corroborated evidence."
            : undefined,
      };
    }
  }
}

function isExtendedGraderSnapshotLabel(grade: string) {
  return grade === "Ungraded" || /^(PSA|BGS|BECKETT|CGC|TAG|SGC)\b/i.test(grade);
}

export async function fetchLivePsaData(
  setName: string,
  cardName: string,
  cardNumber: string,
  rawMarketPriceUsd?: number,
  setTotal?: number,
): Promise<LivePsaDataResult | null> {
  const cacheKey = marketCacheKey(
    setName,
    cardName,
    cardNumber,
    rawMarketPriceUsd,
    setTotal,
  );
  const cachedResult = readCachedMarketResult(cacheKey);

  if (cachedResult) {
    return cachedResult;
  }

  const marketUsd =
    typeof rawMarketPriceUsd === "number" && Number.isFinite(rawMarketPriceUsd)
      ? rawMarketPriceUsd
      : 0;
  const normalizedCardName = normalizeCardName(cardName);
  const normalizedSetName = normalizeCardName(setName);
  const setSlug = slugify(normalizedSetName);
  const nameSlugs = cardNameSlugVariantsForExternalApis(normalizedCardName);
  const primaryNumberSlug = numberSlugVariantsForExternalApis(cardNumber, setTotal)[0] ?? slugify(cardNumber);
  const primaryTcgUrl = buildTcgFishCardUrl(setSlug, nameSlugs[0] ?? slugify(normalizedCardName), primaryNumberSlug);
  const [priceChartingApiOutcome, tcgOutcome, guideOutcome, populationOutcome, soldOutcome] =
    await Promise.allSettled([
      fetchPriceChartingApiSnapshot(setName, cardName, cardNumber, setTotal),
      loadBestTcgFishPage(setSlug, nameSlugs, cardNumber, setTotal),
      mergePriceChartingGuidesFromVariants(setName, cardName, cardNumber, setTotal),
      fetchPriceChartingPopulationWithVariants(setName, cardName, cardNumber, setTotal),
      fetchSoldComps(setName, cardName, cardNumber, setTotal),
    ]);

  let psaPopulation: PsaPopulationSnapshot;
  const snapshotPrices = new Map<string, GradedPrice>();
  const snapshotCandidates: GradedPrice[] = [];
  const sourceStatuses: MarketSourceStatus[] = [];
  const marketEvidence: MarketEvidence[] = [];
  const tcgLoaded = tcgOutcome.status === "fulfilled" ? tcgOutcome.value : null;

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
    snapshotPrices.set("Ungraded", catalogSnapshot);
    snapshotCandidates.push(catalogSnapshot);
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

    for (const [grade, price] of priceChartingApi.gradedPrices.entries()) {
      snapshotCandidates.push(price);
      if (!snapshotPrices.has(grade)) {
        snapshotPrices.set(grade, price);
      }
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
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0 ? 0.58 : 0.28,
        note:
          hasPopulationSignal(psaPopulation) || fishSnapshots.size > 0
            ? "Public page parsed as a fallback source for PSA population and market snapshots."
            : "A public page loaded, but it did not expose usable population or price fields.",
        sourceUrl: tcgLoaded.url,
        sampleCount: psaPopulation.grades.length + fishSnapshots.size,
      }),
    );

    for (const [grade, price] of fishSnapshots.entries()) {
      snapshotCandidates.push(price);
      if (!snapshotPrices.has(grade)) {
        snapshotPrices.set(grade, price);
      }
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
      snapshotCandidates.push(price);
      if (!snapshotPrices.has(grade)) {
        snapshotPrices.set(grade, price);
      }
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

  if (psaPopulation.totalCertified === null && !psaPopulation.grades.length) {
    const priceChartingPopulation =
      populationOutcome.status === "fulfilled" ? populationOutcome.value : null;

    if (priceChartingPopulation) {
      psaPopulation = priceChartingPopulation.population;
      sourceStatuses.push(
        sourceStatus({
          source: "PriceCharting public population",
          state: hasPopulationSignal(priceChartingPopulation.population)
            ? "fallback"
            : "no_match",
          confidence: hasPopulationSignal(priceChartingPopulation.population)
            ? "medium"
            : "low",
          confidenceScore: hasPopulationSignal(priceChartingPopulation.population)
            ? 0.62
            : 0.28,
          note: hasPopulationSignal(priceChartingPopulation.population)
            ? "Population counts were parsed from the public PriceCharting population table."
            : "The public population page did not expose usable counts.",
          sourceUrl: priceChartingPopulation.population.sourceUrl,
          sampleCount: priceChartingPopulation.population.grades.length,
        }),
      );

      for (const [grade, price] of priceChartingPopulation.gradedPrices.entries()) {
        snapshotCandidates.push(price);
        if (!snapshotPrices.has(grade)) {
          snapshotPrices.set(grade, price);
        }
      }
    } else {
      sourceStatuses.push(
        sourceStatus({
          source: "PriceCharting public population",
          state: populationOutcome.status === "rejected" ? "failed" : "no_match",
          confidence: "low",
          confidenceScore: 0.24,
          note: "No fallback population counts were available from PriceCharting.",
          warning:
            populationOutcome.status === "rejected"
              ? errorMessage(populationOutcome.reason)
              : undefined,
        }),
      );
    }
  } else {
    sourceStatuses.push(
      sourceStatus({
        source: "PriceCharting public population",
        state: "disabled",
        confidence: "low",
        confidenceScore: 0.2,
        note: "Skipped because a higher-priority population source already returned usable counts.",
      }),
    );
  }

  let allSales: SaleRecord[] = [];
  let rejectedSales = 0;

  if (soldOutcome.status === "fulfilled") {
    const soldCompResult = soldOutcome.value;
    allSales = soldCompResult.accepted;
    rejectedSales = soldCompResult.rejected;
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

  for (const grade of SOLD_COMP_GRADES) {
    const snapshot = snapshotPrices.get(grade);
    const sales = filterOutlierSales(salesByGrade.get(grade) ?? [], snapshot);
    salesByGrade.set(grade, sales);

    if (sales.length) {
      if (isThinUncorroboratedGrade(sales, snapshot)) {
        thinEvidenceCount += 1;
        gradedPrices.push({
          grade,
          value: sales[0].price,
          populationCount:
            psaPopulation.grades.find((populationGrade) => populationGrade.grade === grade)?.count ?? 0,
          source: "Single public sold comp (unconfirmed estimate)",
          saleCount: 1,
          lastSoldAt: sales[0].date,
          service: gradeService(grade),
          confidence: "low",
          confidenceScore: 0.38,
          evidenceType: "sold_comp",
          sourceUrl: sales[0].listingUrl,
          warning: "Only one uncorroborated sold comp was found; do not treat as a firm market price.",
        });
        continue;
      }

      const value = reconcileSoldPriceWithSnapshot(sales, snapshot);
      const confidence = soldCompConfidence(sales, snapshot);
      gradedPrices.push({
        grade,
        value,
        populationCount:
          psaPopulation.grades.find((populationGrade) => populationGrade.grade === grade)?.count ?? 0,
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
            ? "Thin sold-comp sample; reference as an estimate."
            : undefined,
      });
      continue;
    }

    if (snapshot) {
      fallbackEvidenceCount += 1;
      const confidence = guideConfidence(snapshot.source);
      gradedPrices.push({
        ...snapshot,
        service: snapshot.service ?? gradeService(snapshot.grade),
        confidence: snapshot.confidence ?? confidence.confidence,
        confidenceScore: snapshot.confidenceScore ?? confidence.confidenceScore,
        evidenceType: snapshot.evidenceType ?? "guide_snapshot",
        warning: snapshot.warning ?? "No accepted sold comps for this grade; using public reference snapshot.",
      });
    }
  }

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

  const chartableSalesByGrade = new Map(
    [...salesByGrade.entries()]
      .filter(([grade, sales]) => grade === "Ungraded" ? sales.length >= 2 : sales.length >= 2)
      .map(([grade, sales]) => [grade, sales] as const),
  );
  const priceHistory = buildPriceHistoryFromSales(chartableSalesByGrade);
  const priceConsensus = buildRawPriceConsensus({
    catalogValueUsd: marketUsd,
    soldSales: salesByGrade.get("Ungraded") ?? [],
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

  const psa9 = snapshot.grades.find((grade) => grade.grade === "PSA 9");

  if (psa9) {
    return `PSA 9 Pop ${psa9.count.toLocaleString()}`;
  }

  if (typeof snapshot.totalCertified === "number") {
    return `PSA Total ${snapshot.totalCertified.toLocaleString()}`;
  }

  return "Population unavailable";
}
