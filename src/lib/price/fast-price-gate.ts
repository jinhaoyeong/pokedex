import { SOLID_MATCH_THRESHOLD } from "./match";
import type { PriceQuery, ProviderPriceResult } from "./types";

/** Request-path wall clock for card-detail price. Keep all reference sources racing. */
export const REQUEST_PATH_PRICE_BUDGET_MS = 5_000;

function isCollectrProvider(result: ProviderPriceResult) {
  return result.provider === "collectr-fallback" || /collectr/i.test(result.sourceLabel);
}

function isPriceChartingProvider(result: ProviderPriceResult) {
  return result.provider === "pricecharting-api" || /pricecharting/i.test(result.sourceLabel);
}

function isEbaySoldProvider(result: ProviderPriceResult) {
  return (
    (/^ebay/i.test(result.provider) || /ebay/i.test(result.sourceLabel)) &&
    result.evidenceType === "sold_comp"
  );
}

/**
 * Early-return only on independent market references (Collectr, PriceCharting,
 * eBay sold). Catalog/TCGdex answers are allowed as a last resort after the
 * budget, but must not win the race and skip the references the UI is judged on.
 */
export function isMarketReferenceFastResult(
  result: ProviderPriceResult,
  _query?: PriceQuery,
) {
  if (!(result.ungradedUsd > 0) || result.matchConfidence < SOLID_MATCH_THRESHOLD) {
    return false;
  }

  return (
    isCollectrProvider(result) ||
    isPriceChartingProvider(result) ||
    isEbaySoldProvider(result)
  );
}

export function priceDeltaRatio(reference: number, actual: number) {
  if (!(reference > 0) || !(actual > 0)) {
    return null;
  }

  return Math.abs(reference - actual) / Math.max(reference, 1);
}

export function isWithinMarketReferenceTolerance(
  reference: number,
  actual: number,
  tolerance = 0.1,
) {
  const ratio = priceDeltaRatio(reference, actual);
  return ratio != null && ratio <= tolerance;
}
