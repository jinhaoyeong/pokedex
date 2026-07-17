import { cache } from "react";

import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
import { loadCardWithGradingMarket } from "@/lib/grading-market";
import {
  resolveCachedCardForDetail,
  resolveCardForCatalog,
} from "@/lib/card-learning.server";
import { getCardBySlug } from "@/lib/cards";
import { resolveGuideSecretRareCardBySlug } from "@/lib/market/pricecharting-set-guide.server";
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

    // Secret-rare supplement cards (`ja--official-pc-<set>-<number>`) exist only
    // in PriceCharting's set guide — the generic official-catalog lookup below
    // treats their id as a pokemon-card.com record and answers with a junk card
    // (empty image/number). Resolve them deterministically from the guide first;
    // the regex inside returns null instantly for every other slug shape.
    const secretRareCard = await resolveGuideSecretRareCardBySlug(slug).catch(() => null);

    if (secretRareCard) {
      return { card: secretRareCard, lookupFailed: false, source: "live" };
    }

    const localCard = getCardBySlug(slug);

    if (localCard) {
      if (!enrichGrading || !cardNeedsGradingMarketEnrichment(localCard)) {
        return { card: localCard, lookupFailed: false, source: "local" };
      }

      return {
        card: await maybeEnrichCardGrading(localCard),
        lookupFailed: false,
        source: "local",
      };
    }

    // Overlap index + learning-cache I/O. Preference order is unchanged: index
    // still wins when present; the cache promise is only consumed on index miss.
    const cachedDetailPromise = resolveCachedCardForDetail(slug).catch(() => null);
    const indexedCard = await lookupCardInIndexBySlug(slug);

    if (indexedCard) {
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
        prefetchedCached: await cachedDetailPromise,
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
