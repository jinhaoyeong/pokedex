/**
 * slab-estimate-v2 — a display-only PSA 9 / PSA 10 model. It preserves v1's
 * identity gates, floors, rounding, and uncertainty policy, then adds
 * high-value premium compression and optional first-party learned calibration.
 */
import type { SlabCalibration } from "@/lib/market/slab-calibration";
import {
  classifySlabEra,
  classifySlabRarity,
  estimatePsaGrades,
  medianPositive,
  roundSlabEstimateUsd,
  slabMultiplier,
  type SlabEstimateGrade,
  type SlabEstimateInput,
  type SlabEstimateReasonCode,
  type SlabEstimateResult,
} from "@/lib/market/slab-estimate-v1";

export const SLAB_ESTIMATE_MODEL_VERSION = "slab-estimate-v2";

export type SlabEstimateV2Input = SlabEstimateInput & {
  calibration?: SlabCalibration;
};

function modelMultiplier(
  rawUsd: number,
  era: ReturnType<typeof classifySlabEra>,
  rarity: ReturnType<typeof classifySlabRarity>,
  grade: SlabEstimateGrade,
) {
  const base = slabMultiplier(era, rarity, grade);
  if (era === "vintage") return base;

  const anchor = era === "mid-era"
    ? rarity === "chase" ? 100 : rarity === "standard" ? 70 : 40
    : rarity === "chase" ? 50 : rarity === "standard" ? 35 : 20;
  if (rawUsd <= anchor) return base;

  const exponent = era === "mid-era" ? 0.35 : 0.5;
  const compressed = 1 + (base - 1) * Math.pow(anchor / rawUsd, exponent);
  if (era === "modern" || era === "unknown") {
    const ceiling = grade === "PSA 9" ? 1.65 : 3.5;
    return Math.min(compressed, ceiling);
  }
  return compressed;
}

function blendedMultiplier(model: number, learned: number, sampleCount: number) {
  if (!(learned > 0) || !Number.isFinite(learned)) return model;
  const bounded = Math.max(model * 0.45, Math.min(model * 2.2, learned));
  const weight = Math.min(0.72, sampleCount / (sampleCount + 8));
  return Math.exp(Math.log(model) * (1 - weight) + Math.log(bounded) * weight);
}

function estimateFloor(grade: SlabEstimateGrade) {
  return grade === "PSA 9" ? 12 : 20;
}

function unionAskRange(low: number, high: number, askMedian: number, askCount: number) {
  const band = askCount >= 3 ? { low: 0.7, high: 1.3 } : { low: 0.55, high: 1.6 };
  return {
    low: Math.min(low, roundSlabEstimateUsd(askMedian * band.low)),
    high: Math.max(high, roundSlabEstimateUsd(askMedian * band.high)),
  };
}

function explanation(input: {
  era: ReturnType<typeof classifySlabEra>;
  rarity: ReturnType<typeof classifySlabRarity>;
  compressed: boolean;
  cohort?: string;
  sampleCount?: number;
  asksAgree: boolean;
  asksDisagree: boolean;
  inherited: string;
}) {
  const parts = [
    `PSA model uses exact-print catalog raw with ${input.era === "unknown" ? "modern/unknown-date" : input.era} × ${input.rarity} factors.`,
  ];
  if (input.compressed) {
    parts.push("The premium is compressed for a high-value raw card so the slab price does not scale linearly.");
  }
  if (input.cohort && input.sampleCount) {
    parts.push(`Calibrated against ${input.sampleCount} PokePokedex observed print ratios in the ${input.cohort} cohort.`);
  }
  if (input.asksAgree) parts.push("Cleaned active asks agree with the model.");
  if (input.asksDisagree) parts.push("Active asks disagree, so only the range was widened; asks did not set the midpoint.");
  if (/range widened/i.test(input.inherited)) {
    parts.push(input.inherited.split(".").filter((part) => /range widened/i.test(part)).join(". ").trim());
  }
  return parts.join(" ");
}

export function estimatePsaGradesV2(input: SlabEstimateV2Input): SlabEstimateResult {
  const modelOnly = estimatePsaGrades({
    ...input,
    cleanedAsksUsd: undefined,
    cleanedAsksByGrade: undefined,
  });
  if (modelOnly.outcome === "blocked") return modelOnly;

  const rawMedian = medianPositive(input.trustedRawPricesUsd);
  const era = classifySlabEra(input.releaseDate);
  const rarity = classifySlabRarity(input.rarity);
  const grades = modelOnly.grades.map((baseline) => {
    const grade = baseline.grade;
    const originalMultiplier = slabMultiplier(era, rarity, grade);
    const compressedMultiplier = modelMultiplier(rawMedian, era, rarity, grade);
    const calibration = input.calibration?.[grade];
    const multiplier = calibration
      ? blendedMultiplier(compressedMultiplier, calibration.multiplier, calibration.sampleCount)
      : compressedMultiplier;
    const midpointUsd = roundSlabEstimateUsd(
      Math.max(estimateFloor(grade), rawMedian * multiplier),
    );
    const baselineLowFactor = baseline.lowUsd / baseline.midpointUsd;
    const baselineHighFactor = baseline.highUsd / baseline.midpointUsd;
    let lowUsd = roundSlabEstimateUsd(midpointUsd * baselineLowFactor);
    let highUsd = roundSlabEstimateUsd(midpointUsd * baselineHighFactor);

    if (calibration) {
      lowUsd = Math.min(lowUsd, roundSlabEstimateUsd(rawMedian * calibration.lowMultiplier));
      highUsd = Math.max(highUsd, roundSlabEstimateUsd(rawMedian * calibration.highMultiplier));
    }

    const asks = (input.cleanedAsksByGrade?.[grade] ?? input.cleanedAsksUsd ?? [])
      .filter((value) => Number.isFinite(value) && value > 0);
    const askMedian = medianPositive(asks);
    const asksAgree = askMedian > 0 && askMedian >= lowUsd && askMedian <= highUsd;
    const asksDisagree = askMedian > 0 && !asksAgree;
    if (asksDisagree) {
      const union = unionAskRange(lowUsd, highUsd, askMedian, asks.length);
      lowUsd = union.low;
      highUsd = union.high;
    }

    lowUsd = Math.min(lowUsd, midpointUsd);
    highUsd = Math.max(highUsd, midpointUsd);
    const reasonCodes: SlabEstimateReasonCode[] = [
      ...baseline.reasonCodes.filter((code) => code !== "asks_agree" && code !== "asks_disagree"),
    ];
    const compressed = compressedMultiplier < originalMultiplier * 0.98;
    if (compressed) reasonCodes.push("high_value_compression");
    if (calibration) {
      reasonCodes.push("first_party_calibration");
      if (calibration.sampleCount < 8) reasonCodes.push("thin_first_party_calibration");
    } else {
      reasonCodes.push("uncalibrated_model");
    }
    if (asksAgree) reasonCodes.push("asks_agree");
    if (asksDisagree) reasonCodes.push("asks_disagree");

    return {
      ...baseline,
      lowUsd,
      midpointUsd,
      highUsd,
      modelVersion: SLAB_ESTIMATE_MODEL_VERSION,
      confidence:
        asksDisagree
          ? "low" as const
          : asksAgree || (calibration && calibration.sampleCount >= 5)
            ? "medium" as const
            : "low" as const,
      reasonCodes: [...new Set(reasonCodes)],
      explanation: explanation({
        era,
        rarity,
        compressed,
        cohort: calibration?.cohort,
        sampleCount: calibration?.sampleCount,
        asksAgree,
        asksDisagree,
        inherited: baseline.explanation,
      }),
      outcome: asksDisagree ? "widened" as const : "published" as const,
    };
  }) as typeof modelOnly.grades;

  const outcome = grades.some((grade) => grade.outcome === "widened") ? "widened" : "published";
  return {
    outcome,
    reasonCodes: [...new Set(grades.flatMap((grade) => grade.reasonCodes))],
    explanation: grades[0].explanation,
    grades,
  };
}
