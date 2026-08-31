import { isRealDatedSale } from "@/lib/market/market-history";
import type { MarketHistorySummary, SaleRecord } from "@/types/pokemon";

const PREVIEW_MARKET_SOURCE =
  /static grail preview|bundled grail preview|premium preview composite|preview model|partial cached/i;

export type LiveMarketPayloadLike = {
  timedOut?: boolean;
  status?: string;
  psaPopulation?: {
    grades?: unknown[];
    totalCertified?: number | null;
  } | null;
  gradedPrices?: Array<{ grade?: string; value?: number | null }>;
  priceHistory?: unknown[];
  recentSales?: unknown[];
  marketHistory?: MarketHistorySummary;
};

export function isPreviewMarketSource(value: string) {
  return PREVIEW_MARKET_SOURCE.test(value);
}

export function hasPrimaryLiveMarketPanels(data: LiveMarketPayloadLike | null | undefined) {
  if (!data) {
    return false;
  }

  const population = data.psaPopulation;
  const hasPopulation =
    Boolean(population?.grades?.length) || typeof population?.totalCertified === "number";
  const hasSlabs = Boolean(
    data.gradedPrices?.some(
      (price) =>
        price.grade !== "Ungraded" && typeof price.value === "number" && price.value > 0,
    ),
  );
  const hasSales = Boolean(data.recentSales?.length);

  return hasPopulation || hasSlabs || hasSales;
}

export function hasLiveMarketSignal(data: LiveMarketPayloadLike | null | undefined) {
  if (!data) {
    return false;
  }

  return hasPrimaryLiveMarketPanels(data) || Boolean(data.priceHistory?.length);
}

/**
 * Timeout/empty enrichment payloads used to arrive with historyUnavailable=true
 * and zero sales. Applying them wiped sold listings and hid the price chart.
 */
export function shouldApplyLiveMarketPayload(data: LiveMarketPayloadLike | null | undefined) {
  if (!data) {
    return false;
  }

  if (data.timedOut === true || data.status === "timeout") {
    return hasLiveMarketSignal(data);
  }

  return true;
}

export function mergeLiveRecentSales(current: SaleRecord[], incoming: SaleRecord[] | undefined) {
  if (Array.isArray(incoming) && incoming.length) {
    return incoming;
  }

  if ((current ?? []).every((sale) => !isRealDatedSale(sale))) {
    return [];
  }

  return current;
}

export function mergeLiveMarketHistory(
  current?: MarketHistorySummary,
  incoming?: MarketHistorySummary,
) {
  if (!incoming) {
    return current;
  }

  if (!current) {
    return incoming;
  }

  const currentSales = current.realSaleCount ?? 0;
  const incomingSales = incoming.realSaleCount ?? 0;

  if (incoming.historyUnavailable && !current.historyUnavailable && currentSales >= incomingSales) {
    return current;
  }

  if (incomingSales < currentSales) {
    return current;
  }

  return incoming;
}
