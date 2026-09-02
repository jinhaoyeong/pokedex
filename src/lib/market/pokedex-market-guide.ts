import guideSeed from "../../../data/pokedex-market-guide.json";

import type { GradedPrice } from "@/types/pokemon";
import type { PriceQuery, ProviderPriceResult } from "@/lib/price/types";

export const POKEDEX_MARKET_PROVIDER_ID = "pokedex-market";
export const POKEDEX_MARKET_SOURCE_LABEL = "PokePokedex market";

export const POKEDEX_MARKET_MIN_USD = 0.25;
export const POKEDEX_MARKET_MAX_USD = 250_000;
export const POKEDEX_MARKET_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
export const POKEDEX_MARKET_SOLD_OVERRIDE_SAMPLES = 3;

export type PokedexMarketEvidenceKind = "sold" | "paid" | "curator";

export type PokedexMarketGuideGrade = {
  grade: string;
  valueUsd: number;
  sampleCount?: number;
  kind?: PokedexMarketEvidenceKind;
};

export type PokedexMarketGuideEntry = {
  slug?: string;
  setCode?: string;
  collectorNumber?: string;
  language?: string;
  name?: string;
  englishName?: string;
  ungradedUsd?: number;
  grades?: PokedexMarketGuideGrade[];
  note?: string;
  updatedAt?: string | null;
};

export type PokedexMarketGuideFile = {
  version: number;
  updatedAt?: string | null;
  entries: PokedexMarketGuideEntry[];
};

export type PokedexMarketGuideQuery = {
  slug?: string;
  setCode?: string;
  collectorNumber?: string;
  language?: string;
  name?: string;
  englishName?: string;
};

export type PokedexMarketObservation = {
  priceUsd: number;
  kind: "sold" | "paid";
  grade: string;
  contributorKey: string;
  observedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function normalizeMarketText(value?: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

export function normalizeCollectorNumber(value?: string | null) {
  return value?.trim().replace(/^0+/, "").toLowerCase() ?? "";
}

export function normalizeMarketGrade(value?: string | null) {
  const trimmed = value?.trim() || "Ungraded";
  if (/^raw$/i.test(trimmed) || /^nm$/i.test(trimmed)) {
    return "Ungraded";
  }
  return trimmed.replace(/\s+/g, " ");
}

export function isUsableMarketPriceUsd(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= POKEDEX_MARKET_MIN_USD &&
    value <= POKEDEX_MARKET_MAX_USD
  );
}

export function roundMarketUsd(value: number) {
  return Math.round(value * 100) / 100;
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

function filterObservationOutliers(values: number[]) {
  if (values.length < 3) {
    return values;
  }
  const mid = median(values);
  if (!(mid > 0)) {
    return values;
  }
  const filtered = values.filter((value) => value >= mid / 4 && value <= mid * 4);
  return filtered.length ? filtered : values;
}

function seedEntries(): PokedexMarketGuideEntry[] {
  const file = guideSeed as PokedexMarketGuideFile;
  return Array.isArray(file.entries) ? file.entries : [];
}

export function findPokedexMarketGuideEntry(
  query: PokedexMarketGuideQuery,
  entries: PokedexMarketGuideEntry[] = seedEntries(),
): PokedexMarketGuideEntry | null {
  const slug = normalizeMarketText(query.slug);
  if (slug) {
    const bySlug = entries.find((entry) => normalizeMarketText(entry.slug) === slug);
    if (bySlug) {
      return bySlug;
    }
  }

  const setCode = normalizeMarketText(query.setCode);
  const collectorNumber = normalizeCollectorNumber(query.collectorNumber);
  const language = normalizeMarketText(query.language) || "en";
  if (!setCode || !collectorNumber) {
    return null;
  }

  const numbered = entries.filter(
    (entry) =>
      normalizeMarketText(entry.setCode) === setCode &&
      normalizeCollectorNumber(entry.collectorNumber) === collectorNumber &&
      (normalizeMarketText(entry.language) || "en") === language,
  );
  if (numbered.length === 1) {
    return numbered[0];
  }

  const name = normalizeMarketText(query.englishName) || normalizeMarketText(query.name);
  if (name) {
    return (
      numbered.find(
        (entry) =>
          normalizeMarketText(entry.englishName) === name ||
          normalizeMarketText(entry.name) === name,
      ) ??
      numbered[0] ??
      null
    );
  }

  return numbered[0] ?? null;
}

function gradeConfidence(grade: PokedexMarketGuideGrade): {
  confidence: GradedPrice["confidence"];
  confidenceScore: number;
  warning?: string;
  evidenceType: NonNullable<GradedPrice["evidenceType"]>;
  source: string;
} {
  const sampleCount = grade.sampleCount ?? 0;
  const kind = grade.kind ?? "curator";

  if (kind === "sold") {
    if (sampleCount >= 8) {
      return {
        confidence: "high",
        confidenceScore: 0.78,
        evidenceType: "sold_comp",
        source: `${POKEDEX_MARKET_SOURCE_LABEL} sold comps`,
      };
    }
    if (sampleCount >= POKEDEX_MARKET_SOLD_OVERRIDE_SAMPLES) {
      return {
        confidence: "medium",
        confidenceScore: 0.68,
        evidenceType: "sold_comp",
        source: `${POKEDEX_MARKET_SOURCE_LABEL} sold comps`,
      };
    }
    return {
      confidence: "low",
      confidenceScore: 0.48,
      warning: "Thin first-party sold sample",
      evidenceType: "sold_comp",
      source: `${POKEDEX_MARKET_SOURCE_LABEL} sold comps`,
    };
  }

  if (kind === "paid") {
    if (sampleCount >= 5) {
      return {
        confidence: "medium",
        confidenceScore: 0.55,
        evidenceType: "guide_snapshot",
        source: `${POKEDEX_MARKET_SOURCE_LABEL} collector paid`,
      };
    }
    return {
      confidence: "low",
      confidenceScore: 0.38,
      warning: "Thin collector-paid sample — not a sold listing",
      evidenceType: "guide_snapshot",
      source: `${POKEDEX_MARKET_SOURCE_LABEL} collector paid`,
    };
  }

  return {
    confidence: "medium",
    confidenceScore: 0.72,
    evidenceType: "guide_snapshot",
    source: POKEDEX_MARKET_SOURCE_LABEL,
  };
}

function toGradedPrices(entry: PokedexMarketGuideEntry): GradedPrice[] {
  const rows: GradedPrice[] = [];
  const ungradedUsd = Number(entry.ungradedUsd);
  const ungradedMeta = entry.grades?.find((grade) => grade.grade === "Ungraded");
  if (Number.isFinite(ungradedUsd) && ungradedUsd > 0) {
    const meta = gradeConfidence({
      grade: "Ungraded",
      valueUsd: ungradedUsd,
      sampleCount: ungradedMeta?.sampleCount,
      kind: ungradedMeta?.kind ?? (entry.grades?.length ? undefined : "curator"),
    });
    rows.push({
      grade: "Ungraded",
      value: ungradedUsd,
      populationCount: ungradedMeta?.sampleCount ?? 0,
      source: meta.source,
      evidenceType: meta.evidenceType,
      confidence: meta.confidence,
      confidenceScore: meta.confidenceScore,
      warning: meta.warning,
    });
  }

  for (const grade of entry.grades ?? []) {
    const value = Number(grade.valueUsd);
    if (!grade.grade?.trim() || grade.grade === "Ungraded" || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    const meta = gradeConfidence(grade);
    rows.push({
      grade: grade.grade.trim(),
      value,
      populationCount: grade.sampleCount ?? 0,
      source: meta.source,
      evidenceType: meta.evidenceType,
      confidence: meta.confidence,
      confidenceScore: meta.confidenceScore,
      warning: meta.warning,
    });
  }

  return rows;
}

export function pokedexMarketGuideToProviderResult(
  entry: PokedexMarketGuideEntry,
): ProviderPriceResult | null {
  const gradedPrices = toGradedPrices(entry);
  const ungradedUsd =
    gradedPrices.find((price) => price.grade === "Ungraded")?.value ?? 0;
  if (!(ungradedUsd > 0) && gradedPrices.length === 0) {
    return null;
  }

  const sampleCount = Math.max(
    1,
    ...gradedPrices.map((price) => price.populationCount ?? 0),
    0,
  );
  const sold = gradedPrices.some((price) => price.evidenceType === "sold_comp");

  return {
    provider: POKEDEX_MARKET_PROVIDER_ID,
    sourceLabel: POKEDEX_MARKET_SOURCE_LABEL,
    ungradedUsd,
    confidenceScore: sold ? 0.68 : 0.72,
    matchConfidence: 1,
    evidenceType: sold ? "sold_comp" : "guide_snapshot",
    gradedPrices,
    sampleCount,
    fetchedAt: entry.updatedAt?.trim() || nowIso(),
  };
}

export function lookupPokedexMarketGuide(
  query: PokedexMarketGuideQuery | PriceQuery,
): ProviderPriceResult | null {
  const entry = findPokedexMarketGuideEntry(query);
  return entry ? pokedexMarketGuideToProviderResult(entry) : null;
}

export function aggregateMarketObservations(
  observations: PokedexMarketObservation[],
  identity: PokedexMarketGuideQuery = {},
): PokedexMarketGuideEntry | null {
  const cutoff = Date.now() - POKEDEX_MARKET_MAX_AGE_MS;
  const latest = new Map<string, PokedexMarketObservation>();

  for (const observation of observations) {
    if (!isUsableMarketPriceUsd(observation.priceUsd)) {
      continue;
    }
    const observedAt = Date.parse(observation.observedAt);
    if (Number.isFinite(observedAt) && observedAt < cutoff) {
      continue;
    }
    const grade = normalizeMarketGrade(observation.grade);
    const contributorKey = observation.contributorKey.trim();
    if (!contributorKey) {
      continue;
    }
    const key = `${contributorKey}|${grade}|${observation.kind}`;
    const current = latest.get(key);
    if (!current || observedAt >= Date.parse(current.observedAt)) {
      latest.set(key, {
        ...observation,
        grade,
        contributorKey,
        priceUsd: roundMarketUsd(observation.priceUsd),
      });
    }
  }

  const grouped = new Map<string, { sold: number[]; paid: number[] }>();
  for (const observation of latest.values()) {
    const bucket = grouped.get(observation.grade) ?? { sold: [], paid: [] };
    if (observation.kind === "sold") {
      bucket.sold.push(observation.priceUsd);
    } else {
      bucket.paid.push(observation.priceUsd);
    }
    grouped.set(observation.grade, bucket);
  }

  const grades: PokedexMarketGuideGrade[] = [];
  let ungradedUsd: number | undefined;

  for (const [grade, bucket] of grouped) {
    const sold = filterObservationOutliers(bucket.sold);
    const paid = filterObservationOutliers(bucket.paid);
    const chosen =
      sold.length > 0
        ? { values: sold, kind: "sold" as const }
        : paid.length > 0
          ? { values: paid, kind: "paid" as const }
          : null;
    if (!chosen) {
      continue;
    }
    const valueUsd = roundMarketUsd(median(chosen.values));
    const row: PokedexMarketGuideGrade = {
      grade,
      valueUsd,
      sampleCount: chosen.values.length,
      kind: chosen.kind,
    };
    if (grade === "Ungraded") {
      ungradedUsd = valueUsd;
    }
    grades.push(row);
  }

  if (!(ungradedUsd && ungradedUsd > 0) && !grades.some((grade) => grade.grade !== "Ungraded")) {
    return null;
  }

  return {
    ...identity,
    ungradedUsd,
    grades,
    updatedAt: nowIso(),
    note: "Aggregated from PokePokedex binder and vault reports",
  };
}

function gradeMap(entry: PokedexMarketGuideEntry | null) {
  const map = new Map<string, PokedexMarketGuideGrade>();
  if (!entry) {
    return map;
  }
  if (entry.ungradedUsd && entry.ungradedUsd > 0) {
    const existing = entry.grades?.find((grade) => grade.grade === "Ungraded");
    map.set("Ungraded", {
      grade: "Ungraded",
      valueUsd: entry.ungradedUsd,
      sampleCount: existing?.sampleCount,
      kind: existing?.kind ?? "curator",
    });
  }
  for (const grade of entry.grades ?? []) {
    if (grade.grade === "Ungraded") {
      continue;
    }
    map.set(grade.grade, { ...grade, kind: grade.kind ?? "curator" });
  }
  return map;
}

function preferLiveGrade(
  seed: PokedexMarketGuideGrade | undefined,
  live: PokedexMarketGuideGrade | undefined,
): PokedexMarketGuideGrade | undefined {
  if (live && !seed) {
    return live;
  }
  if (seed && !live) {
    return seed;
  }
  if (!seed || !live) {
    return seed ?? live;
  }

  const liveSold = live.kind === "sold";
  const liveSamples = live.sampleCount ?? 0;
  // Thin paid or a single sold report must not overwrite a curated seed row.
  // Live sold only wins the displayed grade once three independent collectors
  // agree; otherwise live only fills grades the seed does not have.
  if (liveSold && liveSamples >= POKEDEX_MARKET_SOLD_OVERRIDE_SAMPLES) {
    return live;
  }
  return seed;
}

export function mergeSeedAndLiveMarketGuide(
  seed: PokedexMarketGuideEntry | null,
  live: PokedexMarketGuideEntry | null,
): PokedexMarketGuideEntry | null {
  if (!seed) {
    return live;
  }
  if (!live) {
    return {
      ...seed,
      grades: seed.grades?.map((grade) => ({ ...grade, kind: grade.kind ?? "curator" })),
    };
  }

  const seedGrades = gradeMap(seed);
  const liveGrades = gradeMap(live);
  const names = new Set([...seedGrades.keys(), ...liveGrades.keys()]);
  const grades: PokedexMarketGuideGrade[] = [];

  for (const name of names) {
    const next = preferLiveGrade(seedGrades.get(name), liveGrades.get(name));
    if (next) {
      grades.push(next);
    }
  }

  const ungraded = grades.find((grade) => grade.grade === "Ungraded");
  if (!ungraded && grades.every((grade) => grade.grade === "Ungraded" || !(grade.valueUsd > 0))) {
    return seed;
  }

  return {
    slug: seed.slug ?? live.slug,
    setCode: seed.setCode ?? live.setCode,
    collectorNumber: seed.collectorNumber ?? live.collectorNumber,
    language: seed.language ?? live.language,
    name: seed.name ?? live.name,
    englishName: seed.englishName ?? live.englishName,
    ungradedUsd: ungraded?.valueUsd,
    grades,
    note: live.note ?? seed.note,
    updatedAt: live.updatedAt ?? seed.updatedAt ?? nowIso(),
  };
}

function kindFromGradedPrice(price: GradedPrice): PokedexMarketEvidenceKind {
  if (price.evidenceType === "sold_comp") {
    return "sold";
  }
  if (price.source?.toLowerCase().includes("collector paid")) {
    return "paid";
  }
  return "curator";
}

function gradedPricesToGuideEntry(prices: GradedPrice[], ungradedUsd?: number): PokedexMarketGuideEntry {
  const usable = prices.filter((price) => price.evidenceType !== "estimate" && !price.estimate);
  return {
    ungradedUsd: ungradedUsd ?? usable.find((price) => price.grade === "Ungraded")?.value,
    grades: usable.map((price) => ({
      grade: price.grade,
      valueUsd: price.value,
      sampleCount: price.populationCount,
      kind: kindFromGradedPrice(price),
    })),
  };
}

/** Overlay live first-party grades onto an existing card-page result without losing seed/catalog rows. */
export function mergeGradedPricesWithLiveGuide(
  existing: GradedPrice[],
  live: ProviderPriceResult | null,
): GradedPrice[] {
  const liveHasUngraded = Boolean(live?.ungradedUsd && live.ungradedUsd > 0);
  if (!live || (!live.gradedPrices?.length && !liveHasUngraded)) {
    return existing;
  }

  const merged = mergeSeedAndLiveMarketGuide(
    existing.length ? gradedPricesToGuideEntry(existing) : null,
    gradedPricesToGuideEntry(live.gradedPrices ?? [], live.ungradedUsd),
  );
  return merged ? toGradedPrices(merged) : existing;
}
