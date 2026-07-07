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

/** Levenshtein edit distance between two short strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/** Characters OCR routinely confuses; normalized away before fuzzy compare. */
const OCR_CONFUSIONS: Record<string, string> = {
  "0": "o",
  "1": "l",
  "5": "s",
  "8": "b",
  "6": "g",
  "2": "z",
};

/** Lowercase + collapse common OCR character confusions for fuzzy matching. */
export function normalizeForFuzzy(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/[015862]/g, (char) => OCR_CONFUSIONS[char] ?? char);
}

/**
 * Similarity in [0,1] between an OCR token and a known name, tolerant of the
 * character swaps OCR tends to make. 1 means an effective exact match.
 */
export function fuzzyNameScore(candidate: string, known: string): number {
  const a = normalizeForFuzzy(candidate);
  const b = normalizeForFuzzy(known);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.startsWith(a) || a.startsWith(b)) {
    return 0.9 - Math.abs(a.length - b.length) / Math.max(a.length, b.length) * 0.3;
  }
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
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

export type OcrProgress = {
  status: string;
  progress: number;
};

type TesseractWorker = {
  recognize: (image: string) => Promise<{ data: { text?: string | null } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let activeProgress: ((message: OcrProgress) => void) | null = null;
let recognitionQueue = Promise.resolve();

async function createOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import("tesseract.js");
  return createWorker(["eng", "jpn"], 1, {
    logger: (message: OcrProgress) => {
      activeProgress?.(message);
    },
  }) as Promise<TesseractWorker>;
}

/** Start loading Tesseract once. The same worker is reused for future scans. */
export function preloadOcrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/**
 * OCR is serialized through one persistent worker. This avoids the expensive
 * create/terminate cycle for the name strip and full-card passes, and keeps
 * later scans warm.
 */
export function recognizeOcrText(
  image: string,
  onProgress?: (message: OcrProgress) => void,
): Promise<string> {
  const run = async () => {
    const worker = await preloadOcrWorker();
    activeProgress = onProgress ?? null;
    try {
      const { data } = await worker.recognize(image);
      return data.text ?? "";
    } finally {
      activeProgress = null;
    }
  };

  const next = recognitionQueue.then(run, run);
  recognitionQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function terminateOcrWorker(): Promise<void> {
  const worker = await workerPromise?.catch(() => null);
  workerPromise = null;
  activeProgress = null;
  if (worker) {
    await worker.terminate();
  }
}
