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

export type OcrRegion = "header" | "hp" | "footer" | "full" | "other";

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

export type ParseOcrTextOptions = {
  /** Region name or slice label. Standalone numbers are trusted only in the footer. */
  region?: OcrRegion | string;
};

/** Region-aware OCR evidence used for weighted identity ranking. */
export interface OcrTextEvidence {
  text: string;
  region: OcrRegion;
  confidence: number;
  rotation: number;
  nameCandidates: string[];
  number?: string;
  suffix?: string;
}

export function ocrRegionFromLabel(label: string): OcrRegion {
  if (label.includes("hp")) return "hp";
  // PSA label bands are English identity text at the top of a slab crop.
  if (label.includes("psa") || label.includes("label")) return "header";
  if (label.startsWith("name-") || label.includes("top") || label.includes("header")) {
    return "header";
  }
  if (label.includes("number") || label.includes("bottom") || label.includes("footer")) {
    return "footer";
  }
  if (label.includes("full")) return "full";
  return "other";
}

export function regionConfidence(region: OcrRegion): number {
  switch (region) {
    case "header":
      return 0.91;
    case "footer":
      return 0.88;
    case "hp":
      return 0.72;
    case "full":
      return 0.55;
    default:
      return 0.4;
  }
}

/** Prefer header name candidates, then full-card, when merging OCR passes. */
export function mergeOcrNameCandidates(evidence: OcrTextEvidence[]): string[] {
  const ranked = [...evidence].sort((left, right) => {
    const regionRank = (region: OcrRegion) =>
      region === "header" ? 0 : region === "full" ? 1 : 2;
    return (
      regionRank(left.region) - regionRank(right.region) ||
      right.confidence - left.confidence
    );
  });
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    for (const candidate of item.nameCandidates) {
      const key = candidate.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(candidate);
    }
  }
  return names;
}

function cleanLine(line: string): string {
  return line
    .replace(/[^\p{L}\p{N}\s/'-.#]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** PSA label rarity/code prefixes such as FA/, CSR/, SAR/. */
const PSA_RARITY_PREFIX =
  /^(?:FA|CSR|CHR|AR|SAR|SR|UR|HR|RRR|RR|TR|TG|PR|PROMO)\s*\/\s*/i;

/** Common PSA / PriceCharting abbreviations on graded-label name lines. */
const PSA_NAME_ABBREVIATIONS: Array<[RegExp, string]> = [
  // Consume the trailing separator so "ORGN.FRM.PALKIA" → "Origin Forme Palkia".
  [/\bORGN\.?\s*FRM\.?\b[.\s]*/gi, "Origin Forme "],
  [/\bORG\.?\s*FRM\.?\b[.\s]*/gi, "Origin Forme "],
  [/\bORIG\.?\s*FORME?\b[.\s]*/gi, "Origin Forme "],
  [/\bG-HOLO\b/gi, "G"],
  [/\b1ST\s*ED\.?\b/gi, ""],
];

/**
 * Expand a PSA label card-name fragment into a searchable Pokemon name.
 * Examples: "FA/MIMIKYU VMAX" → "Mimikyu VMAX", "FA/ORGN.FRM.PALKIA V" →
 * "Origin Forme Palkia V".
 */
export function expandPsaLabelName(raw: string): string {
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(PSA_RARITY_PREFIX, "");
  for (const [pattern, replacement] of PSA_NAME_ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Title-case Latin tokens; leave CJK alone.
  if (/^[\x00-\x7F]+$/.test(text)) {
    text = text
      .split(" ")
      .filter(Boolean)
      .map((token) => {
        const lower = token.toLowerCase();
        if (NAME_SUFFIXES.has(lower)) return lower === "ex" ? "ex" : token.toUpperCase();
        if (lower === "gx" || lower === "ex") return lower;
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      })
      .join(" ");
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Detect a collector number like "58/198", "058/198", "#234", or "SV049". */
export function extractCollectorNumber(text: string): string | undefined {
  const fraction = text.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  if (fraction) {
    return `${fraction[1]}/${fraction[2]}`;
  }

  // Require an explicit hash/numero mark so years like "2021" on PSA labels
  // cannot win over "#234".
  const hashNumber = text.match(/(?:^|[\s])[#№]\s*(\d{1,4})\b/);
  if (hashNumber) {
    return hashNumber[1];
  }

  const promo = text.match(/\b([A-Z]{1,4}\d{1,3})\b/);
  if (promo) {
    return promo[1];
  }

  return undefined;
}

/**
 * Parse English PSA / CGC label text commonly visible above slabbed cards.
 * Returns name candidates + collector number when the label grammar matches.
 */
export function parsePsaLabelText(rawText: string): ParsedOcrText {
  const lines = rawText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
  const nameCandidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string) => {
    const expanded = expandPsaLabelName(candidate);
    if (!expanded || expanded.length < 3) return;
    const key = expanded.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    nameCandidates.push(expanded);
  };

  let number: string | undefined;
  let suffix: string | undefined;

  for (const line of lines) {
    if (!number) {
      const hash = line.match(/(?:^|[\s])#\s*(\d{1,4})\b/);
      if (hash) number = hash[1];
    }
    // Skip grade / cert / boilerplate / set-title rows.
    if (
      /\b(?:GEM\s*MT|MINT|PSA|CGC|BGS|CERT|POP|AUTHENTIC)\b/i.test(line) ||
      /^\d{6,}$/.test(line) ||
      /\b(?:POKEMON|JPN|JAPANESE|SWSH|XY|SM|SV|BW)\b/i.test(line) ||
      /\b(?:CLIMAX|JUGGLER|UNIVERSE|PRISM|CONQUEST|COLLECTION)\b/i.test(line)
    ) {
      continue;
    }
    // "FA/MIMIKYU VMAX" or "ORIGIN PALKIA VSTAR"
    if (
      PSA_RARITY_PREFIX.test(line) ||
      /\b(?:VMAX|VSTAR|V|GX|EX)\b/i.test(line) ||
      /\bORGN\.?\s*FRM/i.test(line)
    ) {
      addCandidate(line);
      const expanded = expandPsaLabelName(line);
      const tokens = expanded.split(/\s+/);
      const last = tokens[tokens.length - 1]?.toLowerCase();
      if (last && NAME_SUFFIXES.has(last)) {
        suffix = suffix ?? last;
        if (tokens.length > 1) {
          addCandidate(tokens.slice(0, -1).join(" "));
        }
      }
    }
  }

  if (!number) {
    number = extractCollectorNumber(rawText);
  }

  return {
    nameCandidates,
    number,
    suffix,
    lines,
  };
}

/**
 * Region-aware collector extraction. Structured numbers keep the legacy
 * behavior everywhere; a bare 1-4 digit line is accepted only from a footer /
 * bottom slice, where HP and attack-damage numbers cannot leak in.
 */
export function extractCollectorNumberForRegion(
  text: string,
  region: OcrRegion | string,
): string | undefined {
  const structured = extractCollectorNumber(text);
  if (structured) return structured;

  const normalizedRegion =
    region === "header" ||
    region === "hp" ||
    region === "footer" ||
    region === "full" ||
    region === "other"
      ? region
      : ocrRegionFromLabel(region);

  // PSA labels put "#234" in the header band. Accept explicit hash/numero marks
  // there so slab crops can resolve identity without a card-footer read.
  if (normalizedRegion === "header") {
    const hash = text.match(/(?:^|[\s])#\s*(\d{1,4})\b/m);
    if (hash) return hash[1];
  }

  if (normalizedRegion !== "footer") return undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    // Small foil print often turns the slash into a vertical stroke or "7".
    // Keep this tolerant form footer-only and require a complete compact token
    // so ordinary HP/attack numbers cannot become collector evidence.
    for (const token of rawLine.match(/[A-Za-z0-9|/]+/g) ?? []) {
      const ambiguousFraction = token.match(
        /^(\d{2,3})[7|Il](\d{2,3})[A-Za-z]{0,3}$/,
      );
      if (ambiguousFraction) {
        return `${ambiguousFraction[1]}/${ambiguousFraction[2]}`;
      }
    }
    const standalone = rawLine
      .trim()
      .match(/^(?:(?:no\.?)|#|№)?\s*(\d{1,4})$/iu);
    if (standalone) return standalone[1];
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
export function parseOcrText(
  rawText: string,
  options: ParseOcrTextOptions = {},
): ParsedOcrText {
  const lines = rawText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const psaParsed = parsePsaLabelText(rawText);
  const regionLabel = options.region ?? "";
  const preferPsa =
    typeof regionLabel === "string" &&
    (regionLabel.includes("psa") || regionLabel.includes("label"));

  let number = options.region
    ? extractCollectorNumberForRegion(rawText, options.region)
    : extractCollectorNumber(rawText);
  if (!number && psaParsed.number) {
    number = psaParsed.number;
  }
  // Pokemon name rows almost always include HP. Prioritize those short printed
  // header lines over longer attack/rules text before generating candidates.
  const candidateLines = [...lines].sort((left, right) => {
    const leftHasHp = /\b\d{1,3}\s*hp\b/i.test(left);
    const rightHasHp = /\b\d{1,3}\s*hp\b/i.test(right);
    if (leftHasHp !== rightHasHp) return leftHasHp ? -1 : 1;
    return 0;
  });

  let suffix: string | undefined = psaParsed.suffix;
  const nameCandidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string) => {
    const key = candidate.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      nameCandidates.push(candidate);
    }
  };

  // PSA label names are high-signal when present (FA/MIMIKYU VMAX, #234).
  if (preferPsa) {
    for (const candidate of psaParsed.nameCandidates) addCandidate(candidate);
  }

  // Preserve multi-word identities ("Dark Charizard", Japanese names with a
  // spaced suffix) before isolated words. Social captions often contain a
  // cleaner identity than the tilted card itself.
  for (const line of candidateLines.slice(0, 12)) {
    if (PSA_RARITY_PREFIX.test(line) || /\bORGN\.?\s*FRM/i.test(line)) {
      const expanded = expandPsaLabelName(line);
      if (expanded) addCandidate(expanded);
    }
    // Split rarity prefixes so "FA/MIMIKYU" becomes a usable name token.
    const tokens = line
      .split(/[\s/]+/)
      .map((token) => token.trim())
      .filter(Boolean);
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
    const tokens = line.split(/[\s/]+/).filter(Boolean);
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

  if (!preferPsa) {
    for (const candidate of psaParsed.nameCandidates) addCandidate(candidate);
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

export type OcrPreprocessingMetadata = {
  grayscale: boolean;
  contrast: number;
  brightness: number;
  threshold: boolean;
  inverted: boolean;
  maxDimension: number;
  scale: number;
};

export type OcrImageSlice = {
  image: string;
  label: string;
  region: OcrRegion;
  rotation: number;
  xStart: number;
  xEnd: number;
  yStart: number;
  yEnd: number;
  preprocessing: OcrPreprocessingMetadata;
};

type OcrPreprocessOptions = {
  label: string;
  xStart?: number;
  xEnd?: number;
  yStart: number;
  yEnd: number;
  rotation?: 0 | 90 | 180 | 270;
  maxDimension?: number;
  maxScale?: number;
  contrast?: number;
  brightness?: number;
  threshold?: boolean;
  /** Invert after normalize — helps white name text on dark full-art cards. */
  invert?: boolean;
  rawColor?: boolean;
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
  const xStart = clamp(options.xStart ?? 0, 0, 0.98);
  const xEnd = clamp(
    Math.max(options.xEnd ?? 1, xStart + 0.02),
    xStart + 0.02,
    1,
  );
  const yStart = clamp(options.yStart, 0, 0.98);
  const yEnd = clamp(Math.max(options.yEnd, yStart + 0.02), yStart + 0.02, 1);
  const sx = Math.round(img.width * xStart);
  const sw = Math.max(1, Math.round(img.width * (xEnd - xStart)));
  const sy = Math.round(img.height * yStart);
  const sh = Math.max(1, Math.round(img.height * (yEnd - yStart)));
  const maxDimension = options.maxDimension ?? 1600;
  const scale = Math.min(options.maxScale ?? 3, maxDimension / Math.max(sw, sh));
  const rotation = options.rotation ?? 0;
  const preprocessing: OcrPreprocessingMetadata = {
    grayscale: !options.rawColor,
    contrast: options.rawColor ? 100 : options.contrast ?? 145,
    brightness: options.rawColor ? 100 : options.brightness ?? 112,
    threshold: options.rawColor ? false : options.threshold ?? true,
    inverted: options.invert ?? false,
    maxDimension,
    scale,
  };
  const region = ocrRegionFromLabel(options.label);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    return {
      image: source,
      label: options.label,
      region,
      rotation,
      xStart,
      xEnd,
      yStart,
      yEnd,
      preprocessing,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = options.rawColor
    ? "none"
    : [
        "grayscale(100%)",
        `contrast(${options.contrast ?? 145}%)`,
        `brightness(${options.brightness ?? 112}%)`,
        "saturate(0%)",
      ].join(" ");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";

  if (!options.rawColor) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    normalizeOcrPixels(data, options.threshold ?? true, options.invert ?? false);
    ctx.putImageData(data, 0, 0);
  }

  let output = canvas;
  if (rotation !== 0) {
    const rotated = document.createElement("canvas");
    const swapsDimensions = rotation === 90 || rotation === 270;
    rotated.width = swapsDimensions ? canvas.height : canvas.width;
    rotated.height = swapsDimensions ? canvas.width : canvas.height;
    const rotatedContext = rotated.getContext("2d");
    if (rotatedContext) {
      rotatedContext.translate(rotated.width / 2, rotated.height / 2);
      rotatedContext.rotate((rotation * Math.PI) / 180);
      rotatedContext.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      output = rotated;
    }
  }

  return {
    image: output.toDataURL("image/png"),
    label: options.label,
    region,
    rotation,
    xStart,
    xEnd,
    yStart,
    yEnd,
    preprocessing,
  };
}

/** English PSA / CGC label bands at the top of a slab crop. */
export async function buildPsaLabelOcrSlices(
  source: string,
): Promise<OcrImageSlice[]> {
  return Promise.all([
    preprocessOcrRegion(source, {
      label: "psa-label-top",
      xStart: 0,
      xEnd: 1,
      yStart: 0,
      yEnd: 0.22,
      maxDimension: 1400,
      contrast: 145,
      brightness: 118,
      threshold: true,
    }),
    preprocessOcrRegion(source, {
      label: "psa-label-name-band",
      xStart: 0.04,
      xEnd: 0.96,
      yStart: 0.03,
      yEnd: 0.18,
      maxDimension: 1400,
      contrast: 155,
      brightness: 120,
      threshold: true,
    }),
  ]);
}

export async function buildOcrImageSlices(
  source: string,
  options: { includePsaLabel?: boolean } = {},
): Promise<OcrImageSlice[]> {
  // The first three slices are deliberately the identity-critical regions.
  // Callers put these ahead of secondary crop variants so a tight OCR budget
  // cannot spend all its time rereading broad headers before reaching a number.
  // For slab crops, PSA label bands are prepended — English label text is often
  // clearer than foil Japanese print under plastic glare.
  const psaSlices = options.includePsaLabel
    ? await buildPsaLabelOcrSlices(source)
    : [];

  const cardSlices = await Promise.all([
    preprocessOcrRegion(source, {
      label: "name-top-expanded",
      xStart: 0,
      xEnd: 0.82,
      yStart: 0,
      yEnd: 0.22,
      maxDimension: 1200,
      contrast: 152,
      brightness: 116,
      threshold: true,
    }),
    preprocessOcrRegion(source, {
      label: "number-bottom-left-balanced",
      xStart: 0.1,
      xEnd: 0.5,
      yStart: 0.88,
      yEnd: 0.99,
      maxDimension: 1600,
      maxScale: 12,
      rawColor: true,
    }),
    preprocessOcrRegion(source, {
      label: "number-bottom-right-balanced",
      xStart: 0.5,
      xEnd: 0.99,
      yStart: 0.88,
      yEnd: 0.99,
      maxDimension: 1600,
      maxScale: 10,
      rawColor: true,
    }),
    preprocessOcrRegion(source, {
      label: "hp-top-right",
      xStart: 0.6,
      xEnd: 1,
      yStart: 0,
      yEnd: 0.2,
      maxDimension: 900,
      contrast: 148,
      brightness: 114,
      threshold: true,
    }),
    preprocessOcrRegion(source, {
      label: "name-top-inverted",
      xStart: 0,
      xEnd: 0.86,
      yStart: 0,
      yEnd: 0.25,
      maxDimension: 1200,
      contrast: 160,
      brightness: 120,
      threshold: true,
      invert: true,
    }),
    preprocessOcrRegion(source, {
      label: "number-bottom-inverted",
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
    preprocessOcrRegion(source, {
      label: "full-card-rotated-180",
      yStart: 0,
      yEnd: 1,
      rotation: 180,
      maxDimension: 1000,
      contrast: 138,
      brightness: 108,
      threshold: false,
    }),
    preprocessOcrRegion(source, {
      label: "full-card-rotated-90",
      yStart: 0,
      yEnd: 1,
      rotation: 90,
      maxDimension: 1000,
      contrast: 138,
      brightness: 108,
      threshold: false,
    }),
    preprocessOcrRegion(source, {
      label: "full-card-rotated-270",
      yStart: 0,
      yEnd: 1,
      rotation: 270,
      maxDimension: 1000,
      contrast: 138,
      brightness: 108,
      threshold: false,
    }),
  ]);

  return [...psaSlices, ...cardSlices];
}

export type OcrProgress = {
  status: string;
  progress: number;
};

export type OcrRecognitionResult = {
  text: string;
  /** Tesseract's native aggregate confidence on its 0-100 scale. */
  confidence: number | null;
};

export type OcrRecognitionOptions = {
  pageSegmentationMode?: "3" | "6" | "7" | "11";
  characterWhitelist?: string;
};

type TesseractWorker = {
  recognize: (
    image: string,
  ) => Promise<{ data: { text?: string | null; confidence?: number | null } }>;
  setParameters: (parameters: Record<string, string>) => Promise<unknown>;
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

/** Recognize text while retaining Tesseract's native aggregate confidence. */
export function recognizeOcrResult(
  image: string,
  onProgress?: (message: OcrProgress) => void,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const run = async () => {
    const worker = await preloadOcrWorker();
    activeProgress = onProgress ?? null;
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: options.pageSegmentationMode ?? "3",
        tessedit_char_whitelist: options.characterWhitelist ?? "",
      });
      const { data } = await worker.recognize(image);
      return {
        text: data.text ?? "",
        confidence:
          typeof data.confidence === "number" && Number.isFinite(data.confidence)
            ? data.confidence
            : null,
      };
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

/**
 * Backward-compatible text-only OCR API. Recognition stays serialized through
 * the same persistent worker as the richer result API.
 */
export function recognizeOcrText(
  image: string,
  onProgress?: (message: OcrProgress) => void,
): Promise<string> {
  return recognizeOcrResult(image, onProgress).then((result) => result.text);
}

export async function terminateOcrWorker(): Promise<void> {
  const pendingWorker = workerPromise;
  workerPromise = null;
  activeProgress = null;
  // A timeout can happen while the language/model files are still loading.
  // Do not await that download here or keep the serialized queue blocked for
  // the next scan; terminate the stale worker as soon as it materializes.
  recognitionQueue = Promise.resolve();
  if (!pendingWorker) return;
  void pendingWorker
    .then((worker) => worker.terminate())
    .catch(() => undefined);
}
