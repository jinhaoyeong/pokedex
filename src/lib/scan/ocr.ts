/**
 * Helpers for preparing scanned Pokemon card images for OCR, then turning raw
 * OCR text into a structured search guess.
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
  "slab",
  "day",
  "images",
  "image",
  "subject",
  "copyright",
  "psa",
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
  // Pokemon name rows almost always include HP. Prioritize those short printed
  // header lines over longer attack/rules text before generating candidates.
  const candidateLines = [...lines].sort((left, right) => {
    const leftHasHp = /\b\d{1,3}\s*hp\b/i.test(left);
    const rightHasHp = /\b\d{1,3}\s*hp\b/i.test(right);
    if (leftHasHp !== rightHasHp) return leftHasHp ? -1 : 1;
    return 0;
  });

  let suffix: string | undefined;
  const nameCandidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string) => {
    const key = candidate.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      nameCandidates.push(candidate);
    }
  };

  // Preserve multi-word identities ("Dark Charizard", Japanese names with a
  // spaced suffix) before isolated words. Social captions often contain a
  // cleaner identity than the tilted card itself.
  for (const line of candidateLines.slice(0, 12)) {
    const tokens = line.split(" ");
    let run: string[] = [];
    const flushRun = () => {
      if (run.length >= 2) {
        for (let size = 2; size <= Math.min(3, run.length); size += 1) {
          for (let start = 0; start + size <= run.length; start += 1) {
            addCandidate(run.slice(start, start + size).join(" "));
          }
        }
      }
      run = [];
    };
    for (const token of tokens) {
      if (looksLikeName(token) && !NAME_SUFFIXES.has(token.toLowerCase())) {
        run.push(token);
      } else {
        flushRun();
      }
    }
    flushRun();
  }

  // Then add individual tokens and suffix compounds as lower-priority fallbacks.
  for (const line of candidateLines.slice(0, 12)) {
    const tokens = line.split(" ");
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const lower = token.toLowerCase();

      if (NAME_SUFFIXES.has(lower)) {
        suffix = suffix ?? lower;
        // Keep "Name VMAX" as a single candidate when OCR saw both tokens.
        const prev = tokens[i - 1];
        if (prev && looksLikeName(prev)) {
          const compound = `${prev} ${token}`;
          addCandidate(compound);
        }
        continue;
      }

      if (!looksLikeName(token)) {
        continue;
      }

      addCandidate(token);
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
    .replace(/[^\p{L}\p{N}]/gu, "")
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

export type OcrImageSlice = {
  image: string;
  label: string;
  yStart: number;
  yEnd: number;
};

type OcrPreprocessOptions = {
  label: string;
  yStart: number;
  yEnd: number;
  maxDimension?: number;
  contrast?: number;
  brightness?: number;
  threshold?: boolean;
  /** Invert after normalize — helps white name text on dark full-art cards. */
  invert?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadOcrImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load OCR image"));
    img.src = src;
  });
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function normalizeOcrPixels(image: ImageData, threshold: boolean, invert = false) {
  const { data } = image;
  const luminance: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    luminance.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  const low = percentile(luminance, 0.08);
  const high = percentile(luminance, 0.94);
  const range = Math.max(24, high - low);
  let sum = 0;
  for (const value of luminance) {
    sum += clamp(((value - low) / range) * 255, 0, 255);
  }
  const mean = sum / Math.max(1, luminance.length);
  const cutoff = clamp(mean * 0.92, 92, 188);

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let normalized = clamp(((gray - low) / range) * 255, 0, 255);
    normalized = clamp((normalized - 128) * 1.22 + 128, 0, 255);
    if (invert) {
      normalized = 255 - normalized;
    }
    const value = threshold ? (normalized >= cutoff ? 255 : 0) : normalized;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
}

/**
 * Render a crop through canvas filters, then normalize its luminance. Text
 * strips use thresholding so Tesseract sees crisp black/white glyph edges even
 * under indoor shadows, glare, and colored card backgrounds.
 */
export async function preprocessOcrRegion(
  source: string,
  options: OcrPreprocessOptions,
): Promise<OcrImageSlice> {
  const img = await loadOcrImage(source);
  const yStart = clamp(options.yStart, 0, 0.98);
  const yEnd = clamp(Math.max(options.yEnd, yStart + 0.02), yStart + 0.02, 1);
  const sy = Math.round(img.height * yStart);
  const sh = Math.max(1, Math.round(img.height * (yEnd - yStart)));
  const maxDimension = options.maxDimension ?? 1600;
  const scale = Math.min(2, maxDimension / Math.max(img.width, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    return { image: source, label: options.label, yStart, yEnd };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = [
    "grayscale(100%)",
    `contrast(${options.contrast ?? 145}%)`,
    `brightness(${options.brightness ?? 112}%)`,
    "saturate(0%)",
  ].join(" ");
  ctx.drawImage(img, 0, sy, img.width, sh, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  normalizeOcrPixels(data, options.threshold ?? true, options.invert ?? false);
  ctx.putImageData(data, 0, 0);

  return {
    image: canvas.toDataURL("image/jpeg", 0.92),
    label: options.label,
    yStart,
    yEnd,
  };
}

export async function buildOcrImageSlices(source: string): Promise<OcrImageSlice[]> {
  // Name band first (normal + inverted for white-on-dark full arts like
  // Umbreon VMAX), then a compact full-card pass for collector numbers.
  return Promise.all([
    preprocessOcrRegion(source, {
      label: "name-top-expanded",
      yStart: 0,
      yEnd: 0.28,
      maxDimension: 1200,
      contrast: 152,
      brightness: 116,
      threshold: true,
    }),
    preprocessOcrRegion(source, {
      label: "name-top-inverted",
      yStart: 0,
      yEnd: 0.3,
      maxDimension: 1200,
      contrast: 160,
      brightness: 120,
      threshold: true,
      invert: true,
    }),
    preprocessOcrRegion(source, {
      label: "number-bottom",
      yStart: 0.82,
      yEnd: 1,
      maxDimension: 1000,
      contrast: 150,
      brightness: 114,
      threshold: true,
      invert: true,
    }),
    preprocessOcrRegion(source, {
      label: "full-card-balanced",
      yStart: 0,
      yEnd: 1,
      maxDimension: 1000,
      contrast: 138,
      brightness: 108,
      threshold: false,
    }),
  ]);
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
