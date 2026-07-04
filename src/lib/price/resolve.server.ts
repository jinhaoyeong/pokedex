import "server-only";

import { buildOfficialJapaneseFastPriceCacheKeys } from "@/lib/official-japanese-browse.server";

import { median, SOLID_MATCH_THRESHOLD } from "./match";
import { readCachedPriceBySlugs, writeCachedPrice } from "./price-cache.server";
import { collectrProvider } from "./providers/collectr";
import { ebayProvider } from "./providers/ebay";
import { pokemonTcgProvider } from "./providers/pokemontcg";
import { priceChartingApiProvider } from "./providers/pricecharting-api";
import { tcgdexProvider } from "./providers/tcgdex";
import { nowIso } from "./providers/shared";
import { sanitizeResolvedPrice, sanitizeProviderPriceResult } from "./sanity";
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
  collectrProvider,
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

function normalizeText(value?: string) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function normalizedIdentityText(query: PriceQuery) {
  return [query.slug, query.cardId, query.setCode, query.setName, query.setEnglishName]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function isCollectrProvider(result: ProviderPriceResult) {
  return result.provider === "collectr-fallback" || /collectr/i.test(result.sourceLabel);
}

function isPriceChartingProvider(result: ProviderPriceResult) {
  return result.provider === "pricecharting-api" || /pricecharting/i.test(result.sourceLabel);
}

function isModernMarketCard(query: PriceQuery) {
  const identity = normalizedIdentityText(query);

  return (
    /\bsv\d*[a-z]?\b/.test(identity) ||
    /\bsv\d+pt\d+\b/.test(identity) ||
    /\bswsh\d*[a-z]*\b/.test(identity) ||
    /\bscarlet violet\b/.test(identity) ||
    /\bsword shield\b/.test(identity)
  );
}

function isVintageEnglishMarketCard(query: PriceQuery) {
  if (query.language !== "en") {
    return false;
  }

  const identity = normalizedIdentityText(query);

  return (
    /\bbase\d?\b/.test(identity) ||
    /\bbase set\b/.test(identity) ||
    /\bjungle\b/.test(identity) ||
    /\bfossil\b/.test(identity) ||
    /\bteam rocket\b/.test(identity) ||
    /\bgym heroes\b/.test(identity) ||
    /\bgym challenge\b/.test(identity) ||
    /\bneo\b/.test(identity) ||
    /\blegendary collection\b/.test(identity) ||
    /\bexpedition\b/.test(identity) ||
    /\baquapolis\b/.test(identity) ||
    /\bskyridge\b/.test(identity)
  );
}

function findGradeUsd(result: ProviderPriceResult, gradePattern: RegExp) {
  return result.gradedPrices?.find((price) => gradePattern.test(price.grade))?.value ?? 0;
}

function hasSuspiciouslyLowRawAgainstPsa9(result: ProviderPriceResult) {
  const psa9 = findGradeUsd(result, /^PSA\s*9$/i);

  return psa9 > 0 && result.ungradedUsd > 0 && result.ungradedUsd < psa9 * 0.3;
}

function scoreProviderResultForSelection(result: ProviderPriceResult, query: PriceQuery) {
  let confidenceScore = result.confidenceScore;
  const collectrAdvantaged = query.language === "ja" || isModernMarketCard(query);

  if (isCollectrProvider(result) && collectrAdvantaged && !isVintageEnglishMarketCard(query)) {
    confidenceScore = Math.max(confidenceScore, query.language === "ja" ? 0.74 : 0.68);
  }

  if (isPriceChartingProvider(result) && isVintageEnglishMarketCard(query)) {
    confidenceScore = Math.max(confidenceScore, 0.74);
  }

  if (isPriceChartingProvider(result) && collectrAdvantaged) {
    confidenceScore = Math.min(confidenceScore, query.language === "ja" ? 0.52 : 0.58);
  }

  if (isPriceChartingProvider(result) && hasSuspiciouslyLowRawAgainstPsa9(result)) {
    confidenceScore = Math.min(confidenceScore, 0.24);
  }

  return { ...result, confidenceScore };
}

/**
 * Strict "best real price" selection, in the user's intended priority:
 *   solid-match sold comp  >  guide (PriceCharting API)  >  solid-match active  >  catalog
 * Non-catalog sources must be a SOLID match to be eligible. When only catalog
 * feeds answer, take the highest (a lone mismatched-low never wins) — and for a
 * LOCALIZED card that is honest "unverified" (no real market confirmation), so the
 * confidence is dropped and the UI shows it as an estimate, never a solid price.
 */
function selectBest(results: ProviderPriceResult[], query: PriceQuery): Selection | null {
  const scoredResults = results.map((result) => scoreProviderResultForSelection(result, query));
  const collectrAdvantaged = query.language === "ja" || isModernMarketCard(query);
  const collectrCandidate = scoredResults
    .filter(
      (result) =>
        isCollectrProvider(result) &&
        result.ungradedUsd > 0 &&
        result.matchConfidence >= SOLID_MATCH_THRESHOLD,
    )
    .sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
  const eligible = scoredResults.filter(
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
    // For Japanese/Chinese cards, catalog fields are identity hints, not market evidence.
    if (query.language !== "en") {
      const localizedTcgdex = [...tier]
        .filter(
          (result) =>
            result.matchConfidence >= 1 &&
            /^(tcgdex|tcgdex-open)$/.test(result.provider),
        )
        .sort((a, b) => b.confidenceScore - a.confidenceScore)[0];

      if (localizedTcgdex) {
        return {
          headline: localizedTcgdex,
          confidenceScore: Math.min(localizedTcgdex.confidenceScore, 0.42),
        };
      }

      return null;
    }

    // Catalog-only: highest value wins (drops a lone mismatched-low sibling).
    const headline = [...tier].sort((a, b) => b.ungradedUsd - a.ungradedUsd)[0];
    const prices = tier.map((result) => result.ungradedUsd).filter((price) => price > 0);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const disagreement = prices.length >= 2 && high / Math.max(low, 0.01) > 3;
    const central = median(prices);
    const headlineIsOutlier =
      disagreement && central > 0 && headline.ungradedUsd > Math.max(central * 2.4, central + 500);
    return {
      headline,
      confidenceScore:
        disagreement || headlineIsOutlier
          ? Math.min(headline.confidenceScore, 0.38)
          : headline.confidenceScore,
    };
  }

  // A real source answered — highest confidence within the tier.
  let headline = [...tier].sort((a, b) => b.confidenceScore - a.confidenceScore)[0];

  if (
    collectrAdvantaged &&
    collectrCandidate &&
    isPriceChartingProvider(headline) &&
    hasSuspiciouslyLowRawAgainstPsa9(headline)
  ) {
    headline = collectrCandidate;
  }

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
    const cacheKeys =
      query.language === "ja"
        ? buildOfficialJapaneseFastPriceCacheKeys({
            slug: query.slug,
            cardId: query.cardId,
            setCode: query.setCode,
            collectorNumber: query.collectorNumber,
          })
        : [query.slug];
    const cached = readCachedPriceBySlugs(cacheKeys, ttlMs);
    if (cached && cached.ungradedUsd > 0) {
      return { ...cached, slug: query.slug };
    }
  }

  const providers = ALL_PROVIDERS.filter(
    (provider) => (allowScrape || !provider.scrapes) && provider.isConfigured(),
  );

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.fetchPrice(query, signal)),
  );
  const results = settled.flatMap((entry) =>
    entry.status === "fulfilled" && entry.value ? [sanitizeProviderPriceResult(entry.value)] : [],
  );

  const selection = selectBest(results, query);
  const resolved = sanitizeResolvedPrice({
    slug: query.slug,
    ungradedUsd: selection?.headline.ungradedUsd ?? 0,
    confidenceScore: selection?.confidenceScore ?? 0,
    primaryProvider: selection?.headline.provider ?? "",
    results,
    fetchedAt: nowIso(),
  });

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
