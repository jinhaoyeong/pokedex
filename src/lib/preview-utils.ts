import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import type { TcgCard } from "@/types/pokemon";

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

export function mergeBootPreviewCards(current: TcgCard[], boot: TcgCard[]) {
  if (!boot.length) {
    return current;
  }

  if (!current.length) {
    return boot.map(normalizePreviewCard);
  }

  const bootBySlug = new Map(
    boot.map((card) => [card.slug, normalizePreviewCard(card)]),
  );
  const hasOverlap = current.some((card) => bootBySlug.has(card.slug));

  if (!hasOverlap) {
    return current;
  }

  return current.map((card) => bootBySlug.get(card.slug) ?? card);
}
