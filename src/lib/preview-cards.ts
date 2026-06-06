import { getFeaturedCards } from "@/lib/cards";
import { searchLiveCards } from "@/lib/pokemon-tcg-api";
import type { TcgCard } from "@/types/pokemon";

function isUsablePreviewCard(card: TcgCard) {
  return (
    Boolean(card.slug) &&
    Boolean(card.name.trim()) &&
    Boolean(card.setName.trim()) &&
    Boolean(card.collectorNumber.trim()) &&
    card.marketPriceUsd > 0 &&
    card.image !== "/icon.svg" &&
    card.imageStatus !== "placeholder"
  );
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

    target.push(card);
    seen.add(card.slug);
  }
}

export async function getLivePreviewCards(limit = 3): Promise<TcgCard[]> {
  const previewCards: TcgCard[] = [];

  try {
    for (let page = 1; page <= 3 && previewCards.length < limit; page += 1) {
      const response = await searchLiveCards("", undefined, page, "en", "price-desc");
      pushUniqueCards(
        previewCards,
        response.results.map((result) => result.card),
        limit,
      );
    }
  } catch {
    // The local catalog below is only a render safety net when the public catalog is down.
  }

  if (previewCards.length < limit) {
    pushUniqueCards(previewCards, getFeaturedCards(limit * 2), limit);
  }

  return previewCards.slice(0, limit);
}
