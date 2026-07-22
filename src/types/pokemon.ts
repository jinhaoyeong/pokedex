export type SupportedCurrency = "USD" | "EUR" | "GBP" | "JPY" | "MYR";
export type CardLanguageCode =
  | "en"
  | "fr"
  | "es"
  | "it"
  | "pt"
  | "pt-br"
  | "pt-pt"
  | "de"
  | "nl"
  | "pl"
  | "ru"
  | "ja"
  | "ko"
  | "zh-tw"
  | "id"
  | "th"
  | "zh-cn";

export type CardLanguageFilter = CardLanguageCode | "all";

export type JapaneseMarketIdentitySource =
  | "official-detail"
  | "official-browse"
  | "tcgdex"
  | "manual-set-map"
  | "pricecharting-discovery"
  | "cached-confirmed-identity"
  | "name-database"
  | "caller-supplied";

export type JapaneseMarketIdentityStatus =
  | "confirmed"
  | "partial"
  | "identity_incomplete";

/**
 * Canonical bridge between a pokemon-card.com catalog record and the identity
 * consumed by English-language market providers. `printedCollectorNumber` is
 * never populated from a browse position; `browseIndex` exists expressly to
 * keep those two concepts separate.
 */
export interface JapaneseMarketIdentity {
  officialCardId: string;
  browseIndex: number | null;
  japaneseName: string;
  englishMarketName: string | null;
  printedCollectorNumber: string | null;
  collectorNumberTotal: number | null;
  japaneseSetCode: string | null;
  japaneseSetName: string | null;
  englishSetName: string | null;
  priceChartingSetSlug: string | null;
  priceChartingProductId: string | null;
  priceChartingProductUrl: string | null;
  identityConfidence: number;
  identitySource: JapaneseMarketIdentitySource[];
  identityStatus: JapaneseMarketIdentityStatus;
  verifiedAt: string | null;
  identityVersion: number;
}

export type SearchSortOption =
  | "relevance"
  | "price-desc"
  | "price-asc"
  | "change-desc"
  | "change-asc"
  | "number-desc"
  | "number-asc";

export type GradeLabel = string;
export type MarketConfidence = "high" | "medium" | "low";
export type GradingService = "PSA" | "BGS" | "CGC" | "SGC" | "TAG" | "RAW";
export type MarketEvidenceType = "sold_comp" | "guide_snapshot" | "population" | "catalog";
export type MarketSourceState =
  | "ready"
  | "partial"
  | "cached"
  | "fallback"
  | "missing_credentials"
  | "no_match"
  | "identity_incomplete"
  | "timeout"
  | "circuit_open"
  | "provider_error"
  | "failed"
  | "disabled";

export interface MarketSourceStatus {
  source: string;
  state: MarketSourceState;
  confidence: MarketConfidence;
  confidenceScore: number;
  note: string;
  fetchedAt?: string;
  sourceUrl?: string;
  latencyMs?: number;
  sampleCount?: number;
  warning?: string;
}

export interface EvidenceSummary {
  accepted: number;
  rejected: number;
  thin: number;
  fallback: number;
  sourceStatus?: MarketSourceStatus[];
}

export interface MarketEvidence {
  id: string;
  source: string;
  evidenceType: MarketEvidenceType;
  grade: GradeLabel;
  priceUsd?: number;
  date?: string;
  title?: string;
  sourceUrl?: string;
  confidence: MarketConfidence;
  confidenceScore: number;
  note: string;
  warning?: string;
}

export interface PriceConsensusSource {
  source: string;
  value: number;
  confidence: MarketConfidence;
  confidenceScore: number;
  evidenceType: MarketEvidenceType;
  sampleCount?: number;
  sourceUrl?: string;
  note: string;
}

export interface SoldCompReport {
  grade: GradeLabel;
  acceptedCount: number;
  rejectedCount: number;
  suspiciousCount: number;
  latestPriceUsd: number | null;
  latestSoldAt?: string | null;
  averageUsd: number;
  medianUsd: number;
  trimmedAverageUsd: number;
  recencyWeightedUsd: number;
  calculatedValueUsd: number;
  lowUsd: number;
  highUsd: number;
  confidence: MarketConfidence;
  confidenceScore: number;
  method: string;
  suspiciousSignals: string[];
  rejectedReasonCounts?: Record<string, number>;
}

export interface PriceConsensus {
  finalEstimateUsd: number;
  confidence: MarketConfidence;
  confidenceScore: number;
  sourceCount: number;
  sampleCount: number;
  methodology: string;
  sources: PriceConsensusSource[];
  salesReport?: SoldCompReport;
}

export type MarketHistoryPointType =
  | "sold"
  | "guide-snapshot"
  | "catalog-baseline"
  | "projected";

export type MarketHistoryStatus =
  | "available"
  | "limited"
  | "snapshot_only"
  | "unavailable";

export interface MarketHistorySummary {
  status: MarketHistoryStatus;
  historyUnavailable: boolean;
  realSaleCount?: number;
  note?: string;
}

export interface PricePoint {
  date: string;
  value: number;
  gradeValues?: Record<string, number>;
  isProjected?: boolean;
  pointType?: MarketHistoryPointType;
}

export interface GradedPrice {
  grade: GradeLabel;
  value: number;
  populationCount: number;
  source?: string;
  saleCount?: number;
  lastSoldAt?: string | null;
  confidence?: MarketConfidence;
  confidenceScore?: number;
  service?: GradingService;
  evidenceType?: MarketEvidenceType;
  sourceUrl?: string;
  warning?: string;
}

export interface PopulationGradeCount {
  grade: string;
  count: number;
  service?: GradingService;
  confidence?: MarketConfidence;
  confidenceScore?: number;
  evidenceType?: MarketEvidenceType;
  sourceUrl?: string;
  warning?: string;
}

export interface PsaPopulationSnapshot {
  status: "verified" | "pending";
  totalCertified: number | null;
  grades: PopulationGradeCount[];
  source: string;
  fetchedAt: string | null;
  sourceUrl?: string;
  note: string;
  service?: GradingService;
  confidence?: MarketConfidence;
  confidenceScore?: number;
  evidenceType?: MarketEvidenceType;
  warning?: string;
  /** How population was attributed when JP print uses an English parallel PSA census. */
  attribution?: "english_parallel_psa";
}

export type GradingPopulationSnapshot = PsaPopulationSnapshot;
export type GradedMarketPrice = GradedPrice;

export interface PopulationBreakdown {
  japanese?: PsaPopulationSnapshot;
  englishParallel?: PsaPopulationSnapshot & {
    mappedFromSet: string;
  };
}

export interface SaleRecord {
  date: string;
  title: string;
  condition: string;
  price: number;
  source: string;
  listingUrl?: string;
  seller?: string;
  confidence?: MarketConfidence;
  confidenceScore?: number;
  service?: GradingService;
  evidenceType?: MarketEvidenceType;
  sourceUrl?: string;
  warning?: string;
}

export interface CardSourceNote {
  source: string;
  status: "verified" | "estimated" | "stale";
  fetchedAt: string;
  confidence: number;
  note: string;
}

export interface TcgSet {
  id: string;
  name: string;
  localizedName?: string;
  englishName?: string;
  code: string;
  series: string;
  releaseDate: string;
  language: CardLanguageCode;
  languageLabel: string;
  printedTotal?: number;
  total?: number;
}

export interface TcgCard {
  id: string;
  slug: string;
  language: CardLanguageCode;
  languageLabel: string;
  name: string;
  localizedName?: string;
  englishName?: string;
  officialCardId?: string;
  browseIndex?: number;
  marketIdentity?: JapaneseMarketIdentity;
  collectorNumber: string;
  rarity: string;
  supertype: string;
  hp: string;
  types: string[];
  setId: string;
  setCode: string;
  setName: string;
  setLocalizedName?: string;
  setEnglishName?: string;
  image: string;
  artist: string;
  stage?: string;
  dexIds?: number[];
  retreatCost?: number | null;
  legalities?: {
    standard?: boolean;
    expanded?: boolean;
  };
  setPrintedTotal?: number;
  setTotal?: number;
  attacks?: Array<{
    name: string;
    cost?: string[];
    damage?: string | number;
    effect?: string;
  }>;
  imageStatus?: "official" | "derived" | "placeholder";
  marketPriceUsd: number;
  psaPopulation: PsaPopulationSnapshot;
  gradingPopulation?: GradingPopulationSnapshot;
  populationBreakdown?: PopulationBreakdown;
  portfolioDefaultQuantity: number;
  priceHistory: PricePoint[];
  marketHistory?: MarketHistorySummary;
  marketHistoryStatus?: MarketHistoryStatus;
  historyUnavailable?: boolean;
  gradedPrices: GradedPrice[];
  recentSales: SaleRecord[];
  evidenceSummary?: EvidenceSummary;
  sourceStatus?: MarketSourceStatus[];
  marketEvidence?: MarketEvidence[];
  priceConsensus?: PriceConsensus;
  sources: CardSourceNote[];
}

export interface SearchResult {
  card: TcgCard;
  score: number;
  matchReason: string;
}

export interface LiveSearchResponse {
  results: SearchResult[];
  totalCount: number | null;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  notice?: string;
}

export interface PortfolioItem {
  cardId: string;
  slug: string;
  name: string;
  setName: string;
  setCode?: string;
  setEnglishName?: string;
  language?: CardLanguageCode;
  englishName?: string;
  setPrintedTotal?: number;
  rarity?: string;
  collectorNumber: string;
  image: string;
  quantity: number;
  grade: GradeLabel;
  costBasisUsd: number;
  marketValueUsd?: number;
  marketValueUpdatedAt?: string;
  marketSource?: string;
  addedAt: string;
}
