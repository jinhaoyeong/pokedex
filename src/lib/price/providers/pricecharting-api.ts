import { fetchPriceChartingMarketPrice } from "@/lib/market/pricecharting-provider";
import { parseCardFinishId } from "@/lib/card-finish";
import { hasPricedMarketPayload } from "../priced-payload";
import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";
import { nowIso } from "./shared";

/**
 * PriceCharting market adapter.
 *
 * Prefers the paid JSON API when configured; otherwise (and on API miss) uses the
 * public set-slug guide page via the shared reader proxy, then open-source catalogs.
 */
function isLocalFailoverStressQuery(query: PriceQuery) {
  return process.env.NODE_ENV !== "production" && query.slug.includes("stress-failover");
}

export const priceChartingApiProvider: PriceProvider = {
  id: "pricecharting-api",
  label: "PriceCharting API",
  scrapes: false,
  isConfigured() {
    // Even without PRICECHARTING_API_KEY, fetchPriceChartingMarketPrice can still
    // resolve guide prices from the public set-slug page (via the Jina reader) or
    // open-source catalog fallbacks. Treating the provider as unconfigured here
    // left official Japanese sets with a PriceCharting slug (e.g. M4) at $0.
    return true;
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
        finish: parseCardFinishId(query.finish) ?? undefined,
        productId: query.productId,
        productUrl: query.productUrl,
        setSlug: query.setSlug,
      },
      signal,
    );

    if (!market || !hasPricedMarketPayload(market)) {
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
      sales: market.sales,
      sourceUrl: market.sourceUrl,
      productId: market.productId,
      productUrl: market.productUrl,
      setSlug: market.setSlug,
      sampleCount: market.sampleCount ?? market.sales?.length ?? 1,
      fetchedAt: nowIso(),
    };
  },
};
