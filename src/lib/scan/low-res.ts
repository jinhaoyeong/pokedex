import { CLIP_MATCH_MIN_SCORE_LOW_RES } from "@/lib/scan/dhash-core";

/**
 * Low-resolution / heavily compressed scan photos (chat shares, pixelated
 * camera thumbs). dHash against HD catalog art is noise on these — Hamming
 * distance to the true card is often worse than to a random lookalike.
 * CLIP + printed-name OCR are the usable signals.
 */

/** Longest side below this is treated as a low-res scan. */
export const LOW_RES_MAX_DIMENSION = 480;
/** Upscale target so CLIP (224px) and OCR see interpolated pixels, not blocks. */
export const LOW_RES_TARGET_DIMENSION = 720;
/** Slightly below the HD CLIP floor — same-art thumbs typically land 0.60–0.75. */
export const LOW_RES_CLIP_MIN_SCORE = CLIP_MATCH_MIN_SCORE_LOW_RES;
/** Display floor when OCR or CLIP agrees on a species. */
export const LOW_RES_DISPLAY_MIN_SCORE = 0.62;
/** Seed live-search from CLIP names at this score (HD uses a stricter 0.72). */
export const LOW_RES_INDEX_SEED_SCORE = 0.6;
/**
 * Camera photos of a blurry card are often 1080p+ so dimension checks miss them.
 * Laplacian sharpness below this is treated as the same low-quality path.
 */
export const LOW_QUALITY_SHARPNESS_MAX = 0.34;
/**
 * 4× block-average residual mapped to 0–1. Pixelated or heavily smoothed
 * photos reconstruct almost perfectly; sharp art does not.
 */
export const LOW_QUALITY_DEGRADATION_MIN = 0.68;

function lumaAt(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): number {
  const i = (y * width + x) * 4;
  return (
    0.299 * (pixels[i] ?? 0) +
    0.587 * (pixels[i + 1] ?? 0) +
    0.114 * (pixels[i + 2] ?? 0)
  );
}

/**
 * How much of the photo is already explained by 4×4 color blocks.
 * 1 = pixelated/blurred stamp; 0 = sharp high-frequency art.
 */
export function measureScanDegradation(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 16 || height < 16) return 1;
  if (pixels.length < width * height * 4) return 0;
  const factor = 4;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 24_000)));
  const insetX = Math.max(0, Math.floor(width * 0.12));
  const insetY = Math.max(0, Math.floor(height * 0.12));
  let sumAbs = 0;
  let count = 0;
  for (let y = insetY; y < height - insetY; y += step) {
    for (let x = insetX; x < width - insetX; x += step) {
      const bx = x - (x % factor);
      const by = y - (y % factor);
      let block = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const px = Math.min(width - 1, bx + dx);
          const py = Math.min(height - 1, by + dy);
          block += lumaAt(pixels, width, px, py);
          n += 1;
        }
      }
      sumAbs += Math.abs(lumaAt(pixels, width, x, y) - block / n);
      count += 1;
    }
  }
  if (!count) return 0;
  const meanAbs = sumAbs / count;
  return Math.max(0, Math.min(1, 1 - (meanAbs - 2) / 16));
}

export function isLowResolutionScan(width: number, height: number): boolean {
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);
  if (maxDim <= 0 || minDim <= 0) return false;
  if (maxDim < LOW_RES_MAX_DIMENSION) return true;
  // Wide chat screenshots of a single card can be just over 480 on one axis
  // while the card itself is still a tiny pixelated stamp.
  return maxDim < 640 && minDim < 320;
}

/**
 * Tiny uploads, blurry camera captures, and pixelated enlargements all need
 * the CLIP+OCR path — pixel count alone misses a 1080p photo of a soft card.
 */
export function isLowQualityScan(input: {
  width: number;
  height: number;
  sharpnessScore?: number | null;
  degradationScore?: number | null;
}): boolean {
  if (isLowResolutionScan(input.width, input.height)) return true;
  if (
    typeof input.sharpnessScore === "number" &&
    input.sharpnessScore < LOW_QUALITY_SHARPNESS_MAX
  ) {
    return true;
  }
  if (
    typeof input.degradationScore === "number" &&
    input.degradationScore >= LOW_QUALITY_DEGRADATION_MIN
  ) {
    return true;
  }
  return false;
}

/** Card-shaped thumbs should skip table-quad detection (it crops the name bar). */
export function isLowResCardShapedScan(
  width: number,
  height: number,
  cardAspect = 0.716,
): boolean {
  if (!isLowResolutionScan(width, height)) return false;
  const aspect = width / height;
  return Math.abs(aspect - cardAspect) / cardAspect <= 0.14;
}

/**
 * Pixelated dHash scores of 0.75–0.80 are usually collisions (Solgaleo, etc.).
 * Never send those hashes to catalog lookup; CLIP/OCR must lead.
 */
export function shouldQueryScanHash(lowResolution: boolean): boolean {
  return !lowResolution;
}

function speciesKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\b(?:ex|gx|vstar|vmax|tag team)\b/g, " ")
    .replace(/(?:^|\s)v(?:\s|$)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * Pixelated CLIP neighbors of different Pokemon all land in a 0.70–0.80 band.
 * Trust the cluster only when one species clearly leads.
 */
export function canTrustLowResClipIdentity(
  hits: Array<{ name: string; score: number }>,
): boolean {
  const top = hits[0];
  if (!top || top.score < 0.78) return false;
  const topKey = speciesKey(top.name);
  if (!topKey) return false;
  const rival = hits.find((hit) => {
    const key = speciesKey(hit.name);
    return key && key !== topKey && hit.score >= top.score - 0.07;
  });
  return !rival;
}

/** Seed live-search from visual names only when that identity is trustworthy. */
export function shouldSeedCatalogFromVisualHits(
  hits: Array<{ name: string; score: number }>,
  lowResolution: boolean,
  minScore: number,
): boolean {
  if (!hits[0] || hits[0].score < minScore) return false;
  if (!lowResolution) return true;
  return canTrustLowResClipIdentity(hits);
}
