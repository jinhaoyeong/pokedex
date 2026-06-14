/**
 * Pure helpers for turning raw OCR text from a scanned Pokemon card into a
 * structured search guess. Kept free of browser/runtime APIs so it can be
 * unit-reasoned about and shared between client and server.
 */

/** Tokens that frequently appear on cards but are never the Pokemon name. */
const STOP_WORDS = new Set([
  "hp",
  "basic",
  "stage",
  "stage1",
  "stage2",
  "evolves",
  "from",
  "into",
  "pokemon",
  "trainer",
  "energy",
  "item",
  "supporter",
  "stadium",
  "weakness",
  "resistance",
  "retreat",
  "cost",
  "illus",
  "ability",
  "ancient",
  "future",
  "tera",
  "rule",
  "box",
  "the",
  "and",
  "for",
  "this",
  "your",
  "you",
  "may",
  "put",
  "damage",
  "counters",
  "attack",
  "defending",
  "active",
  "bench",
  "benched",
  "each",
  "turn",
  "card",
  "cards",
  "deck",
  "hand",
  "discard",
  "pile",
]);

/** Suffixes that are part of the card name and worth keeping (e.g. "ex"). */
const NAME_SUFFIXES = new Set(["ex", "gx", "vmax", "vstar", "v"]);

export interface ParsedOcrText {
  /** Candidate name tokens ranked from most to least likely. */
  nameCandidates: string[];
  /** Collector number when a "NNN/NNN" or trailing-number pattern is found. */
  number?: string;
  /** Suffix detected next to the name, e.g. "ex" / "vstar". */
  suffix?: string;
  /** Lines of cleaned text, longest first. */
  lines: string[];
}

function cleanLine(line: string): string {
  return line
    .replace(/[^\p{L}\p{N}\s/'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect a collector number like "58/198", "058/198", or "SV049". */
export function extractCollectorNumber(text: string): string | undefined {
  const fraction = text.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (fraction) {
    return `${fraction[1]}/${fraction[2]}`;
  }

  const promo = text.match(/\b([A-Z]{1,4}\d{1,3})\b/);
  if (promo) {
    return promo[1];
  }

  return undefined;
}

function looksLikeName(token: string): boolean {
  const lower = token.toLowerCase();
  if (STOP_WORDS.has(lower)) {
    return false;
  }
  if (token.length < 3) {
    return false;
  }
  // Mostly-alphabetic tokens only (allow internal apostrophe/hyphen).
  return /^[\p{L}][\p{L}'-]*$/u.test(token);
}

/**
 * Parse raw OCR output into a structured guess. The name candidates are
 * intentionally generous — the caller validates them against the Pokemon name
 * database before committing to a search query.
 */
export function parseOcrText(rawText: string): ParsedOcrText {
  const lines = rawText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const number = extractCollectorNumber(rawText);

  let suffix: string | undefined;
  const nameCandidates: string[] = [];
  const seen = new Set<string>();

  // Prefer tokens from the visually largest lines (top of the card name bar),
  // which OCR tends to report among the earlier/longer lines.
  for (const line of lines.slice(0, 12)) {
    const tokens = line.split(" ");
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const lower = token.toLowerCase();

      if (NAME_SUFFIXES.has(lower)) {
        suffix = suffix ?? lower;
        continue;
      }

      if (!looksLikeName(token)) {
        continue;
      }

      const normalized = token.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        nameCandidates.push(token);
      }
    }
  }

  return { nameCandidates, number, suffix, lines };
}

/**
 * Build a search query string from a validated name plus optional suffix and
 * collector number. Mirrors the free-text grammar the live search understands
 * (e.g. "Charizard ex 199" or "Pikachu 58").
 */
export function buildScanQuery(parts: {
  name: string;
  suffix?: string;
  number?: string;
}): string {
  const segments = [parts.name.trim()];
  if (parts.suffix) {
    segments.push(parts.suffix);
  }
  if (parts.number) {
    // The live search keys off the printed number, not the set total.
    segments.push(parts.number.split("/")[0]);
  }
  return segments.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
