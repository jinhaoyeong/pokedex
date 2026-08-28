import type { CardLanguageCode } from "@/types/pokemon";

export interface PokemonTcgSetApiResponse {
  data: Array<{
    id: string;
    name: string;
    series: string;
    releaseDate: string;
    printedTotal?: number;
    total?: number;
  }>;
}

export interface PokemonTcgCardApiPriceBucket {
  low?: number;
  market?: number;
  mid?: number;
}

export interface PokemonTcgCardApiResponse {
  page: number;
  pageSize: number;
  totalCount: number;
  data: Array<{
    id: string;
    name: string;
    supertype?: string;
    hp?: string;
    types?: string[];
    number: string;
    rarity?: string;
    artist?: string;
    images?: {
      small?: string;
      large?: string;
    };
    set: {
      id: string;
      name: string;
      series: string;
      releaseDate: string;
      printedTotal?: number;
      total?: number;
    };
    tcgplayer?: {
      updatedAt?: string;
      prices?: Record<string, PokemonTcgCardApiPriceBucket>;
    };
    cardmarket?: {
      updatedAt?: string;
      prices?: {
        averageSellPrice?: number;
        lowPrice?: number;
        lowPriceExPlus?: number;
        avg1?: number;
        avg7?: number;
        avg30?: number;
        trendPrice?: number;
      };
    };
  }>;
}

export interface TcgdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
}

export interface TcgdexSetBrief {
  id: string;
  name: string;
  releaseDate?: string;
  cardCount?: {
    official?: number;
    total?: number;
  };
}

export interface TcgdexSetResponse {
  id: string;
  name: string;
  releaseDate?: string;
  cardCount?: {
    official?: number;
    total?: number;
  };
  serie?: {
    id: string;
    name: string;
  };
  cards?: TcgdexCardBrief[];
}

export interface TcgdexCardResponse {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  illustrator?: string;
  rarity?: string;
  hp?: string | number | null;
  types?: string[];
  stage?: string;
  dexId?: number[];
  attacks?: Array<{
    cost?: string[];
    name: string;
    effect?: string;
    damage?: string | number;
  }>;
  retreat?: number | null;
  legal?: {
    standard?: boolean;
    expanded?: boolean;
  };
  variants?: Record<string, boolean>;
  set: {
    id: string;
    name: string;
    cardCount?: {
      official?: number;
      total?: number;
    };
  };
  pricing?: {
    tcgplayer?: Record<
      string,
      {
        market?: number;
        low?: number;
        mid?: number;
        marketPrice?: number;
        lowPrice?: number;
        midPrice?: number;
        highPrice?: number;
      }
    >;
    cardmarket?: {
      averageSellPrice?: number;
      lowPrice?: number;
      lowPriceExPlus?: number;
      avg1?: number;
      avg7?: number;
      avg30?: number;
      trendPrice?: number;
      trend?: number;
      low?: number;
      avg?: number;
    };
  };
  updated?: string;
}

export interface TcgdexEnglishCompanion {
  name?: string;
  setName?: string;
  image?: string;
  marketPriceUsd?: number;
}

export interface PokemonCardJpSearchItem {
  cardID: string;
  cardThumbFile: string;
  cardNameAltText: string;
  cardNameViewText: string;
}

export interface PokemonCardJpSearchResponse {
  result: number;
  hitCnt: number;
  thisPage: number;
  maxPage: number;
  cardList: PokemonCardJpSearchItem[];
}

export interface PokemonCardJpDetail {
  cardID: string;
  name: string;
  image: string;
  setCode: string;
  collectorNumber: string;
  /** One-based position in an official/community browse result, never a card number. */
  browseIndex?: number;
  collectorNumberSource?: "official-detail" | "official-browse" | "manual-fallback";
  printedTotal?: number;
  rarity: string;
  hp: string;
  types: string[];
  stage?: string;
  artist: string;
}

export interface PublicUngradedPriceFallback {
  priceUsd: number;
  sampleCount: number;
  matchTier: "strict" | "loose";
  query: string;
}

export interface PokeApiPokemonSpeciesResponse {
  names: Array<{
    name: string;
    language: {
      name: string;
    };
  }>;
}

export type CollectorHeuristicFallback = {
  number: string;
  printedTotal: number;
  lucene: string;
  notice: string;
};

export type CollectorMarketFallback = {
  numbers: string[];
  printedTotal: number;
  language: CardLanguageCode;
  englishCardName: string;
  localizedName?: string;
  setCode: string;
  setEnglishName: string;
};

export type CollectorCodeQuery = {
  rawNumber?: string;
  number: string;
  printedTotal?: number;
  /** Promo / set suffix from queries like `288/SV-P`. */
  setCode?: string;
};

export type SetSortGuideEnrichmentOptions = {
  maxCards?: number;
  budgetMs?: number;
  cardTimeoutMs?: number;
  skipWhenSufficient?: boolean;
};

export type NormalizeTcgdexCardsForSearchOptions = {
  /**
   * Skip the broad per-card English-name resolution. During a localized
   * price-sort this loop fetched TCGdex `/en/cards/{id}` for up to 300 cards
   * (a second unbounded network pass that, with the detail fetch, pushed cold
   * loads past the route budget). The downstream guide-price enrichment already
   * resolves English names (DB-only, fast) for the top cards that surface.
   */
  skipEnglishNameEnrichment?: boolean;
  /** Keep rarity / set totals from already-fetched TCGdex detail payloads. */
  preserveDetailedCards?: boolean;
};
