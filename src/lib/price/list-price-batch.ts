import { buildPriceLookupParams, type PriceLookupPayload } from "@/lib/price/price-query";
import type { ProviderPriceResult, ResolvedPrice } from "@/lib/price/types";
import type { TcgCard } from "@/types/pokemon";

export const PRICE_SORT_BATCH_BUDGET_MS = 2_200;
export const PRICE_SORT_BATCH_MAX_CARDS = 32;

export function resolvedPriceToLookupPayload(resolved: ResolvedPrice): PriceLookupPayload {
  const market = resolved.ungradedUsd > 0 ? resolved.ungradedUsd : null;

  return {
    status: market ? "success" : "no_match",
    ungradedUsd: market,
    marketPrice: market,
    prices: { market, ungraded: market, raw: market },
    primaryProvider: resolved.primaryProvider,
    confidenceScore: resolved.confidenceScore,
    fetchedAt: resolved.fetchedAt,
    results: resolved.results,
  };
}

export function providerResultToLookupPayload(
  slug: string,
  result: ProviderPriceResult,
): PriceLookupPayload {
  return resolvedPriceToLookupPayload({
    slug,
    ungradedUsd: result.ungradedUsd,
    confidenceScore: result.confidenceScore,
    primaryProvider: result.provider,
    results: [result],
    fetchedAt: result.fetchedAt,
  });
}

export function priceLookupFieldsFromCard(card: TcgCard) {
  return Object.fromEntries(buildPriceLookupParams(card).entries());
}
