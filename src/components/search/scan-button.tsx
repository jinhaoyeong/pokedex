"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ClientPrice } from "@/components/client-price";
import { ScanDebugPanel } from "@/components/search/scan-debug-panel";
import { formatCardDisplayName } from "@/lib/card-display-name";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { cosineSimilarity, embedImage, getEmbedder } from "@/lib/scan/embedding";
import { recallScans, rememberScan } from "@/lib/scan/embedding-store";
import {
  buildAuxiliaryIdentityOcrSlices,
  buildOcrImageSlices,
  buildPsaLabelOcrSlices,
  buildScanQuery,
  fuzzyNameScore,
  mergeOcrNameCandidates,
  mergeParsedOcrText,
  parseOcrText,
  parsePsaLabelText,
  preloadOcrWorker,
  recognizeOcrResult,
  regionConfidence,
  terminateOcrWorker,
  type OcrRecognitionResult,
  type OcrTextEvidence,
  type ParsedOcrText,
} from "@/lib/scan/ocr";
import { DHASH_WORK_HEIGHT, DHASH_WORK_WIDTH } from "@/lib/scan/dhash-core";
import {
  dHash,
  dHash9x8,
  dHashEqualized,
  dHashHighlightCompressed,
  hashSimilarity,
  toWorkGrayscale,
} from "@/lib/scan/phash";
import {
  rankByVisualSimilarity,
  type PhotoSignature,
} from "@/lib/scan/scan-matcher";
import { normalizeScanCardImageUrl } from "@/lib/scan/image-url";
import {
  isValidPerspectiveQuad,
  projectPoint,
  projectiveTransformForQuad,
  type PerspectiveQuad,
} from "@/lib/scan/perspective";
import type {
  ScanCardGuess,
  ScanMatch,
  VisualIndexHit,
} from "@/lib/scan/types";
import {
  compareVisualSourceVariants,
  fuseHashAndNeuralHits,
  isDecisiveVisualResult,
  mergeSearchResults,
  tallyVisualSourceVotes,
} from "@/lib/scan/visual-hits";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import {
  adjustQuadTopEdge,
  boundingRectFromQuad,
  classifyDecodedScanImage,
  classifyScanScene,
  estimateCardFrame,
  insetNestedAppCardQuad,
  isNestedAppCard,
  isSocialCaptionBand,
  normalizeCardCorners,
  scaleCardQuad,
  scoreCropQuality,
  screenshotCaptionBox,
  slabLabelBoxFromQuad,
  type CropQuality,
  type NormalizedRect,
  type ScanImageDiagnostics,
  type ScanSourceHint,
} from "@/lib/scan/card-geometry";
import {
  agreementConfidence,
  compareCollectorNumbers,
  fuseScanCandidateEvidence,
  inferLanguageHints,
  inferScriptHint,
  parseCollectorNumber,
} from "@/lib/scan/identity-evidence";
import {
  buildScanTextIdentity,
  isActionableTextIdentity,
  isResolvedTextIdentity,
  scoreCatalogAgainstTextIdentity,
  textIdentitySearchLanguages,
  type ScanTextIdentity,
} from "@/lib/scan/text-identity";
import {
  correctOcrSpeciesName,
  extractNestedOcrNameTokens,
} from "@/lib/scan/ocr-species";
import {
  createScanDebugReport,
  isScanDebugEnabled,
  publishScanDebugReport,
  type ScanDebugCandidate,
  type ScanDebugRankingEntry,
  type ScanDebugReport,
} from "@/lib/scan/scan-debug";
import { buildLiveSearchApiParams } from "@/lib/search-href";
import type {
  CardLanguageCode,
  CardLanguageFilter,
  LiveSearchResponse,
  SearchResult,
  TcgCard,
} from "@/types/pokemon";

type Stage = "capture" | "crop" | "processing" | "results";

type ScanSourceVariant = {
  label: string;
  source: string;
  role: "rectified" | "expanded" | "contracted" | "legacy" | "aligned";
};

type ProcessImageOptions = {
  verifyText?: boolean;
  alternateSources?: ScanSourceVariant[];
  sourceHint?: ScanSourceHint;
  /** True only when the primary source was successfully projectively rectified. */
  alreadyRectified?: boolean;
  /** User dragged/resized the crop handles — trust the cutout, skip full-frame fallbacks. */
  manualCrop?: boolean;
  /** Prefer PSA label OCR bands (slab crops / graded photos). */
  includePsaLabel?: boolean;
  /** Extra OCR-only crops (slab label, screenshot caption). Never hashed. */
  ocrAuxiliarySources?: Array<{ label: string; source: string }>;
  /**
   * Nested in-banner card inside an app screenshot. Artwork is too small to
   * hash/CLIP; chrome OCR (clock, logo grid) invents identities like Gyarados 7.
   */
  nestedScreenshot?: boolean;
};

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
 * Rectified camera / slab photos land a bit lower after glare and plastic.
 * Still requires isDecisiveVisualResult's name-margin rules.
 */
const FAST_HASH_CAMERA_THRESHOLD = 0.74;
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
const EMBED_BUDGET_MS = 12_000;
/** Hard cap so OCR can never hang a scan for minutes. */
const OCR_BUDGET_MS = 12_000;
/** Bound live-search calls used as a last-resort scan fallback. */
const LIVE_SEARCH_BUDGET_MS = 8_000;
/** Shorter per-request budget for text-identity catalog lookups. */
const TEXT_IDENTITY_SEARCH_MS = 4_000;
/** Hard wall clock for the whole OCR/PSA → live-catalog resolve step. */
const TEXT_IDENTITY_TOTAL_MS = 10_000;
/** Cap sequential live-search attempts during text-identity resolve. */
const TEXT_IDENTITY_MAX_ATTEMPTS = 4;
/** Bound each /api/visual-search round-trip so a hung index can't stall the UI. */
const VISUAL_SEARCH_BUDGET_MS = 15_000;
/** Never let remote candidate art keep the scanner in processing indefinitely. */
const CANDIDATE_RERANK_BUDGET_MS = 28_000;
/** Shorter rerank budget after a manual single-card cutout. */
const MANUAL_CROP_RERANK_BUDGET_MS = 12_000;
const MEMORY_RECALL_BUDGET_MS = 3_000;
/** Quick PSA-label OCR window before falling through to the full read. */
const PSA_LABEL_OCR_BUDGET_MS = 4_500;
/** Extra time when the original-frame label or caption crop is also being read. */
const PSA_AUXILIARY_OCR_BUDGET_MS = 8_000;
/** Nested screenshot cards skip CLIP/hash and only OCR the cutout name band. */
const NESTED_SCREENSHOT_OCR_BUDGET_MS = 7_000;
const NESTED_SCREENSHOT_EMPTY_NOTICE =
  "Couldn't read the card in this screenshot. Crop tighter around the card, then scan.";
/** A remembered scan above this similarity is treated as the same card. */
const MEMORY_NEURAL_THRESHOLD = 0.9;
const MEMORY_HASH_THRESHOLD = 0.92;
const DEFAULT_PERSPECTIVE_QUAD: PerspectiveQuad = [
  { x: 0.15, y: 0.08 },
  { x: 0.85, y: 0.08 },
  { x: 0.85, y: 0.92 },
  { x: 0.15, y: 0.92 },
];

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

function quadCoverage(quad: PerspectiveQuad): number {
  let twiceArea = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const point = quad[index];
    const next = quad[(index + 1) % quad.length];
    twiceArea += point.x * next.y - next.x * point.y;
  }
  return Math.max(0, Math.min(1, Math.abs(twiceArea) / 2));
}

function fastHashMatchThreshold(options: ProcessImageOptions): number {
  if (options.alreadyRectified && options.verifyText) {
    return FAST_HASH_CAMERA_THRESHOLD;
  }
  return FAST_HASH_MATCH_THRESHOLD;
}

async function cropNormalizedRect(
  source: string,
  box: NormalizedRect,
): Promise<string | null> {
  const img = await loadImageElement(source);
  const width = Math.max(1, img.width);
  const height = Math.max(1, img.height);
  const sx = Math.max(0, Math.min(width - 1, Math.round(box.left * width)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(box.top * height)));
  const ex = Math.max(sx + 1, Math.min(width, Math.round(box.right * width)));
  const ey = Math.max(sy + 1, Math.min(height, Math.round(box.bottom * height)));
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw < 12 || sh < 12) return null;
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToLosslessDataUrl(canvas);
}

async function drawQuadOverlay(
  source: string,
  quad: PerspectiveQuad,
): Promise<string> {
  const image = await loadImageElement(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return source;
  context.drawImage(image, 0, 0);
  context.beginPath();
  quad.forEach((point, index) => {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.lineWidth = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) * 0.006));
  context.strokeStyle = "#ff4d45";
  context.fillStyle = "rgba(255, 77, 69, 0.08)";
  context.fill();
  context.stroke();
  return canvasToLosslessDataUrl(canvas);
}

function debugCandidateFromHit(
  hit: VisualIndexHit,
  source: string,
): ScanDebugCandidate {
  const language = hit.lang || "en";
  const setId = hit.id.includes("-") ? hit.id.split("-")[0] ?? "" : "";
  return {
    cardId: hit.id,
    slug: language === "en" ? hit.id : `${language}--${hit.id}`,
    name: hit.name,
    language,
    collectorNumber: hit.localId,
    setId,
    score: hit.score,
    source,
  };
}

function debugCandidateFromResult(
  result: SearchResult,
  source: string,
  score = result.score,
): ScanDebugCandidate {
  const card = result.card;
  return {
    cardId: card.id,
    slug: card.slug,
    name: card.localizedName || card.name,
    language: card.language || "en",
    collectorNumber: card.collectorNumber,
    setId: card.setId,
    score,
    source,
  };
}

function normalizedOcrDebugText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function debugRankingFromMatch(
  match: ScanMatch,
  source: string,
): ScanDebugRankingEntry {
  return {
    ...debugCandidateFromResult(match.result, source, match.visualScore),
    totalScore: match.visualScore,
    components: {
      dHash: match.method === "phash" ? match.visualScore : null,
      clip: match.method === "neural" ? match.visualScore : null,
      exactName: null,
      collectorNumber: null,
      language: null,
      set: null,
      cropQuality: null,
    },
    bonuses: {},
    penalties: {},
  };
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

/**
 * Flatten a photographed card quadrilateral into an upright card image.
 * Inverse projective sampling avoids gaps that forward-mapping source pixels
 * would create, while bilinear interpolation keeps text and borders readable.
 */
async function rectifyPerspective(
  source: string,
  normalizedQuad: PerspectiveQuad,
): Promise<string | null> {
  if (!isValidPerspectiveQuad(normalizedQuad)) return null;
  const img = await loadImageElement(source);
  const sourceQuad = normalizedQuad.map((point) => ({
    x: point.x * Math.max(1, img.width - 1),
    y: point.y * Math.max(1, img.height - 1),
  })) as PerspectiveQuad;
  const transform = projectiveTransformForQuad(sourceQuad);
  if (!transform) return null;

  const averageHeight =
    (distance(sourceQuad[0], sourceQuad[3]) +
      distance(sourceQuad[1], sourceQuad[2])) /
    2;
  const outputHeight = Math.max(320, Math.min(1000, Math.round(averageHeight)));
  const outputWidth = Math.max(229, Math.round(outputHeight * CARD_ASPECT));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = img.width;
  sourceCanvas.height = img.height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) return null;
  sourceContext.drawImage(img, 0, 0);
  const sourcePixels = sourceContext.getImageData(0, 0, img.width, img.height);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) return null;
  const outputPixels = outputContext.createImageData(outputWidth, outputHeight);

  for (let y = 0; y < outputHeight; y += 1) {
    const v = outputHeight === 1 ? 0 : y / (outputHeight - 1);
    for (let x = 0; x < outputWidth; x += 1) {
      const u = outputWidth === 1 ? 0 : x / (outputWidth - 1);
      const sourcePoint = projectPoint(transform, u, v);
      if (!sourcePoint) continue;
      const sx = Math.max(0, Math.min(img.width - 1, sourcePoint.x));
      const sy = Math.max(0, Math.min(img.height - 1, sourcePoint.y));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const y1 = Math.min(img.height - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const destinationOffset = (y * outputWidth + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top =
          sourcePixels.data[(y0 * img.width + x0) * 4 + channel] * (1 - fx) +
          sourcePixels.data[(y0 * img.width + x1) * 4 + channel] * fx;
        const bottom =
          sourcePixels.data[(y1 * img.width + x0) * 4 + channel] * (1 - fx) +
          sourcePixels.data[(y1 * img.width + x1) * 4 + channel] * fx;
        outputPixels.data[destinationOffset + channel] = Math.round(
          top * (1 - fy) + bottom * fy,
        );
      }
    }
  }

  outputContext.putImageData(outputPixels, 0, 0);
  return canvasToLosslessDataUrl(outputCanvas);
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

/**
 * Find and rectify a tilted card inside a social screenshot or camera frame.
 * The detector uses the card's colorful footprint, so neutral captions and
 * app chrome do not dominate either the visual hash or OCR.
 */
/**
 * Locate the card in a noisy camera / table photo and return normalized
 * corner handles (TL/TR/BR/BL) so the UI can cut out and flatten it.
 */
async function detectCardPerspectiveQuad(
  source: string,
  sharpnessScore?: number,
): Promise<{ quad: PerspectiveQuad; quality: CropQuality } | null> {
  const img = await loadImageElement(source);
  const sampleWidth = Math.min(480, img.width);
  const sampleHeight = Math.max(24, Math.round((sampleWidth * img.height) / img.width));
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) return null;
  sampleContext.drawImage(img, 0, 0, sampleWidth, sampleHeight);
  const imageData = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight);
  const frame = estimateCardFrame(imageData.data, sampleWidth, sampleHeight);
  if (!frame || frame.confidence < 0.35) return null;
  const normalized = normalizeCardCorners(
    frame.corners,
    sampleWidth,
    sampleHeight,
    img.width,
    img.height,
  );
  if (!normalized || !isValidPerspectiveQuad(normalized)) return null;

  // Reject detections that barely shrink the frame — those are usually table
  // noise and make a worse cutout than leaving the original photo alone.
  const xs = normalized.map((point) => point.x);
  const ys = normalized.map((point) => point.y);
  const area =
    (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  if (area > 0.88) return null;

  const quality = scoreCropQuality(normalized, {
    sharpnessScore: sharpnessScore ?? Math.min(1, frame.confidence),
    imageAspect: img.width / Math.max(1, img.height),
  });
  if (quality.confidence < 0.32) return null;

  const bounds = boundingRectFromQuad(normalized);
  const coverage =
    Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top);
  const nested = isNestedAppCard({
    coverage,
    cropTop: bounds.top,
    cropBottom: bounds.bottom,
  });
  const quad = nested ? insetNestedAppCardQuad(normalized) : normalized;
  const nestedQuality = nested
    ? scoreCropQuality(quad, {
        sharpnessScore: sharpnessScore ?? Math.min(1, frame.confidence),
        imageAspect: img.width / Math.max(1, img.height),
      })
    : quality;

  return { quad, quality: nestedQuality };
}

async function autoDeskewCard(source: string): Promise<string | null> {
  const img = await loadImageElement(source);
  const sampleWidth = Math.min(240, img.width);
  const sampleHeight = Math.max(24, Math.round((sampleWidth * img.height) / img.width));
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) return null;
  sampleContext.drawImage(img, 0, 0, sampleWidth, sampleHeight);
  const imageData = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight);
  const frame = estimateCardFrame(imageData.data, sampleWidth, sampleHeight);
  if (!frame || frame.confidence < 0.35) return null;

  const sourceScale = img.width / sampleWidth;
  const margin = 1.1;
  let cropWidth = frame.width * sourceScale * margin;
  let cropHeight = frame.height * sourceScale * margin;
  if (cropWidth / cropHeight > CARD_ASPECT) {
    cropHeight = cropWidth / CARD_ASPECT;
  } else {
    cropWidth = cropHeight * CARD_ASPECT;
  }
  const outputScale = Math.min(1, 1000 / Math.max(cropWidth, cropHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(64, Math.round(cropWidth * outputScale));
  canvas.height = Math.max(90, Math.round(cropHeight * outputScale));
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.scale(outputScale, outputScale);
  context.rotate(frame.rotation);
  context.translate(
    -frame.centerX * sourceScale,
    -frame.centerY * sourceScale,
  );
  context.drawImage(img, 0, 0);
  return canvasToLosslessDataUrl(canvas);
}

async function isCardShapedImage(source: string): Promise<boolean> {
  const img = await loadImageElement(source);
  if (!img.width || !img.height) return false;
  const aspect = img.width / img.height;
  return Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT <= 0.1;
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
    const relativeCutoff = Math.max(0.8, topScore - 0.04);
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

function rankVisualTiesWithOcr(
  hits: VisualIndexHit[],
  candidates: string[],
): VisualIndexHit[] {
  if (!candidates.length) return hits;
  const agreement = (name: string) =>
    candidates.reduce(
      (best, candidate) =>
        Math.max(
          best,
          fuzzyNameScore(candidate, name),
          rawMatchScore(candidate, name),
        ),
      0,
    );
  return [...hits].sort((left, right) => {
    const visualGap = right.score - left.score;
    if (Math.abs(visualGap) > 0.03) return visualGap;
    const ocrGap = agreement(right.name) - agreement(left.name);
    return ocrGap || visualGap;
  });
}

function cardNameAgreement(card: TcgCard, name: string): number {
  return Math.max(
    fuzzyNameScore(name, card.name),
    fuzzyNameScore(name, card.englishName ?? ""),
    fuzzyNameScore(name, card.localizedName ?? ""),
    rawMatchScore(name, card.name),
    rawMatchScore(name, card.englishName ?? ""),
    rawMatchScore(name, card.localizedName ?? ""),
  );
}

function confirmIdentityFromVisualHits(
  hits: VisualIndexHit[],
  candidates: string[],
): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const hit of hits) {
    for (const candidate of candidates) {
      const score = Math.max(
        fuzzyNameScore(candidate, hit.name),
        rawMatchScore(candidate, hit.name),
      );
      if (score > (best?.score ?? 0)) {
        best = { name: hit.name, score };
      }
    }
  }
  return best && best.score >= 0.84 ? best : null;
}

function directMatchesForIdentity(
  directMatches: SearchResult[],
  indexHits: VisualIndexHit[],
  identity: { name: string; score: number } | null,
  method: "neural" | "phash",
): ScanMatch[] {
  if (!identity || identity.score < 0.82) return [];
  const direct = directMatches.filter(
    (result) => cardNameAgreement(result.card, identity.name) >= 0.84,
  );
  const hits = indexHits.filter(
    (hit) =>
      Math.max(
        fuzzyNameScore(identity.name, hit.name),
        rawMatchScore(identity.name, hit.name),
      ) >= 0.84,
  );
  return rankedFromDirectOrHits(direct, hits, method, 0);
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
  const sharpLike = dHash9x8(img);
  if (sharpLike !== 0n && !seen.has(sharpLike.toString())) {
    seen.add(sharpLike.toString());
    hashes.push(sharpLike);
  }
  const equalized = dHashEqualized(img);
  if (equalized !== 0n && !seen.has(equalized.toString())) {
    seen.add(equalized.toString());
    hashes.push(equalized);
  }
  const glareCompressed = dHashHighlightCompressed(img);
  if (glareCompressed !== 0n && !seen.has(glareCompressed.toString())) {
    seen.add(glareCompressed.toString());
    hashes.push(glareCompressed);
  }
  const workGrayRaw = toWorkGrayscale(img);
  const workGray =
    workGrayRaw.length === DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT
      ? workGrayRaw.map((value) => Math.round(value))
      : null;

  for (const inset of [0.01, 0.02, 0.05, 0.08, 0.1]) {
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

/**
 * Fallback for rotated cards when geometry detection is uncertain. Generate a
 * bounded set of centered, upright candidates; only hashes are sent.
 */
async function collectRotationHashes(source: string): Promise<bigint[]> {
  const img = await loadImageElement(source);
  const hashes: bigint[] = [];
  const seen = new Set<string>();
  // Midpoints complement the geometry detector/coarse alignment. Being within
  // ~2° matters substantially for dHash; 25° recovers a 27° JP card at 95%+.
  const angles = [-25, 25, -35, 35, -15, 15, -45, 45];
  const scales = [0.58, 0.6, 0.62];

  for (const degrees of angles) {
    const radians = (degrees * Math.PI) / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const rotated = document.createElement("canvas");
    // Expand bounds before rotating so card corners are never clipped.
    rotated.width = Math.ceil(img.width * cosine + img.height * sine);
    rotated.height = Math.ceil(img.width * sine + img.height * cosine);
    const context = rotated.getContext("2d");
    if (!context) continue;
    context.fillStyle = "#000";
    context.fillRect(0, 0, rotated.width, rotated.height);
    context.translate(rotated.width / 2, rotated.height / 2);
    context.rotate(radians);
    context.drawImage(img, -img.width / 2, -img.height / 2);

    for (const scale of scales) {
      // Scale against the original frame (not expanded rotation bounds).
      let cropHeight = img.height * scale;
      let cropWidth = cropHeight * CARD_ASPECT;
      if (cropWidth > img.width * scale) {
        cropWidth = img.width * scale;
        cropHeight = cropWidth / CARD_ASPECT;
      }
      const crop = document.createElement("canvas");
      crop.width = Math.max(64, Math.round(cropWidth));
      crop.height = Math.max(90, Math.round(cropHeight));
      const cropContext = crop.getContext("2d");
      if (!cropContext) continue;
      cropContext.drawImage(
        rotated,
        (rotated.width - cropWidth) / 2,
        (rotated.height - cropHeight) / 2,
        cropWidth,
        cropHeight,
        0,
        0,
        crop.width,
        crop.height,
      );
      const hash = dHash(crop);
      const key = hash.toString();
      if (hash !== 0n && !seen.has(key)) {
        seen.add(key);
        hashes.push(hash);
      }
    }
  }
  return hashes.slice(0, 24);
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
  const unique = hashes.filter((hash) => hash !== 0n).slice(0, 24);
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

/**
 * Honor EXIF orientation for phone photos. PNG/WebP digital scans stay on the
 * original bytes so catalog-identical uploads keep a lossless hash.
 */
async function fileToOrientedDataUrl(file: File): Promise<string> {
  const type = file.type.toLowerCase();
  if (type === "image/png" || type === "image/webp" || type === "image/gif") {
    return fileToDataUrl(file);
  }
  if (typeof createImageBitmap !== "function") {
    return fileToDataUrl(file);
  }
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return fileToDataUrl(file);
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return fileToDataUrl(file);
  }
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
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        LIVE_SEARCH_BUDGET_MS,
      );
      try {
        const response = await fetch(
          `/api/pokemon-names?q=${encodeURIComponent(candidate)}&limit=6`,
          { signal: controller.signal },
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
      } finally {
        window.clearTimeout(timeoutId);
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

async function searchCandidates(
  query: string,
  options: {
    language?: CardLanguageFilter;
    setFilter?: string;
    timeoutMs?: number;
  } = {},
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? LIVE_SEARCH_BUDGET_MS;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const params = buildLiveSearchApiParams({
      query,
      page: 1,
      language: options.language ?? "all",
      setFilter: options.setFilter ?? "",
    });
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

function preferCollectorMatches(
  results: SearchResult[],
  collectorNumber?: string,
): SearchResult[] {
  if (!collectorNumber?.trim() || !results.length) return results;
  const matched = results.filter(
    (result) =>
      compareCollectorNumbers(collectorNumber, result.card.collectorNumber, {
        setCode: result.card.setCode,
        setPrintedTotal: result.card.setPrintedTotal,
      }).score >= 0.85,
  );
  return matched.length ? matched : results;
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
      image: normalizeScanCardImageUrl(hit.image),
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
  budgetMs = EMBED_BUDGET_MS,
): Promise<Float32Array | null> {
  if (!NEURAL_ENABLED) {
    return null;
  }

  return Promise.race([
    embedImage(image, onProgress),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), budgetMs);
    }),
  ]);
}

function withFallbackBudget<T>(
  promise: Promise<T>,
  fallback: T,
  budgetMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(value);
    };
    const timeoutId = window.setTimeout(() => {
      onTimeout?.();
      finish(fallback);
    }, budgetMs);
    promise.then(finish, () => finish(fallback));
  });
}

/**
 * Strict-to-loose candidate search. Prefer set-code filters when OCR/PSA
 * exposed one — that is how JP CSR prints resolve without a visual-index hit.
 * Free-text set titles are NOT used as API set filters (they force slow server
 * set-resolution and can stall the scanner). JA searches try name-only first
 * because name+number glued queries often return 0 for official JP rows.
 */
async function searchCandidatesWithFallback(
  parts: { name: string; suffix?: string; number?: string },
  maxAttempts = 3,
  options: {
    languageHints?: CardLanguageCode[];
    setCodes?: string[];
    setHints?: string[];
    timeoutMs?: number;
    deadlineMs?: number;
    onAttempt?: (done: number, total: number) => void;
  } = {},
): Promise<SearchResult[]> {
  const preferJapanese = options.languageHints?.[0] === "ja";
  const timeoutMs = options.timeoutMs ?? LIVE_SEARCH_BUDGET_MS;
  const deadlineMs = options.deadlineMs ?? Date.now() + TEXT_IDENTITY_TOTAL_MS;
  const attempts = preferJapanese
    ? [
        buildScanQuery({ name: parts.name, suffix: parts.suffix }),
        buildScanQuery({ name: parts.name }),
        buildScanQuery(parts),
      ]
    : [
        buildScanQuery({ name: parts.name, suffix: parts.suffix }),
        buildScanQuery({ name: parts.name }),
        buildScanQuery(parts),
      ];
  const languages = textIdentitySearchLanguages(options.languageHints);
  // Only concrete set codes (S8b, S10P). Set titles like "VMAX CLIMAX" hang the
  // live-search set resolver and must not be sent as `set=`.
  const setFilters = [
    ...(options.setCodes ?? []).slice(0, 2),
    "",
  ].filter((value, index, all) => value !== undefined && all.indexOf(value) === index);

  type Planned = {
    setFilter: string;
    language: CardLanguageFilter;
    query: string;
  };
  const planned: Planned[] = [];
  const seen = new Set<string>();
  for (const setFilter of setFilters) {
    for (const language of languages) {
      for (const query of attempts) {
        const key = `${setFilter}:${language}:${query.trim().toLowerCase()}`;
        if (!query.trim() || seen.has(key)) continue;
        seen.add(key);
        planned.push({ setFilter, language, query });
      }
    }
  }
  const queue = planned.slice(0, Math.max(1, Math.min(maxAttempts, TEXT_IDENTITY_MAX_ATTEMPTS)));

  for (let index = 0; index < queue.length; index += 1) {
    if (Date.now() >= deadlineMs) break;
    const item = queue[index];
    options.onAttempt?.(index + 1, queue.length);
    const remaining = Math.max(500, deadlineMs - Date.now());
    const results = preferCollectorMatches(
      await searchCandidates(item.query, {
        language: item.language,
        setFilter: item.setFilter || undefined,
        timeoutMs: Math.min(timeoutMs, remaining),
      }),
      parts.number,
    );
    if (results.length) {
      if (index > 0) {
        console.log(
          `Strict scan query "${queue[0].query}" returned 0 results; matched with looser query "${item.query}" (${item.language}${item.setFilter ? `, set=${item.setFilter}` : ""}).`,
        );
      }
      return results;
    }
  }
  return [];
}

async function resolveMatchesFromTextIdentity(
  identity: ScanTextIdentity,
  options: {
    onProgress?: (label: string, progress: number) => void;
  } = {},
): Promise<ScanMatch[]> {
  return withFallbackBudget(
    resolveMatchesFromTextIdentityUncapped(identity, options),
    [],
    TEXT_IDENTITY_TOTAL_MS + 500,
    () => {
      options.onProgress?.("Catalog lookup timed out…", 1);
    },
  );
}

/**
 * Live-catalog identity from OCR / PSA text. Does not require the visual index.
 * Hard-capped so a slow/empty catalog cannot freeze the scanner UI.
 */
async function resolveMatchesFromTextIdentityUncapped(
  identity: ScanTextIdentity,
  options: {
    onProgress?: (label: string, progress: number) => void;
  } = {},
): Promise<ScanMatch[]> {
  if (!isActionableTextIdentity(identity)) return [];

  const started = Date.now();
  const deadlineMs = started + TEXT_IDENTITY_TOTAL_MS;
  const report = (label: string, fraction: number) => {
    options.onProgress?.(label, fraction);
  };

  report("Matching printed name & number…", 0.15);

  // Skip the pokemon-names round-trip when PSA already gave a clean Latin name
  // (FA/MIMIKYU VMAX). confirmName can itself take several seconds per token.
  const primaryName = identity.names[0];
  const looksCleanLatin =
    /^[\x00-\x7F]+$/.test(primaryName) &&
    primaryName.trim().split(/\s+/).length <= 4;
  let confirmedName = primaryName;
  if (!looksCleanLatin && Date.now() < deadlineMs - 2_000) {
    confirmedName =
      (await confirmName(identity.names.slice(0, 2)))?.name ?? primaryName;
  }

  report("Searching the catalog…", 0.35);

  const pool = await searchCandidatesWithFallback(
    {
      name: confirmedName,
      suffix: identity.suffix,
      number: identity.number,
    },
    TEXT_IDENTITY_MAX_ATTEMPTS,
    {
      languageHints: identity.languageHints,
      setCodes: identity.setCodes,
      timeoutMs: TEXT_IDENTITY_SEARCH_MS,
      deadlineMs,
      onAttempt: (done, total) => {
        report(
          "Searching the catalog…",
          0.35 + (done / Math.max(1, total)) * 0.45,
        );
      },
    },
  );

  // One alternate name only, and only if we still have budget + no number hit.
  const numberMatched = identity.number
    ? preferCollectorMatches(pool, identity.number)
    : [];
  const hasNumberHit =
    Boolean(identity.number) &&
    numberMatched.length > 0 &&
    numberMatched.some(
      (result) =>
        compareCollectorNumbers(identity.number, result.card.collectorNumber, {
          setCode: result.card.setCode,
          setPrintedTotal: result.card.setPrintedTotal,
        }).score >= 0.85,
    );

  if (
    !hasNumberHit &&
    pool.length < 2 &&
    identity.names.length > 1 &&
    Date.now() < deadlineMs - 1_500
  ) {
    report("Trying alternate name…", 0.85);
    const extra = await searchCandidatesWithFallback(
      {
        name: identity.names[1],
        suffix: identity.suffix,
        number: identity.number,
      },
      2,
      {
        languageHints: identity.languageHints,
        setCodes: identity.setCodes,
        timeoutMs: TEXT_IDENTITY_SEARCH_MS,
        deadlineMs,
      },
    );
    for (const result of extra) {
      if (!pool.some((entry) => entry.card.slug === result.card.slug)) {
        pool.push(result);
      }
    }
  }

  report("Scoring catalog matches…", 0.95);

  const scored = pool
    .map((result) => {
      const scores = scoreCatalogAgainstTextIdentity(identity, result);
      return { result, scores };
    })
    .filter((entry) => entry.scores.nameScore >= 0.72 || entry.scores.total >= 0.7)
    .sort((left, right) => right.scores.total - left.scores.total);

  return scored.slice(0, 8).map((entry) => ({
    result: entry.result,
    visualScore: entry.scores.total,
    method: "phash" as const,
  }));
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
  names?: string[];
  collectorNumber?: string;
  languageHints?: CardLanguageCode[];
  scriptHint?: ReturnType<typeof inferScriptHint>;
}): Promise<{
  hits: VisualIndexHit[];
  directMatches: SearchResult[];
  identityHits: VisualIndexHit[];
  identityMatches: SearchResult[];
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
      names?: string[];
      collectorNumber?: string;
      languageHints?: CardLanguageCode[];
      scriptHint?: ReturnType<typeof inferScriptHint>;
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
    if (params.names?.length) {
      body.names = params.names.slice(0, 24);
    }
    if (params.collectorNumber) {
      body.collectorNumber = params.collectorNumber;
    }
    if (params.languageHints?.length) {
      body.languageHints = params.languageHints;
    }
    if (params.scriptHint) {
      body.scriptHint = params.scriptHint;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      VISUAL_SEARCH_BUDGET_MS,
    );
    try {
      const response = await fetch("/api/visual-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          hits: [],
          directMatches: [],
          identityHits: [],
          identityMatches: [],
          ready: false,
          size: 0,
        };
      }
      const data = (await response.json()) as {
        hits?: VisualIndexHit[];
        directMatches?: SearchResult[];
        identityHits?: VisualIndexHit[];
        identityMatches?: SearchResult[];
        ready?: boolean;
        size?: number;
      };
      return {
        hits: data.hits ?? [],
        directMatches: data.directMatches ?? [],
        identityHits: data.identityHits ?? [],
        identityMatches: data.identityMatches ?? [],
        ready: Boolean(data.ready),
        size: Number(data.size) || 0,
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
  } catch {
    return {
      hits: [],
      directMatches: [],
      identityHits: [],
      identityMatches: [],
      ready: false,
      size: 0,
    };
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
  options: {
    preferVisualOnly?: boolean;
    languageHints?: CardLanguageCode[];
    setCodes?: string[];
    setHints?: string[];
  } = {},
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
  const searchOptions = {
    languageHints: options.languageHints,
    setCodes: options.setCodes,
    setHints: options.setHints,
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
        {
          languageHints: hit.lang === "ja" ? ["ja"] : options.languageHints,
        },
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
      await searchCandidatesWithFallback(
        {
          name: confirmed.name,
          suffix: parsed.suffix,
          number: parsed.number,
        },
        3,
        searchOptions,
      ),
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
          searchOptions,
        );
      }),
    );
    for (const results of rawResults) {
      add(results);
    }
  }

  if (acc.length) {
    return preferCollectorMatches(acc, parsed.number).slice(0, 12);
  }

  // 4) Last resort: one raw OCR token, bounded attempts.
  const token = parsed.nameCandidates[0];
  if (token) {
    add(
      await searchCandidatesWithFallback(
        { name: token, suffix: parsed.suffix, number: parsed.number },
        2,
        searchOptions,
      ),
    );
  }
  return preferCollectorMatches(acc, parsed.number).slice(0, 12);
}

function fileFromEvent(event: React.ChangeEvent<HTMLInputElement>): File | null {
  const file = event.target.files?.[0] ?? null;
  event.target.value = "";
  return file;
}

/**
 * Nested in-banner screenshot cards are too small to hash/CLIP. OCR the cutout
 * name band, correct it to a species, then search the English catalog. Never
 * fall back to artwork collisions (that is how Gyarados 7 appeared).
 */
async function matchNestedScreenshotCard(options: {
  source: string;
  runOcr: (
    image: string,
    ocrOptions?: {
      pageSegmentationMode?: "3" | "6" | "7" | "11";
      characterWhitelist?: string;
    },
  ) => Promise<OcrRecognitionResult>;
  onStatus?: (label: string, progress: number) => void;
  debug?: ScanDebugReport | null;
}): Promise<{
  matches: ScanMatch[];
  guessName: string | null;
  ocrNumber?: string;
  speciesScore?: number;
  notice: string | null;
}> {
  const { source, runOcr, onStatus, debug } = options;
  onStatus?.("Reading the card…", 22);
  const slices = await buildOcrImageSlices(source, { nestedScreenshot: true });
  const deadline = Date.now() + NESTED_SCREENSHOT_OCR_BUDGET_MS;
  const ocrEvidence: OcrTextEvidence[] = [];
  let species: { name: string; score: number } | null = null;

  for (const slice of slices) {
    if (Date.now() > deadline) break;
    let recognitionTimedOut = false;
    const recognition = await Promise.race([
      runOcr(slice.image, {
        pageSegmentationMode:
          slice.region === "footer"
            ? "11"
            : slice.region === "header" || slice.region === "hp"
              ? "11"
              : "3",
      }),
      new Promise<OcrRecognitionResult>((resolve) => {
        window.setTimeout(() => {
          recognitionTimedOut = true;
          resolve({ text: "", confidence: null });
        }, Math.max(400, deadline - Date.now()));
      }),
    ]);
    if (recognitionTimedOut) {
      await terminateOcrWorker().catch(() => undefined);
      break;
    }
    const text = recognition.text;
    const parsedSlice = parseOcrText(text, { region: slice.region });
    if (debug) {
      debug.ocrSlices.push({
        text,
        normalizedText: normalizedOcrDebugText(text),
        confidence:
          recognition.confidence == null
            ? null
            : Math.max(0, Math.min(1, recognition.confidence / 100)),
        region: `nested:${slice.region}`,
        rotation: slice.rotation,
        preprocessing: JSON.stringify(slice.preprocessing),
        parsedCollector: null,
      });
    }
    if (!text) continue;
    ocrEvidence.push({
      text,
      region: slice.region,
      confidence:
        recognition.confidence == null
          ? regionConfidence(slice.region)
          : Math.max(0, Math.min(1, recognition.confidence / 100)),
      rotation: slice.rotation,
      nameCandidates: parsedSlice.nameCandidates,
      number: parsedSlice.number,
      suffix: parsedSlice.suffix,
    });
    const blob = ocrEvidence.map((item) => item.text).join("\n");
    species = correctOcrSpeciesName(extractNestedOcrNameTokens(blob));
    if (species && species.score >= 0.85) {
      debug?.notes.push(
        `Nested species from OCR: ${species.name} (${species.score.toFixed(3)}).`,
      );
      break;
    }
  }

  const ocrBlob = ocrEvidence.map((item) => item.text).join("\n");
  species =
    species ?? correctOcrSpeciesName(extractNestedOcrNameTokens(ocrBlob));
  const parsedNumber = ocrEvidence.map((item) => item.number).find(Boolean);

  if (!species) {
    debug?.notes.push(
      "Nested screenshot: no readable card name; refusing artwork collisions.",
    );
    return {
      matches: [],
      guessName: null,
      notice: NESTED_SCREENSHOT_EMPTY_NOTICE,
    };
  }

  const speciesName = species.name;
  const speciesScore = species.score;

  onStatus?.("Searching the catalog…", 72);
  const identity = buildScanTextIdentity({
    extraNames: [speciesName],
    languageHints: ["en"],
    parsed: {
      nameCandidates: [speciesName],
      number: parsedNumber,
      lines: ocrEvidence.flatMap((item) => item.text.split(/\r?\n/)).filter(Boolean),
    },
  });
  const liveResults = await searchCandidates(speciesName, {
    language: "en",
    timeoutMs: 5_000,
  });
  const namedLive = liveResults.filter(
    (result) => scoreCatalogAgainstTextIdentity(identity, result).nameScore >= 0.85,
  );
  let matches: ScanMatch[] = namedLive.slice(0, 8).map((result) => ({
    result: {
      ...result,
      score: Math.max(result.score, 0.86),
    },
    visualScore: Math.max(
      scoreCatalogAgainstTextIdentity(identity, result).nameScore,
      0.86,
    ),
    method: "phash",
  }));

  if (!matches.length) {
    onStatus?.("Matching printed name…", 88);
    const identityResult = await visualSearch({
      hash: "0",
      embedding: null,
      names: [speciesName],
      languageHints: ["en"],
    });
    const indexHits = (
      identityResult.identityHits.length
        ? identityResult.identityHits
        : identityResult.hits
    ).filter(
      (hit) =>
        fuzzyNameScore(hit.name, speciesName) >= 0.85 ||
        fuzzyNameScore(hit.name.replace(/^dark\s+/i, ""), speciesName) >= 0.85,
    );
    matches = searchResultsFromVisualHits(indexHits, 0.5)
      .filter(
        (result) =>
          scoreCatalogAgainstTextIdentity(identity, result).nameScore >= 0.85,
      )
      .slice(0, 8)
      .map((result) => ({
        result,
        visualScore: Math.max(result.score, 0.86),
        method: "phash" as const,
      }));
  }

  if (!matches.length) {
    debug?.notes.push(
      `Nested OCR read ${speciesName}, but catalog search returned no name matches.`,
    );
    return {
      matches: [],
      guessName: speciesName,
      ocrNumber: parsedNumber,
      speciesScore,
      notice: `Read ${speciesName}, but couldn't load matching prints. Search by name.`,
    };
  }

  debug?.notes.push(
    `Nested catalog match: ${matches[0].result.card.name} (${matches.length} prints).`,
  );
  return {
    matches,
    guessName: speciesName,
    ocrNumber: parsedNumber,
    speciesScore,
    notice:
      matches.length > 1
        ? "Read the printed name — tap the matching print."
        : null,
  };
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
  const [scanDebugReport, setScanDebugReport] = useState<ScanDebugReport | null>(null);

  // Crop/align step state.
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [cropCorners, setCropCorners] = useState<PerspectiveQuad>(
    DEFAULT_PERSPECTIVE_QUAD,
  );

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const photoSignatureRef = useRef<PhotoSignature | null>(null);
  const cropContainerRef = useRef<HTMLDivElement | null>(null);
  /** True once the user drags or resizes the crop frame. */
  const cropTouchedRef = useRef(false);
  /** True when auto-detection already locked onto a card cutout. */
  const cropAutoDetectedRef = useRef(false);
  /** Geometry confidence for the auto/manual cutout (feeds evidence fusion). */
  const cropQualityRef = useRef<CropQuality | null>(null);
  const captureSourceHintRef = useRef<ScanSourceHint>("upload");
  const scanDiagnosticsRef = useRef<ScanImageDiagnostics | null>(null);
  const scanDebugRef = useRef<ScanDebugReport | null>(null);
  const scanStartedAtRef = useRef<number | null>(null);

  const syncDebugReport = useCallback((publish = false) => {
    if (!isScanDebugEnabled() || !scanDebugRef.current) return;
    if (publish && scanStartedAtRef.current != null) {
      scanDebugRef.current.durationMs = Math.max(
        0,
        performance.now() - scanStartedAtRef.current,
      );
    }
    const snapshot = createScanDebugReport(scanDebugRef.current);
    scanDebugRef.current = snapshot;
    setScanDebugReport(snapshot);
    if (publish) publishScanDebugReport(snapshot);
  }, []);

  const resetState = useCallback(() => {
    setStage("capture");
    setProgress(0);
    setStatusText("");
    setPreview(null);
    setGuess(null);
    setConfident(false);
    setMatches([]);
    setNotice(null);
    setScanDebugReport(null);
    setRawImage(null);
    setCropCorners(DEFAULT_PERSPECTIVE_QUAD);
    photoSignatureRef.current = null;
    cropTouchedRef.current = false;
    cropAutoDetectedRef.current = false;
    cropQualityRef.current = null;
    captureSourceHintRef.current = "upload";
    scanDiagnosticsRef.current = null;
    scanDebugRef.current = null;
    scanStartedAtRef.current = null;
  }, []);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    resetState();
  }, [resetState]);

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

  const runOcr = useCallback(async (
    image: string,
    options: {
      pageSegmentationMode?: "3" | "6" | "7" | "11";
      characterWhitelist?: string;
    } = {},
  ): Promise<OcrRecognitionResult> => {
    return recognizeOcrResult(
      image,
      (message: { status: string; progress: number }) => {
        if (message.status === "recognizing text") {
          // Keep OCR progress in the 50-70 band so it never rewinds the bar
          // after embedding / visual search already advanced past 40%.
          setProgress(50 + Math.round(message.progress * 20));
        }
      },
      options,
    );
  }, []);

  /** Compare a photo signature against remembered (confirmed) scans. */
  const recallBestMemory = useCallback(async (signature: PhotoSignature) => {
    const memories = await recallScans();
    let best: { slug: string; score: number; method: ScanMatch["method"] } | null = null;
    for (const memory of memories) {
      let score = 0;
      let method: ScanMatch["method"] = "phash";
      if (signature.vector && memory.vector) {
        score = cosineSimilarity(signature.vector, memory.vector);
        method = "neural";
      } else if (memory.hash) {
        score = hashSimilarity(signature.hash, BigInt(memory.hash));
      }
      if (score > (best?.score ?? 0)) {
        best = { slug: memory.slug, score, method };
      }
    }
    if (!best) return null;
    const strong =
      best.score >=
      (best.method === "neural" ? MEMORY_NEURAL_THRESHOLD : MEMORY_HASH_THRESHOLD);
    return strong ? best : null;
  }, []);

  const finishVisualMatches = useCallback(
    (
      ranked: ScanMatch[],
      topScore: number,
      noticeText?: string | null,
      guessOverride?: ScanCardGuess | null,
    ) => {
      const top = ranked[0];
      if (guessOverride) {
        setGuess(guessOverride);
        setConfident(false);
      } else if (top) {
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
      if (scanDebugRef.current) {
        if (!scanDebugRef.current.finalRanking.length) {
          scanDebugRef.current.finalRanking = ranked
            .slice(0, 20)
            .map((match) => debugRankingFromMatch(match, "fast-visual"));
        }
        syncDebugReport(true);
      }
      setStage("results");
    },
    [syncDebugReport],
  );

  const processImage = useCallback(
    async (
      sourceDataUrl: string,
      options: ProcessImageOptions = {},
    ) => {
      setStage("processing");
      setProgress(5);
      setNotice(null);
      setMatches([]);
      setGuess(null);
      setConfident(false);
      photoSignatureRef.current = null;
      scanStartedAtRef.current = performance.now();

      try {
        const debugEnabled = isScanDebugEnabled();
        const nestedScreenshot = Boolean(options.nestedScreenshot);
        if (nestedScreenshot) {
          const trimmedNested = await trimLetterboxBorders(sourceDataUrl);
          const nestedSource = trimmedNested || sourceDataUrl;
          setPreview(await downscaleImage(nestedSource, 640, 0.92));
          scanDebugRef.current?.notes.push(
            "Nested app-screenshot card: skip chrome OCR, CLIP, and full-frame hashes.",
          );
          const nested = await matchNestedScreenshotCard({
            source: nestedSource,
            runOcr,
            onStatus: (label, progress) => {
              setStatusText(label);
              setProgress(progress);
            },
            debug: scanDebugRef.current,
          });
          const guessOverride = nested.guessName
            ? {
                name: nested.guessName,
                number: nested.ocrNumber,
                confidence:
                  nested.matches[0]?.visualScore ?? nested.speciesScore ?? 0.85,
                language: "en" as const,
                source: "ocr" as const,
              }
            : null;
          if (nested.notice && nested.matches.length) {
            setNotice(nested.notice);
          }
          finishVisualMatches(
            nested.matches,
            nested.matches[0]?.visualScore ?? 0,
            nested.notice,
            guessOverride,
          );
          return;
        }
        // Strip black letterbox/pillarbox before hashing — padding alone can
        // drop a clean Umbreon digital from ~0.89 → ~0.50 and surface random
        // cards (Palpitoad, etc.) as "matches".
        const trimmedSource = await trimLetterboxBorders(sourceDataUrl);
        const unalignedSource = trimmedSource || sourceDataUrl;
        // Never deskew an already card-shaped upload. Color-footprint geometry
        // can mistake asymmetrical artwork for a tilted rectangle; exact JP
        // catalog images then lose their otherwise-perfect hash.
        const cardShaped =
          Boolean(options.alreadyRectified) ||
          scanDiagnosticsRef.current?.inputType === "digital" ||
          (await isCardShapedImage(unalignedSource).catch(() => false));
        const deskewedSource = cardShaped
          ? null
          : await autoDeskewCard(unalignedSource).catch(() => null);
        const sourceForMatch = deskewedSource ?? unalignedSource;

        // Hash the rectified card plus the original frame as a safety net.
        // Never hash a JPEG recompress — that alone can drop an exact Umbreon
        // VMAX match from ~0.98 → ~0.87.
        const sourceVariants: ScanSourceVariant[] = [];
        const seenSources = new Set<string>();
        const addSourceVariant = (variant: ScanSourceVariant) => {
          if (!variant.source || seenSources.has(variant.source)) return;
          seenSources.add(variant.source);
          sourceVariants.push(variant);
        };
        addSourceVariant({
          label: deskewedSource ? "auto-aligned" : "primary",
          source: sourceForMatch,
          role: deskewedSource ? "aligned" : "rectified",
        });
        for (const variant of options.alternateSources ?? []) {
          // Manual single-card crops from multi-slab photos must not hash the
          // untouched full frame — it poisons retrieval and burns OCR budget.
          if (options.manualCrop && variant.role === "legacy") continue;
          addSourceVariant(variant);
        }
        if (deskewedSource && !options.manualCrop && !nestedScreenshot) {
          addSourceVariant({
            label: "pre-alignment",
            source: unalignedSource,
            role: "legacy",
          });
        }
        const sourceFingerprints = await Promise.all(
          sourceVariants.map(async (variant) => ({
            ...variant,
            ...(await collectPhotoFingerprints(variant.source)),
          })),
        );
        // Full-frame "legacy" hashes of table photos collide with random catalog
        // cards at ~0.84 and used to outrank the rectified card. Keep them for
        // crop selection only — never mix them into the primary lookup.
        const hashingFingerprints = sourceFingerprints.filter(
          (fingerprint) => fingerprint.role !== "legacy",
        );
        const fingerprintPool = hashingFingerprints.length
          ? hashingFingerprints
          : sourceFingerprints;
        const workGray = fingerprintPool[0]?.workGray ?? null;
        const reservedHashes = fingerprintPool
          .map((fingerprint) => fingerprint.hashes[0])
          .filter((hash): hash is bigint => Boolean(hash && hash !== 0n));
        const insetHashes = fingerprintPool.flatMap((fingerprint) =>
          fingerprint.hashes.slice(1),
        );
        const photoHashes = Array.from(
          new Map(
            [...reservedHashes, ...insetHashes]
              .filter((hash) => hash !== 0n)
              .map((hash) => [hash.toString(), hash]),
          ).values(),
        ).slice(0, 24);
        let photoHash = photoHashes[0] ?? 0n;
        let hashKey = photoHash.toString();

        const encodeImage = await downscaleImage(sourceForMatch, 640, 0.92);
        setPreview(encodeImage);

        // 1) Hash match first — no model download. Digital catalog renders and
        // near-duplicate photos finish here in well under a second.
        setStatusText("Matching artwork to the catalog…");
        setProgress(18);
        const hashSearchPromise = bestVisualSearchByHashes(photoHashes, workGray);
        const perVariantHashPromise = Promise.all(
          sourceFingerprints.map(async (fingerprint) => ({
            fingerprint,
            result: await bestVisualSearchByHashes(
              fingerprint.hashes,
              fingerprint.workGray,
            ),
          })),
        );
        const includePsaLabel =
          Boolean(options.includePsaLabel) ||
          scanDiagnosticsRef.current?.inputType === "slab";
        const auxiliarySources = options.ocrAuxiliarySources ?? [];
        // Start OCR in parallel for digital/full-art cards so we don't wait on
        // CLIP when artwork matching is weak or the host catalog is empty.
        const primaryOcrPromise = buildOcrImageSlices(sourceForMatch, {
          includePsaLabel,
          nestedScreenshot,
        });
        const embedBudgetMs =
          nestedScreenshot
            ? 0
            : options.manualCrop || options.alreadyRectified
              ? EMBED_BUDGET_MS
              : options.verifyText
                ? 16_000
                : EMBED_BUDGET_MS;
        const embedPromise = nestedScreenshot
          ? Promise.resolve(null)
          : embedImageWithBudget(
              encodeImage,
              (modelProgress) => {
                if (modelProgress.status === "progress" && modelProgress.progress) {
                  setProgress((current) =>
                    Math.max(current, 18 + Math.round((modelProgress.progress! / 100) * 20)),
                  );
                }
              },
              embedBudgetMs,
            );

        // Graded slabs / screenshot captions: read printed identity from the
        // original frame (label above the card, caption below) before the inner
        // crop. Never hash these crops — plastic labels poison artwork search.
        const printedIdentitySources: Array<{ label: string; source: string }> = [
          ...auxiliarySources,
          ...(includePsaLabel
            ? [{ label: "psa-label-inner", source: sourceForMatch }]
            : []),
        ];
        const psaLabelPromise = printedIdentitySources.length
          ? (async (): Promise<ParsedOcrText | null> => {
              const deadline =
                Date.now() +
                (auxiliarySources.length
                  ? PSA_AUXILIARY_OCR_BUDGET_MS
                  : PSA_LABEL_OCR_BUDGET_MS);
              const parts: ParsedOcrText[] = [];
              for (const item of printedIdentitySources) {
                if (Date.now() > deadline) break;
                const slices =
                  item.label === "psa-label-inner"
                    ? (await buildPsaLabelOcrSlices(item.source)).slice(0, 2)
                    : await buildAuxiliaryIdentityOcrSlices(item.source, item.label);
                for (const slice of slices) {
                  if (Date.now() > deadline) break;
                  let timedOut = false;
                  const recognition = await Promise.race([
                    runOcr(slice.image, { pageSegmentationMode: "6" }),
                    new Promise<null>((resolve) => {
                      window.setTimeout(() => {
                        timedOut = true;
                        resolve(null);
                      }, Math.max(400, deadline - Date.now()));
                    }),
                  ]);
                  if (!recognition?.text) {
                    if (timedOut) break;
                    continue;
                  }
                  const parsedLabel = parsePsaLabelText(recognition.text);
                  // Captions are noisy Instagram chrome. Only keep PSA/caption
                  // grammar (Name · Set) — never greedy per-token OCR names.
                  const fromRegion = item.label.includes("caption")
                    ? null
                    : parseOcrText(recognition.text, {
                        region: slice.label,
                      });
                  const merged = mergeParsedOcrText([parsedLabel, fromRegion]);
                  if (merged?.nameCandidates.length || merged?.number || merged?.setHints?.length) {
                    parts.push(merged);
                  }
                  const combined = mergeParsedOcrText(parts);
                  if (combined?.nameCandidates.length && combined.number) {
                    return combined;
                  }
                }
              }
              return mergeParsedOcrText(parts);
            })()
          : Promise.resolve(null);

        let hashResult = await hashSearchPromise;
        const perVariantHashResults = await perVariantHashPromise;
        const sourceVotes = tallyVisualSourceVotes(
          perVariantHashResults.map((entry) => ({
            role: entry.fingerprint.role,
            hits: entry.result.hits,
          })),
        );
        const rankedSourceVariants = [...perVariantHashResults].sort((left, right) =>
          compareVisualSourceVariants(
            { role: left.fingerprint.role, hits: left.result.hits },
            { role: right.fingerprint.role, hits: right.result.hits },
            sourceVotes,
          ),
        );
        const bestSourceFingerprint =
          rankedSourceVariants[0]?.fingerprint ?? sourceFingerprints[0];
        if (bestSourceFingerprint?.hashes[0]) {
          photoHash = bestSourceFingerprint.hashes[0];
          hashKey = photoHash.toString();
        }
        if (scanDebugRef.current) {
          scanDebugRef.current.retrieval.dHashCandidates = hashResult.hits
            .slice(0, 20)
            .map((hit) => debugCandidateFromHit(hit, "dhash"));
          scanDebugRef.current.notes.push(
            `Crop selected by dHash: ${bestSourceFingerprint?.label ?? "primary"}.`,
          );
        }
        const hashFastThreshold = fastHashMatchThreshold(options);
        if (
          !nestedScreenshot &&
          !options.manualCrop &&
          !options.alreadyRectified &&
          !isDecisiveVisualResult(
            hashResult.hits,
            hashFastThreshold,
          )
        ) {
          setStatusText("Checking card rotation…");
          const rotationHashes = await collectRotationHashes(unalignedSource);
          if (rotationHashes.length) {
            const rotationResult = await bestVisualSearchByHashes(
              rotationHashes,
              null,
            );
            if (
              (rotationResult.hits[0]?.score ?? 0) >
              (hashResult.hits[0]?.score ?? 0) + 0.04
            ) {
              hashResult = rotationResult;
              if (scanDebugRef.current) {
                scanDebugRef.current.retrieval.dHashCandidates = rotationResult.hits
                  .slice(0, 20)
                  .map((hit) => debugCandidateFromHit(hit, "dhash-rotation"));
                scanDebugRef.current.notes.push(
                  "Rotation recovery produced the strongest dHash result.",
                );
              }
            }
          }
        }
        setProgress(40);

        const psaLabel = await psaLabelPromise;
        if (psaLabel?.nameCandidates.length) {
          const psaLanguageHints = inferLanguageHints(
            inferScriptHint(psaLabel.lines.join("\n")),
            psaLabel.lines.join("\n"),
          );
          const psaIdentity = buildScanTextIdentity({
            parsed: psaLabel,
            languageHints: psaLanguageHints,
          });
          scanDebugRef.current?.notes.push(
            `PSA/text identity: ${psaIdentity.names.slice(0, 3).join(", ")}${
              psaIdentity.number ? ` #${psaIdentity.number}` : ""
            }${
              psaIdentity.setCodes[0]
                ? ` [${psaIdentity.setCodes[0]}]`
                : psaIdentity.setHints[0]
                  ? ` (${psaIdentity.setHints[0]})`
                  : ""
            }.`,
          );
          if (isActionableTextIdentity(psaIdentity)) {
            setStatusText("Matching label text to the catalog…");
            setProgress(72);
            let textMatches = await resolveMatchesFromTextIdentity(psaIdentity, {
              onProgress: (label, fraction) => {
                setStatusText(label);
                setProgress(72 + Math.round(fraction * 18));
              },
            });
            // Prefer art confirmation among text shortlist when available, but
            // never require the visual index for a name+#number print.
            if (textMatches.length > 1) {
              const photoVector = await embedPromise;
              photoSignatureRef.current = {
                hash: photoHash,
                vector: photoVector,
              };
              if (photoVector || photoHash) {
                const reranked = await withFallbackBudget(
                  rankByVisualSimilarity(
                    { hash: photoHash, vector: photoVector },
                    textMatches.map((match) => match.result),
                    { neural: Boolean(photoVector) },
                  ),
                  [],
                  MANUAL_CROP_RERANK_BUDGET_MS,
                );
                if (reranked.length) {
                  // Keep text score floor so a weak art collision can't demote a
                  // perfect name+#number identity below display threshold.
                  textMatches = reranked.map((match) => {
                    const textScore =
                      textMatches.find(
                        (entry) =>
                          entry.result.card.slug === match.result.card.slug,
                      )?.visualScore ?? 0.7;
                    return {
                      ...match,
                      visualScore: Math.max(match.visualScore, textScore),
                    };
                  });
                }
              }
            } else {
              photoSignatureRef.current = { hash: photoHash, vector: null };
            }

            const top = textMatches[0];
            const topScores = top
              ? scoreCatalogAgainstTextIdentity(psaIdentity, top.result)
              : null;
            const filtered = filterConfidentMatches(textMatches);
            if (
              filtered.length &&
              topScores &&
              (isResolvedTextIdentity(psaIdentity, topScores) ||
                topScores.total >= 0.8)
            ) {
              void embedPromise;
              setConfident(isResolvedTextIdentity(psaIdentity, topScores));
              setNotice(
                isResolvedTextIdentity(psaIdentity, topScores)
                  ? null
                  : "Matched from printed text — confirm the exact print if needed.",
              );
              finishVisualMatches(filtered, filtered[0].visualScore);
              return;
            }
          }
        }

        const indexReady = hashResult.ready || hashResult.size > 0;
        const hashTopScore = hashResult.hits[0]?.score ?? 0;
        // Rectified / manual cutouts can finish on a decisive hash even when
        // verifyText was requested — waiting on CLIP+OCR just to confirm a
        // 0.9+ catalog identity is what made slab crops feel stuck.
        if (
          !nestedScreenshot &&
          (!options.verifyText || options.alreadyRectified || options.manualCrop) &&
          !debugEnabled &&
          isDecisiveVisualResult(
            hashResult.hits,
            hashFastThreshold,
          )
        ) {
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
            void primaryOcrPromise;
            finishVisualMatches(ranked, hashTopScore);
            return;
          }
        }

        // 2) Optional CLIP pass — skip waiting when the catalog isn't loaded.
        let photoVector: Float32Array | null = null;
        let indexHits = hashResult.hits;
        let directMatches = hashResult.directMatches;
        let method: "neural" | "phash" = "phash";
        const bestEmbedPromise =
          bestSourceFingerprint && bestSourceFingerprint.source !== sourceForMatch
            ? downscaleImage(bestSourceFingerprint.source, 640, 0.92).then((image) =>
                embedImageWithBudget(
                  image,
                  undefined,
                  embedBudgetMs,
                ),
              )
            : embedPromise;

        if (indexReady && !nestedScreenshot) {
          setStatusText("Recognizing artwork…");
          photoVector = await bestEmbedPromise;
          setProgress(55);
          if (photoVector) {
            setStatusText("Matching artwork to the catalog…");
            const neuralResult = await visualSearch({
              hash: hashKey,
              hashes: photoHashes.filter((hash) => hash !== 0n).slice(0, 4).map(String),
              workGray,
              embedding: photoVector,
            });
            if (scanDebugRef.current) {
              scanDebugRef.current.retrieval.clipCandidates = neuralResult.hits
                .slice(0, 20)
                .map((hit) => debugCandidateFromHit(hit, "clip"));
            }
            const neuralTopScore = neuralResult.hits[0]?.score ?? 0;
            const currentTopScore = indexHits[0]?.score ?? 0;
            const fusedHits = fuseHashAndNeuralHits(
              hashResult.hits,
              neuralResult.hits,
              24,
            );
            if (fusedHits.length) {
              indexHits = fusedHits;
              directMatches = mergeSearchResults(
                [directMatches, neuralResult.directMatches],
                24,
              );
              method =
                indexHits[0]?.id === hashResult.hits[0]?.id
                  ? "phash"
                  : neuralTopScore >= currentTopScore && neuralResult.hits.length
                    ? "neural"
                    : "phash";
            }
          }
        } else {
          void embedPromise;
        }

        const signature: PhotoSignature = { hash: photoHash, vector: photoVector };
        photoSignatureRef.current = signature;
        setProgress(70);

        const topVisualScore = indexHits[0]?.score ?? 0;
        if (
          !nestedScreenshot &&
          !options.verifyText &&
          !debugEnabled &&
          isDecisiveVisualResult(
            indexHits,
            SKIP_OCR_VISUAL_THRESHOLD,
          )
        ) {
          const ranked = filterConfidentMatches(
            rankedFromDirectOrHits(directMatches, indexHits, method),
          );
          if (ranked.length) {
            void primaryOcrPromise;
            finishVisualMatches(ranked, topVisualScore);
            return;
          }
        }

        // 3) OCR when visual matching is weak/missing (often already warm).
        setStatusText("Reading the card…");
        const ocrSourceFingerprints = Array.from(
          new Map(
            [
              ...rankedSourceVariants.map((entry) => entry.fingerprint),
              ...sourceFingerprints,
            ]
              .filter((fingerprint) =>
                options.manualCrop || nestedScreenshot
                  ? fingerprint.role !== "legacy"
                  : true,
              )
              .map((fingerprint) => [fingerprint.source, fingerprint]),
          ).values(),
        ).slice(0, nestedScreenshot || options.manualCrop ? 1 : options.verifyText ? 3 : 2);
        const ocrSliceGroups = await Promise.all(
          ocrSourceFingerprints.map(async (fingerprint) => ({
            sourceLabel: fingerprint.label,
            slices:
              fingerprint.source === sourceForMatch
                ? await primaryOcrPromise
                : await buildOcrImageSlices(fingerprint.source, {
                    includePsaLabel:
                      includePsaLabel && fingerprint.role !== "legacy",
                  }),
          })),
        );
        type LabeledOcrSlice =
          (typeof ocrSliceGroups)[number]["slices"][number] & {
            sourceLabel: string;
          };
        const ocrSlices: LabeledOcrSlice[] = [];
        const deferredSlices: LabeledOcrSlice[] = [];
        for (const group of ocrSliceGroups) {
          const labeled = group.slices.map((slice) => ({
            ...slice,
            sourceLabel: group.sourceLabel,
          }));
          // Identity-critical work from the strongest crop stays contiguous:
          // one name band, then left/right collector-number bands. Remaining
          // preprocessing and rotations run only if the budget allows.
          ocrSlices.push(...labeled.slice(0, nestedScreenshot ? 5 : 3));
          deferredSlices.push(...labeled.slice(3));
        }
        if (!nestedScreenshot) {
          ocrSlices.push(...deferredSlices);
        }
        const ocrEvidence: OcrTextEvidence[] = [];
        const processedOcrSources = new Set<string>();
        const ocrDeadline =
          Date.now() +
          (nestedScreenshot
            ? NESTED_SCREENSHOT_OCR_BUDGET_MS
            : options.manualCrop
              ? Math.min(OCR_BUDGET_MS, 7_000)
              : OCR_BUDGET_MS);
        for (const slice of ocrSlices) {
          if (Date.now() > ocrDeadline) {
            break;
          }
          let recognitionTimedOut = false;
          const recognition = await Promise.race([
            runOcr(
              slice.image,
              slice.region === "footer"
                ? {
                    pageSegmentationMode: "11",
                    characterWhitelist:
                      "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#-",
                  }
                : slice.region === "header" || slice.region === "hp"
                  ? { pageSegmentationMode: "11" }
                  : { pageSegmentationMode: "3" },
            ),
            new Promise<OcrRecognitionResult>((resolve) => {
              window.setTimeout(() => {
                recognitionTimedOut = true;
                resolve({ text: "", confidence: null });
              }, Math.max(500, ocrDeadline - Date.now()));
            }),
          ]);
          if (recognitionTimedOut) {
            // An abandoned queued recognition otherwise blocks every later
            // fixture and can emit stale progress into the next scan.
            await terminateOcrWorker().catch(() => undefined);
          }
          const text = recognition.text;
          const parsedSlice = parseOcrText(text, { region: slice.region });
          const nativeConfidence =
            recognition.confidence == null
              ? null
              : Math.max(0, Math.min(1, recognition.confidence / 100));
          const evidenceConfidence =
            nativeConfidence ?? regionConfidence(slice.region);
          processedOcrSources.add(slice.sourceLabel);
          if (scanDebugRef.current) {
            const collector = parsedSlice.number
              ? parseCollectorNumber(parsedSlice.number)
              : null;
            scanDebugRef.current.ocrSlices.push({
              text,
              normalizedText: normalizedOcrDebugText(text),
              confidence: nativeConfidence,
              region: `${slice.sourceLabel}:${slice.region}`,
              rotation: slice.rotation,
              preprocessing: JSON.stringify(slice.preprocessing),
              parsedCollector: collector
                ? {
                    raw: collector.raw,
                    primary: collector.primary ?? null,
                    denominator: collector.denominator ?? null,
                    prefix: collector.prefix ?? null,
                    confidence: nativeConfidence,
                  }
                : null,
            });
          }
          if (!text) {
            if (recognitionTimedOut) break;
            continue;
          }
          ocrEvidence.push({
            text,
            region: slice.region,
            confidence: evidenceConfidence,
            rotation: slice.rotation,
            nameCandidates: parsedSlice.nameCandidates,
            number: parsedSlice.number,
            suffix: parsedSlice.suffix,
          });
          const hasHeaderName = ocrEvidence.some(
            (item) => item.region === "header" && item.nameCandidates.length,
          );
          const hasNumber = ocrEvidence.some((item) => item.number);
          if (
            hasHeaderName &&
            hasNumber &&
            processedOcrSources.size >= Math.min(2, ocrSourceFingerprints.length)
          ) {
            break;
          }
        }

        const headerEvidence = ocrEvidence.filter((item) => item.region === "header");
        const footerEvidence = ocrEvidence.filter((item) => item.region === "footer");
        const fullEvidence = ocrEvidence.filter((item) => item.region === "full");
        const mergedNames = mergeOcrNameCandidates(ocrEvidence);
        const strongest = (items: OcrTextEvidence[], field: "number" | "suffix") =>
          [...items]
            .filter((item) => Boolean(item[field]))
            .sort((left, right) => right.confidence - left.confidence)[0]?.[field];
        const parsed: ParsedOcrText = {
          nameCandidates: Array.from(
            new Set([
              ...(psaLabel?.nameCandidates ?? []),
              ...mergedNames,
            ]),
          ),
          number:
            strongest(footerEvidence, "number") ??
            strongest(headerEvidence, "number") ??
            strongest(fullEvidence, "number") ??
            psaLabel?.number,
          suffix:
            strongest(headerEvidence, "suffix") ??
            strongest(fullEvidence, "suffix") ??
            psaLabel?.suffix,
          lines: [
            ...(psaLabel?.lines ?? []),
            ...ocrEvidence.flatMap((item) => item.text.split(/\r?\n/)).filter(Boolean),
          ],
          setHints: psaLabel?.setHints,
          setCodes: psaLabel?.setCodes,
        };
        const ocrBlob = [
          ...(psaLabel?.lines ?? []),
          ...ocrEvidence.map((item) => item.text),
        ].join("\n");
        const scriptHint = inferScriptHint(ocrBlob);
        const languageHints = inferLanguageHints(scriptHint, ocrBlob);

        setStatusText("Matching to the catalog…");
        setProgress(78);

        const nestedLetterTokens = nestedScreenshot
          ? Array.from(
              new Set(ocrBlob.match(/[A-Za-z]{6,14}/g) ?? []),
            )
          : [];
        const ocrNameCandidates = Array.from(
          new Set(
            [
              ...parsed.nameCandidates,
              ...nestedLetterTokens,
              parsed.suffix && parsed.nameCandidates[0]
                ? `${parsed.nameCandidates[0]} ${parsed.suffix}`
                : null,
            ].filter((value): value is string => Boolean(value)),
          ),
        );
        if (nestedScreenshot && ocrNameCandidates.length > 1) {
          const nestedNamePriority = (name: string) => {
            if (/^[A-Z][a-z]{4,}$/.test(name) || /^[a-z]{5,}$/.test(name)) return 0;
            if (/^[A-Za-z]+$/.test(name)) return 1;
            return 2;
          };
          ocrNameCandidates.sort(
            (left, right) => nestedNamePriority(left) - nestedNamePriority(right),
          );
        }

        const nestedNameConfirmed =
          nestedScreenshot
            ? await confirmName(
                Array.from(
                  new Set([
                    ...ocrNameCandidates,
                    ...ocrBlob
                      .split(/[^\p{L}]+/u)
                      .filter((token) => token.length >= 5 && token.length <= 16),
                  ]),
                ).slice(0, 6),
              )
            : null;
        if (
          nestedNameConfirmed &&
          nestedNameConfirmed.score >= NAME_MATCH_THRESHOLD
        ) {
          ocrNameCandidates.unshift(nestedNameConfirmed.name);
          scanDebugRef.current?.notes.push(
            `Nested name DB match: ${nestedNameConfirmed.name} (${nestedNameConfirmed.score.toFixed(3)}).`,
          );
        }

        // Text-first catalog resolve: works even when the card art was never
        // hashed into the visual index (common for JP SWSH CSRs / older slabs).
        const cardTextIdentity = buildScanTextIdentity({
          parsed:
            nestedNameConfirmed && nestedNameConfirmed.score >= NAME_MATCH_THRESHOLD
              ? {
                  ...parsed,
                  nameCandidates: [
                    nestedNameConfirmed.name,
                    ...parsed.nameCandidates,
                  ],
                }
              : parsed,
          languageHints,
          extraNames: ocrNameCandidates,
          extraLines: nestedScreenshot ? parsed.lines : psaLabel?.lines,
        });
        if (
          isActionableTextIdentity(cardTextIdentity) &&
          (options.manualCrop ||
            options.includePsaLabel ||
            options.verifyText ||
            topVisualScore < DIRECT_VISUAL_MATCH_THRESHOLD)
        ) {
          setStatusText("Matching printed name & number…");
          setProgress(80);
          const textMatches = await resolveMatchesFromTextIdentity(
            cardTextIdentity,
            {
              onProgress: (label, fraction) => {
                setStatusText(label);
                setProgress(80 + Math.round(fraction * 12));
              },
            },
          );
          const top = textMatches[0];
          const topScores = top
            ? scoreCatalogAgainstTextIdentity(cardTextIdentity, top.result)
            : null;
          if (
            top &&
            topScores &&
            (isResolvedTextIdentity(cardTextIdentity, topScores) ||
              (topScores.nameScore >= 0.9 && topScores.total >= 0.78) ||
              (nestedScreenshot && topScores.nameScore >= 0.85))
          ) {
            scanDebugRef.current?.notes.push(
              `Text-first catalog match: ${top.result.card.name} #${top.result.card.collectorNumber} (${topScores.total.toFixed(3)}).`,
            );
            // Optional art re-rank among text shortlist only — never block on index.
            let ranked = textMatches;
            if (textMatches.length > 1 && signature.vector) {
              const reranked = await withFallbackBudget(
                rankByVisualSimilarity(signature, textMatches.map((m) => m.result), {
                  neural: true,
                }),
                [],
                MANUAL_CROP_RERANK_BUDGET_MS,
              );
              if (reranked.length) {
                ranked = reranked.map((match) => {
                  const textScore =
                    textMatches.find(
                      (entry) =>
                        entry.result.card.slug === match.result.card.slug,
                    )?.visualScore ?? 0.7;
                  return {
                    ...match,
                    visualScore: Math.max(match.visualScore, textScore),
                  };
                });
              }
            }
            const named = nestedScreenshot
              ? ranked.filter(
                  (match) =>
                    scoreCatalogAgainstTextIdentity(cardTextIdentity, match.result)
                      .nameScore >= 0.85,
                )
              : ranked;
            const filtered = nestedScreenshot
              ? named.slice(0, 8)
              : filterConfidentMatches(named);
            if (filtered.length) {
              setConfident(isResolvedTextIdentity(cardTextIdentity, topScores));
              setGuess({
                name: filtered[0].result.card.englishName ?? filtered[0].result.card.name,
                number: filtered[0].result.card.collectorNumber,
                confidence: filtered[0].visualScore,
                language: languageHints[0],
                source: "ocr",
              });
              finishVisualMatches(
                filtered,
                filtered[0].visualScore,
                nestedScreenshot && !isResolvedTextIdentity(cardTextIdentity, topScores)
                  ? "Read the printed name — tap the matching print."
                  : undefined,
              );
              return;
            }
          }
        }

        if (nestedScreenshot) {
          scanDebugRef.current?.notes.push(
            "Nested screenshot: no readable card name; refusing artwork collisions.",
          );
          finishVisualMatches(
            [],
            0,
            "Couldn't read the card in this screenshot. Crop tighter around the card, then scan.",
          );
          return;
        }

        // Card-era names such as "Dark Charizard" are not species aliases, but
        // they are exact identities in the visual catalog. Resolve those before
        // fuzzy species matching so clear camera OCR cannot become Wailord.
        const identityResult = await visualSearch({
          hash: hashKey,
          hashes: photoHashes.filter((hash) => hash !== 0n).slice(0, 4).map(String),
          workGray,
          embedding: null,
          names: ocrNameCandidates,
          collectorNumber: parsed.number,
          languageHints,
          scriptHint,
        });
        if (scanDebugRef.current) {
          scanDebugRef.current.retrieval.exactNameCandidates =
            identityResult.identityHits
              .slice(0, 20)
              .map((hit) => debugCandidateFromHit(hit, "exact-name"));
          scanDebugRef.current.retrieval.nameAndNumberCandidates =
            identityResult.identityHits
              .filter((hit) => hit.score >= 0.9)
              .slice(0, 20)
              .map((hit) => debugCandidateFromHit(hit, "name-and-number"));
        }
        // Prefer resolved / name+number identity hits over bare exact-name rows.
        const identityHit =
          identityResult.identityHits.find((hit) => hit.score >= 0.9) ??
          identityResult.identityHits[0] ??
          null;
        const nameDbConfirmed = identityHit
          ? { name: identityHit.name, score: identityHit.score }
          : await confirmName(ocrNameCandidates);
        // Text is a tie-breaker only: retain meaningful visual-score leads, but
        // resolve dHash collisions such as Mewtwo/Dark Charizard using the
        // clearly printed name or social caption.
        indexHits = rankVisualTiesWithOcr(indexHits, ocrNameCandidates);
        const confirmed =
          nameDbConfirmed ??
          confirmIdentityFromVisualHits(indexHits, ocrNameCandidates);
        const localIdentityMatches = directMatchesForIdentity(
          directMatches,
          indexHits,
          confirmed,
          method,
        );
        const catalogIdentityMatches = identityResult.identityMatches.map((result) => ({
          result,
          visualScore: result.score,
          method,
        })) satisfies ScanMatch[];

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

        const trustedConfirmed =
          confirmed && confirmed.score >= 0.9 ? confirmed : null;
        const strongHit =
          indexHits.find((hit) => hit.score >= DIRECT_VISUAL_MATCH_THRESHOLD) ?? null;
        const visualHit = indexHits[0] ?? null;
        // A validated printed name beats weak/ambiguous hash collisions from a
        // rotated slab. Decisive visual matches already returned before OCR.
        const detectedGuess: ScanCardGuess | null = trustedConfirmed
          ? {
              name: trustedConfirmed.name,
              number: parsed.number,
              suffix: parsed.suffix,
              confidence: trustedConfirmed.score,
              language: languageHints[0],
              source: "ocr",
            }
          : strongHit
          ? {
              name: strongHit.name,
              number: strongHit.localId || parsed.number,
              confidence: strongHit.score,
              language: languageHints[0],
              source: "ocr",
            }
          : confirmed
            ? {
                name: confirmed.name,
                number: parsed.number,
                suffix: parsed.suffix,
                confidence: parsed.number ? 0.85 : 0.6,
                language: languageHints[0],
                source: "ocr",
              }
            : visualHit
              ? {
                  name: visualHit.name,
                  number: visualHit.localId || parsed.number,
                  confidence: visualHit.score,
                  language: languageHints[0],
                  source: "ocr",
                }
              : null;
        setGuess(detectedGuess);

        const candidates = await gatherCandidates(confirmed, parsed, indexHits, {
          languageHints,
          setCodes: cardTextIdentity.setCodes,
          setHints: cardTextIdentity.setHints,
        });
        if (scanDebugRef.current) {
          scanDebugRef.current.retrieval.liveSearchCandidates = candidates
            .slice(0, 20)
            .map((result) => debugCandidateFromResult(result, "candidate-pool"));
        }

        let ranked: ScanMatch[] = [];
        if (candidates.length) {
          setStatusText("Comparing artwork…");
          ranked = await withFallbackBudget(
            rankByVisualSimilarity(signature, candidates, {
              neural: Boolean(signature.vector),
              onProgress: (done, total) => {
                setProgress(82 + Math.round((done / Math.max(1, total)) * 16));
              },
            }),
            [],
            options.manualCrop || options.alreadyRectified
              ? MANUAL_CROP_RERANK_BUDGET_MS
              : CANDIDATE_RERANK_BUDGET_MS,
            () => {
              scanDebugRef.current?.notes.push(
                "Candidate artwork rerank timed out; retained server index evidence.",
              );
            },
          );
        }
        // Preserve the server index's exact visual evidence even if a later
        // client-side signature pass used an unaligned fallback crop. This is
        // especially important when rotation recovery found the winning hash.
        const indexEvidenceMatches = rankedFromDirectOrHits(
          directMatches,
          indexHits,
          method,
          INDEX_SEED_MIN_SCORE,
        );
        for (const indexMatch of indexEvidenceMatches) {
          const existingIndex = ranked.findIndex(
            (entry) => entry.result.card.slug === indexMatch.result.card.slug,
          );
          if (existingIndex < 0) {
            ranked.push(indexMatch);
            continue;
          }
          const existing = ranked[existingIndex];
          if (indexMatch.visualScore > existing.visualScore) {
            ranked[existingIndex] = indexMatch;
          }
        }
        // Memory is genuine image similarity, but it is only one input to
        // evidence fusion. Never prepend/sort it after collector/language
        // agreement has been evaluated.
        const memory = await withFallbackBudget(
          recallBestMemory(signature),
          null,
          MEMORY_RECALL_BUDGET_MS,
          () => {
            scanDebugRef.current?.notes.push(
              "Remembered-scan lookup timed out and was skipped.",
            );
          },
        );
        if (memory && memory.score >= MIN_DISPLAY_VISUAL_SCORE) {
          const rememberedIndex = ranked.findIndex(
            (entry) => entry.result.card.slug === memory.slug,
          );
          if (rememberedIndex >= 0) {
            ranked = ranked.map((entry, index) =>
              index === rememberedIndex
                ? {
                    ...entry,
                    visualScore: Math.max(entry.visualScore, memory.score),
                    method:
                      memory.score > entry.visualScore
                        ? memory.method
                        : entry.method,
                  }
                : entry,
            );
          } else {
            const remembered = await fetchCardResult(memory.slug);
            if (remembered) {
              ranked.push({
                result: remembered,
                visualScore: memory.score,
                method: memory.method,
              });
            }
          }
          scanDebugRef.current?.notes.push(
            `Memory evidence included without forced promotion (${memory.method}, ${memory.score.toFixed(3)}).`,
          );
        }
        // Fuse visual + OCR/catalog evidence. Exact name alone reranks; only
        // name+number+(language|strong visual) may override artwork order.
        const fusedEntries = fuseScanCandidateEvidence({
          visualRanked: ranked,
          identityMatches: [...catalogIdentityMatches, ...localIdentityMatches],
          ocrNames: ocrNameCandidates,
          collectorNumber: parsed.number,
          languageHints,
          scriptHint,
          geometryQuality: cropQualityRef.current?.confidence ?? 0.55,
          method,
        });
        ranked = fusedEntries.map((entry) => entry.match);

        // If OCR/live-search produced nothing, still surface strong visual hits.
        if (!ranked.length && indexHits.length) {
          ranked = rankedFromDirectOrHits(
            directMatches,
            indexHits,
            method,
            INDEX_SEED_MIN_SCORE,
          );
        }

        const agreement = agreementConfidence({
          top: ranked[0],
          visualTop: visualHit,
          identityTop: identityHit,
          ocrNames: ocrNameCandidates,
          collectorNumber: parsed.number,
          languageHints,
          scriptHint,
        });
        setConfident(agreement.confident);
        if (agreement.notice) {
          setNotice(agreement.notice);
        } else if (
          agreement.level === "possible" &&
          ranked.length > 1
        ) {
          setNotice("Possible matches — review the top candidates.");
        }

        ranked = filterConfidentMatches(ranked);
        const unknownWeakCrop =
          scanDiagnosticsRef.current?.inputType === "unknown" &&
          !cropAutoDetectedRef.current &&
          !cropTouchedRef.current &&
          (ranked[0]?.visualScore ?? 0) < 0.88;
        if (unknownWeakCrop) {
          ranked = [];
          scanDebugRef.current?.notes.push(
            "Unknown non-card scene: default crop discarded before display.",
          );
        }
        if (unknownWeakCrop) {
          ranked = [];
          scanDebugRef.current?.notes.push(
            "Unknown non-card scene: weak crop discarded before display.",
          );
        }
        if (ranked.length) {
          setGuess({
            name: ranked[0].result.card.englishName ?? ranked[0].result.card.name,
            number: ranked[0].result.card.collectorNumber,
            confidence: ranked[0].visualScore,
            language: ranked[0].result.card.language,
            source: "ocr",
          });
        }
        if (scanDebugRef.current) {
          const detailedBySlug = new Map(
            fusedEntries.map((entry) => [entry.match.result.card.slug, entry]),
          );
          // Benchmark the same candidates the user actually sees. Rejected
          // fused rows remain observable in per-method retrieval diagnostics.
          scanDebugRef.current.finalRanking = ranked.slice(0, 20).map((match) => {
            const entry = detailedBySlug.get(match.result.card.slug);
            if (!entry) return debugRankingFromMatch(match, "visual-fallback");
            return {
              ...debugCandidateFromResult(
                entry.match.result,
                "evidence-fusion",
                entry.evidence.finalScore,
              ),
              totalScore: entry.evidence.finalScore,
              components: {
                dHash:
                  entry.match.method === "phash"
                    ? entry.evidence.visualScore
                    : null,
                clip:
                  entry.match.method === "neural"
                    ? entry.evidence.clipScore
                    : null,
                exactName: entry.evidence.nameScore,
                collectorNumber: entry.evidence.collectorScore,
                language: entry.evidence.languageScore,
                set: null,
                cropQuality: entry.evidence.geometryQuality,
              },
              bonuses: { agreement: entry.evidence.agreementBonus },
              penalties: { conflict: entry.evidence.conflictPenalty },
            };
          });
        }
        setProgress(100);
        setMatches(ranked);
        if (!ranked.length) {
          setNotice(
            !indexReady
              ? "Card matching catalog isn't loaded on this server yet. Search by name below, or try again after the next deploy."
              : options.includePsaLabel || options.manualCrop
                ? "Couldn't find a confident match. Crop one slab including the PSA label (name + #number), or search by name below."
                : "Couldn't find a confident match. Crop tightly to the card edges (no black borders), or search by name below.",
          );
          setGuess(null);
        }
        syncDebugReport(true);
        setStage("results");
      } catch (error) {
        if (scanDebugRef.current) {
          scanDebugRef.current.notes.push(
            `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          syncDebugReport(true);
        }
        setNotice("Something went wrong while scanning. Please try again.");
        setStage("results");
      }
    },
    [finishVisualMatches, recallBestMemory, runOcr, syncDebugReport],
  );

  const onCapture = useCallback(
    async (
      event: React.ChangeEvent<HTMLInputElement>,
      sourceHint: ScanSourceHint,
    ) => {
      const file = fileFromEvent(event);
      if (!file) return;
      cropTouchedRef.current = false;
      cropAutoDetectedRef.current = false;
      cropQualityRef.current = null;
      scanDiagnosticsRef.current = null;
      const dataUrl = await fileToOrientedDataUrl(file);
      captureSourceHintRef.current = sourceHint;
      // Auto-trim black canvas padding common on digital card shares.
      const trimmed = await trimLetterboxBorders(dataUrl).catch(() => dataUrl);
      const img = await loadImageElement(trimmed).catch(() => null);
      const aspect = img && img.height ? img.width / img.height : CARD_ASPECT;
      const diagnostics = img
        ? classifyDecodedScanImage(img, { sourceHint })
        : null;
      scanDiagnosticsRef.current = diagnostics;
      // An upload that is already card-shaped (official catalog renders — no
      // background, no perspective) is edge-to-edge: default the frame to the
      // full image so the name bar and collector number aren't sliced off.
      const isFullBleedCard = Boolean(
        sourceHint === "upload" &&
          diagnostics &&
          (diagnostics.inputType === "digital" ||
            (diagnostics.fullBleedScore >= 0.74 &&
              diagnostics.cameraPhotoScore < 0.45)),
      );
      if (isScanDebugEnabled()) {
        const report = createScanDebugReport({
          classification: {
            inputType: diagnostics?.inputType ?? "unknown",
            fullBleedScore: diagnostics?.fullBleedScore ?? null,
            cameraPhotoScore: diagnostics?.cameraPhotoScore ?? null,
          },
          geometry: {
            autoDetected: false,
            quad: null,
            cropConfidence: null,
            aspectRatio: diagnostics?.aspectRatio ?? aspect,
            coverageRatio: diagnostics?.coverageRatio ?? null,
            sharpnessScore: diagnostics?.sharpnessScore ?? null,
          },
          imageVariants: {
            original: dataUrl,
            legacy: trimmed !== dataUrl ? trimmed : null,
          },
          notes: [
            `Capture source: ${sourceHint}.`,
            `Classifier: ${diagnostics?.inputType ?? "unknown"}.`,
          ],
        });
        scanDebugRef.current = report;
        setScanDebugReport(report);
      }
      // Otherwise default the crop box to a centered card-shaped region.
      const defaultW = isFullBleedCard ? 1 : Math.min(0.98, (0.92 * CARD_ASPECT) / aspect);
      const defaultH = Math.min(1, (defaultW * aspect) / CARD_ASPECT);
      const left = (1 - defaultW) / 2;
      const top = (1 - defaultH) / 2;
      let initialQuad: PerspectiveQuad = [
        { x: left, y: top },
        { x: left + defaultW, y: top },
        { x: left + defaultW, y: top + defaultH },
        { x: left, y: top + defaultH },
      ];
      let autoDetected = false;
      let cropNotice: string | null = null;
      // Camera / table photos: find the card and pre-place cutout handles so
      // Scan flattens to a clean card-only image like the demo.
      if (!isFullBleedCard) {
        const detected = await detectCardPerspectiveQuad(
          trimmed,
          diagnostics?.sharpnessScore,
        ).catch(() => null);
        if (detected) {
          initialQuad = detected.quad;
          cropQualityRef.current = detected.quality;
          const coverage = quadCoverage(detected.quad);
          const cropBox = boundingRectFromQuad(detected.quad);
          const scene = classifyScanScene({
            imageAspect: aspect,
            cropQuality: detected.quality,
            coverage,
            isFullBleed: false,
            cropTop: cropBox.top,
            cropBottom: cropBox.bottom,
          });
          // High confidence → auto-scan cutout. Medium → show handles but keep
          // full-image fallback. Low → do not silently trust the quad.
          if (detected.quality.confidence >= 0.55) {
            autoDetected = true;
          } else if (detected.quality.confidence >= 0.38) {
            autoDetected = true;
            cropNotice =
              "Crop looks uncertain — adjust the handles if the border looks off.";
          } else {
            cropQualityRef.current = null;
            cropNotice =
              "Couldn't lock a confident card cutout. Adjust the handles, then scan.";
          }
          if (scene === "slab") {
            cropNotice =
              cropNotice ??
              "Detected a graded slab — the PSA label is read from the original photo.";
          } else if (scene === "screenshot") {
            cropNotice =
              cropNotice ??
              (isNestedAppCard({
                coverage,
                cropTop: cropBox.top,
                cropBottom: cropBox.bottom,
              })
                ? "Detected a card inside a screenshot — only the nested card is read."
                : "Detected a screenshot — captions under the card are included.");
          }
        }
      } else {
        cropQualityRef.current = scoreCropQuality(initialQuad, {
          sharpnessScore: diagnostics?.sharpnessScore ?? 0.7,
          imageAspect: aspect,
        });
      }
      setRawImage(trimmed);
      setCropCorners(initialQuad);
      cropTouchedRef.current = false;
      cropAutoDetectedRef.current = autoDetected;
      if (scanDebugRef.current) {
        scanDebugRef.current.geometry = {
          autoDetected,
          quad: initialQuad,
          cropConfidence: cropQualityRef.current?.confidence ?? null,
          aspectRatio: diagnostics?.aspectRatio ?? aspect,
          coverageRatio: quadCoverage(initialQuad),
          sharpnessScore: diagnostics?.sharpnessScore ?? null,
        };
        scanDebugRef.current.imageVariants.quadOverlay = {
          label: "Detected quad overlay",
          src: await drawQuadOverlay(trimmed, initialQuad).catch(() => trimmed),
        };
        syncDebugReport();
      }
      setNotice(cropNotice);
      setStage("crop");
    },
    [syncDebugReport],
  );

  const onCornerPointerMove = useCallback(
    (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const container = cropContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const point = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
      setCropCorners((current) => {
        const next = current.map((corner) => ({ ...corner })) as PerspectiveQuad;
        next[index] = point;
        if (!isValidPerspectiveQuad(next)) return current;
        cropTouchedRef.current = true;
        return next;
      });
    },
    [],
  );

  const confirmCrop = useCallback(async () => {
    if (!rawImage) return;
    // Untouched digital / full-frame uploads keep the original so processImage
    // can run its own deskew. Auto-detected or manually adjusted corners are
    // projective cutouts — flatten them to a card-only image first.
    const shouldCutOut = cropTouchedRef.current || cropAutoDetectedRef.current;
    if (!shouldCutOut) {
      if (scanDebugRef.current) {
        scanDebugRef.current.imageVariants.rectified = {
          label: "Full-bleed input",
          src: rawImage,
        };
        syncDebugReport();
      }
      void processImage(rawImage, {
        verifyText: captureSourceHintRef.current === "camera",
        sourceHint: captureSourceHintRef.current,
        alreadyRectified: false,
      });
      return;
    }
    if (cropTouchedRef.current) {
      cropQualityRef.current = scoreCropQuality(cropCorners, {
        sharpnessScore: scanDiagnosticsRef.current?.sharpnessScore,
        imageAspect: scanDiagnosticsRef.current?.aspectRatio,
      });
    }
    const rectified = await rectifyPerspective(rawImage, cropCorners).catch(() => null);
    const manualCrop = cropTouchedRef.current;
    const inputType = scanDiagnosticsRef.current?.inputType;
    const coverage = quadCoverage(cropCorners);
    const imageAspect = scanDiagnosticsRef.current?.aspectRatio ?? 1;
    const cropBox = boundingRectFromQuad(cropCorners);
    const leftoverBottom = 1 - cropBox.bottom;
    const leftoverTop = cropBox.top;
    const nestedScreenshot = isNestedAppCard({
      coverage,
      cropTop: cropBox.top,
      cropBottom: cropBox.bottom,
    });
    const sceneKind = classifyScanScene({
      imageAspect,
      cropQuality: cropQualityRef.current,
      coverage,
      isFullBleed: false,
      cropTop: cropBox.top,
      cropBottom: cropBox.bottom,
    });
    const slabLike =
      !nestedScreenshot && (inputType === "slab" || sceneKind === "slab");
    const screenshotLike =
      nestedScreenshot ||
      inputType === "screenshot" ||
      sceneKind === "screenshot";
    // Nested in-banner cards: one rectified crop. Extra variants and the full
    // screenshot hash/OCR the clock, search bar, and logo grid.
    const variantQuads: Array<{
      label: string;
      role: ScanSourceVariant["role"];
      quad: PerspectiveQuad;
    }> = nestedScreenshot
      ? []
      : (
          manualCrop
            ? [
                {
                  label: "contracted-1pct",
                  role: "contracted" as const,
                  quad: scaleCardQuad(cropCorners, 0.99) as PerspectiveQuad,
                },
                {
                  label: "expanded-1pct",
                  role: "expanded" as const,
                  quad: scaleCardQuad(cropCorners, 1.01) as PerspectiveQuad,
                },
                {
                  label: "top-expanded",
                  role: "expanded" as const,
                  quad: adjustQuadTopEdge(cropCorners, -0.012) as PerspectiveQuad,
                },
              ]
            : [
                {
                  label: "expanded-1pct",
                  role: "expanded" as const,
                  quad: scaleCardQuad(cropCorners, 1.01) as PerspectiveQuad,
                },
                {
                  label: "expanded-2pct",
                  role: "expanded" as const,
                  quad: scaleCardQuad(cropCorners, 1.02) as PerspectiveQuad,
                },
                {
                  label: "contracted-1pct",
                  role: "contracted" as const,
                  quad: scaleCardQuad(cropCorners, 0.99) as PerspectiveQuad,
                },
                {
                  label: "contracted-2pct",
                  role: "contracted" as const,
                  quad: scaleCardQuad(cropCorners, 0.98) as PerspectiveQuad,
                },
                {
                  label: "contracted-3pct",
                  role: "contracted" as const,
                  quad: scaleCardQuad(cropCorners, 0.97) as PerspectiveQuad,
                },
                {
                  label: "contracted-4pct",
                  role: "contracted" as const,
                  quad: scaleCardQuad(cropCorners, 0.96) as PerspectiveQuad,
                },
                {
                  label: "top-expanded",
                  role: "expanded" as const,
                  quad: adjustQuadTopEdge(cropCorners, -0.012) as PerspectiveQuad,
                },
                {
                  label: "top-contracted",
                  role: "contracted" as const,
                  quad: adjustQuadTopEdge(cropCorners, 0.012) as PerspectiveQuad,
                },
              ]
        ).filter((variant) => isValidPerspectiveQuad(variant.quad));
    const alternateSources = (
      await Promise.all(
        variantQuads.map(async (variant) => {
          const source = await rectifyPerspective(rawImage, variant.quad).catch(
            () => null,
          );
          return source
            ? { label: variant.label, source, role: variant.role }
            : null;
        }),
      )
    ).filter((variant): variant is ScanSourceVariant => variant !== null);
    // Full-frame fallback helps auto-detect / camera glare. For a user-dragged
    // crop on a multi-slab photo it only adds noise and a long dead-end path.
    if (!manualCrop && !nestedScreenshot) {
      alternateSources.push({
        label: "legacy-original",
        source: rawImage,
        role: "legacy",
      });
    }
    if (scanDebugRef.current) {
      const expanded = alternateSources.find((variant) => variant.role === "expanded");
      const contracted = alternateSources.find(
        (variant) => variant.role === "contracted",
      );
      scanDebugRef.current.geometry = {
        ...scanDebugRef.current.geometry,
        autoDetected: cropAutoDetectedRef.current,
        quad: cropCorners,
        cropConfidence: cropQualityRef.current?.confidence ?? null,
        coverageRatio: coverage,
      };
      scanDebugRef.current.imageVariants.rectified = rectified
        ? { label: "Exact rectified crop", src: rectified }
        : null;
      scanDebugRef.current.imageVariants.expanded = expanded
        ? { label: expanded.label, src: expanded.source }
        : null;
      scanDebugRef.current.imageVariants.contracted = contracted
        ? { label: contracted.label, src: contracted.source }
        : null;
      scanDebugRef.current.imageVariants.legacy = nestedScreenshot
        ? null
        : {
            label: "Legacy full image",
            src: rawImage,
          };
      scanDebugRef.current.imageVariants.quadOverlay = {
        label: "Confirmed quad overlay",
        src: await drawQuadOverlay(rawImage, cropCorners).catch(() => rawImage),
      };
      if (nestedScreenshot) {
        scanDebugRef.current.notes.push(
          "Nested app-screenshot card: skip chrome OCR, CLIP, and full-frame hashes.",
        );
      }
      syncDebugReport();
    }
    const ocrAuxiliarySources: Array<{ label: string; source: string }> = [];
    if (slabLike) {
      const labelBox = slabLabelBoxFromQuad(cropCorners);
      if (labelBox) {
        const labelSource = await cropNormalizedRect(rawImage, labelBox);
        if (labelSource) {
          ocrAuxiliarySources.push({
            label: "psa-label-original",
            source: labelSource,
          });
        }
      }
    }
    if (
      screenshotLike &&
      !nestedScreenshot &&
      isSocialCaptionBand({
        leftoverBottom,
        leftoverTop,
        coverage,
        cropBottom: cropBox.bottom,
      })
    ) {
      const captionBox = screenshotCaptionBox(cropBox);
      if (captionBox) {
        const captionSource = await cropNormalizedRect(rawImage, captionBox);
        if (captionSource) {
          ocrAuxiliarySources.push({
            label: "screenshot-caption",
            source: captionSource,
          });
        }
      }
    }
    if (scanDebugRef.current && ocrAuxiliarySources.length) {
      scanDebugRef.current.notes.push(
        `OCR-only crops: ${ocrAuxiliarySources.map((item) => item.label).join(", ")}.`,
      );
      syncDebugReport();
    }
    void processImage(rectified ?? rawImage, {
      verifyText:
        captureSourceHintRef.current === "camera" || Boolean(rectified),
      alternateSources,
      sourceHint: captureSourceHintRef.current,
      alreadyRectified: Boolean(rectified),
      manualCrop,
      includePsaLabel:
        !nestedScreenshot &&
        (slabLike || (manualCrop && inputType !== "digital")),
      ocrAuxiliarySources,
      nestedScreenshot,
    });
  }, [cropCorners, processImage, rawImage, syncDebugReport]);

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
        onChange={(event) => void onCapture(event, "camera")}
      />
      {/* Photo library / file picker. */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void onCapture(event, "upload")}
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
                      Drag the corner handles to align with the card corners.
                      We’ll cut out and flatten the card before matching.
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
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      aria-hidden="true"
                    >
                      <path
                        d={`M0 0H100V100H0Z M${cropCorners
                          .map((point) => `${point.x * 100} ${point.y * 100}`)
                          .join("L")}Z`}
                        fill="rgba(0,0,0,0.48)"
                        fillRule="evenodd"
                      />
                      <polygon
                        points={cropCorners
                          .map((point) => `${point.x * 100},${point.y * 100}`)
                          .join(" ")}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="0.8"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    {cropCorners.map((point, index) => (
                      <button
                        key={index}
                        type="button"
                        aria-label={`Move card corner ${index + 1}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={(event) => onCornerPointerMove(index, event)}
                        onPointerUp={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                          }
                        }}
                        className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border-2 border-black bg-[var(--accent)] text-sm font-black text-black shadow-[0_2px_12px_rgba(0,0,0,0.8)]"
                        style={{
                          left: `${point.x * 100}%`,
                          top: `${point.y * 100}%`,
                        }}
                      >
                        {index + 1}
                      </button>
                    ))}
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
              <ScanDebugPanel report={scanDebugReport} />
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
