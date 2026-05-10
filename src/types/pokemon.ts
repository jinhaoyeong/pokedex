export type SupportedCurrency = "USD" | "EUR" | "GBP" | "JPY" | "MYR";

export type GradeLabel =
  | "Ungraded"
  | "PSA 8"
  | "PSA 9"
  | "PSA 10"
  | "BGS 9.5"
  | "CGC 10";

export interface PricePoint {
  date: string;
  value: number;
}

export interface GradedPrice {
  grade: GradeLabel;
  value: number;
  populationCount: number;
}

export interface PopulationGradeCount {
  grade: string;
  count: number;
}

export interface PsaPopulationSnapshot {
  status: "verified" | "pending";
  totalCertified: number | null;
  grades: PopulationGradeCount[];
  source: string;
  fetchedAt: string | null;
  sourceUrl?: string;
  note: string;
}

export interface SaleRecord {
  date: string;
  title: string;
  condition: string;
  price: number;
  source: string;
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
  code: string;
  series: string;
  releaseDate: string;
}

export interface TcgCard {
  id: string;
  slug: string;
  name: string;
  collectorNumber: string;
  rarity: string;
  supertype: string;
  hp: string;
  types: string[];
  setId: string;
  setCode: string;
  setName: string;
  image: string;
  artist: string;
  marketPriceUsd: number;
  psaPopulation: PsaPopulationSnapshot;
  portfolioDefaultQuantity: number;
  priceHistory: PricePoint[];
  gradedPrices: GradedPrice[];
  recentSales: SaleRecord[];
  sources: CardSourceNote[];
}

export interface SearchResult {
  card: TcgCard;
  score: number;
  matchReason: string;
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
