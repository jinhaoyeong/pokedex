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
  /** Verified PriceCharting product id. When present, skip fuzzy product search. */
  productId?: string;
  /** Verified public PriceCharting `/game/...` URL for this exact print. */
  productUrl?: string;
  /** Verified PriceCharting console/set slug containing this exact print. */
  setSlug?: string;
  /** Official Japanese catalog id. Kept separate from provider-native cardId. */
  officialCardId?: string;
  /** Official browse position, never a printed collector number. */
  browseIndex?: number;
  /** Canonical identity version used to invalidate dependent market caches. */
  identityVersion?: number;
  /** Fully versioned cache key produced from the canonical Japanese identity. */
  cacheIdentityKey?: string;
  /** Print finish so PriceCharting/sold lookups stay on holo vs reverse vs non-holo. */
  finish?: string;
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
  /** Provider record URL when available, useful for diagnostics and no-price catalog hits. */
  sourceUrl?: string;
  /** Optional realized sales (eBay sold / aggregators). */
  sales?: SaleRecord[];
  /** Provider-native product id used for an exact match, when known. */
  productId?: string;
  /** Exact provider product display name, useful for localized-name translation. */
  productName?: string;
  /** Public product page for the exact matched print. */
  productUrl?: string;
  /** Provider-native set/console slug containing the exact matched print. */
  setSlug?: string;
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

export type PriceProviderAttemptStatus =
  | "success"
  | "no_match"
  | "timeout"
  | "circuit_open"
  | "provider_error";

export type PriceProviderAttempt = {
  provider: string;
  status: PriceProviderAttemptStatus;
  latencyMs: number;
  error?: string;
};

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
  /** Retry-safe provider outcome diagnostics; transient errors are never cached as matches. */
  providerAttempts?: PriceProviderAttempt[];
  fetchedAt: string;
  /** TCGPlayer / Pokemon TCG catalog NM, when present and distinct from the sold/guide headline. */
  nmMarketUsd?: number | null;
};
