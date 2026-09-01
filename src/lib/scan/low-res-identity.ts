/**
 * Identity rules for pixelated / blurry scans.
 *
 * Catalog search will happily confirm whatever OCR invented ("Vullaby 49").
 * Low-quality photos may only use a header species read; CLIP and dHash
 * rerank prints of that species and must not pick a different Pokemon.
 */

import { parseCollectorNumber } from "@/lib/scan/identity-evidence";
import { fuzzyNameScore } from "@/lib/scan/ocr";
import { correctOcrSpeciesName } from "@/lib/scan/ocr-species";
import { speciesFromPrintedPhrases } from "@/lib/scan/printed-phrases";

/** Name-band OCR must beat this before we search the catalog. */
export const LOW_RES_SPECIES_MIN_SCORE = 0.72;
export const LOW_RES_SPECIES_UNIQUE_MARGIN = 0.08;

export function isTrustedLowResCollectorNumber(
  raw?: string | null,
): boolean {
  if (!raw?.trim()) return false;
  const token = raw.trim();
  // Bare 1–2 digits are HP, damage, retreat, or footer noise — never TG16.
  if (/^\d{1,2}$/.test(token)) return false;
  const parsed = parseCollectorNumber(token);
  if (parsed.denominator) return true;
  if (parsed.prefix && parsed.primary) return true;
  const primary = parsed.primary ?? "";
  if (/^\d{3}$/.test(primary)) return true;
  if (/^\d{4}$/.test(primary)) {
    const year = Number(primary);
    if (year >= 1995 && year <= 2035) return false;
    return true;
  }
  return false;
}

export function speciesFromLowResHeaderTokens(
  headerTokens: string[],
  extraText: string[] = [],
): { name: string; score: number } | null {
  const fromName = correctOcrSpeciesName(headerTokens, {
    minScore: LOW_RES_SPECIES_MIN_SCORE,
    uniqueMargin: LOW_RES_SPECIES_UNIQUE_MARGIN,
  });
  const fromPhrase = speciesFromPrintedPhrases([
    ...headerTokens,
    ...extraText,
  ]);
  if (fromPhrase && fromName && fromPhrase.name !== fromName.name) {
    // Unique ability/attack titles beat a weak single-token species guess.
    if (fromPhrase.score >= 0.86 && fromName.score < 0.94) {
      return fromPhrase;
    }
  }
  if (fromPhrase && (!fromName || fromPhrase.score >= fromName.score)) {
    return fromPhrase;
  }
  return fromName;
}

export function catalogAgreesWithSpecies(
  card: { name: string; englishName?: string | null },
  species: string,
): boolean {
  const names = [card.englishName, card.name].filter(
    (value): value is string => Boolean(value),
  );
  for (const name of names) {
    const score = Math.max(
      fuzzyNameScore(name, species),
      fuzzyNameScore(name, `${species} V`),
      fuzzyNameScore(name, `${species} VMAX`),
      fuzzyNameScore(name, `${species} VSTAR`),
      fuzzyNameScore(name, `${species} ex`),
      fuzzyNameScore(name, `${species} gx`),
    );
    if (score >= 0.82) return true;
  }
  return false;
}

/**
 * Text-first catalog hits are circular: searching "Vullaby 49" always
 * scores ~1.0 against Vullaby 49. Require an independent header species.
 */
export function canAcceptLowResTextIdentity(input: {
  species: { name: string; score: number } | null;
  catalogNameScore: number;
  catalogCard?: { name: string; englishName?: string | null } | null;
}): boolean {
  if (!input.species || input.species.score < LOW_RES_SPECIES_MIN_SCORE) {
    return false;
  }
  if (input.catalogNameScore < 0.9) return false;
  if (
    input.catalogCard &&
    !catalogAgreesWithSpecies(input.catalogCard, input.species.name)
  ) {
    return false;
  }
  return true;
}

/** Weak visual piles are guesses — show nothing instead of 6–8 lookalikes. */
export const LOW_CONFIDENCE_SCAN_FLOOR = 0.82;
export const LOW_CONFIDENCE_MAX_RESULTS = 3;
export const NAMED_LOW_QUALITY_MAX_RESULTS = 3;

/**
 * Low-confidence scans must not dump a page of lookalikes.
 * No printed species + weak artwork → empty. A named species may keep a
 * short print list so the user can pick TG16 vs TG30.
 */
export function restrictLowConfidenceScanResults<T>(
  matches: T[],
  options: {
    scoreOf: (item: T) => number;
    nameOf: (item: T) => string;
    trustedSpecies: string | null;
    clipTrusted: boolean;
  },
): T[] {
  if (!matches.length) return [];
  const sorted = [...matches].sort(
    (left, right) => options.scoreOf(right) - options.scoreOf(left),
  );
  const top = options.scoreOf(sorted[0]);
  const species = options.trustedSpecies?.trim() || null;

  if (species) {
    const named = sorted.filter((item) =>
      catalogAgreesWithSpecies({ name: options.nameOf(item) }, species),
    );
    if (!named.length) return [];
    const cap =
      top >= LOW_CONFIDENCE_SCAN_FLOOR ? 6 : NAMED_LOW_QUALITY_MAX_RESULTS;
    return named.slice(0, cap);
  }

  if (!options.clipTrusted || top < LOW_CONFIDENCE_SCAN_FLOOR) {
    return [];
  }
  return sorted.slice(0, LOW_CONFIDENCE_MAX_RESULTS);
}
