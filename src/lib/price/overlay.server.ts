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

export function overlayCachedPrice(card: TcgCard): TcgCard {
  const cached = readCachedPrice(card.slug, OVERLAY_TTL_MS);
  if (!cached || !(cached.ungradedUsd > 0)) {
    return card;
  }

  const headline = cached.results.find((result) => result.provider === cached.primaryProvider);
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
