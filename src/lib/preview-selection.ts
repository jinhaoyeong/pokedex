import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import type { TcgCard } from "@/types/pokemon";

export function isUsablePreviewCard(card: TcgCard) {
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

export function normalizePreviewCard(card: TcgCard): TcgCard {
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

export function pushUniquePreviewCards(target: TcgCard[], cards: TcgCard[], limit: number) {
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
