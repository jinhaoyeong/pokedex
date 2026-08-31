/**
 * Lightweight perceptual hashing (dHash) for near-duplicate image matching.
 * Pure browser canvas + math — no model, no network — so it always works as a
 * baseline visual matcher and as a fallback when the neural model is loading or
 * unavailable.
 */

import {
  DHASH_HEIGHT,
  DHASH_WIDTH,
  DHASH_WORK_HEIGHT,
  DHASH_WORK_WIDTH,
  compressHighlights,
  dHashFromGray9x8,
  dHashFromWorkGray,
  equalizeGray,
} from "@/lib/scan/dhash-core";

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** Draw `source` into a working-size grayscale matrix (72×64). */
export function toWorkGrayscale(source: Drawable): number[] {
  const canvas = document.createElement("canvas");
  canvas.width = DHASH_WORK_WIDTH;
  canvas.height = DHASH_WORK_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return [];
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, DHASH_WORK_WIDTH, DHASH_WORK_HEIGHT);
  const { data } = ctx.getImageData(0, 0, DHASH_WORK_WIDTH, DHASH_WORK_HEIGHT);
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma.
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}

/** Draw `source` into a tiny grayscale matrix for hashing. */
function toGrayscale(source: Drawable): number[] {
  const work = toWorkGrayscale(source);
  if (work.length < DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT) {
    return [];
  }
  // Match server/seed path: box-filter 72×64 → 9×8, then compare neighbors.
  const tiny: number[] = [];
  // Reuse dHashFromWorkGray's downscale by computing via shared helper.
  // Expose 9×8 through a one-off by hashing internals — keep a local downsample:
  const destW = DHASH_WIDTH;
  const destH = DHASH_HEIGHT;
  for (let y = 0; y < destH; y += 1) {
    const y0 = Math.floor((y * DHASH_WORK_HEIGHT) / destH);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * DHASH_WORK_HEIGHT) / destH));
    for (let x = 0; x < destW; x += 1) {
      const x0 = Math.floor((x * DHASH_WORK_WIDTH) / destW);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * DHASH_WORK_WIDTH) / destW));
      let sum = 0;
      let count = 0;
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          sum += work[py * DHASH_WORK_WIDTH + px] ?? 0;
          count += 1;
        }
      }
      tiny.push(count ? sum / count : 0);
    }
  }
  return tiny;
}

/**
 * Compute a 64-bit difference hash. Each bit marks whether a pixel is brighter
 * than its right-hand neighbor, which is robust to brightness/contrast shifts.
 */
export function dHash(source: Drawable): bigint {
  const work = toWorkGrayscale(source);
  if (work.length >= DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT) {
    return dHashFromWorkGray(work);
  }
  const gray = toGrayscale(source);
  if (gray.length < DHASH_WIDTH * DHASH_HEIGHT) {
    return 0n;
  }
  return dHashFromGray9x8(gray);
}

/**
 * Direct 9×8 canvas dHash. Matches the seed script's sharp 9×8 resize more
 * closely than the 72×64 box-filter path, so exact catalog PNGs score higher.
 */
export function dHash9x8(source: Drawable): bigint {
  const canvas = document.createElement("canvas");
  canvas.width = DHASH_WIDTH;
  canvas.height = DHASH_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return 0n;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, DHASH_WIDTH, DHASH_HEIGHT);
  const { data } = ctx.getImageData(0, 0, DHASH_WIDTH, DHASH_HEIGHT);
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return dHashFromGray9x8(gray);
}

/** Lighting-normalized dHash for scanner beds and phone auto-exposure. */
export function dHashEqualized(source: Drawable): bigint {
  const work = toWorkGrayscale(source);
  if (work.length < DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT) {
    return 0n;
  }
  return dHashFromWorkGray(equalizeGray(work));
}

/** Extra query hash that tamps down foil / plastic glare before dHash. */
export function dHashHighlightCompressed(source: Drawable, ceiling = 220): bigint {
  const work = toWorkGrayscale(source);
  if (work.length < DHASH_WORK_WIDTH * DHASH_WORK_HEIGHT) {
    return 0n;
  }
  return dHashFromWorkGray(compressHighlights(work, ceiling));
}

/** Population count of set bits in a 64-bit value. */
function popcount(value: bigint): number {
  let count = 0;
  let v = value;
  while (v > 0n) {
    count += Number(v & 1n);
    v >>= 1n;
  }
  return count;
}

/** Hamming distance (0-64) between two dHashes. */
export function hamming(a: bigint, b: bigint): number {
  return popcount(a ^ b);
}

/** Visual similarity in [0,1] derived from two dHashes (1 = identical). */
export function hashSimilarity(a: bigint, b: bigint): number {
  if (a === 0n || b === 0n) {
    return 0;
  }
  return 1 - hamming(a, b) / 64;
}
