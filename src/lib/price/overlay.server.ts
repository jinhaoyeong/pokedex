import "server-only";

import type { TcgCard } from "@/types/pokemon";

import { readCachedPrice } from "./price-cache.server";

/**
 * Cache-FIRST price overlay for the server render path. Reads ONLY the local
 * price cache (no network, never a scrape) and applies a warmed price to the
 * card. Misses leave the card untouched; the background warmer / `/api/price`
 * fill the cache out of band. This is how a card shows the resilient multi-source
 * price without the render ever triggering an external fetch.
 */

const OVERLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Only apply a CONFIDENT cached price. An unverified localized catalog value
// (e.g. a mismatched JP CardMarket listing, confidence ~0.3) must not override
// the card's own estimate — that's the "$5 on a $1k card" case.
const OVERLAY_MIN_CONFIDENCE = 0.45;
const TRUSTED_OVERLAY_PROVIDERS = new Set(["pricecharting-api", "ebay"]);

export function overlayCachedPrice(card: TcgCard): TcgCard {
  const cached = readCachedPrice(card.slug, OVERLAY_TTL_MS);
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

  const consensus = card.priceConsensus
    ? {
        ...card.priceConsensus,
        finalEstimateUsd: cached.ungradedUsd,
        confidenceScore: cached.confidenceScore,
        confidence:
          cached.confidenceScore >= 0.72
            ? ("high" as const)
            : cached.confidenceScore >= 0.45
              ? ("medium" as const)
              : ("low" as const),
      }
    : card.priceConsensus;

  return {
    ...card,
    marketPriceUsd: cached.ungradedUsd,
    priceConsensus: consensus,
    sources: [
      {
        source: sourceLabel,
        status: cached.confidenceScore >= 0.6 ? "verified" : "estimated",
        fetchedAt: cached.fetchedAt,
        confidence: cached.confidenceScore,
        note: "Warmed from the multi-source price cache.",
      },
      ...card.sources.filter((source) => source.source !== sourceLabel),
    ],
  };
}
