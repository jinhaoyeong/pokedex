/**
 * Block-resistant multi-source price pipeline.
 *
 * Every external price source implements `PriceProvider`. The request path only
 * ever runs NON-BLOCKING providers (real APIs); the optional HTML-scraping
 * provider is background-only. See `resolve.server.ts` for the aggregator and
 * `price-cache.server.ts` for the local cache that page views read from first.
 */

import type { GradedPrice, SaleRecord } from "@/types/pokemon";

/** Minimal card identity a provider needs to look up a price. */
export type PriceQuery = {
  slug: string;
  language: string;
  /** Provider-native card id when known, e.g. TCGdex `sv2a-201` / PokemonTCG `sv3pt5-199`. */
  cardId?: string;
  setCode?: string;
  setName?: string;
  /** English set name, used by English-catalog providers for localized cards. */
  setEnglishName?: string;
  collectorNumber?: string;
  name: string;
  /** English card name, used when the native name is localized (e.g. Japanese). */
  englishName?: string;
  rarity?: string;
};

export type ProviderPriceResult = {
  /** Stable provider id, e.g. "tcgdex" | "pokemontcg" | "ebay" | "pricecharting-api". */
  provider: string;
  /** Human-readable source label stored on the card (used by the consensus logic). */
  sourceLabel: string;
  /** Headline ungraded market price in USD. */
  ungradedUsd: number;
  /** 0..1 — how much to trust this source for this card. */
  confidenceScore: number;
  /**
   * 0..1 — how confidently the underlying listing(s) ARE this exact card. 1 for
   * id-based catalog APIs; for eBay it's the strict title-match score. Below the
   * solid threshold the result must not win the headline.
   */
  matchConfidence: number;
  /** "guide_snapshot" for catalog/guide APIs, "sold_comp" for realized sales. */
  evidenceType: "guide_snapshot" | "sold_comp" | "catalog";
  /** Optional per-grade prices (PriceCharting API supplies these). */
  gradedPrices?: GradedPrice[];
  /** Optional realized sales (eBay sold / aggregators). */
  sales?: SaleRecord[];
  /** Number of underlying samples backing the figure, when known. */
  sampleCount?: number;
  fetchedAt: string;
};

export interface PriceProvider {
  /** Stable id; also the env/config key. */
  readonly id: string;
  /** Human label for logs. */
  readonly label: string;
  /**
   * Whether this provider may HTML-scrape (and therefore risk an IP block).
   * Scraping providers are excluded from the request path; only the background
   * warmer passes `allowScrape: true`.
   */
  readonly scrapes: boolean;
  /** True when credentials/config are present so the provider can run. */
  isConfigured(): boolean;
  /** Resolve a price, or null when this provider has nothing for the card. */
  fetchPrice(query: PriceQuery, signal?: AbortSignal): Promise<ProviderPriceResult | null>;
}

/** Aggregated, cache-shaped price record persisted in `pokemon-prices-cache.sqlite`. */
export type ResolvedPrice = {
  slug: string;
  /** Best headline ungraded price in USD (0 when no source returned a value). */
  ungradedUsd: number;
  confidenceScore: number;
  /** Provider id that produced the headline. */
  primaryProvider: string;
  /** All provider results that contributed (for the consensus + transparency). */
  results: ProviderPriceResult[];
  fetchedAt: string;
};
