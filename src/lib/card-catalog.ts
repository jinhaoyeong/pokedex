import { cache } from "react";

import { getCardBySlug } from "@/lib/cards";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";
import type { TcgCard } from "@/types/pokemon";

export type CardCatalogLookup = {
  card: TcgCard | null;
  lookupFailed: boolean;
};

export const getCardCatalogCached = cache(
  async (
    slug: string,
    includePublicPriceFallback: boolean,
  ): Promise<CardCatalogLookup> => {
    const localCard = getCardBySlug(slug);

    if (localCard) {
      return { card: localCard, lookupFailed: false };
    }

    try {
      return {
        card: await fetchLiveCardBySlug(slug, { includePublicPriceFallback }),
        lookupFailed: false,
      };
    } catch (error) {
      console.error(`Live card lookup failed for "${slug}"`, error);
      return { card: null, lookupFailed: true };
    }
  },
);
