import "server-only";

import { SOLID_MATCH_THRESHOLD } from "./match";
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

function evidencePriority(evidenceType: ProviderPriceResult["evidenceType"]): number {
  if (evidenceType === "sold_comp") {
    return 3;
  }
  if (evidenceType === "guide_snapshot") {
    return 2;
  }
  return 1; // catalog
}

type Selection = { headline: ProviderPriceResult; confidenceScore: number };

/**
 * Strict "best real price" selection, in the user's intended priority:
 *   solid-match sold comp  >  guide (PriceCharting API)  >  solid-match active  >  catalog
 * Non-catalog sources must be a SOLID match to be eligible. When only catalog
 * feeds answer, take the highest (a lone mismatched-low never wins) — and for a
 * LOCALIZED card that is honest "unverified" (no real market confirmation), so the
 * confidence is dropped and the UI shows it as an estimate, never a solid price.
 */
function selectBest(results: ProviderPriceResult[], language: string): Selection | null {
  const eligible = results.filter(
    (result) =>
      result.ungradedUsd > 0 &&
      (result.evidenceType === "catalog" || result.matchConfidence >= SOLID_MATCH_THRESHOLD),
  );
  if (!eligible.length) {
    return null;
  }

  const maxTier = Math.max(...eligible.map((result) => evidencePriority(result.evidenceType)));
  const tier = eligible.filter((result) => evidencePriority(result.evidenceType) === maxTier);

  if (maxTier === 1) {
    // Catalog-only: highest value wins (drops a lone mismatched-low sibling).
    const headline = [...tier].sort((a, b) => b.ungradedUsd - a.ungradedUsd)[0];
    const localized = language !== "en";
    return {
      headline,
      // A localized catalog price has no real market confirmation — mark it
      // unverified (low confidence) instead of presenting it as a solid price.
      confidenceScore: localized ? Math.min(headline.confidenceScore, 0.3) : headline.confidenceScore,
    };
  }

  // A real source answered — highest confidence within the tier.
  const headline = [...tier].sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
  return { headline, confidenceScore: headline.confidenceScore };
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

  const selection = selectBest(results, query.language);
  const resolved: ResolvedPrice = {
    slug: query.slug,
    ungradedUsd: selection?.headline.ungradedUsd ?? 0,
    confidenceScore: selection?.confidenceScore ?? 0,
    primaryProvider: selection?.headline.provider ?? "",
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
