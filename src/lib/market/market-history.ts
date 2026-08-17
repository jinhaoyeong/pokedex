import type {
  MarketHistoryPointType,
  MarketHistorySummary,
  PricePoint,
  SaleRecord,
} from "@/types/pokemon";

const PREVIEW_SOURCE =
  /static grail preview|bundled grail preview|premium preview composite|preview model|partial cached/i;

const POINT_PRIORITY: Record<MarketHistoryPointType, number> = {
  projected: 0,
  "catalog-baseline": 1,
  "guide-snapshot": 2,
  sold: 3,
};

export function mergeMarketHistoryPointType(
  left?: MarketHistoryPointType,
  right?: MarketHistoryPointType,
): MarketHistoryPointType | undefined {
  if (!left) return right;
  if (!right) return left;
  return POINT_PRIORITY[right] > POINT_PRIORITY[left] ? right : left;
}

export function isRealDatedSale(sale: SaleRecord) {
  const parsed = Date.parse(sale.date);
  const source = [sale.source, sale.sourceUrl, sale.listingUrl].filter(Boolean).join(" ");

  return (
    Number.isFinite(parsed) &&
    Number.isFinite(sale.price) &&
    sale.price > 0 &&
    !PREVIEW_SOURCE.test(source)
  );
}

/**
 * Classify chart truthfulness independently from whether the UI can draw a line.
 * A guide ladder or projected points can support a current valuation, but they
 * never turn into historical performance without at least one dated real sale.
 */
export function classifyMarketHistory(
  points: PricePoint[],
  recentSales: SaleRecord[],
): MarketHistorySummary {
  const realSaleCount = recentSales.filter(isRealDatedSale).length;
  const pointTypes = new Set(
    points.map((point) => point.pointType ?? (point.isProjected ? "projected" : undefined)),
  );
  const hasSnapshot =
    pointTypes.has("guide-snapshot") ||
    pointTypes.has("catalog-baseline") ||
    points.some((point) => point.value > 0 || Object.values(point.gradeValues ?? {}).some((v) => v > 0));

  if (realSaleCount >= 1) {
    return {
      status: realSaleCount >= 2 ? "available" : "limited",
      historyUnavailable: false,
      realSaleCount,
      note:
        realSaleCount >= 2
          ? "Dated accepted sold listings support the market-history chart."
          : "Only one dated accepted sale supports this limited history view.",
    };
  }

  if (hasSnapshot) {
    return {
      status: "snapshot_only",
      historyUnavailable: true,
      realSaleCount: 0,
      note: "Current guide/catalog snapshots are available, but no real dated sale history was accepted.",
    };
  }

  return {
    status: "unavailable",
    historyUnavailable: true,
    realSaleCount: 0,
    note: "No real dated market history is available for this print.",
  };
}
