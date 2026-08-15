import type { GradedPrice } from "@/types/pokemon";

import type { ProviderPriceResult, ResolvedPrice } from "./types";

type PricedShape = {
  ungradedUsd?: number | null;
  gradedPrices?: Array<Pick<GradedPrice, "grade" | "value">> | null;
};

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function hasPositiveSlab(
  gradedPrices: Array<Pick<GradedPrice, "grade" | "value">> | null | undefined,
): boolean {
  return (gradedPrices ?? []).some(
    (price) => price.grade.toLowerCase() !== "ungraded" && positive(price.value) > 0,
  );
}

/** True when a payload has a usable ungraded headline or at least one positive slab. */
export function hasPricedMarketPayload(value: PricedShape | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return positive(value.ungradedUsd) > 0 || hasPositiveSlab(value.gradedPrices);
}

export function isPricedProviderResult(
  result: ProviderPriceResult | null | undefined,
): result is ProviderPriceResult {
  return hasPricedMarketPayload(result);
}

export function isPricedResolvedPrice(resolved: Pick<ResolvedPrice, "ungradedUsd" | "results">) {
  return (
    positive(resolved.ungradedUsd) > 0 ||
    resolved.results.some((result) => isPricedProviderResult(result))
  );
}

export function findNmMarketUsd(results: ProviderPriceResult[] | undefined): number | null {
  const preferredProviderIds = ["pokemontcg", "tcgdex", "tcgdex-open"];

  for (const provider of preferredProviderIds) {
    const match = results?.find(
      (result) =>
        result.provider === provider &&
        result.evidenceType === "catalog" &&
        positive(result.ungradedUsd) > 0,
    );

    if (match) {
      return match.ungradedUsd;
    }
  }

  return null;
}

export function shouldShowNmSecondary(headlineUsd: number, nmMarketUsd: number | null | undefined) {
  if (!(headlineUsd > 0) || !(typeof nmMarketUsd === "number" && nmMarketUsd > 0)) {
    return false;
  }

  return Math.abs(nmMarketUsd - headlineUsd) / headlineUsd > 0.15;
}
