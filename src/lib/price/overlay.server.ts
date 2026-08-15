import "server-only";

import {
  getHeadlineMarketPriceUsd,
  isSuspiciouslyLowCatalogPrice,
} from "@/lib/localized-set-market";
import { readCachedOpenSourceMarketFallback } from "@/lib/market/open-source-market-provider";
import { buildOfficialJapaneseFastPriceCacheKeys } from "@/lib/official-japanese-browse.server";
import { lookupCachedCardBySlug } from "@/lib/pokemon-cards-cache.server";
import type { LiveSearchResponse, SearchResult, TcgCard } from "@/types/pokemon";

import { priceCacheSlugAliases } from "./price-cache-keys";
import { readCachedPriceBySlugs } from "./price-cache.server";

/**
 * Cache-FIRST price overlay for the server render path. Reads ONLY the
 * persistent price cache (Supabase; no provider fetch, never a scrape) and
 * applies a warmed price to the card. Misses leave the card untouched; the
 * background warmer / `/api/price` fill the cache out of band. This is how a
 * card shows the resilient multi-source price without the render ever
 * triggering an external provider fetch.
 */

const OVERLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Only apply a CONFIDENT cached price. An unverified localized catalog value
// (e.g. a mismatched JP CardMarket listing, confidence ~0.3) must not override
// the card's own estimate — that's the "$5 on a $1k card" case.
const OVERLAY_MIN_CONFIDENCE = 0.45;
const TRUSTED_OVERLAY_PROVIDERS = new Set(["pricecharting-api", "ebay"]);
const REAL_MARKET_SOURCE_PATTERN =
  /pricecharting|public guide|public page|grading market consensus|ebay|sold comp|marketplace/i;

type CachedPriceOverlay = {
  value: number;
  confidenceScore: number;
  sourceLabel: string;
  fetchedAt: string;
  provider?: string;
};

function upsertUngradedPrice(card: TcgCard, value: number, sourceLabel: string, confidenceScore: number) {
  return card.gradedPrices.map((price) =>
    price.grade === "Ungraded"
      ? {
          ...price,
          value,
          source: sourceLabel,
          confidence:
            confidenceScore >= 0.72 ? ("high" as const) : confidenceScore >= 0.45 ? ("medium" as const) : ("low" as const),
          confidenceScore,
        }
      : price,
  );
}

function applyCachedPriceOverlay(card: TcgCard, overlay: CachedPriceOverlay): TcgCard {
  const consensus = card.priceConsensus
    ? {
        ...card.priceConsensus,
        finalEstimateUsd: overlay.value,
        confidenceScore: overlay.confidenceScore,
        confidence:
          overlay.confidenceScore >= 0.72
            ? ("high" as const)
            : overlay.confidenceScore >= 0.45
              ? ("medium" as const)
              : ("low" as const),
      }
    : {
        finalEstimateUsd: overlay.value,
        confidence:
          overlay.confidenceScore >= 0.72
            ? ("high" as const)
            : overlay.confidenceScore >= 0.45
              ? ("medium" as const)
              : ("low" as const),
        confidenceScore: overlay.confidenceScore,
        sourceCount: 1,
        sampleCount: 0,
        methodology: "Warmed market price from the local multi-source cache.",
        sources: [
          {
            source: overlay.sourceLabel,
            value: overlay.value,
            confidence:
              overlay.confidenceScore >= 0.72
                ? ("high" as const)
                : overlay.confidenceScore >= 0.45
                  ? ("medium" as const)
                  : ("low" as const),
            confidenceScore: overlay.confidenceScore,
            evidenceType: "guide_snapshot" as const,
            note: "Applied from local cache before rendering the search list.",
          },
        ],
      };

  return {
    ...card,
    marketPriceUsd: overlay.value,
    gradedPrices: upsertUngradedPrice(card, overlay.value, overlay.sourceLabel, overlay.confidenceScore),
    priceHistory: card.priceHistory.map((point) => ({
      ...point,
      value: point.value > 0 ? point.value : overlay.value,
      gradeValues: point.gradeValues
        ? { ...point.gradeValues, Ungraded: point.gradeValues.Ungraded ?? overlay.value }
        : point.gradeValues,
    })),
    priceConsensus: consensus,
    sources: [
      {
        source: overlay.sourceLabel,
        status: overlay.confidenceScore >= 0.6 ? "verified" : "estimated",
        fetchedAt: overlay.fetchedAt,
        confidence: overlay.confidenceScore,
        note: "Warmed from the local multi-source price cache.",
      },
      ...card.sources.filter((source) => source.source !== overlay.sourceLabel),
    ],
  };
}

export async function overlayCachedPrice(card: TcgCard): Promise<TcgCard> {
  const cacheKeys = [
    ...priceCacheSlugAliases({
      slug: card.slug,
      language: card.language,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      officialCardId: card.officialCardId,
      cardId: card.id,
      finish: card.finish,
    }),
    ...(card.language === "ja"
      ? buildOfficialJapaneseFastPriceCacheKeys({
          slug: card.slug,
          cardId: card.id,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
        })
      : []),
  ];
  const cached = await readCachedPriceBySlugs(cacheKeys, OVERLAY_TTL_MS);
  if (!cached || !(cached.ungradedUsd > 0) || cached.confidenceScore < OVERLAY_MIN_CONFIDENCE) {
    return card;
  }

  const headline = cached.results.find((result) => result.provider === cached.primaryProvider);
  const hasTrustedOverlaySource =
    TRUSTED_OVERLAY_PROVIDERS.has(cached.primaryProvider) ||
    cached.results.some(
      (result) =>
        TRUSTED_OVERLAY_PROVIDERS.has(result.provider) &&
        result.ungradedUsd > 0 &&
        result.confidenceScore >= OVERLAY_MIN_CONFIDENCE,
    );
  if (!hasTrustedOverlaySource) {
    return card;
  }

  const sourceLabel = headline?.sourceLabel ?? "Cached market price";

  return applyCachedPriceOverlay(card, {
    value: cached.ungradedUsd,
    confidenceScore: cached.confidenceScore,
    sourceLabel,
    fetchedAt: cached.fetchedAt,
    provider: cached.primaryProvider,
  });
}

function hasRealMarketEvidence(card: TcgCard) {
  return Boolean(
    card.recentSales.length ||
      card.marketEvidence?.some((item) => item.evidenceType === "sold_comp") ||
      card.priceConsensus?.sources?.some(
        (source) =>
          source.value > 0 &&
          source.confidenceScore >= 0.5 &&
          (source.evidenceType !== "catalog" || REAL_MARKET_SOURCE_PATTERN.test(source.source)),
      ) ||
      card.gradedPrices.some(
        (price) =>
          price.grade === "Ungraded" &&
          price.value > 0 &&
          REAL_MARKET_SOURCE_PATTERN.test(price.source ?? ""),
      ) ||
      card.sources.some((source) => REAL_MARKET_SOURCE_PATTERN.test(source.source)),
  );
}

function shouldUseOverlay(current: TcgCard, value: number, confidenceScore: number) {
  const currentPrice = getHeadlineMarketPriceUsd(current);

  if (!(value > 0)) {
    return false;
  }

  if (!(currentPrice > 0)) {
    return true;
  }

  if (isSuspiciouslyLowCatalogPrice(current) && value > currentPrice * 1.15) {
    return true;
  }

  if (confidenceScore >= 0.5 && value > currentPrice * 1.25) {
    return true;
  }

  return current.language !== "en" && value > currentPrice * 1.8;
}

async function overlayCachedCardPrice(card: TcgCard): Promise<TcgCard> {
  const cached = await lookupCachedCardBySlug(card.slug);
  const cachedCard = cached?.card;

  if (!cachedCard || cachedCard.language !== card.language || cached.meta.priceStatus === "disputed") {
    return card;
  }

  const value = getHeadlineMarketPriceUsd(cachedCard);

  if (!shouldUseOverlay(card, value, cached.meta.trustScore) || !hasRealMarketEvidence(cachedCard)) {
    return card;
  }

  return {
    ...card,
    marketPriceUsd: value,
    gradedPrices: cachedCard.gradedPrices.length ? cachedCard.gradedPrices : card.gradedPrices,
    priceHistory: cachedCard.priceHistory.length ? cachedCard.priceHistory : card.priceHistory,
    recentSales: cachedCard.recentSales.length ? cachedCard.recentSales : card.recentSales,
    evidenceSummary: cachedCard.evidenceSummary ?? card.evidenceSummary,
    sourceStatus: cachedCard.sourceStatus ?? card.sourceStatus,
    marketEvidence: cachedCard.marketEvidence ?? card.marketEvidence,
    priceConsensus: cachedCard.priceConsensus ?? card.priceConsensus,
    sources: [
      ...cachedCard.sources.filter((source) => REAL_MARKET_SOURCE_PATTERN.test(source.source)),
      ...card.sources,
    ],
  };
}

async function overlayOpenSourceFileCache(card: TcgCard): Promise<TcgCard> {
  const cached = await readCachedOpenSourceMarketFallback({
    language: card.language,
    name: card.name,
    englishName: card.englishName,
    setName: card.setName,
    setEnglishName: card.setEnglishName,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
  });

  if (
    !cached ||
    !(cached.ungradedUsd > 0) ||
    cached.status === "catalog_found_no_price" ||
    (card.language !== "en" && !REAL_MARKET_SOURCE_PATTERN.test(cached.sourceLabel)) ||
    !shouldUseOverlay(card, cached.ungradedUsd, cached.confidenceScore)
  ) {
    return card;
  }

  return applyCachedPriceOverlay(card, {
    value: cached.ungradedUsd,
    confidenceScore: cached.confidenceScore,
    sourceLabel: cached.sourceLabel,
    fetchedAt: cached.fetchedAt,
    provider: cached.provider,
  });
}

export async function overlayCachedSearchResultPrices(
  results: SearchResult[],
): Promise<SearchResult[]> {
  const overlaid = await Promise.all(
    results.map(async (result) => {
      const localCacheCard = await overlayCachedCardPrice(result.card);
      const priceCacheCard = await overlayCachedPrice(localCacheCard);
      const fileCacheCard = await overlayOpenSourceFileCache(priceCacheCard);

      return fileCacheCard === result.card ? result : { ...result, card: fileCacheCard };
    }),
  );

  return overlaid;
}

export async function overlayCachedSearchResponsePrices(
  response: LiveSearchResponse,
): Promise<LiveSearchResponse> {
  if (!response.results.length) {
    return response;
  }

  return {
    ...response,
    results: await overlayCachedSearchResultPrices(response.results),
  };
}
