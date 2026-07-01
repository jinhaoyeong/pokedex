/**
 * Lightweight perceptual hashing (dHash) for near-duplicate image matching.
 * Pure browser canvas + math — no model, no network — so it always works as a
 * baseline visual matcher and as a fallback when the neural model is loading or
 * unavailable.
 */

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** Draw `source` into a tiny grayscale matrix for hashing. */
function toGrayscale(source: Drawable): number[] {
  const canvas = document.createElement("canvas");
  canvas.width = HASH_WIDTH;
  canvas.height = HASH_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return [];
  }
  ctx.drawImage(source, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const { data } = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT);
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma.
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}

/**
 * Compute a 64-bit difference hash. Each bit marks whether a pixel is brighter
 * than its right-hand neighbor, which is robust to brightness/contrast shifts.
 */
export function dHash(source: Drawable): bigint {
  const gray = toGrayscale(source);
  if (gray.length < HASH_WIDTH * HASH_HEIGHT) {
    return 0n;
  }
  let hash = 0n;
  let bit = 0n;
  for (let row = 0; row < HASH_HEIGHT; row += 1) {
    for (let col = 0; col < HASH_WIDTH - 1; col += 1) {
      const left = gray[row * HASH_WIDTH + col];
      const right = gray[row * HASH_WIDTH + col + 1];
      if (left > right) {
        hash |= 1n << bit;
      }
      bit += 1n;
    }
  }
  return hash;
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
