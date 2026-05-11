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

export type GradeLabel = string;
export type MarketConfidence = "high" | "medium" | "low";
export type GradingService = "PSA" | "BGS" | "CGC" | "SGC" | "TAG" | "RAW";
export type MarketEvidenceType = "sold_comp" | "guide_snapshot" | "population" | "catalog";

export interface EvidenceSummary {
  accepted: number;
  rejected: number;
  thin: number;
  fallback: number;
}

export interface PricePoint {
  date: string;
  value: number;
  gradeValues?: Record<string, number>;
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
}

export type GradingPopulationSnapshot = PsaPopulationSnapshot;
export type GradedMarketPrice = GradedPrice;

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
  portfolioDefaultQuantity: number;
  priceHistory: PricePoint[];
  gradedPrices: GradedPrice[];
  recentSales: SaleRecord[];
  evidenceSummary?: EvidenceSummary;
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
  collectorNumber: string;
  image: string;
  quantity: number;
  grade: GradeLabel;
  costBasisUsd: number;
  addedAt: string;
}
