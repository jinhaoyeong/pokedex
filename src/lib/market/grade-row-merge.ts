import type { GradedPrice, MarketEvidenceType } from "@/types/pokemon";

import { SLAB_ESTIMATE_MODEL_VERSION } from "@/lib/market/slab-estimate-v2";

const GRADE_RANK: Record<string, number> = {
  sold_comp: 3,
  guide_snapshot: 2,
  catalog: 1,
  estimate: 0,
  population: 0,
};

export function isEstimatedGradePrice(price: Pick<GradedPrice, "evidenceType" | "estimate" | "source">) {
  return (
    price.evidenceType === "estimate" ||
    Boolean(price.estimate) ||
    price.source === "PSA grade estimate" ||
    price.estimate?.modelVersion === SLAB_ESTIMATE_MODEL_VERSION
  );
}

export function gradeRowPrecedence(price: GradedPrice) {
  if (!(price.value > 0)) {
    return -1;
  }
  if (isEstimatedGradePrice(price)) {
    return GRADE_RANK.estimate;
  }
  const evidence: MarketEvidenceType | undefined = price.evidenceType;
  if (evidence && evidence in GRADE_RANK) {
    return GRADE_RANK[evidence];
  }
  if ((price.saleCount ?? 0) > 0) {
    return GRADE_RANK.sold_comp;
  }
  if (price.source && /guide|pricecharting|collectr|pokedex market/i.test(price.source)) {
    return GRADE_RANK.guide_snapshot;
  }
  if (price.grade === "Ungraded") {
    return GRADE_RANK.catalog;
  }
  return GRADE_RANK.guide_snapshot;
}

/**
 * Merge grade rows. Validated sold / binder observation beats curated guide,
 * which beats a model estimate. An incoming observation replaces only its
 * matching grade.
 */
export function mergeGradeRowsByPrecedence(
  existing: GradedPrice[],
  incoming: GradedPrice[],
): GradedPrice[] {
  const merged = new Map<string, GradedPrice>();

  for (const price of existing) {
    merged.set(price.grade, price);
  }

  for (const price of incoming) {
    const current = merged.get(price.grade);
    if (!current) {
      merged.set(price.grade, price);
      continue;
    }

    const incomingRank = gradeRowPrecedence(price);
    const currentRank = gradeRowPrecedence(current);
    if (incomingRank > currentRank) {
      merged.set(price.grade, {
        ...current,
        ...price,
        populationCount: price.populationCount || current.populationCount || 0,
      });
      continue;
    }
    if (incomingRank === currentRank && incomingRank >= 0) {
      merged.set(price.grade, {
        ...current,
        ...price,
        populationCount: price.populationCount || current.populationCount || 0,
      });
      continue;
    }

    merged.set(price.grade, {
      ...current,
      populationCount: current.populationCount || price.populationCount || 0,
    });
  }

  return [...merged.values()];
}

export function withoutEstimatedGradePrices(prices: GradedPrice[] | undefined) {
  return (prices ?? []).filter((price) => !isEstimatedGradePrice(price));
}

export function displayableGradeRows(prices: GradedPrice[]) {
  return prices.filter((price) => {
    if (isEstimatedGradePrice(price)) {
      return price.grade === "PSA 9" || price.grade === "PSA 10";
    }
    return price.value > 0;
  });
}
