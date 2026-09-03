import type {
  SlabEra,
  SlabEstimateGrade,
  SlabRarityClass,
} from "@/lib/market/slab-estimate-v1";

export type SlabCalibrationObservation = {
  cardKey: string;
  contributorKey: string;
  grade: "Ungraded" | SlabEstimateGrade;
  priceUsd: number;
  era: SlabEra;
  rarity: SlabRarityClass;
  language: string;
};

export type SlabGradeCalibration = {
  multiplier: number;
  lowMultiplier: number;
  highMultiplier: number;
  sampleCount: number;
  cohort: string;
};

export type SlabCalibration = Partial<Record<SlabEstimateGrade, SlabGradeCalibration>>;

export type SlabCalibrationTarget = {
  cardKey?: string | null;
  era: SlabEra;
  rarity: SlabRarityClass;
  language: string;
};

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], position: number) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function normalizedLanguage(value: string) {
  return value.trim().toLowerCase() || "en";
}

type CardRatio = {
  cardKey: string;
  grade: SlabEstimateGrade;
  ratio: number;
  era: SlabEra;
  rarity: SlabRarityClass;
  language: string;
};

function cardRatios(observations: SlabCalibrationObservation[]) {
  const contributors = new Map<string, number[]>();
  const facts = new Map<
    string,
    Pick<SlabCalibrationObservation, "cardKey" | "grade" | "era" | "rarity" | "language">
  >();

  for (const row of observations) {
    if (!(row.priceUsd > 0) || !Number.isFinite(row.priceUsd)) continue;
    const key = `${row.cardKey}|${row.grade}`;
    const contributorKey = `${key}|${row.contributorKey}`;
    contributors.set(contributorKey, [row.priceUsd]);
    facts.set(key, row);
  }

  const values = new Map<string, number[]>();
  for (const [key, prices] of contributors) {
    const cardGradeKey = key.split("|").slice(0, -1).join("|");
    const bucket = values.get(cardGradeKey) ?? [];
    bucket.push(median(prices));
    values.set(cardGradeKey, bucket);
  }

  const result: CardRatio[] = [];
  const cardKeys = new Set(observations.map((row) => row.cardKey));
  for (const cardKey of cardKeys) {
    const raw = median(values.get(`${cardKey}|Ungraded`) ?? []);
    if (!(raw > 0)) continue;
    for (const grade of ["PSA 9", "PSA 10"] as const) {
      const slab = median(values.get(`${cardKey}|${grade}`) ?? []);
      const ratio = slab / raw;
      const plausible = grade === "PSA 9"
        ? ratio >= 0.55 && ratio <= 12
        : ratio >= 0.8 && ratio <= 40;
      const fact = facts.get(`${cardKey}|${grade}`) ?? facts.get(`${cardKey}|Ungraded`);
      if (!fact || !(slab > 0) || !plausible) continue;
      result.push({
        cardKey,
        grade,
        ratio,
        era: fact.era,
        rarity: fact.rarity,
        language: normalizedLanguage(fact.language),
      });
    }
  }
  return result;
}

function selectCohort(rows: CardRatio[], target: SlabCalibrationTarget) {
  const language = normalizedLanguage(target.language);
  const candidates = [
    {
      label: `${target.era}/${target.rarity}/${language}`,
      minimum: 3,
      rows: rows.filter(
        (row) =>
          row.era === target.era &&
          row.rarity === target.rarity &&
          row.language === language,
      ),
    },
    {
      label: `${target.era}/${target.rarity}`,
      minimum: 4,
      rows: rows.filter((row) => row.era === target.era && row.rarity === target.rarity),
    },
    {
      label: target.era,
      minimum: 6,
      rows: rows.filter((row) => row.era === target.era),
    },
    { label: "all prints", minimum: 8, rows },
  ];
  return candidates.find((candidate) => candidate.rows.length >= candidate.minimum) ?? null;
}

/**
 * Builds robust cross-card raw-to-slab ratios from first-party paid/sold
 * observations. Each print contributes one ratio, so popular cards cannot
 * overwhelm the model merely by having more reports.
 */
export function buildSlabCalibration(
  observations: SlabCalibrationObservation[],
  target: SlabCalibrationTarget,
): SlabCalibration {
  const ratios = cardRatios(observations).filter((row) => row.cardKey !== target.cardKey);
  const calibration: SlabCalibration = {};

  for (const grade of ["PSA 9", "PSA 10"] as const) {
    const cohort = selectCohort(
      ratios.filter((row) => row.grade === grade),
      target,
    );
    if (!cohort) continue;
    const values = cohort.rows.map((row) => row.ratio);
    calibration[grade] = {
      multiplier: median(values),
      lowMultiplier: quantile(values, 0.2),
      highMultiplier: quantile(values, 0.8),
      sampleCount: values.length,
      cohort: cohort.label,
    };
  }

  return calibration;
}
