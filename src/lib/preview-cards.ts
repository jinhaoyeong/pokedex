import { cache } from "react";

import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { searchLiveCards } from "@/lib/pokemon-tcg-api";
import { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";
import { pushUniquePreviewCards } from "@/lib/preview-selection";
import type { TcgCard } from "@/types/pokemon";

export { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";

const PREVIEW_SET_CANDIDATES = ["me2pt5", "sv10", "sv9", "sv8pt5", "sv6pt5"];

export const getLivePreviewCards = cache(async (limit = MARKET_PICKS_LIMIT): Promise<TcgCard[]> => {
  const previewCards: TcgCard[] = [];

  for (const setId of PREVIEW_SET_CANDIDATES) {
    if (previewCards.length >= limit) {
      break;
    }

    try {
      const response = await searchLiveCards("", setId, 1, "en", "price-desc");
      pushUniquePreviewCards(
        previewCards,
        response.results.map((result) => result.card),
        limit,
      );
    } catch {
      // Try the next recent set candidate.
    }
  }

  if (previewCards.length < limit) {
    try {
      const response = await searchLiveCards("", undefined, 1, "en", "price-desc");
      pushUniquePreviewCards(
        previewCards,
        response.results.map((result) => result.card),
        limit,
      );
    } catch {
      // Leave the section empty when live preview selection fails.
    }
  }

  return previewCards
    .sort(
      (left, right) =>
        getHeadlineMarketPriceUsd(right) - getHeadlineMarketPriceUsd(left),
    )
    .slice(0, limit);
});
