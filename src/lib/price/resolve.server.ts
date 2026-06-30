import "server-only";

import { readCachedPrice, writeCachedPrice } from "./price-cache.server";
import { ebayProvider } from "./providers/ebay";
import { pokemonTcgProvider } from "./providers/pokemontcg";
import { priceChartingApiProvider } from "./providers/pricecharting-api";
import { tcgdexProvider } from "./providers/tcgdex";
import { nowIso } from "./providers/shared";
import type { PriceProvider, PriceQuery, ProviderPriceResult, ResolvedPrice } from "./types";

/**
 * Block-resistant price aggregator.
 *
 * Request path: `resolvePrice(query)` → cache-first, then ONLY the non-blocking
 * API providers (never a scrape). Background warmer: `allowScrape: true` may also
 * use scraping providers as a last-resort gap-filler. Either way results are
 * written to the local cache so the next view is instant.
 */

const ALL_PROVIDERS: PriceProvider[] = [
  priceChartingApiProvider,
  ebayProvider,
  tcgdexProvider,
  pokemonTcgProvider,
];

// Default freshness for cache reads on the request path: 24h.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function evidenceBonus(evidenceType: ProviderPriceResult["evidenceType"]): number {
  if (evidenceType === "sold_comp") {
    return 0.3;
  }
  if (evidenceType === "guide_snapshot") {
    return 0.15;
  }
  return 0;
}

/**
 * Choose the headline. A real guide/sold source always beats catalog feeds. When
 * only catalog feeds answered, take the HIGHER value — a single mismatched feed
 * (the bug that showed a Charizard at ~$1.48) shouldn't win over a saner sibling.
 */
function pickHeadline(results: ProviderPriceResult[]): ProviderPriceResult | null {
  if (!results.length) {
    return null;
  }

  const nonCatalog = results.filter((result) => result.evidenceType !== "catalog");
  if (nonCatalog.length) {
    return [...nonCatalog].sort(
      (a, b) =>
        b.confidenceScore + evidenceBonus(b.evidenceType) - (a.confidenceScore + evidenceBonus(a.evidenceType)),
    )[0];
  }

  return [...results].sort((a, b) => b.ungradedUsd - a.ungradedUsd)[0];
}

export type ResolvePriceOptions = {
  /** Allow scraping providers (background warmer only). Request path leaves false. */
  allowScrape?: boolean;
  /** Cache freshness window. `0` forces a refresh (warmer uses this). */
  ttlMs?: number;
  /** Skip the cache read entirely (warmer). */
  refresh?: boolean;
  signal?: AbortSignal;
};

export async function resolvePrice(
  query: PriceQuery,
  options: ResolvePriceOptions = {},
): Promise<ResolvedPrice> {
  const { allowScrape = false, ttlMs = DEFAULT_TTL_MS, refresh = false, signal } = options;

  if (!refresh) {
    const cached = readCachedPrice(query.slug, ttlMs);
    if (cached && cached.ungradedUsd > 0) {
      return cached;
    }
  }

  const providers = ALL_PROVIDERS.filter(
    (provider) => (allowScrape || !provider.scrapes) && provider.isConfigured(),
  );

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.fetchPrice(query, signal)),
  );
  const results = settled.flatMap((entry) =>
    entry.status === "fulfilled" && entry.value ? [entry.value] : [],
  );

  const headline = pickHeadline(results);
  const resolved: ResolvedPrice = {
    slug: query.slug,
    ungradedUsd: headline?.ungradedUsd ?? 0,
    confidenceScore: headline?.confidenceScore ?? 0,
    primaryProvider: headline?.provider ?? "",
    results,
    fetchedAt: nowIso(),
  };

  if (resolved.ungradedUsd > 0) {
    writeCachedPrice(resolved, { language: query.language, setCode: query.setCode });
  }

  return resolved;
}

/** Which sources are currently usable (for diagnostics / the warmer log). */
export function configuredProviderIds(allowScrape = false): string[] {
  return ALL_PROVIDERS.filter(
    (provider) => (allowScrape || !provider.scrapes) && provider.isConfigured(),
  ).map((provider) => provider.id);
}
