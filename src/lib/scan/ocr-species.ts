/**
 * Correct garbled nested-screenshot OCR against official English species
 * names. Does not require the Pokemon names API or visual catalog.
 */

import { ENGLISH_SPECIES_NAMES } from "@/lib/scan/english-species-names";
import { fuzzyNameScore, parseOcrText } from "@/lib/scan/ocr";

const MIN_SPECIES_SCORE = 0.72;
const UNIQUE_MARGIN = 0.04;

export type CorrectOcrSpeciesOptions = {
  minScore?: number;
  uniqueMargin?: number;
};

/** App chrome that OCR often reads from screenshot banners. */
const NESTED_OCR_NAME_BLOCKLIST = new Set([
  "search",
  "products",
  "trading",
  "games",
  "collectr",
  "filters",
  "filter",
  "pokemon",
  "scanner",
  "unlimited",
  "scanning",
  "camera",
  "gallery",
  "settings",
  "profile",
  "portfolio",
  "english",
  "japanese",
  "korean",
  "chinese",
  "collect",
  "quick",
]);

function nestedNamePriority(name: string): number {
  if (/^[A-Z][a-z]{4,}$/.test(name) || /^[a-z]{5,}$/.test(name)) return 0;
  if (/^[A-Za-z]+$/.test(name)) return 1;
  return 2;
}

/** Prefer clean Latin species tokens over mixed-case OCR junk. */
export function rankNestedOcrNameCandidates(names: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 4) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  unique.sort(
    (left, right) =>
      nestedNamePriority(left) - nestedNamePriority(right) ||
      right.length - left.length,
  );
  return unique;
}

/** Letter runs plus parseOcrText names from a nested-crop OCR blob. */
export function extractNestedOcrNameTokens(blob: string): string[] {
  const letterRuns = blob.match(/[A-Za-z]{5,16}/g) ?? [];
  const parsed = parseOcrText(blob, { region: "header" }).nameCandidates;
  return rankNestedOcrNameCandidates([...parsed, ...letterRuns]);
}

/**
 * Map noisy OCR tokens (e.g. "VSpooreon") onto the closest official species.
 * Returns null when the best hit is weak or tied with another species.
 */
export function correctOcrSpeciesName(
  candidates: string[],
  options: CorrectOcrSpeciesOptions = {},
): { name: string; score: number } | null {
  const minScore = options.minScore ?? MIN_SPECIES_SCORE;
  const uniqueMargin = options.uniqueMargin ?? UNIQUE_MARGIN;
  let best: { name: string; score: number } | null = null;
  let second = 0;

  for (const candidate of rankNestedOcrNameCandidates(candidates)) {
    if (NESTED_OCR_NAME_BLOCKLIST.has(candidate.toLocaleLowerCase())) {
      continue;
    }
    if (candidate.length < 5 || candidate.length > 16) {
      continue;
    }

    for (const species of ENGLISH_SPECIES_NAMES) {
      if (Math.abs(species.length - candidate.length) > 3) {
        continue;
      }
      const score = fuzzyNameScore(candidate, species);
      if (!best || score > best.score) {
        second = best?.score ?? 0;
        best = { name: species, score };
      } else if (score > second) {
        second = score;
      }
    }
  }

  if (!best || best.score < minScore) {
    return null;
  }
  if (best.score < 0.9 && best.score - second < uniqueMargin) {
    return null;
  }
  return best;
}
