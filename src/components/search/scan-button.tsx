"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ClientPrice } from "@/components/client-price";
import { formatCardDisplayName } from "@/lib/card-display-name";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { cosineSimilarity, embedImage, getEmbedder } from "@/lib/scan/embedding";
import { recallScans, rememberScan } from "@/lib/scan/embedding-store";
import {
  buildOcrImageSlices,
  buildScanQuery,
  fuzzyNameScore,
  parseOcrText,
  preloadOcrWorker,
  recognizeOcrText,
  type ParsedOcrText,
} from "@/lib/scan/ocr";
import { DHASH_WORK_HEIGHT, DHASH_WORK_WIDTH } from "@/lib/scan/dhash-core";
import { dHash, hashSimilarity, toWorkGrayscale } from "@/lib/scan/phash";
import {
  rankByVisualSimilarity,
  type PhotoSignature,
} from "@/lib/scan/scan-matcher";
import type {
  ScanCardGuess,
  ScanMatch,
  VisualIndexHit,
} from "@/lib/scan/types";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import { buildLiveSearchApiParams } from "@/lib/search-href";
import type {
  CardLanguageCode,
  LiveSearchResponse,
  SearchResult,
  TcgCard,
} from "@/types/pokemon";

type Stage = "capture" | "crop" | "processing" | "results";

/** Standard Pokemon card aspect ratio (width / height). */
const CARD_ASPECT = 0.716;

/** Use the on-device neural recognizer (falls back to perceptual hash). */
const NEURAL_ENABLED = true;
/** Name-DB fuzzy match above this is trusted despite OCR noise. */
const NAME_MATCH_THRESHOLD = 0.72;
/** A visual-index match at or above this is treated as a direct card identity. */
const DIRECT_VISUAL_MATCH_THRESHOLD = 0.8;
/**
 * Strong enough to skip the OCR + live-search loop. Clean digital uploads and
 * sharp photos routinely land here once the catalog visual index is available.
 */
const SKIP_OCR_VISUAL_THRESHOLD = 0.62;
/** Hash-only matches this high are good enough to finish before CLIP loads. */
const FAST_HASH_MATCH_THRESHOLD = 0.78;
/**
 * Only trust visual-index hits at/above this when OCR found nothing usable.
 * Lower scores are often letterbox/hash collisions (Umbreon → random toad).
 */
const WEAK_VISUAL_OVERRIDE_THRESHOLD = 0.7;
/** Index hits below this must not seed live-search name lookups. */
const INDEX_SEED_MIN_SCORE = 0.72;
/** Hide ranked candidates weaker than this — better empty than nonsense. */
const MIN_DISPLAY_VISUAL_SCORE = 0.58;
/** Don't block the scan on a slow first-time CLIP download/load. */
const EMBED_BUDGET_MS = 8_000;
/** Hard cap so OCR can never hang a scan for minutes. */
const OCR_BUDGET_MS = 12_000;
/** Bound live-search calls used as a last-resort scan fallback. */
const LIVE_SEARCH_BUDGET_MS = 8_000;
/** A remembered scan above this similarity is treated as the same card. */
const MEMORY_NEURAL_THRESHOLD = 0.9;
const MEMORY_HASH_THRESHOLD = 0.92;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/** Downscale an image data URL to bound OCR/encode cost. */
async function downscaleImage(
  source: string,
  maxDimension: number,
  quality: number,
): Promise<string> {
  const img = await loadImageElement(source);
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Lossless canvas export — used for crop/hash so JPEG artifacts can't spoil dHash. */
function canvasToLosslessDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

/**
 * Trim uniform black letterboxing/pillarboxing. Digital shares often put the
 * card on a black canvas; hashing that padding collapses Umbreon into random
 * collisions (~0.5 score) and produces garbage match lists.
 *
 * Only rows/cols that are almost entirely near-black count as padding — dark
 * full-art scenes must not be shaved.
 */
async function trimLetterboxBorders(source: string): Promise<string> {
  const img = await loadImageElement(source);
  const sampleW = 160;
  const sampleH = Math.max(32, Math.round((sampleW * img.height) / img.width));
  const sample = document.createElement("canvas");
  sample.width = sampleW;
  sample.height = sampleH;
  const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) return source;
  sampleCtx.drawImage(img, 0, 0, sampleW, sampleH);
  const { data } = sampleCtx.getImageData(0, 0, sampleW, sampleH);

  const rowIsPadding = (y: number) => {
    let dark = 0;
    for (let x = 0; x < sampleW; x += 1) {
      const i = (y * sampleW + x) * 4;
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luma < 14) dark += 1;
    }
    return dark / sampleW >= 0.97;
  };
  const colIsPadding = (x: number) => {
    let dark = 0;
    for (let y = 0; y < sampleH; y += 1) {
      const i = (y * sampleW + x) * 4;
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luma < 14) dark += 1;
    }
    return dark / sampleH >= 0.97;
  };

  let top = 0;
  while (top < sampleH && rowIsPadding(top)) top += 1;
  let bottom = sampleH - 1;
  while (bottom > top && rowIsPadding(bottom)) bottom -= 1;
  let left = 0;
  while (left < sampleW && colIsPadding(left)) left += 1;
  let right = sampleW - 1;
  while (right > left && colIsPadding(right)) right -= 1;

  const contentW = right - left + 1;
  const contentH = bottom - top + 1;
  const areaRatio = (contentW * contentH) / (sampleW * sampleH);
  // No meaningful padding, or detection failed — keep the original.
  if (top === 0 && left === 0 && right === sampleW - 1 && bottom === sampleH - 1) {
    return source;
  }
  if (areaRatio < 0.25 || areaRatio > 0.995 || contentW < 8 || contentH < 8) {
    return source;
  }

  const scaleX = img.width / sampleW;
  const scaleY = img.height / sampleH;
  const sx = Math.max(0, Math.floor(left * scaleX));
  const sy = Math.max(0, Math.floor(top * scaleY));
  const sw = Math.min(img.width - sx, Math.ceil(contentW * scaleX));
  const sh = Math.min(img.height - sy, Math.ceil(contentH * scaleY));
  if (sw < 32 || sh < 32) return source;

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const outCtx = out.getContext("2d");
  if (!outCtx) return source;
  outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToLosslessDataUrl(out);
}

function filterConfidentMatches(matches: ScanMatch[]): ScanMatch[] {
  const absolute = matches.filter(
    (match) => match.visualScore >= MIN_DISPLAY_VISUAL_SCORE,
  );
  if (!absolute.length) return [];
  const topScore = absolute[0].visualScore;

  // A clean digital match is decisive. Keep only near-ties; unrelated dHash
  // collisions can still score 0.65–0.80 and must not look like plausible
  // alternatives beneath a 0.9+ identity.
  if (topScore >= 0.82) {
    const relativeCutoff = Math.max(0.78, topScore - 0.055);
    return absolute
      .filter((match) => match.visualScore >= relativeCutoff)
      .slice(0, 4);
  }

  // If the leader is still weak, don't dump a page of near-random cards.
  if (topScore < SKIP_OCR_VISUAL_THRESHOLD) {
    return absolute.slice(0, 3);
  }
  return absolute.slice(0, 8);
}

/**
 * Build a few inset crops and hash each. Digital renders often include a thin
 * border/padding that the catalog art doesn't, which otherwise tanks hash recall.
 */
async function collectPhotoFingerprints(source: string): Promise<{
  hashes: bigint[];
  workGray: number[] | null;
}> {
  const img = await loadImageElement(source);
  const hashes: bigint[] = [];
  const seen = new Set<string>();

  const pushHash = (drawable: HTMLImageElement | HTMLCanvasElement) => {
    const hash = dHash(drawable);
    const key = hash.toString();
    if (hash !== 0n && !seen.has(key)) {
      seen.add(key);
      hashes.push(hash);
    }
  };

  pushHash(img);
  const workGrayRaw = toWorkGrayscale(img);
  const workGray =
    workGrayRaw.length === DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT
      ? workGrayRaw.map((value) => Math.round(value))
      : null;

  for (const inset of [0.02, 0.05, 0.08]) {
    const sx = Math.round(img.width * inset);
    const sy = Math.round(img.height * inset);
    const sw = Math.max(1, Math.round(img.width * (1 - inset * 2)));
    const sh = Math.max(1, Math.round(img.height * (1 - inset * 2)));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    pushHash(canvas);
  }

  return { hashes, workGray };
}

async function bestVisualSearchByHashes(
  hashes: bigint[],
  workGray: number[] | null,
): Promise<{
  hits: VisualIndexHit[];
  directMatches: SearchResult[];
  ready: boolean;
  size: number;
}> {
  const unique = hashes.filter((hash) => hash !== 0n).slice(0, 4);
  if (!unique.length && !workGray) {
    return { hits: [], directMatches: [], ready: false, size: 0 };
  }
  // One request with inset-crop hashes + luminance fingerprint.
  return visualSearch({
    hash: (unique[0] ?? 0n).toString(),
    hashes: unique.map((hash) => hash.toString()),
    workGray,
    embedding: null,
  });
}

/**
 * Grayscale + contrast-stretch a (optionally cropped) region of an image to
 * improve OCR legibility. `yStart`/`yEnd` are fractions of the height — used to
 * isolate the card's name band for a cleaner read.
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** Raw (non-Latin-aware) substring match — needed for Japanese names. */
function rawMatchScore(candidate: string, name: string): number {
  const c = candidate.trim().toLowerCase();
  const n = (name ?? "").trim().toLowerCase();
  if (c.length < 2 || !n) return 0;
  if (c === n) return 1;
  if (n.includes(c) || c.includes(n)) return 0.85;
  return 0;
}

/**
 * Resolve OCR name candidates to a canonical catalog name using the Pokemon
 * name database plus fuzzy scoring (tolerant of OCR character swaps).
 */
async function confirmName(
  candidates: string[],
): Promise<{ name: string; score: number } | null> {
  const shortlist = candidates.filter((candidate) => candidate.length >= 2).slice(0, 4);
  if (!shortlist.length) {
    return null;
  }

  const scored = await Promise.all(
    shortlist.map(async (candidate) => {
      try {
        const response = await fetch(
          `/api/pokemon-names?q=${encodeURIComponent(candidate)}&limit=6`,
        );
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as {
          results?: Array<{ name: string; englishName: string }>;
        };
        let best: { name: string; score: number } | null = null;
        for (const hit of payload.results ?? []) {
          const name = hit.englishName || hit.name;
          const score = Math.max(
            fuzzyNameScore(candidate, hit.name),
            fuzzyNameScore(candidate, hit.englishName),
            rawMatchScore(candidate, hit.name),
          );
          if (score > (best?.score ?? 0)) {
            best = { name, score };
          }
        }
        return best;
      } catch {
        return null;
      }
    }),
  );

  let best: { name: string; score: number } | null = null;
  for (const hit of scored) {
    if (hit && hit.score > (best?.score ?? 0)) {
      best = hit;
    }
  }
  return best && best.score >= NAME_MATCH_THRESHOLD ? best : null;
}

async function searchCandidates(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), LIVE_SEARCH_BUDGET_MS);
  try {
    const params = buildLiveSearchApiParams({ query, page: 1 });
    const response = await fetch(`/api/live-search?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = (await response.json()) as LiveSearchResponse;
    return data.results.slice(0, 18);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isCardLanguageCode(value: string): value is CardLanguageCode {
  return value in LANGUAGE_LABELS;
}

/** Convert visual-index hits into scan results without another catalog round-trip. */
function searchResultsFromVisualHits(
  hits: VisualIndexHit[],
  minScore = SKIP_OCR_VISUAL_THRESHOLD,
): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const hit of hits) {
    if (hit.score < minScore) {
      continue;
    }
    const language = isCardLanguageCode(hit.lang) ? hit.lang : "en";
    const slug = language === "en" ? hit.id : `${language}--${hit.id}`;
    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    const setCode = hit.id.includes("-") ? hit.id.split("-")[0]?.toUpperCase() ?? "" : "";
    const card: TcgCard = {
      id: hit.id,
      slug,
      language,
      languageLabel: LANGUAGE_LABELS[language] ?? language,
      name: hit.name,
      englishName: hit.name,
      collectorNumber: hit.localId || "?",
      rarity: "Unknown",
      supertype: "Pokemon",
      hp: "-",
      types: [],
      setId: setCode.toLowerCase(),
      setCode,
      setName: hit.setName || setCode || "Unknown set",
      image: hit.image,
      artist: "Unknown",
      marketPriceUsd: 0,
      psaPopulation: {
        status: "pending",
        totalCertified: null,
        grades: [],
        source: "Scan visual match",
        fetchedAt: null,
        note: "Identity matched visually. Open the card for live market and population data.",
      },
      portfolioDefaultQuantity: 1,
      priceHistory: [],
      gradedPrices: [],
      recentSales: [],
      sources: [
        {
          source: "Scan visual index",
          status: "estimated",
          fetchedAt: new Date().toISOString(),
          confidence: 0.7,
          note: "Identity resolved from the visual catalog match.",
        },
      ],
    };
    results.push({
      card,
      score: hit.score,
      matchReason: "Direct visual match",
    });
  }

  return results;
}

function rankedFromDirectOrHits(
  directMatches: SearchResult[],
  indexHits: VisualIndexHit[],
  method: "neural" | "phash",
  minScore = SKIP_OCR_VISUAL_THRESHOLD,
): ScanMatch[] {
  const filteredDirect = directMatches.filter((result) => result.score >= minScore);
  const source =
    filteredDirect.length > 0
      ? filteredDirect
      : searchResultsFromVisualHits(indexHits, minScore);
  return source.slice(0, 12).map((result) => ({
    result,
    visualScore: result.score,
    method,
  }));
}

async function embedImageWithBudget(
  image: string,
  onProgress?: (progress: { status: string; progress?: number }) => void,
): Promise<Float32Array | null> {
  if (!NEURAL_ENABLED) {
    return null;
  }

  return Promise.race([
    embedImage(image, onProgress),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), EMBED_BUDGET_MS);
    }),
  ]);
}

/**
 * Strict-to-loose candidate search. The full "Name suffix number" query goes
 * first; if it returns nothing the collector number, then the suffix, are
 * dropped — a misread number or a set-numbering mismatch in the catalog must
 * not zero out an otherwise solid name match. A bare collector number is never
 * searched on its own ("2" matches hundreds of unrelated cards).
 */
async function searchCandidatesWithFallback(
  parts: { name: string; suffix?: string; number?: string },
  maxAttempts = 3,
): Promise<SearchResult[]> {
  const attempts = [
    buildScanQuery(parts),
    buildScanQuery({ name: parts.name, suffix: parts.suffix }),
    buildScanQuery({ name: parts.name }),
  ];
  const seen = new Set<string>();
  let tried = 0;
  for (const attempt of attempts) {
    const key = attempt.trim().toLowerCase();
    if (!key || seen.has(key) || tried >= maxAttempts) continue;
    seen.add(key);
    tried += 1;
    const results = await searchCandidates(attempt);
    if (results.length) {
      if (attempt !== attempts[0]) {
        console.log(
          `Strict scan query "${attempts[0]}" returned 0 results; matched with looser query "${attempt}".`,
        );
      }
      return results;
    }
  }
  return [];
}

/**
 * Match the photo against the server catalog index — by CLIP embedding when
 * available (robust to foil/lighting), with the perceptual hash as fallback.
 */
async function visualSearch(params: {
  hash: string;
  hashes?: string[];
  workGray?: number[] | null;
  embedding: Float32Array | null;
}): Promise<{
  hits: VisualIndexHit[];
  directMatches: SearchResult[];
  ready: boolean;
  size: number;
}> {
  try {
    const body: {
      hash: string;
      hashes?: string[];
      workGray?: number[];
      limit: number;
      embedding?: number[];
    } = {
      hash: params.hash,
      limit: 24,
    };
    if (params.hashes?.length) {
      body.hashes = params.hashes;
    }
    if (params.workGray?.length === DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT) {
      body.workGray = params.workGray;
    }
    if (params.embedding) {
      // Round to keep the payload small; ranking is unaffected.
      body.embedding = Array.from(params.embedding, (v) => Math.round(v * 1e4) / 1e4);
    }
    const response = await fetch("/api/visual-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { hits: [], directMatches: [], ready: false, size: 0 };
    }
    const data = (await response.json()) as {
      hits?: VisualIndexHit[];
      directMatches?: SearchResult[];
      ready?: boolean;
      size?: number;
    };
    return {
      hits: data.hits ?? [],
      directMatches: data.directMatches ?? [],
      ready: Boolean(data.ready),
      size: Number(data.size) || 0,
    };
  } catch {
    return { hits: [], directMatches: [], ready: false, size: 0 };
  }
}

async function fetchCardResult(slug: string): Promise<SearchResult | null> {
  try {
    const response = await fetch(`/api/cards/${slug}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const { card } = (await response.json()) as { card?: SearchResult["card"] };
    return card ? { card, score: 1, matchReason: "Scan memory" } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve candidate app cards to display + rank. Artwork matches from the
 * visual index lead (they work even when OCR can't read the card); OCR name and
 * collector number provide fallbacks so a scan rarely dead-ends.
 */
async function gatherCandidates(
  confirmed: { name: string } | null,
  parsed: ParsedOcrText,
  indexHits: VisualIndexHit[],
  options: { preferVisualOnly?: boolean } = {},
): Promise<SearchResult[]> {
  const acc: SearchResult[] = [];
  const seen = new Set<string>();
  const add = (results: SearchResult[]) => {
    for (const result of results) {
      if (!seen.has(result.card.slug)) {
        seen.add(result.card.slug);
        acc.push(result);
      }
    }
  };

  // 1) Artwork-matched identities from the visual index (strongest signal).
  // Ignore weak collisions — they flood the list with unrelated cards.
  const distinctHits: VisualIndexHit[] = [];
  const distinctNames = new Set<string>();
  for (const hit of indexHits) {
    if (hit.score < INDEX_SEED_MIN_SCORE) continue;
    const key = hit.name.toLowerCase();
    if (!hit.name || distinctNames.has(key)) continue;
    distinctNames.add(key);
    distinctHits.push(hit);
    if (distinctHits.length >= (options.preferVisualOnly ? 3 : 2)) break;
  }

  const visualLookups = await Promise.all(
    distinctHits.map((hit) =>
      searchCandidatesWithFallback(
        { name: hit.name, number: hit.localId },
        options.preferVisualOnly ? 1 : 2,
      ),
    ),
  );
  for (const results of visualLookups) {
    add(results);
  }

  if (options.preferVisualOnly && acc.length) {
    return acc.slice(0, 12);
  }

  // 2) OCR-confirmed name, strict first then progressively loosened.
  if (confirmed && acc.length < 12) {
    add(
      await searchCandidatesWithFallback({
        name: confirmed.name,
        suffix: parsed.suffix,
        number: parsed.number,
      }),
    );
  }

  // 3) Digital/full-art path: search raw OCR compounds even when the Pokemon
  // name DB didn't confirm (e.g. "Umbreon VMAX" / "215").
  if (acc.length < 8) {
    const rawQueries = Array.from(
      new Set(
        [
          ...parsed.nameCandidates.slice(0, 4),
          parsed.suffix && parsed.nameCandidates[0]
            ? `${parsed.nameCandidates[0]} ${parsed.suffix}`
            : null,
          parsed.number && parsed.nameCandidates[0]
            ? `${parsed.nameCandidates[0]} ${parsed.number.split("/")[0]}`
            : null,
          parsed.number && confirmed
            ? `${confirmed.name} ${parsed.number.split("/")[0]}`
            : null,
        ].filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, 4);

    const rawResults = await Promise.all(
      rawQueries.map((query) => {
        const parts = query.trim().split(/\s+/);
        const maybeSuffix = parts[parts.length - 1]?.toLowerCase();
        const suffix =
          maybeSuffix === "vmax" ||
          maybeSuffix === "vstar" ||
          maybeSuffix === "ex" ||
          maybeSuffix === "gx" ||
          maybeSuffix === "v"
            ? maybeSuffix
            : parsed.suffix;
        const name =
          suffix && parts.length > 1
            ? parts.slice(0, -1).join(" ")
            : query;
        return searchCandidatesWithFallback(
          {
            name,
            suffix: suffix && name !== query ? suffix : parsed.suffix,
            number: parsed.number,
          },
          3,
        );
      }),
    );
    for (const results of rawResults) {
      add(results);
    }
  }

  if (acc.length) {
    return acc.slice(0, 12);
  }

  // 4) Last resort: one raw OCR token, bounded attempts.
  const token = parsed.nameCandidates[0];
  if (token) {
    add(
      await searchCandidatesWithFallback(
        { name: token, suffix: parsed.suffix, number: parsed.number },
        2,
      ),
    );
  }
  return acc.slice(0, 12);
}

function fileFromEvent(event: React.ChangeEvent<HTMLInputElement>): File | null {
  const file = event.target.files?.[0] ?? null;
  event.target.value = "";
  return file;
}

export function ScanButton({ startOpen = false }: { startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [stage, setStage] = useState<Stage>("capture");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [guess, setGuess] = useState<ScanCardGuess | null>(null);
  const [confident, setConfident] = useState(false);
  const [matches, setMatches] = useState<ScanMatch[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // Crop/align step state.
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [imgAspect, setImgAspect] = useState(CARD_ASPECT);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(0.9);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const photoSignatureRef = useRef<PhotoSignature | null>(null);
  const cropContainerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
  /** True once the user drags or resizes the crop frame. */
  const cropTouchedRef = useRef(false);
  /** True when the upload is already an edge-to-edge card render. */
  const cropFullBleedRef = useRef(false);

  // Box height as a fraction of image height, derived to keep card aspect.
  const cropH = Math.min(1, (cropW * imgAspect) / CARD_ASPECT);

  const resetState = useCallback(() => {
    setStage("capture");
    setProgress(0);
    setStatusText("");
    setPreview(null);
    setGuess(null);
    setConfident(false);
    setMatches([]);
    setNotice(null);
    setRawImage(null);
    photoSignatureRef.current = null;
    cropTouchedRef.current = false;
    cropFullBleedRef.current = false;
  }, []);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    resetState();
  }, [resetState]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Hide the mobile nav dock (portaled to <body>) and lock page scroll so the
    // full-screen scanner can't be scrolled behind or overlaid.
    document.body.classList.add("scanner-modal-open");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Warm CLIP + OCR while the user is still framing the card.
    if (NEURAL_ENABLED) {
      void getEmbedder().catch(() => undefined);
    }
    void preloadOcrWorker().catch(() => undefined);
    // Fail fast with a clear message when this host has no visual catalog.
    void fetch("/api/visual-search", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { ready?: boolean; size?: number };
        if (!data.ready && !(Number(data.size) > 0)) {
          setNotice(
            "This server doesn't have the card-matching catalog loaded. Open traepokedexpmax.vercel.app to scan, or search by name.",
          );
        }
      })
      .catch(() => undefined);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("scanner-modal-open");
      document.body.style.overflow = previousOverflow;
    };
  }, [open, closeOverlay]);

  const runOcr = useCallback(async (image: string): Promise<string> => {
    return recognizeOcrText(
      image,
      (message: { status: string; progress: number }) => {
        if (message.status === "recognizing text") {
          // Keep OCR progress in the 50-70 band so it never rewinds the bar
          // after embedding / visual search already advanced past 40%.
          setProgress(50 + Math.round(message.progress * 20));
        }
      },
    );
  }, []);

  /** Compare a photo signature against remembered (confirmed) scans. */
  const recallBestMemory = useCallback(async (signature: PhotoSignature) => {
    const memories = await recallScans();
    let best: { slug: string; score: number } | null = null;
    for (const memory of memories) {
      let score = 0;
      if (signature.vector && memory.vector) {
        score = cosineSimilarity(signature.vector, memory.vector);
      } else if (memory.hash) {
        score = hashSimilarity(signature.hash, BigInt(memory.hash));
      }
      if (score > (best?.score ?? 0)) {
        best = { slug: memory.slug, score };
      }
    }
    if (!best) return null;
    const strong =
      best.score >= (signature.vector ? MEMORY_NEURAL_THRESHOLD : MEMORY_HASH_THRESHOLD);
    return strong ? best : null;
  }, []);

  const finishVisualMatches = useCallback(
    (
      ranked: ScanMatch[],
      topScore: number,
      noticeText?: string | null,
    ) => {
      const top = ranked[0];
      if (top) {
        setGuess({
          name: top.result.card.englishName ?? top.result.card.name,
          number: top.result.card.collectorNumber,
          confidence: top.visualScore,
          source: "ocr",
        });
        setConfident(topScore >= DIRECT_VISUAL_MATCH_THRESHOLD);
      }
      setProgress(100);
      setMatches(ranked);
      if (!ranked.length && noticeText) {
        setNotice(noticeText);
      }
      setStage("results");
    },
    [],
  );

  const processImage = useCallback(
    async (sourceDataUrl: string) => {
      setStage("processing");
      setProgress(5);
      setNotice(null);
      setMatches([]);
      setGuess(null);
      setConfident(false);
      photoSignatureRef.current = null;

      try {
        // Strip black letterbox/pillarbox before hashing — padding alone can
        // drop a clean Umbreon digital from ~0.89 → ~0.50 and surface random
        // cards (Palpitoad, etc.) as "matches".
        const trimmedSource = await trimLetterboxBorders(sourceDataUrl);
        const sourceForMatch = trimmedSource || sourceDataUrl;

        // Hash lossless source + inset crops + luminance fingerprint.
        // Never hash a JPEG recompress — that alone can drop an exact Umbreon
        // VMAX match from ~0.98 → ~0.87.
        const { hashes: photoHashes, workGray } =
          await collectPhotoFingerprints(sourceForMatch);
        const photoHash = photoHashes[0] ?? 0n;
        const hashKey = photoHash.toString();

        const encodeImage = await downscaleImage(sourceForMatch, 640, 0.92);
        setPreview(encodeImage);

        // 1) Hash match first — no model download. Digital catalog renders and
        // near-duplicate photos finish here in well under a second.
        setStatusText("Matching artwork to the catalog…");
        setProgress(18);
        const hashSearchPromise = bestVisualSearchByHashes(photoHashes, workGray);
        // Start OCR in parallel for digital/full-art cards so we don't wait on
        // CLIP when artwork matching is weak or the host catalog is empty.
        const ocrParallelPromise = buildOcrImageSlices(sourceForMatch);
        const embedPromise = embedImageWithBudget(encodeImage, (modelProgress) => {
          if (modelProgress.status === "progress" && modelProgress.progress) {
            setProgress((current) =>
              Math.max(current, 18 + Math.round((modelProgress.progress! / 100) * 20)),
            );
          }
        });

        const hashResult = await hashSearchPromise;
        setProgress(40);
        const indexReady = hashResult.ready || hashResult.size > 0;
        const hashTopScore = hashResult.hits[0]?.score ?? 0;
        if (hashTopScore >= FAST_HASH_MATCH_THRESHOLD) {
          const ranked = filterConfidentMatches(
            rankedFromDirectOrHits(
              hashResult.directMatches,
              hashResult.hits,
              "phash",
            ),
          );
          if (ranked.length) {
            photoSignatureRef.current = { hash: photoHash, vector: null };
            // Keep CLIP warming in the background for later scans; don't wait.
            void embedPromise;
            void ocrParallelPromise;
            finishVisualMatches(ranked, hashTopScore);
            return;
          }
        }

        // 2) Optional CLIP pass — skip waiting when the catalog isn't loaded.
        let photoVector: Float32Array | null = null;
        let indexHits = hashResult.hits;
        let directMatches = hashResult.directMatches;
        let method: "neural" | "phash" = "phash";

        if (indexReady) {
          setStatusText("Recognizing artwork…");
          photoVector = await embedPromise;
          setProgress(55);
          if (photoVector) {
            setStatusText("Matching artwork to the catalog…");
            const neuralResult = await visualSearch({
              hash: hashKey,
              hashes: photoHashes.filter((hash) => hash !== 0n).slice(0, 4).map(String),
              workGray,
              embedding: photoVector,
            });
            if (
              neuralResult.hits.length &&
              (neuralResult.hits[0]?.score ?? 0) >= (indexHits[0]?.score ?? 0)
            ) {
              indexHits = neuralResult.hits;
              directMatches = neuralResult.directMatches;
              method = "neural";
            }
          }
        } else {
          void embedPromise;
        }

        const signature: PhotoSignature = { hash: photoHash, vector: photoVector };
        photoSignatureRef.current = signature;
        setProgress(70);

        const topVisualScore = indexHits[0]?.score ?? 0;
        if (topVisualScore >= SKIP_OCR_VISUAL_THRESHOLD) {
          const ranked = filterConfidentMatches(
            rankedFromDirectOrHits(directMatches, indexHits, method),
          );
          if (ranked.length) {
            void ocrParallelPromise;
            finishVisualMatches(ranked, topVisualScore);
            return;
          }
        }

        // 3) OCR when visual matching is weak/missing (often already warm).
        setStatusText("Reading the card…");
        const ocrSlices = await ocrParallelPromise;
        const topSliceParses: ParsedOcrText[] = [];
        let parsedFull: ParsedOcrText | null = null;
        const ocrDeadline = Date.now() + OCR_BUDGET_MS;
        for (const slice of ocrSlices) {
          if (Date.now() > ocrDeadline) {
            break;
          }
          const text = await Promise.race([
            runOcr(slice.image),
            new Promise<string>((resolve) => {
              window.setTimeout(() => resolve(""), Math.max(500, ocrDeadline - Date.now()));
            }),
          ]);
          if (!text) {
            continue;
          }
          const parsedSlice = parseOcrText(text);
          if (slice.label.startsWith("name-")) {
            topSliceParses.push(parsedSlice);
          } else {
            parsedFull = parsedSlice;
          }
          if (
            topSliceParses.some((sliceParse) => sliceParse.nameCandidates.length) &&
            (topSliceParses.some((sliceParse) => sliceParse.number) || parsedFull)
          ) {
            break;
          }
        }
        const parsedName = {
          nameCandidates: Array.from(
            new Set(topSliceParses.flatMap((slice) => slice.nameCandidates)),
          ),
          number: topSliceParses.find((slice) => slice.number)?.number,
          suffix: topSliceParses.find((slice) => slice.suffix)?.suffix,
          lines: topSliceParses.flatMap((slice) => slice.lines),
        } satisfies ParsedOcrText;
        const parsed: ParsedOcrText = {
          nameCandidates: Array.from(
            new Set([...parsedName.nameCandidates, ...(parsedFull?.nameCandidates ?? [])]),
          ),
          number: parsedName.number ?? parsedFull?.number,
          suffix: parsedName.suffix ?? parsedFull?.suffix,
          lines: [...parsedName.lines, ...(parsedFull?.lines ?? [])],
        };

        setStatusText("Matching to the catalog…");
        setProgress(78);

        const ocrNameCandidates = Array.from(
          new Set(
            [
              ...parsed.nameCandidates,
              // Keep "Name VMAX" style phrases for the name DB / live search.
              parsed.suffix && parsed.nameCandidates[0]
                ? `${parsed.nameCandidates[0]} ${parsed.suffix}`
                : null,
            ].filter((value): value is string => Boolean(value)),
          ),
        );
        const confirmed = await confirmName(ocrNameCandidates);

        // Prefer a strong visual hit over OCR junk — but never let a weak
        // letterbox collision (score ~0.5) beat a real OCR name like Umbreon.
        if (
          topVisualScore >= WEAK_VISUAL_OVERRIDE_THRESHOLD &&
          !confirmed &&
          ocrNameCandidates.length === 0
        ) {
          const ranked = filterConfidentMatches(
            rankedFromDirectOrHits(
              directMatches,
              indexHits,
              method,
              WEAK_VISUAL_OVERRIDE_THRESHOLD,
            ),
          );
          if (ranked.length) {
            finishVisualMatches(ranked, topVisualScore);
            return;
          }
        }

        const strongHit =
          indexHits.find((hit) => hit.score >= DIRECT_VISUAL_MATCH_THRESHOLD) ?? null;
        const visualHit = indexHits[0] ?? null;
        // Never promote an unconfirmed OCR token when artwork already suggested a card.
        const detectedGuess: ScanCardGuess | null = strongHit
          ? {
              name: strongHit.name,
              number: strongHit.localId || parsed.number,
              confidence: strongHit.score,
              source: "ocr",
            }
          : confirmed
            ? {
                name: confirmed.name,
                number: parsed.number,
                suffix: parsed.suffix,
                confidence: parsed.number ? 0.85 : 0.6,
                source: "ocr",
              }
            : visualHit
              ? {
                  name: visualHit.name,
                  number: visualHit.localId || parsed.number,
                  confidence: visualHit.score,
                  source: "ocr",
                }
              : null;
        setGuess(detectedGuess);
        setConfident(Boolean(strongHit || confirmed));

        const candidates = await gatherCandidates(confirmed, parsed, indexHits);

        let ranked: ScanMatch[] = [];
        if (candidates.length) {
          setStatusText("Comparing artwork…");
          ranked = await rankByVisualSimilarity(signature, candidates, {
            neural: Boolean(signature.vector),
            onProgress: (done, total) => {
              setProgress(82 + Math.round((done / Math.max(1, total)) * 16));
            },
          });
        }

        // If OCR/live-search produced nothing, still surface strong visual hits.
        if (!ranked.length && indexHits.length) {
          ranked = rankedFromDirectOrHits(
            directMatches,
            indexHits,
            method,
            INDEX_SEED_MIN_SCORE,
          );
        }

        const memory = await recallBestMemory(signature);
        if (memory && memory.score >= MIN_DISPLAY_VISUAL_SCORE) {
          const inRanked = ranked.some((m) => m.result.card.slug === memory.slug);
          if (inRanked) {
            ranked = [...ranked].sort((a, b) => {
              if (a.result.card.slug === memory.slug) return -1;
              if (b.result.card.slug === memory.slug) return 1;
              return 0;
            });
          } else {
            const remembered = await fetchCardResult(memory.slug);
            if (remembered) {
              ranked = [
                { result: remembered, visualScore: memory.score, method: "neural" },
                ...ranked,
              ];
            }
          }
        }

        ranked = filterConfidentMatches(ranked);
        setProgress(100);
        setMatches(ranked);
        if (!ranked.length) {
          setNotice(
            !indexReady
              ? "Card matching catalog isn't loaded on this server yet. Search by name below, or try again after the next deploy."
              : "Couldn't find a confident match. Crop tightly to the card edges (no black borders), or search by name below.",
          );
          setGuess(null);
        }
        setStage("results");
      } catch {
        setNotice("Something went wrong while scanning. Please try again.");
        setStage("results");
      }
    },
    [finishVisualMatches, recallBestMemory, runOcr],
  );

  const onCapture = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = fileFromEvent(event);
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      // Auto-trim black canvas padding common on digital card shares.
      const trimmed = await trimLetterboxBorders(dataUrl).catch(() => dataUrl);
      const img = await loadImageElement(trimmed).catch(() => null);
      const aspect = img && img.height ? img.width / img.height : CARD_ASPECT;
      // An upload that is already card-shaped (official catalog renders — no
      // background, no perspective) is edge-to-edge: default the frame to the
      // full image so the name bar and collector number aren't sliced off.
      const isFullBleedCard = Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT <= 0.08;
      // Otherwise default the crop box to a centered card-shaped region.
      const defaultW = isFullBleedCard ? 1 : Math.min(0.98, (0.92 * CARD_ASPECT) / aspect);
      const defaultH = Math.min(1, (defaultW * aspect) / CARD_ASPECT);
      setRawImage(trimmed);
      setImgAspect(aspect);
      setCropW(defaultW);
      setCropX((1 - defaultW) / 2);
      setCropY((1 - defaultH) / 2);
      cropTouchedRef.current = false;
      cropFullBleedRef.current = isFullBleedCard;
      setStage("crop");
    },
    [],
  );

  const onCropPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { px: event.clientX, py: event.clientY, x: cropX, y: cropY };
    },
    [cropX, cropY],
  );

  const onCropPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const container = cropContainerRef.current;
      if (!drag || !container) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dx = (event.clientX - drag.px) / rect.width;
      const dy = (event.clientY - drag.py) / rect.height;
      cropTouchedRef.current = true;
      dragPositionRef.current = {
        x: Math.max(0, Math.min(1 - cropW, drag.x + dx)),
        y: Math.max(0, Math.min(1 - cropH, drag.y + dy)),
      };
      if (dragFrameRef.current === null) {
        dragFrameRef.current = requestAnimationFrame(() => {
          dragFrameRef.current = null;
          const next = dragPositionRef.current;
          if (!next) return;
          setCropX(next.x);
          setCropY(next.y);
        });
      }
    },
    [cropW, cropH],
  );

  const onCropPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragFrameRef.current !== null) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    if (dragPositionRef.current) {
      setCropX(dragPositionRef.current.x);
      setCropY(dragPositionRef.current.y);
      dragPositionRef.current = null;
    }
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const onCropSize = useCallback(
    (nextW: number) => {
      // Resize about the box center so it doesn't drift to a corner.
      cropTouchedRef.current = true;
      const prevH = Math.min(1, (cropW * imgAspect) / CARD_ASPECT);
      const centerX = cropX + cropW / 2;
      const centerY = cropY + prevH / 2;
      const nextH = Math.min(1, (nextW * imgAspect) / CARD_ASPECT);
      setCropW(nextW);
      setCropX(Math.max(0, Math.min(1 - nextW, centerX - nextW / 2)));
      setCropY(Math.max(0, Math.min(1 - nextH, centerY - nextH / 2)));
    },
    [cropW, cropX, cropY, imgAspect],
  );

  const confirmCrop = useCallback(async () => {
    if (!rawImage) return;
    // An untouched frame on a full-bleed upload means "use the whole image":
    // skip the canvas crop entirely so the aspect-locked frame can't shave
    // the name bar or collector number off the edges.
    if (cropFullBleedRef.current && !cropTouchedRef.current) {
      void processImage(rawImage);
      return;
    }
    const img = await loadImageElement(rawImage).catch(() => null);
    if (!img) {
      void processImage(rawImage);
      return;
    }
    const sx = Math.round(cropX * img.width);
    const sy = Math.round(cropY * img.height);
    const sw = Math.round(cropW * img.width);
    const sh = Math.round(cropH * img.height);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx || sw <= 0 || sh <= 0) {
      void processImage(rawImage);
      return;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    void processImage(canvasToLosslessDataUrl(canvas));
  }, [cropX, cropY, cropW, cropH, processImage, rawImage]);

  /** Persist a confirmed photo → card mapping so future scans improve. */
  const confirmMatch = useCallback((match: ScanMatch) => {
    const signature = photoSignatureRef.current;
    if (signature) {
      void rememberScan({
        cardId: match.result.card.id,
        slug: match.result.card.slug,
        name: match.result.card.name,
        vector: signature.vector ?? undefined,
        hash: signature.hash.toString(),
        addedAt: Date.now(),
      });
    }
    stashCardForNavigation(match.result.card);
  }, []);

  const detectedLabel = guess ? buildScanQuery(guess) || guess.name : null;
  const refineQuery = confident && guess ? guess.name : detectedLabel;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          resetState();
        }}
        className="scan-trigger"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
          />
          <circle cx="12" cy="12" r="3.25" />
        </svg>
        Scan a card
      </button>

      {/* Native rear-camera capture (full-screen OS camera on phones). */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onCapture}
      />
      {/* Photo library / file picker. */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onCapture}
      />

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scan a Pokemon card"
          className="fixed inset-0 z-[100] flex justify-center bg-black/85 sm:items-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeOverlay();
          }}
        >
          <div className="scan-modal-panel flex h-full w-full flex-col overflow-hidden shadow-2xl sm:h-auto sm:max-h-[88vh] sm:max-w-xl sm:rounded-3xl sm:border">
            {/* Header */}
            <div className="scan-modal-header flex shrink-0 items-center justify-between px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  Card Dex scanner
                </p>
                <h2 className="text-xl font-black text-white">Scan a card</h2>
              </div>
              <button
                type="button"
                onClick={closeOverlay}
                aria-label="Close scanner"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-slate-200 transition hover:bg-white/20"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5">
                  <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            {/* Scrollable content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {stage === "capture" ? (
                <div className="space-y-5">
                  {notice ? (
                    <div className="scan-notice-box" role="status">
                      <p className="text-sm leading-6">{notice}</p>
                    </div>
                  ) : null}
                  <div className="scan-info-box">
                    <p className="text-sm leading-6 text-slate-200">
                      Point your camera at a Pokémon card or upload a photo. We
                      recognize the artwork on-device and show matching cards
                      with live pricing.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="btn btn-primary w-full"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.8l1-1.6A1 1 0 0 1 9.1 5h5.8a1 1 0 0 1 .85.4l1 1.6h1.8A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
                      <circle cx="12" cy="12.5" r="3" />
                    </svg>
                    Take a photo
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="btn btn-ghost w-full"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V5m0 0L8 9m4-4 4 4M5 19h14" />
                    </svg>
                    Upload a photo
                  </button>
                  <p className="text-xs leading-5 text-slate-400">
                    Fill the frame with the card, shoot straight-on, and avoid
                    glare. Matching runs on-device; only a tiny artwork
                    fingerprint is sent to find the card. The recognizer
                    downloads once on the first scan.
                  </p>
                </div>
              ) : null}

              {stage === "crop" && rawImage ? (
                <div className="space-y-4">
                  <div className="scan-info-box p-4">
                    <p className="text-sm leading-6 text-slate-200">
                      Drag the frame over the card and size it to hug the edges.
                      A tight crop makes recognition far more accurate.
                    </p>
                  </div>
                  <div
                    ref={cropContainerRef}
                    className="relative w-full touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-black"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={rawImage}
                      alt="Captured card"
                      draggable={false}
                      decoding="async"
                      className="block w-full select-none"
                    />
                    <div className="pointer-events-none absolute inset-0">
                      <span
                        className="absolute inset-x-0 top-0 bg-black/42"
                        style={{ height: `${cropY * 100}%` }}
                      />
                      <span
                        className="absolute inset-x-0 bottom-0 bg-black/42"
                        style={{ height: `${Math.max(0, 1 - (cropY + cropH)) * 100}%` }}
                      />
                      <span
                        className="absolute left-0 bg-black/42"
                        style={{
                          top: `${cropY * 100}%`,
                          width: `${cropX * 100}%`,
                          height: `${cropH * 100}%`,
                        }}
                      />
                      <span
                        className="absolute right-0 bg-black/42"
                        style={{
                          top: `${cropY * 100}%`,
                          width: `${Math.max(0, 1 - (cropX + cropW)) * 100}%`,
                          height: `${cropH * 100}%`,
                        }}
                      />
                    </div>
                    <div
                      onPointerDown={onCropPointerDown}
                      onPointerMove={onCropPointerMove}
                      onPointerUp={onCropPointerUp}
                      onPointerCancel={onCropPointerUp}
                      className="scan-crop-frame absolute touch-none cursor-move rounded-lg bg-transparent"
                      style={{
                        left: `${cropX * 100}%`,
                        top: `${cropY * 100}%`,
                        width: `${cropW * 100}%`,
                        height: `${cropH * 100}%`,
                      }}
                    >
                      <span className="scan-crop-handle absolute -left-px -top-px h-6 w-6 rounded-tl-lg border-l-[3px] border-t-[3px]" />
                      <span className="scan-crop-handle absolute -right-px -top-px h-6 w-6 rounded-tr-lg border-r-[3px] border-t-[3px]" />
                      <span className="scan-crop-handle absolute -bottom-px -left-px h-6 w-6 rounded-bl-lg border-b-[3px] border-l-[3px]" />
                      <span className="scan-crop-handle absolute -bottom-px -right-px h-6 w-6 rounded-br-lg border-b-[3px] border-r-[3px]" />
                    </div>
                  </div>
                  <div className="scan-info-box p-4">
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-300">
                      Frame size
                    </label>
                    <input
                      type="range"
                      min={30}
                      max={100}
                      value={Math.round(cropW * 100)}
                      onChange={(event) => onCropSize(Number(event.target.value) / 100)}
                      className="w-full accent-yellow-300"
                    />
                  </div>
                </div>
              ) : null}

              {stage === "processing" ? (
                <div className="flex flex-col items-center gap-5 py-10 text-center">
                  {preview ? (
                    <div className="relative aspect-[0.716/1] w-44 overflow-hidden rounded-2xl border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview}
                        alt="Scanned card"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                      <span className="scan-laser" aria-hidden="true" />
                    </div>
                  ) : null}
                  <p className="text-base font-bold text-white">{statusText}</p>
                  <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-all"
                      style={{ width: `${Math.max(8, progress)}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {stage === "results" ? (
                <div className="space-y-4">
                  {detectedLabel ? (
                    <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-dim)]">
                        {confident ? "Detected" : "Best guess from photo"}
                      </p>
                      <p className="mt-1 text-xl font-black text-white">
                        {detectedLabel}
                      </p>
                    </div>
                  ) : null}

                  {notice ? (
                    <p className="rounded-2xl border border-amber-400/30 bg-[#2a2410] p-4 text-sm font-semibold leading-6 text-amber-100">
                      {notice}
                    </p>
                  ) : null}

                  {matches.length ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-300">
                        {matches.length} potential match
                        {matches.length === 1 ? "" : "es"} · tap the right card
                      </p>
                      <div className="space-y-2.5">
                        {matches.map((match, index) => {
                          const card = match.result.card;
                          const title = formatCardDisplayName(card);
                          const price = getHeadlineMarketPriceUsd(card);
                          const percent = Math.round(match.visualScore * 100);
                          return (
                            <Link
                              key={`${card.slug}__${index}`}
                              href={`/cards/${card.slug}`}
                              prefetch
                              onClick={() => {
                                confirmMatch(match);
                                closeOverlay();
                              }}
                              className={`scan-match-card grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-3 p-3 ${
                                index === 0 ? "scan-match-card--selected" : ""
                              }`}
                            >
                              <div className="relative aspect-[0.716/1] w-[3.75rem] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40">
                                <Image
                                  src={card.image}
                                  alt={title}
                                  fill
                                  sizes="60px"
                                  className="object-contain"
                                />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-bold text-white">
                                    {title}
                                  </p>
                                  {match.method === "neural" && percent > 0 ? (
                                    <span
                                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                        index === 0
                                          ? "bg-[var(--accent)] text-[#0a0b0f]"
                                          : "bg-white/10 text-slate-300"
                                      }`}
                                    >
                                      {percent}%
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 truncate text-xs text-slate-400">
                                  {card.setName} · #{card.collectorNumber}
                                </p>
                                {price > 0 ? (
                                  <ClientPrice
                                    amountUsd={price}
                                    className="text-sm font-semibold text-[var(--text-dim)]"
                                  />
                                ) : null}
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Sticky footer actions */}
            {stage === "crop" ? (
              <div className="scan-modal-footer shrink-0 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRawImage(null);
                      setStage("capture");
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    onClick={confirmCrop}
                    className="btn btn-primary btn-sm"
                  >
                    Scan this card
                  </button>
                </div>
              </div>
            ) : null}

            {stage === "results" ? (
              <div className="scan-modal-footer shrink-0 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={resetState}
                    className="btn btn-ghost btn-sm"
                  >
                    Scan another
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const params = refineQuery
                        ? buildLiveSearchApiParams({ query: refineQuery, page: 1 })
                        : null;
                      closeOverlay();
                      router.push(params ? `/search?${params.toString()}` : "/search");
                    }}
                    className="btn btn-primary btn-sm"
                  >
                    {matches.length ? "Refine search" : "Search by name"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
