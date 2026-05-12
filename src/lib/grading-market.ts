import type { TcgCard } from "@/types/pokemon";

import {
  fetchLivePsaData,
  mergeLiveMarketDataIntoCard,
} from "@/lib/psa-population";

/**
 * Fetches live grading / population / comps once on the server so the card detail
 * page can render enriched data immediately instead of flashing "Pending" until
 * the client refetches the same data.
 */
export async function loadCardWithGradingMarket(card: TcgCard): Promise<{
  card: TcgCard;
  gradingEnriched: boolean;
}> {
  const lookupSetName = card.setEnglishName?.trim() || card.setName;
  const lookupCardName =
    card.language !== "en" && card.englishName?.trim()
      ? card.englishName.trim()
      : card.name;

  try {
    const data = await fetchLivePsaData(
      lookupSetName,
      lookupCardName,
      card.collectorNumber,
      card.marketPriceUsd,
      card.setPrintedTotal ?? card.setTotal,
    );

    if (!data) {
      return { card, gradingEnriched: false };
    }

    const next = structuredClone(card);
    mergeLiveMarketDataIntoCard(next, {
      psaPopulation: data.psaPopulation,
      gradedPrices: data.gradedPrices,
      priceHistory: data.priceHistory,
      recentSales: data.recentSales,
      evidenceSummary: data.evidenceSummary,
      sourceStatus: data.sourceStatus,
      marketEvidence: data.marketEvidence,
      priceConsensus: data.priceConsensus,
    });

    return { card: next, gradingEnriched: true };
  } catch {
    return { card, gradingEnriched: false };
  }
}

export {
  fetchLivePsaData as fetchGradingMarketData,
  getPrimaryPsaPopulationLabel as getPrimaryGradingPopulationLabel,
  mergeCatalogAndLiveGradedPrices,
  mergeLiveMarketDataIntoCard,
  mergePriceHistoryWithCatalog,
  shouldPreferIncomingPopulation,
} from "@/lib/psa-population";
