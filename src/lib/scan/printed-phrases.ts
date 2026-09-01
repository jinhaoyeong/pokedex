/**
 * Distinctive printed titles (abilities / attacks) that stay readable when
 * the name bar is dark or pixelated. Two-or-more-word phrases only — never
 * map a single OCR token onto a species.
 */

import { fuzzyNameScore } from "@/lib/scan/ocr";

type PrintedPhrase = {
  phrase: string;
  species: string;
};

/**
 * Unique English card text → species. Only titles that belong to one
 * evolutionary line, so a fuzzy OCR hit cannot hop to another Pokemon.
 */
const UNIQUE_PRINTED_PHRASES: PrintedPhrase[] = [
  { phrase: "dummy doll", species: "Mimikyu" },
  { phrase: "jealous eyes", species: "Mimikyu" },
  { phrase: "quick shooting", species: "Inteleon" },
  { phrase: "rapid hunt", species: "Crobat" },
  { phrase: "big shield", species: "Aegislash" },
  { phrase: "reaping charge", species: "Crobat" },
  { phrase: "photon blender", species: "Necrozma" },
  { phrase: "genome hacking", species: "Mewtwo" },
  { phrase: "star alchemy", species: "Alakazam" },
  { phrase: "shining feather", species: "Ho-Oh" },
  { phrase: "lost impact", species: "Giratina" },
  { phrase: "royal blaze", species: "Ninetales" },
  { phrase: "nights daze", species: "Zoroark" },
  { phrase: "night daze", species: "Zoroark" },
  { phrase: "wicked blow", species: "Urshifu" },
  { phrase: "surging strikes", species: "Urshifu" },
];

const MIN_PHRASE_SCORE = 0.86;

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function windowsOf(words: string[], size: number): string[] {
  if (words.length < size) return [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - size; i += 1) {
    out.push(words.slice(i, i + size).join(" "));
  }
  return out;
}

/** Consecutive 2–3 word runs from OCR, plus the raw candidates. */
export function extractPrintedPhrases(texts: string[]): string[] {
  const phrases: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizePhrase(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    phrases.push(normalized);
  };
  for (const text of texts) {
    add(text);
    const words = normalizePhrase(text).split(" ").filter(Boolean);
    for (const window of [...windowsOf(words, 2), ...windowsOf(words, 3)]) {
      add(window);
    }
  }
  return phrases;
}

/**
 * Map OCR ability/attack titles onto a species. Returns null unless one
 * unique two-word phrase clearly wins.
 */
export function speciesFromPrintedPhrases(
  texts: string[],
): { name: string; score: number } | null {
  const phrases = extractPrintedPhrases(texts);
  if (!phrases.length) return null;

  let best: { name: string; score: number } | null = null;
  let second = 0;
  for (const phrase of phrases) {
    if (phrase.split(" ").length < 2) continue;
    for (const entry of UNIQUE_PRINTED_PHRASES) {
      const score = fuzzyNameScore(phrase, entry.phrase);
      if (!best || score > best.score) {
        second = best?.score ?? 0;
        best = { name: entry.species, score };
      } else if (entry.species !== best.name && score > second) {
        second = score;
      }
    }
  }

  if (!best || best.score < MIN_PHRASE_SCORE) return null;
  if (best.score < 0.96 && best.score - second < 0.06) return null;
  return best;
}
