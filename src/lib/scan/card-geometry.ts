export type CardFrameEstimate = {
  /** Clockwise canvas rotation, in radians, that makes the card upright. */
  rotation: number;
  /** Card center in sample-image coordinates. */
  centerX: number;
  centerY: number;
  /** Bounding dimensions in sample-image coordinates, before safety margin. */
  width: number;
  height: number;
  confidence: number;
};

const CARD_ASPECT = 0.716;

function quantile(sorted: number[], ratio: number): number {
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)),
  );
  return sorted[index] ?? 0;
}

/**
 * Locate a colorful, portrait card against a comparatively neutral background.
 * Rotation is searched explicitly rather than inferred with PCA: card artwork
 * is asymmetric, while its rotated rectangular footprint remains stable.
 */
export function estimateCardFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): CardFrameEstimate | null {
  if (width < 24 || height < 24 || pixels.length < width * height * 4) {
    return null;
  }

  const points: Array<[number, number]> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      if (high >= 70 && high - low >= 38) {
        points.push([x, y]);
      }
    }
  }

  const colorfulRatio = points.length / (width * height);
  if (colorfulRatio < 0.012 || colorfulRatio > 0.78) {
    return null;
  }

  let best:
    | {
        rotation: number;
        left: number;
        right: number;
        top: number;
        bottom: number;
        score: number;
      }
    | undefined;

  // Instagram photos and handheld captures are commonly tilted by up to 60°.
  for (let degrees = -60; degrees <= 60; degrees += 2) {
    const rotation = (degrees * Math.PI) / 180;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of points) {
      xs.push(x * cosine - y * sine);
      ys.push(x * sine + y * cosine);
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const left = quantile(xs, 0.01);
    const right = quantile(xs, 0.99);
    const top = quantile(ys, 0.01);
    const bottom = quantile(ys, 0.99);
    const candidateWidth = right - left;
    const candidateHeight = bottom - top;
    if (candidateWidth <= 8 || candidateHeight <= candidateWidth) continue;

    const aspect = candidateWidth / candidateHeight;
    const areaRatio = (candidateWidth * candidateHeight) / (width * height);
    const fillRatio = points.length / (candidateWidth * candidateHeight);
    if (aspect < 0.48 || aspect > 0.94 || areaRatio > 0.92 || fillRatio < 0.08) {
      continue;
    }
    const score =
      Math.abs(aspect - CARD_ASPECT) +
      areaRatio * 0.08 +
      Math.abs(degrees) * 0.00015;
    if (!best || score < best.score) {
      best = { rotation, left, right, top, bottom, score };
    }
  }

  if (!best) return null;
  const candidateWidth = best.right - best.left;
  const candidateHeight = best.bottom - best.top;
  const aspectError = Math.abs(candidateWidth / candidateHeight - CARD_ASPECT);
  if (aspectError > 0.16) return null;

  const rotatedCenterX = (best.left + best.right) / 2;
  const rotatedCenterY = (best.top + best.bottom) / 2;
  const cosine = Math.cos(best.rotation);
  const sine = Math.sin(best.rotation);

  return {
    rotation: best.rotation,
    centerX: rotatedCenterX * cosine + rotatedCenterY * sine,
    centerY: -rotatedCenterX * sine + rotatedCenterY * cosine,
    width: candidateWidth,
    height: candidateHeight,
    confidence: Math.max(0, Math.min(1, 1 - aspectError / 0.16)),
  };
}
