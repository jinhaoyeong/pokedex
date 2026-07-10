import {
  fetchPriceChartingMarketPrice,
  isPriceChartingApiConfigured,
} from "@/lib/market/pricecharting-provider";
import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";
import { nowIso } from "./shared";

/**
 * Official PriceCharting API adapter.
 *
 * Uses the paid JSON API instead of HTML scraping. Authentication is handled by
 * the shared client with PRICECHARTING_API_KEY or PRICECHARTING_API_TOKEN.
 */
function isLocalFailoverStressQuery(query: PriceQuery) {
  return process.env.NODE_ENV !== "production" && query.slug.includes("stress-failover");
}

export const priceChartingApiProvider: PriceProvider = {
  id: "pricecharting-api",
  label: "PriceCharting API",
  scrapes: false,
  isConfigured() {
    // This provider is explicitly the paid JSON API adapter. Treating it as
    // configured without a token made the supposedly non-scraping /api/price
    // path silently fall back to PriceCharting HTML and trigger 429 bursts.
    return isPriceChartingApiConfigured();
  },
  async fetchPrice(query: PriceQuery, signal?: AbortSignal): Promise<ProviderPriceResult | null> {
    if (isLocalFailoverStressQuery(query)) {
      console.warn("PriceCharting stress-test block simulated", {
        slug: query.slug,
        status: 403,
      });
      return null;
    }

    const market = await fetchPriceChartingMarketPrice(
      {
        language: query.language,
        name: query.name,
        englishName: query.englishName,
        setName: query.setName,
        setEnglishName: query.setEnglishName,
        setCode: query.setCode,
        collectorNumber: query.collectorNumber,
        rarity: query.rarity,
      },
      signal,
    );

    if (!market) {
      return null;
    }

    const provider =
      /tcgdex/i.test(market.sourceLabel)
        ? "tcgdex-open"
        : /pokemon\s*tcg/i.test(market.sourceLabel)
          ? "pokemontcg-open"
          : this.id;

    return {
      provider,
      sourceLabel: market.sourceLabel,
      ungradedUsd: market.ungradedUsd,
      confidenceScore: market.confidenceScore,
      matchConfidence: market.matchConfidence,
      evidenceType: market.evidenceType,
      gradedPrices: market.gradedPrices,
      sourceUrl: market.sourceUrl,
      sampleCount: 1,
      fetchedAt: nowIso(),
    };
  },
};
