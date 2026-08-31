/**
 * Shared dHash bit-packing used by the browser scanner and the server
 * visual-search fingerprint path. Keep this in sync with
 * `scripts/seed-scan-index.mjs` (`left > right` comparisons).
 */

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;
/** Working size before the final 9×8 sample — closer to sharp's filter. */
export const DHASH_WORK_WIDTH = 72;
export const DHASH_WORK_HEIGHT = 64;
/**
 * Hamming radius for catalog dHash lookup. The old default of 32 (~50% of bits)
 * returns half the catalog as "matches" and drowns the real card in collisions.
 * Distance 16 ≈ 0.75 similarity — near-duplicates and clean scans still hit;
 * random 64-bit hashes (mean distance 32) do not.
 */
export const DHASH_MATCH_MAX_DISTANCE = 16;
/** CLIP cosine floor. Random pairs sit ~0.2–0.45; same-art scans are typically ≥0.70. */
export const CLIP_MATCH_MIN_SCORE = 0.66;

/** Box-filter a larger grayscale buffer down to 9×8. */
export function downscaleGrayBox(
  source: ArrayLike<number>,
  srcWidth: number,
  srcHeight: number,
  destWidth = DHASH_WIDTH,
  destHeight = DHASH_HEIGHT,
): number[] {
  const dest = new Array<number>(destWidth * destHeight);
  for (let y = 0; y < destHeight; y += 1) {
    const y0 = Math.floor((y * srcHeight) / destHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcHeight) / destHeight));
    for (let x = 0; x < destWidth; x += 1) {
      const x0 = Math.floor((x * srcWidth) / destWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcWidth) / destWidth));
      let sum = 0;
      let count = 0;
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          sum += source[py * srcWidth + px] ?? 0;
          count += 1;
        }
      }
      dest[y * destWidth + x] = count ? sum / count : 0;
    }
  }
  return dest;
}

/** Pack a 9×8 grayscale matrix into the catalog dHash bigint. */
export function dHashFromGray9x8(gray: ArrayLike<number>): bigint {
  if (gray.length < DHASH_WIDTH * DHASH_HEIGHT) {
    return 0n;
  }
  let hash = 0n;
  let bit = 0n;
  for (let row = 0; row < DHASH_HEIGHT; row += 1) {
    for (let col = 0; col < DHASH_WIDTH - 1; col += 1) {
      const left = gray[row * DHASH_WIDTH + col] ?? 0;
      const right = gray[row * DHASH_WIDTH + col + 1] ?? 0;
      if (left > right) {
        hash |= 1n << bit;
      }
      bit += 1n;
    }
  }
  return hash;
}

/** dHash from a working-size grayscale buffer (e.g. 72×64). */
export function dHashFromWorkGray(
  source: ArrayLike<number>,
  srcWidth = DHASH_WORK_WIDTH,
  srcHeight = DHASH_WORK_HEIGHT,
): bigint {
  if (source.length < srcWidth * srcHeight) {
    return 0n;
  }
  return dHashFromGray9x8(downscaleGrayBox(source, srcWidth, srcHeight));
}

/**
 * Histogram-equalize 0–255 luma so scanner / phone lighting shifts do not
 * flip dHash neighbor bits. Use as an extra query hash, not a replacement —
 * the catalog was hashed without equalization.
 */
export function equalizeGray(source: ArrayLike<number>): number[] {
  const length = source.length;
  const rounded = new Array<number>(length);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < length; i += 1) {
    const value = Math.max(0, Math.min(255, Math.round(Number(source[i]) || 0)));
    rounded[i] = value;
    hist[value] += 1;
  }

  const cdf = new Array<number>(256);
  let sum = 0;
  let cdfMin = 0;
  for (let i = 0; i < 256; i += 1) {
    if (hist[i] && cdfMin === 0) cdfMin = sum + hist[i];
    sum += hist[i];
    cdf[i] = sum;
  }
  const range = Math.max(1, length - cdfMin);
  const out = new Array<number>(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.round(((cdf[rounded[i]] - cdfMin) / range) * 255);
  }
  return out;
}

/**
 * Clamp specular highlights before hashing. Foil glare and slab plastic turn
 * large patches into 255, which flips neighbor bits versus catalog art.
 */
export function compressHighlights(
  source: ArrayLike<number>,
  ceiling = 220,
): number[] {
  const cap = Math.max(1, Math.min(255, ceiling));
  const out = new Array<number>(source.length);
  for (let i = 0; i < source.length; i += 1) {
    const value = Number(source[i]) || 0;
    out[i] = value > cap ? cap : value;
  }
  return out;
}
