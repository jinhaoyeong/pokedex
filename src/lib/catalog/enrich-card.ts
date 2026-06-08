import type { TcgCard } from "@/types/pokemon";

import { lookupLastSoldForCard } from "@/lib/catalog/market-store";

export async function enrichCardWithCatalogData(card: TcgCard): Promise<TcgCard> {
  const lastSold = await lookupLastSoldForCard(card);
  if (!lastSold?.lastSoldAt) {
    return card;
  }

  const next = structuredClone(card);
  const ungraded = next.gradedPrices.find((price) => price.grade === "Ungraded");
  if (ungraded) {
    ungraded.lastSoldAt = lastSold.lastSoldAt;
  }

  if (!next.recentSales.length && lastSold.lastSoldPriceUsd) {
    next.recentSales = [
      {
        date: lastSold.lastSoldAt,
        title: card.name,
        condition: "Ungraded",
        price: lastSold.lastSoldPriceUsd,
        source: lastSold.source ?? "Catalog cache",
        confidence: "medium",
        confidenceScore: 0.55,
        evidenceType: "sold_comp",
      },
    ];
  }

  return next;
}

export async function enrichCardsWithCatalogData(cards: TcgCard[]) {
  return Promise.all(cards.map((card) => enrichCardWithCatalogData(card)));
}
