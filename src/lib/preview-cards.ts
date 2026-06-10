import { getFeaturedCards } from "@/lib/cards";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { fetchLiveCardBySlug, searchLiveCards } from "@/lib/pokemon-tcg-api";
import type { TcgCard } from "@/types/pokemon";

export const MARKET_PICKS_LIMIT = 3;

const MARKET_PICK_SLUGS = [
  "sv8pt5-179",
  "sv3pt5-183",
  "sv8pt5-60",
];

const MARKET_PICK_SEARCHES: Array<{ query: string; setFilter?: string }> = [
  { query: "umbreon", setFilter: "sv8pt5" },
  { query: "charizard", setFilter: "sv3pt5" },
  { query: "pikachu", setFilter: "sv8pt5" },
];

function isUsablePreviewCard(card: TcgCard) {
  const headlinePrice = getHeadlineMarketPriceUsd(card);

  return (
    Boolean(card.slug) &&
    Boolean(card.name.trim()) &&
    Boolean(card.setName.trim()) &&
    Boolean(card.collectorNumber.trim()) &&
    headlinePrice >= 5 &&
    headlinePrice <= 2_500 &&
    card.image !== "/icon.svg" &&
    card.imageStatus !== "placeholder"
  );
}

function normalizePreviewCard(card: TcgCard): TcgCard {
  const headlinePrice = Math.round(getHeadlineMarketPriceUsd(card) * 100) / 100;

  return {
    ...card,
    marketPriceUsd: headlinePrice,
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: headlinePrice,
          }
        : price,
    ),
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: headlinePrice,
        }
      : card.priceConsensus,
  };
}

function pushUniqueCards(target: TcgCard[], cards: TcgCard[], limit: number) {
  const seen = new Set(target.map((card) => card.slug));

  for (const card of cards) {
    if (target.length >= limit) {
      break;
    }

    if (!isUsablePreviewCard(card) || seen.has(card.slug)) {
      continue;
    }

    target.push(normalizePreviewCard(card));
    seen.add(card.slug);
  }
}

export async function getLivePreviewCards(limit = MARKET_PICKS_LIMIT): Promise<TcgCard[]> {
  const previewCards: TcgCard[] = [];

  try {
    for (const slug of MARKET_PICK_SLUGS) {
      if (previewCards.length >= limit) {
        break;
      }

      const card = await fetchLiveCardBySlug(slug, {
        includePublicPriceFallback: false,
      });

      if (card) {
        pushUniqueCards(previewCards, [card], limit);
      }
    }
  } catch {
    // Fall back to search-driven selection below when slug lookups fail.
  }

  if (previewCards.length < limit) {
    try {
      for (const search of MARKET_PICK_SEARCHES) {
        if (previewCards.length >= limit) {
          break;
        }

        const response = await searchLiveCards(
          search.query,
          search.setFilter,
          1,
          "en",
          "price-desc",
        );
        pushUniqueCards(
          previewCards,
          response.results.map((result) => result.card),
          limit,
        );
      }
    } catch {
      // Fall back to the local catalog below when live preview selection fails.
    }
  }

  if (previewCards.length < limit) {
    pushUniqueCards(previewCards, getFeaturedCards(limit * 2), limit);
  }

  return previewCards
    .sort(
      (left, right) =>
        getHeadlineMarketPriceUsd(right) - getHeadlineMarketPriceUsd(left),
    )
    .slice(0, limit);
}
