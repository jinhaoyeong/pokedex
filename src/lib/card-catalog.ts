import { cache } from "react";

import { resolveCardForCatalog } from "@/lib/card-learning.server";
import { getCardBySlug } from "@/lib/cards";
import { lookupCardInIndexBySlug } from "@/lib/pokemon-cards-index.server";
import type { TcgCard } from "@/types/pokemon";

export type CardCatalogLookup = {
  card: TcgCard | null;
  lookupFailed: boolean;
  source?: "local" | "live" | "cache";
};

export const getCardCatalogCached = cache(
  async (
    slug: string,
    includePublicPriceFallback: boolean,
    options: { enrichGrading?: boolean } = {},
  ): Promise<CardCatalogLookup> => {
    const localCard = getCardBySlug(slug);

    if (localCard) {
      return { card: localCard, lookupFailed: false, source: "local" };
    }

    const indexedCard = lookupCardInIndexBySlug(slug);

    if (indexedCard) {
      return { card: indexedCard, lookupFailed: false, source: "local" };
    }

    try {
      const resolved = await resolveCardForCatalog(slug, includePublicPriceFallback, options);

      return {
        card: resolved.card,
        lookupFailed: resolved.source === "none",
        source: resolved.source === "none" ? undefined : resolved.source,
      };
    } catch (error) {
      console.error(`Live card lookup failed for "${slug}"`, error);
      return { card: null, lookupFailed: true };
    }
  },
);
