import type { GradedPrice, MarketEvidence, PricePoint, TcgCard } from "@/types/pokemon";

import {
  isEstimatedGradePrice,
  mergeGradeRowsByPrecedence,
} from "@/lib/market/grade-row-merge";
import {
  extractTrustedCatalogRawPrices,
  normalizeCollectorToken,
  type SlabEstimateResult,
} from "@/lib/market/slab-estimate-v1";
import { estimatePsaGradesV2 } from "@/lib/market/slab-estimate-v2";

export function slabEstimateRows(result: SlabEstimateResult): GradedPrice[] {
  if (result.outcome === "blocked") {
    return [];
  }

  return result.grades.map((grade) => ({
    grade: grade.grade,
    value: grade.midpointUsd,
    populationCount: 0,
    source: "PSA grade estimate",
    confidence: grade.confidence,
    confidenceScore: grade.confidence === "medium" ? 0.48 : 0.28,
    service: "PSA" as const,
    evidenceType: "estimate" as const,
    warning: grade.reasonCodes.includes("asks_disagree")
      ? "Active asking prices disagree with the model."
      : grade.reasonCodes.includes("model_only_no_valid_asks")
        ? "No valid active listings remained after hygiene."
        : "Display-only estimate. Not a sold comp or book value.",
    estimate: {
      lowUsd: grade.lowUsd,
      midpointUsd: grade.midpointUsd,
      highUsd: grade.highUsd,
      modelVersion: grade.modelVersion,
      confidence: grade.confidence,
      reasonCodes: grade.reasonCodes,
      explanation: grade.explanation,
    },
  }));
}

export function withProjectedSlabHistory(
  existing: PricePoint[] | undefined,
  estimates: GradedPrice[],
): PricePoint[] {
  const history = (existing ?? []).map((point) => ({
    ...point,
    gradeValues: point.gradeValues ? { ...point.gradeValues } : undefined,
  }));
  if (!estimates.length) {
    return history;
  }

  const today = new Date().toISOString().slice(0, 10);
  const gradeValues = Object.fromEntries(
    estimates.map((price) => [price.grade, price.value]),
  );
  const existingToday = history.find((point) => point.date.slice(0, 10) === today);
  if (existingToday) {
    existingToday.gradeValues = { ...(existingToday.gradeValues ?? {}), ...gradeValues };
    existingToday.isProjected = existingToday.isProjected ?? true;
    existingToday.pointType = existingToday.pointType ?? "projected";
    return history;
  }

  history.push({
    date: today,
    value: 0,
    gradeValues,
    isProjected: true,
    pointType: "projected",
  });
  return history;
}

function hasJapanesePrintConflict(card: TcgCard) {
  const printed = normalizeCollectorToken(card.marketIdentity?.printedCollectorNumber);
  const collector = normalizeCollectorToken(card.collectorNumber);
  return card.language === "ja" && Boolean(printed && collector && printed !== collector);
}

function estimateEvidence(
  existing: MarketEvidence[] | undefined,
  estimated: GradedPrice[],
): MarketEvidence[] {
  return [
    ...(existing ?? []).filter((item) => item.evidenceType !== "estimate"),
    ...estimated.map((price) => ({
      id: `estimate-${price.grade}`,
      source: "PSA grade estimate",
      evidenceType: "estimate" as const,
      grade: price.grade,
      priceUsd: price.value,
      confidence: price.confidence ?? "low",
      confidenceScore: price.confidenceScore ?? 0.28,
      note: price.estimate?.explanation ?? "Display-only PSA estimate.",
      warning: price.warning,
    })),
  ];
}

/**
 * Synchronous exact-print fallback for card-detail first paint. Server
 * calibration and diagnostics still arrive through /api/grading-market, but a
 * cold serverless request can no longer leave the PSA 9/10 panel empty.
 */
export function applyModelOnlySlabEstimatesToCard(card: TcgCard): TcgCard {
  const result = estimatePsaGradesV2({
    identity: {
      name: card.englishName?.trim() || card.name,
      setCode: card.setCode,
      setName: card.setEnglishName || card.setName,
      collectorNumber: card.collectorNumber,
      language: card.language,
      finish: card.finish,
      officialCardId: card.officialCardId ?? card.marketIdentity?.officialCardId,
      printedCollectorNumber: card.marketIdentity?.printedCollectorNumber,
      identityStatus: card.marketIdentity?.identityStatus,
      identitySources: card.marketIdentity?.identitySource,
      conflictingCatalogIdentities: hasJapanesePrintConflict(card),
    },
    releaseDate: card.setReleaseDate,
    rarity: card.rarity,
    finish: card.finish,
    language: card.language,
    trustedRawPricesUsd: extractTrustedCatalogRawPrices(card),
  });
  const estimated = slabEstimateRows(result);
  if (!estimated.length) {
    return card;
  }

  const gradedPrices = mergeGradeRowsByPrecedence(card.gradedPrices ?? [], estimated);
  const visibleEstimates = gradedPrices.filter(isEstimatedGradePrice);
  return {
    ...card,
    gradedPrices,
    priceHistory: withProjectedSlabHistory(card.priceHistory, visibleEstimates),
    marketEvidence: estimateEvidence(card.marketEvidence, visibleEstimates),
  };
}
