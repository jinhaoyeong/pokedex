import type { GradedPrice, SaleRecord } from "@/types/pokemon";

import type { ProviderPriceResult, ResolvedPrice } from "./types";

const RAW_TO_PSA10_CEILING_RATIO = 0.45;

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function median(values: number[]) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);

  if (!sorted.length) {
    return 0;
  }

  return sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}

export function gradedCeilingRawUsd(rawUsd: number, psa10Usd: number): number {
  if (!(rawUsd > 0) || !(psa10Usd > 0) || rawUsd <= psa10Usd) {
    return rawUsd;
  }

  return Math.round(psa10Usd * RAW_TO_PSA10_CEILING_RATIO * 100) / 100;
}

export function findPsa10Usd(gradedPrices: GradedPrice[] | undefined): number {
  return Math.max(
    0,
    ...(gradedPrices ?? [])
      .filter((price) => /^PSA\s*10$/i.test(price.grade))
      .map((price) => positive(price.value)),
  );
}

export function findResolvedPsa10Usd(resolved: Pick<ResolvedPrice, "results">): number {
  return Math.max(
    0,
    ...resolved.results.map((result) => findPsa10Usd(result.gradedPrices)),
  );
}

export function filterRawSalesOutliers(
  sales: SaleRecord[] | undefined,
  referenceUsd?: number,
): SaleRecord[] | undefined {
  if (!sales?.length) {
    return sales;
  }

  const values = sales.map((sale) => sale.price).filter((price) => price > 0);
  const medianValue = median(values);
  const lower = Math.max(
    referenceUsd && referenceUsd > 0 ? referenceUsd / 8 : 0,
    medianValue && medianValue > 0 ? medianValue / 4 : 0,
  );
  const upper = Math.min(
    referenceUsd && referenceUsd > 0 ? referenceUsd * 8 : Number.POSITIVE_INFINITY,
    medianValue && medianValue > 0 ? medianValue * 4 : Number.POSITIVE_INFINITY,
  );
  const filtered = sales.filter((sale) => sale.price >= lower && sale.price <= upper);

  return filtered.length ? filtered : sales;
}

export function sanitizeProviderPriceResult(result: ProviderPriceResult): ProviderPriceResult {
  const psa10Usd = findPsa10Usd(result.gradedPrices);
  const preliminaryRawUsd = gradedCeilingRawUsd(result.ungradedUsd, psa10Usd);
  const sales = filterRawSalesOutliers(result.sales, preliminaryRawUsd);
  const salesMedianUsd =
    result.evidenceType === "sold_comp" && sales?.length ? median(sales.map((sale) => sale.price)) : 0;
  const ungradedUsd = gradedCeilingRawUsd(salesMedianUsd || preliminaryRawUsd, psa10Usd);
  const gradedPrices = result.gradedPrices?.map((price) =>
    price.grade === "Ungraded" && price.value !== ungradedUsd
      ? {
          ...price,
          value: ungradedUsd,
          warning:
            price.warning ??
            "Raw value was capped below PSA 10 because the provider returned an inconsistent ungraded market.",
        }
      : price,
  );

  return {
    ...result,
    ungradedUsd,
    ...(sales ? { sales } : {}),
    ...(gradedPrices ? { gradedPrices } : {}),
  };
}

export function sanitizeResolvedPrice(resolved: ResolvedPrice): ResolvedPrice {
  const results = resolved.results.map(sanitizeProviderPriceResult);
  const psa10Usd = findResolvedPsa10Usd({ results });
  const ungradedUsd = gradedCeilingRawUsd(resolved.ungradedUsd, psa10Usd);

  return {
    ...resolved,
    ungradedUsd,
    results,
  };
}
