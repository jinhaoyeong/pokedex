import { cache } from "react";

import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
import { loadCardWithGradingMarket } from "@/lib/grading-market";
import { resolveCardForCatalog } from "@/lib/card-learning.server";
import { getCardBySlug } from "@/lib/cards";
import { lookupCardInIndexBySlug } from "@/lib/pokemon-cards-index.server";
import { overlayCachedPrice } from "@/lib/price/overlay.server";
import type { TcgCard } from "@/types/pokemon";

export type CardCatalogLookup = {
  card: TcgCard | null;
  lookupFailed: boolean;
  source?: "local" | "live" | "cache";
};

async function maybeEnrichCardGrading(card: TcgCard) {
  if (!cardNeedsGradingMarketEnrichment(card)) {
    return card;
  }

  const enriched = await loadCardWithGradingMarket(card);
  return enriched.card;
}

async function resolveCardCatalogLookup(
  slug: string,
  includePublicPriceFallback: boolean,
  options: { enrichGrading?: boolean } = {},
): Promise<CardCatalogLookup> {
  {
    const enrichGrading = options.enrichGrading ?? false;
    const localCard = getCardBySlug(slug);

    if (localCard && localCard.marketPriceUsd > 0) {
      if (!enrichGrading || !cardNeedsGradingMarketEnrichment(localCard)) {
        return { card: localCard, lookupFailed: false, source: "local" };
      }

      return {
        card: await maybeEnrichCardGrading(localCard),
        lookupFailed: false,
        source: "local",
      };
    }

    const indexedCard = lookupCardInIndexBySlug(slug);

    if (indexedCard && indexedCard.marketPriceUsd > 0) {
      if (!enrichGrading || !cardNeedsGradingMarketEnrichment(indexedCard)) {
        return { card: indexedCard, lookupFailed: false, source: "local" };
      }

      return {
        card: await maybeEnrichCardGrading(indexedCard),
        lookupFailed: false,
        source: "local",
      };
    }

    try {
      const resolved = await resolveCardForCatalog(slug, includePublicPriceFallback, {
        enrichGrading,
      });

      return {
        card: resolved.card,
        lookupFailed: resolved.source === "none",
        source: resolved.source === "none" ? undefined : resolved.source,
      };
    } catch (error) {
      console.error(`Live card lookup failed for "${slug}"`, error);
      return { card: null, lookupFailed: true };
    }
  }
}

export const getCardCatalogCached = cache(
  async (
    slug: string,
    includePublicPriceFallback: boolean,
    options: { enrichGrading?: boolean } = {},
  ): Promise<CardCatalogLookup> => {
    const result = await resolveCardCatalogLookup(slug, includePublicPriceFallback, options);
    // Cache-first price overlay: apply a warmed multi-source price without any
    // provider fetch in the render path. Misses leave the card as-is.
    return result.card ? { ...result, card: await overlayCachedPrice(result.card) } : result;
  },
);
