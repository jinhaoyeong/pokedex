/**
 * slab-estimate-v1 — display-only PSA 9 / PSA 10 midpoints from exact-print
 * catalog raw prices. Never a sold comp, book value, observation, or binder value.
 */

export const SLAB_ESTIMATE_MODEL_VERSION = "slab-estimate-v1";

export type SlabEra = "vintage" | "mid-era" | "modern" | "unknown";
export type SlabRarityClass = "bulk" | "standard" | "chase";
export type SlabEstimateGrade = "PSA 9" | "PSA 10";
export type SlabEstimateConfidence = "medium" | "low";
export type SlabEstimateOutcome = "published" | "widened" | "blocked";

export type SlabEstimateReasonCode =
  | "identity_incomplete"
  | "identity_conflict"
  | "missing_catalog_raw"
  | "rarity_derived_raw_rejected"
  | "model_only_no_valid_asks"
  | "asks_agree"
  | "asks_disagree"
  | "unknown_release_date"
  | "non_english_print"
  | "ambiguous_premium_variant"
  | "high_value_compression"
  | "first_party_calibration"
  | "thin_first_party_calibration"
  | "uncalibrated_model";

export type SlabEstimateIdentity = {
  name: string;
  setCode?: string | null;
  setName?: string | null;
  collectorNumber: string;
  language: string;
  finish?: string | null;
  officialCardId?: string | null;
  printedCollectorNumber?: string | null;
  identityStatus?: "confirmed" | "partial" | "identity_incomplete" | null;
  identitySources?: string[] | null;
  conflictingCatalogIdentities?: boolean;
};

export type SlabEstimateInput = {
  identity: SlabEstimateIdentity;
  releaseDate?: string | null;
  rarity?: string | null;
  finish?: string | null;
  language: string;
  /** Exact-print catalog raw prices only. Never rarity-derived estimates. */
  trustedRawPricesUsd: number[];
  cleanedAsksUsd?: number[];
  cleanedAsksByGrade?: Partial<Record<SlabEstimateGrade, number[]>>;
  discardedJunkCount?: number;
};

export type SlabGradeEstimate = {
  grade: SlabEstimateGrade;
  lowUsd: number;
  midpointUsd: number;
  highUsd: number;
  modelVersion: string;
  confidence: SlabEstimateConfidence;
  reasonCodes: SlabEstimateReasonCode[];
  explanation: string;
  outcome: Exclude<SlabEstimateOutcome, "blocked">;
};

export type SlabEstimateResult =
  | {
      outcome: "blocked";
      reasonCodes: SlabEstimateReasonCode[];
      explanation: string;
      grades: [];
    }
  | {
      outcome: "published" | "widened";
      reasonCodes: SlabEstimateReasonCode[];
      explanation: string;
      grades: [SlabGradeEstimate, SlabGradeEstimate];
    };

const PSA9_FLOOR_USD = 12;
const PSA10_FLOOR_USD = 20;

const MULTIPLIERS: Record<
  Exclude<SlabEra, "unknown">,
  Record<SlabRarityClass, { psa9: number; psa10: number }>
> = {
  modern: {
    bulk: { psa9: 1.5, psa10: 3 },
    standard: { psa9: 1.8, psa10: 4.5 },
    chase: { psa9: 2.2, psa10: 6 },
  },
  "mid-era": {
    bulk: { psa9: 1.8, psa10: 4.5 },
    standard: { psa9: 2.3, psa10: 7 },
    chase: { psa9: 3, psa10: 10 },
  },
  vintage: {
    bulk: { psa9: 2.2, psa10: 7 },
    standard: { psa9: 3, psa10: 12 },
    chase: { psa9: 4, psa10: 18 },
  },
};

const RANGE_FACTORS: Record<SlabEstimateGrade, { low: number; high: number }> = {
  "PSA 9": { low: 0.8, high: 1.25 },
  "PSA 10": { low: 0.75, high: 1.4 },
};

export const RARITY_DERIVED_SOURCE_PATTERN =
  /early market estimate|card-adjusted rarity estimate|localized market estimate|localized search group estimate|rarity estimate|english companion/i;

const CHASE_RARITY =
  /\b(secret rare|illustration rare|special illustration|hyper rare|rainbow rare|gold rare|full art|alternate art|special art|amazing rare|shiny rare|radiant rare|mega hyper|\bsir\b|\bsar\b|\bur\b|\bir\b|\bhr\b)\b/i;
const STANDARD_RARITY =
  /\b(rare holo|holo rare|double rare|ultra rare|ace spec|rare|gx|vmax|vstar|\bv\b|\bex\b|holofoil)\b/i;
const BULK_RARITY =
  /\b(common|uncommon|promo|trainer|item|stadium|supporter|energy)\b/i;

export function classifySlabEra(releaseDate?: string | null): SlabEra {
  const year = parseReleaseYear(releaseDate);
  if (year == null) {
    return "unknown";
  }
  if (year <= 2002) {
    return "vintage";
  }
  if (year <= 2015) {
    return "mid-era";
  }
  return "modern";
}

export function classifySlabRarity(rarity?: string | null): SlabRarityClass {
  const value = rarity?.trim() ?? "";
  if (!value || /^unknown$/i.test(value)) {
    return "standard";
  }
  if (CHASE_RARITY.test(value)) {
    return "chase";
  }
  if (BULK_RARITY.test(value) && !STANDARD_RARITY.test(value) && !CHASE_RARITY.test(value)) {
    return "bulk";
  }
  if (STANDARD_RARITY.test(value)) {
    return "standard";
  }
  if (BULK_RARITY.test(value)) {
    return "bulk";
  }
  return "standard";
}

export function slabMultiplier(era: SlabEra, rarity: SlabRarityClass, grade: SlabEstimateGrade) {
  const table = MULTIPLIERS[era === "unknown" ? "modern" : era][rarity];
  return grade === "PSA 9" ? table.psa9 : table.psa10;
}

export function roundSlabEstimateUsd(value: number) {
  if (!(value > 0) || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 10) {
    return Math.round(value * 2) / 2;
  }
  if (value < 100) {
    return Math.round(value);
  }
  return Math.round(value / 5) * 5;
}

export function medianPositive(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function isAmbiguousPremiumVariant(input: {
  finish?: string | null;
  rarity?: string | null;
  setName?: string | null;
  name?: string | null;
}) {
  const blob = [input.finish, input.rarity, input.setName, input.name].filter(Boolean).join(" ");
  return (
    /firstEdition/i.test(input.finish ?? "") ||
    /\b(1st(?:\s|-)?ed(?:ition)?|first\s+edition|shadowless)\b/i.test(blob)
  );
}

export function normalizeCollectorToken(value?: string | null) {
  return (
    value
      ?.normalize("NFKC")
      .trim()
      .split("/")[0]
      ?.trim()
      .toLowerCase()
      .replace(/^0+(?=\d)/, "") ?? ""
  );
}

export function evaluateCanonicalIdentity(identity: SlabEstimateIdentity): {
  ok: boolean;
  reasonCodes: SlabEstimateReasonCode[];
} {
  const reasonCodes: SlabEstimateReasonCode[] = [];
  const name = identity.name?.trim() ?? "";
  const collectorNumber = identity.collectorNumber?.trim() ?? "";
  const language = identity.language?.trim() ?? "";
  const setOk = Boolean(identity.setCode?.trim() || identity.setName?.trim());

  if (!name || !collectorNumber || !language || !setOk) {
    reasonCodes.push("identity_incomplete");
  }

  if (language === "ja") {
    const confirmed =
      identity.identityStatus === "confirmed" &&
      Boolean(identity.printedCollectorNumber?.trim()) &&
      (identity.identitySources ?? []).includes("official-detail");
    if (!confirmed) {
      reasonCodes.push("identity_incomplete");
    }
  }

  const printed = normalizeCollectorToken(identity.printedCollectorNumber);
  const collector = normalizeCollectorToken(identity.collectorNumber);
  if (printed && collector && printed !== collector) {
    reasonCodes.push("identity_conflict");
  }
  if (identity.conflictingCatalogIdentities) {
    reasonCodes.push("identity_conflict");
  }

  return { ok: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

export function isRarityDerivedSource(value?: string | null) {
  return Boolean(value && RARITY_DERIVED_SOURCE_PATTERN.test(value));
}

function parseReleaseYear(releaseDate?: string | null) {
  const trimmed = releaseDate?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d{4})/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  return year >= 1995 && year <= 2100 ? year : null;
}

function applyFloor(grade: SlabEstimateGrade, midpoint: number) {
  const floor = grade === "PSA 9" ? PSA9_FLOOR_USD : PSA10_FLOOR_USD;
  return Math.max(midpoint, floor);
}

function widenFactors(
  base: { low: number; high: number },
  wideners: Array<{ apply: boolean; amount: number }>,
) {
  let low = base.low;
  let high = base.high;
  for (const widener of wideners) {
    if (!widener.apply) {
      continue;
    }
    low = 1 - (1 - low) * (1 + widener.amount);
    high = 1 + (high - 1) * (1 + widener.amount);
  }
  return { low: Math.max(0.2, low), high };
}

function unionRange(
  modelLow: number,
  modelHigh: number,
  askMedian: number,
  askCount: number,
) {
  const band = askCount >= 3 ? { low: 0.7, high: 1.3 } : { low: 0.55, high: 1.6 };
  return {
    low: Math.min(modelLow, roundSlabEstimateUsd(askMedian * band.low) || askMedian * band.low),
    high: Math.max(modelHigh, roundSlabEstimateUsd(askMedian * band.high) || askMedian * band.high),
  };
}

function rangesAgree(askMedian: number, modelLow: number, modelHigh: number) {
  return askMedian >= modelLow && askMedian <= modelHigh;
}

function explain(reasonCodes: SlabEstimateReasonCode[], era: SlabEra, rarity: SlabRarityClass) {
  const parts = [
    `PSA 9/10 model uses ${era === "unknown" ? "modern (unknown date)" : era} × ${rarity} multipliers on exact-print catalog raw.`,
  ];
  if (reasonCodes.includes("model_only_no_valid_asks")) {
    parts.push("Active listings were discarded as junk; the model range is unchanged.");
  }
  if (reasonCodes.includes("asks_agree")) {
    parts.push("Cleaned asking prices agree with the model.");
  }
  if (reasonCodes.includes("asks_disagree")) {
    parts.push("Active asking prices disagree, so the published range is widened. This is not a sold comp.");
  }
  if (reasonCodes.includes("unknown_release_date")) {
    parts.push("Release date unknown; range widened 15%.");
  }
  if (reasonCodes.includes("non_english_print")) {
    parts.push("Non-English print; range widened 20%.");
  }
  if (reasonCodes.includes("ambiguous_premium_variant")) {
    parts.push("First edition / shadowless variant; range widened 25%.");
  }
  return parts.join(" ");
}

export function estimatePsaGrades(input: SlabEstimateInput): SlabEstimateResult {
  const identity = evaluateCanonicalIdentity(input.identity);
  if (!identity.ok) {
    const reasonCodes = identity.reasonCodes;
    return {
      outcome: "blocked",
      reasonCodes,
      explanation: reasonCodes.includes("identity_conflict")
        ? "Canonical print identity is conflicting, so PSA estimates are withheld."
        : "Canonical print identity is incomplete, so PSA estimates are withheld.",
      grades: [],
    };
  }

  const trusted = input.trustedRawPricesUsd.filter((value) => Number.isFinite(value) && value > 0);
  if (!trusted.length) {
    return {
      outcome: "blocked",
      reasonCodes: ["missing_catalog_raw"],
      explanation:
        "No positive sanitized catalog raw is tied to this exact set, number, language, and finish.",
      grades: [],
    };
  }

  const rawMedian = medianPositive(trusted);
  const era = classifySlabEra(input.releaseDate);
  const rarity = classifySlabRarity(input.rarity);
  const language = input.language.trim() || input.identity.language;
  const unknownDate = era === "unknown";
  const nonEnglish = language !== "en";
  const premium = isAmbiguousPremiumVariant({
    finish: input.finish ?? input.identity.finish,
    rarity: input.rarity,
    setName: input.identity.setName,
    name: input.identity.name,
  });

  const sharedReasons: SlabEstimateReasonCode[] = [];
  if (unknownDate) sharedReasons.push("unknown_release_date");
  if (nonEnglish) sharedReasons.push("non_english_print");
  if (premium) sharedReasons.push("ambiguous_premium_variant");

  const totalAsks =
    (input.cleanedAsksByGrade?.["PSA 9"]?.length ?? 0) +
    (input.cleanedAsksByGrade?.["PSA 10"]?.length ?? 0) +
    (input.cleanedAsksUsd?.length ?? 0);
  if ((input.discardedJunkCount ?? 0) > 0 && totalAsks === 0) {
    sharedReasons.push("model_only_no_valid_asks");
  }

  const grades = (["PSA 9", "PSA 10"] as const).map((grade) => {
    const rawMid = rawMedian * slabMultiplier(era, rarity, grade);
    const midpointUsd = roundSlabEstimateUsd(applyFloor(grade, rawMid));
    const widened = widenFactors(RANGE_FACTORS[grade], [
      { apply: unknownDate, amount: 0.15 },
      { apply: nonEnglish, amount: 0.2 },
      { apply: premium, amount: 0.25 },
    ]);
    let lowUsd = roundSlabEstimateUsd(midpointUsd * widened.low);
    let highUsd = roundSlabEstimateUsd(midpointUsd * widened.high);
    const gradeReasons = [...sharedReasons];
    const gradeAsks = (
      input.cleanedAsksByGrade?.[grade] ??
      input.cleanedAsksUsd ??
      []
    ).filter((value) => Number.isFinite(value) && value > 0);
    const gradeAskMedian = medianPositive(gradeAsks);
    let gradeOutcome: "published" | "widened" = "published";
    let confidence: SlabEstimateConfidence = "medium";

    if (gradeAsks.length > 0 && gradeAskMedian > 0) {
      if (rangesAgree(gradeAskMedian, lowUsd, highUsd)) {
        gradeReasons.push("asks_agree");
      } else {
        const union = unionRange(lowUsd, highUsd, gradeAskMedian, gradeAsks.length);
        lowUsd = roundSlabEstimateUsd(union.low);
        highUsd = roundSlabEstimateUsd(union.high);
        gradeReasons.push("asks_disagree");
        gradeOutcome = "widened";
        confidence = "low";
      }
    }

    if (lowUsd > midpointUsd) {
      lowUsd = roundSlabEstimateUsd(Math.min(lowUsd, midpointUsd));
    }
    if (highUsd < midpointUsd) {
      highUsd = roundSlabEstimateUsd(Math.max(highUsd, midpointUsd));
    }

    const reasonCodes = [...new Set(gradeReasons)];
    return {
      grade,
      lowUsd,
      midpointUsd,
      highUsd,
      modelVersion: SLAB_ESTIMATE_MODEL_VERSION,
      confidence,
      reasonCodes,
      explanation: explain(reasonCodes, era, rarity),
      outcome: gradeOutcome,
    } satisfies SlabGradeEstimate;
  }) as [SlabGradeEstimate, SlabGradeEstimate];

  const outcome = grades.some((grade) => grade.outcome === "widened") ? "widened" : "published";

  return {
    outcome,
    reasonCodes: [...new Set(grades.flatMap((grade) => grade.reasonCodes))],
    explanation: grades[0].explanation,
    grades,
  };
}

export function extractTrustedCatalogRawPrices(card: {
  marketPriceUsd?: number;
  finish?: string | null;
  finishMarkets?: Array<{ id: string; ungradedUsd?: number | null }>;
  gradedPrices?: Array<{ grade: string; value: number; source?: string; evidenceType?: string }>;
  sources?: Array<{ source?: string; note?: string }>;
  priceConsensus?: { sources?: Array<{ source?: string; evidenceType?: string; note?: string }> };
}): number[] {
  const sourceBlob = [
    ...(card.sources ?? []).flatMap((source) => [source.source, source.note]),
    ...(card.priceConsensus?.sources ?? []).flatMap((source) => [source.source, source.note]),
    ...(card.gradedPrices ?? []).map((price) => price.source),
  ]
    .filter(Boolean)
    .join(" ");

  if (isRarityDerivedSource(sourceBlob)) {
    return [];
  }

  const prices: number[] = [];
  const finish = card.finish?.trim();
  if (finish && card.finishMarkets?.length) {
    const match = card.finishMarkets.find(
      (market) => market.id === finish && typeof market.ungradedUsd === "number" && market.ungradedUsd > 0,
    );
    if (match?.ungradedUsd && match.ungradedUsd > 0) {
      prices.push(match.ungradedUsd);
      return [...new Set(prices)];
    }
    return [];
  }

  const ungraded = card.gradedPrices?.find((price) => price.grade === "Ungraded" && price.value > 0);
  if (ungraded && (ungraded.evidenceType === "catalog" || !ungraded.evidenceType) && !isRarityDerivedSource(ungraded.source)) {
    prices.push(ungraded.value);
  }

  if (typeof card.marketPriceUsd === "number" && card.marketPriceUsd > 0 && !isRarityDerivedSource(sourceBlob)) {
    prices.push(card.marketPriceUsd);
  }

  return [...new Set(prices.filter((value) => value > 0))];
}
