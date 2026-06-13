import { cache } from "react";

import { fetchLiveCardBySlug, searchLiveCards } from "@/lib/pokemon-tcg-api";
import { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";
import { pushUniquePreviewCards } from "@/lib/preview-selection";
import type { TcgCard } from "@/types/pokemon";

export { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";

/** Fixed hero lineup: recognizable chase cards with stable layout order. */
const CURATED_PREVIEW_SLUGS = ["sv8pt5-179", "sv3pt5-183", "sv8pt5-60"];

const PREVIEW_SEARCH_FALLBACKS: Array<{ query: string; setFilter?: string }> = [
  { query: "pikachu ex", setFilter: "sv8pt5" },
  { query: "charizard ex", setFilter: "sv3pt5" },
  { query: "umbreon ex", setFilter: "sv8pt5" },
];

export const getLivePreviewCards = cache(async (limit = MARKET_PICKS_LIMIT): Promise<TcgCard[]> => {
  const previewCards: TcgCard[] = [];

  const slugCards = await Promise.all(
    CURATED_PREVIEW_SLUGS.map((slug) =>
      fetchLiveCardBySlug(slug, {
        includePublicPriceFallback: false,
      }).catch(() => null),
    ),
  );

  for (const card of slugCards) {
    if (previewCards.length >= limit) {
      break;
    }

    if (card) {
      pushUniquePreviewCards(previewCards, [card], limit);
    }
  }

  if (previewCards.length < limit) {
    for (const search of PREVIEW_SEARCH_FALLBACKS) {
      if (previewCards.length >= limit) {
        break;
      }

      try {
        const response = await searchLiveCards(
          search.query,
          search.setFilter,
          1,
          "en",
          "price-desc",
        );
        pushUniquePreviewCards(
          previewCards,
          response.results.map((result) => result.card),
          limit,
        );
      } catch {
        // Try the next fallback search.
      }
    }
  }

  return previewCards.slice(0, limit);
});
