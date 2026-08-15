import {
  resolveGradingMarketLookupCardName,
  resolveGradingMarketLookupSetName,
} from "@/lib/grading-market-lookup";
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
  const lookupSetName = resolveGradingMarketLookupSetName(card);
  const lookupCardName = resolveGradingMarketLookupCardName(card);

  try {
    const data = await fetchLivePsaData(
      lookupSetName,
      lookupCardName,
      card.collectorNumber,
      card.marketPriceUsd,
      card.setPrintedTotal ?? card.setTotal,
      card.rarity,
      {
        setCode: card.setCode,
        isJapanese: card.language === "ja",
        language: card.language,
        englishCardName: card.englishName?.trim() || undefined,
        productId: card.marketIdentity?.priceChartingProductId ?? undefined,
        productUrl: card.marketIdentity?.priceChartingProductUrl ?? undefined,
        setSlug: card.marketIdentity?.priceChartingSetSlug ?? undefined,
        identityVersion: card.marketIdentity?.identityVersion,
        officialCardId: card.marketIdentity?.officialCardId,
      },
    );

    if (!data) {
      return { card, gradingEnriched: false };
    }

    const next = structuredClone(card);
    mergeLiveMarketDataIntoCard(next, {
      psaPopulation: data.psaPopulation,
      gradedPrices: data.gradedPrices,
      priceHistory: data.priceHistory,
      marketHistory: data.marketHistory,
      populationBreakdown: data.populationBreakdown,
      recentSales: data.recentSales,
      evidenceSummary: data.evidenceSummary,
      sourceStatus: data.sourceStatus,
      marketEvidence: data.marketEvidence,
      priceConsensus: data.priceConsensus,
      nmMarketUsd: data.nmMarketUsd,
    });

    return { card: next, gradingEnriched: true };
  } catch {
    return { card, gradingEnriched: false };
  }
}

export {
  fetchLivePsaData as fetchGradingMarketData,
  fetchQuickLocalizedGuidePrice,
  getPrimaryPsaPopulationLabel as getPrimaryGradingPopulationLabel,
  mergeCatalogAndLiveGradedPrices,
  mergeLiveMarketDataIntoCard,
  mergePriceHistoryWithCatalog,
  shouldPreferIncomingPopulation,
} from "@/lib/psa-population";
