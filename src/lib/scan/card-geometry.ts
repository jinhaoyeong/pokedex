export type CardCorner = {
  x: number;
  y: number;
};

/** Top-left, top-right, bottom-right, bottom-left in image coordinates. */
export type CardCornerQuad = [CardCorner, CardCorner, CardCorner, CardCorner];

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
  /**
   * Card corners in the same sample-image coordinates as the detector input.
   * Ordered top-left, top-right, bottom-right, bottom-left.
   */
  corners: CardCornerQuad;
};

const CARD_ASPECT = 0.716;

function quantile(sorted: number[], ratio: number): number {
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)),
  );
  return sorted[index] ?? 0;
}

function lumaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  const offset = (y * width + x) * 4;
  return (
    0.299 * (pixels[offset] ?? 0) +
    0.587 * (pixels[offset + 1] ?? 0) +
    0.114 * (pixels[offset + 2] ?? 0)
  );
}

function cross(
  origin: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}

function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const sorted = [...points].sort((left, right) =>
    left[0] === right[0] ? left[1] - right[1] : left[0] - right[0],
  );
  const lower: Array<[number, number]> = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Array<[number, number]> = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Approximate a convex hull with four corners by repeatedly removing the vertex
 * whose deletion least reduces the hull area (Douglas-style simplification).
 */
function approximateQuad(hull: Array<[number, number]>): CardCornerQuad | null {
  if (hull.length < 4) return null;
  let points = hull.slice();
  while (points.length > 4) {
    let removeIndex = 0;
    let bestRemainingArea = -1;
    for (let index = 0; index < points.length; index += 1) {
      const candidate = points.filter((_, pointIndex) => pointIndex !== index);
      const area = polygonArea(candidate);
      // Keep the vertex set whose area drops the least when one point is removed.
      if (area > bestRemainingArea) {
        bestRemainingArea = area;
        removeIndex = index;
      }
    }
    points = points.filter((_, pointIndex) => pointIndex !== removeIndex);
  }

  const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const ordered = [...points].sort(
    (left, right) =>
      Math.atan2(left[1] - centerY, left[0] - centerX) -
      Math.atan2(right[1] - centerY, right[0] - centerX),
  );
  // Rotate the cyclic order so index 0 is the top-left-most corner.
  let start = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ordered.length; index += 1) {
    const score = ordered[index][0] + ordered[index][1];
    if (score < bestScore) {
      bestScore = score;
      start = index;
    }
  }
  const cycled = [
    ordered[start],
    ordered[(start + 1) % 4],
    ordered[(start + 2) % 4],
    ordered[(start + 3) % 4],
  ];
  // Ensure clockwise TL→TR→BR→BL (canvas y grows downward, so clockwise is
  // increasing atan2 from the top-left start in image space).
  const clockwise =
    cross(cycled[0], cycled[1], cycled[2]) > 0
      ? cycled
      : [cycled[0], cycled[3], cycled[2], cycled[1]];

  if (new Set(clockwise.map((point) => `${point[0]},${point[1]}`)).size !== 4) {
    return null;
  }
  return clockwise.map(([x, y]) => ({ x, y })) as CardCornerQuad;
}

/**
 * Collect foreground points for a card on a table / desk. Combines colorful
 * artwork with edge pixels that diverge from the border background so dark
 * cards still form a usable footprint without swallowing the table.
 */
function collectForegroundPoints(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Array<[number, number]> {
  const borderLumas: number[] = [];
  const borderStep = Math.max(1, Math.floor(Math.min(width, height) / 48));
  for (let x = 0; x < width; x += borderStep) {
    borderLumas.push(lumaAt(pixels, width, x, 0));
    borderLumas.push(lumaAt(pixels, width, x, height - 1));
  }
  for (let y = 0; y < height; y += borderStep) {
    borderLumas.push(lumaAt(pixels, width, 0, y));
    borderLumas.push(lumaAt(pixels, width, width - 1, y));
  }
  borderLumas.sort((a, b) => a - b);
  const backgroundLuma = quantile(borderLumas, 0.5);

  const points: Array<[number, number]> = [];
  // Sample images are already tiny (~320px); keep every pixel for stable edges.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      const saturation = high - low;
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      const gradient =
        Math.abs(lumaAt(pixels, width, x + 1, y) - lumaAt(pixels, width, x - 1, y)) +
        Math.abs(lumaAt(pixels, width, x, y + 1) - lumaAt(pixels, width, x, y - 1));

      const colorful = high >= 55 && saturation >= 28;
      const contrastsBackground = Math.abs(luma - backgroundLuma) >= 34;
      const edged = gradient >= 40 && contrastsBackground;
      if (colorful || edged) {
        points.push([x, y]);
      }
    }
  }
  return points;
}

function frameFromRotatedBounds(
  points: Array<[number, number]>,
  width: number,
  height: number,
): CardFrameEstimate | null {
  const ratio = points.length / (width * height);
  if (ratio < 0.008 || ratio > 0.55) {
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
    const left = quantile(xs, 0.015);
    const right = quantile(xs, 0.985);
    const top = quantile(ys, 0.015);
    const bottom = quantile(ys, 0.985);
    const candidateWidth = right - left;
    const candidateHeight = bottom - top;
    if (candidateWidth <= 8 || candidateHeight <= candidateWidth * 0.85) continue;

    const aspect = candidateWidth / candidateHeight;
    const areaRatio = (candidateWidth * candidateHeight) / (width * height);
    const fillRatio = points.length / (candidateWidth * candidateHeight);
    // Perspective photos commonly produce AABBs wider than a true 0.716 card.
    if (aspect < 0.48 || aspect > 1.05 || areaRatio > 0.88 || fillRatio < 0.08) {
      continue;
    }
    const score =
      Math.abs(aspect - CARD_ASPECT) * 0.9 +
      areaRatio * 0.12 +
      Math.abs(degrees) * 0.00012 +
      (1 - Math.min(1, fillRatio)) * 0.05;
    if (!best || score < best.score) {
      best = { rotation, left, right, top, bottom, score };
    }
  }

  if (!best) return null;
  const candidateWidth = best.right - best.left;
  const candidateHeight = best.bottom - best.top;
  const aspectError = Math.abs(candidateWidth / candidateHeight - CARD_ASPECT);
  if (aspectError > 0.34) return null;

  const rotatedCenterX = (best.left + best.right) / 2;
  const rotatedCenterY = (best.top + best.bottom) / 2;
  const cosine = Math.cos(best.rotation);
  const sine = Math.sin(best.rotation);
  const padX = candidateWidth * 0.012;
  const padY = candidateHeight * 0.012;
  const unrotate = (rx: number, ry: number): CardCorner => ({
    x: rx * cosine + ry * sine,
    y: -rx * sine + ry * cosine,
  });

  return {
    rotation: best.rotation,
    centerX: rotatedCenterX * cosine + rotatedCenterY * sine,
    centerY: -rotatedCenterX * sine + rotatedCenterY * cosine,
    width: candidateWidth,
    height: candidateHeight,
    confidence: Math.max(0, Math.min(1, 1 - aspectError / 0.34)),
    corners: [
      unrotate(best.left - padX, best.top - padY),
      unrotate(best.right + padX, best.top - padY),
      unrotate(best.right + padX, best.bottom + padY),
      unrotate(best.left - padX, best.bottom + padY),
    ],
  };
}

function frameFromConvexHull(
  points: Array<[number, number]>,
  width: number,
  height: number,
): CardFrameEstimate | null {
  if (points.length < 24) return null;
  const hull = convexHull(points);
  const corners = approximateQuad(hull);
  if (!corners) return null;

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (boxWidth < 12 || boxHeight <= boxWidth * 0.85) return null;

  const areaRatio = (boxWidth * boxHeight) / (width * height);
  if (areaRatio < 0.08 || areaRatio > 0.88) return null;

  // Expand slightly so borders / collector numbers survive the cutout.
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const padded = corners.map((corner) => ({
    x: centerX + (corner.x - centerX) * 1.03,
    y: centerY + (corner.y - centerY) * 1.03,
  })) as CardCornerQuad;

  const aspect = boxWidth / boxHeight;
  const aspectError = Math.abs(aspect - CARD_ASPECT);
  return {
    rotation: 0,
    centerX,
    centerY,
    width: boxWidth,
    height: boxHeight,
    confidence: Math.max(0.35, Math.min(1, 1 - aspectError / 0.4)),
    corners: padded,
  };
}

/**
 * Locate a portrait card against a comparatively neutral background.
 * Prefers a convex-hull quadrilateral (handles perspective camera photos),
 * falling back to a rotated bounding box for simpler tilted captures.
 */
export function estimateCardFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): CardFrameEstimate | null {
  if (width < 24 || height < 24 || pixels.length < width * height * 4) {
    return null;
  }

  const points = collectForegroundPoints(pixels, width, height);
  const hullFrame = frameFromConvexHull(points, width, height);
  if (hullFrame && hullFrame.confidence >= 0.4) {
    return hullFrame;
  }
  return frameFromRotatedBounds(points, width, height) ?? hullFrame;
}

/**
 * Normalize sample-image corners into a 0–1 quad relative to the source image.
 * Returns null when any corner lands far outside the frame.
 */
export function normalizeCardCorners(
  corners: CardCornerQuad,
  sampleWidth: number,
  sampleHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): CardCornerQuad | null {
  if (
    sampleWidth <= 0 ||
    sampleHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }

  const scaleX = sourceWidth / sampleWidth;
  const scaleY = sourceHeight / sampleHeight;
  const normalized = corners.map((corner) => ({
    x: (corner.x * scaleX) / Math.max(1, sourceWidth - 1),
    y: (corner.y * scaleY) / Math.max(1, sourceHeight - 1),
  })) as CardCornerQuad;

  const inBounds = normalized.every(
    (corner) =>
      corner.x >= -0.08 &&
      corner.x <= 1.08 &&
      corner.y >= -0.08 &&
      corner.y <= 1.08,
  );
  if (!inBounds) return null;

  return normalized.map((corner) => ({
    x: Math.max(0, Math.min(1, corner.x)),
    y: Math.max(0, Math.min(1, corner.y)),
  })) as CardCornerQuad;
}

export type CropQuality = {
  aspectScore: number;
  edgeScore: number;
  cornerScore: number;
  coverageScore: number;
  sharpnessScore: number;
  confidence: number;
};

export type SceneKind =
  | "digital_card"
  | "loose_physical"
  | "slab"
  | "screenshot"
  | "multiple_cards"
  | "unknown";

function segmentLength(a: CardCorner, b: CardCorner): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function edgeAngle(a: CardCorner, b: CardCorner): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function angleDelta(left: number, right: number): number {
  let delta = Math.abs(left - right) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta;
}

/**
 * Score whether a normalized cutout quad looks like a trustworthy Pokémon card
 * crop before we silently trust it for matching.
 */
export function scoreCropQuality(
  quad: CardCornerQuad,
  options: { sharpnessScore?: number } = {},
): CropQuality {
  const [tl, tr, br, bl] = quad;
  const top = segmentLength(tl, tr);
  const bottom = segmentLength(bl, br);
  const left = segmentLength(tl, bl);
  const right = segmentLength(tr, br);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  const aspect = height > 0 ? width / height : 0;
  const aspectError = Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT;
  const aspectScore = Math.max(0, 1 - aspectError / 0.35);

  const parallelScore =
    1 -
    (angleDelta(edgeAngle(tl, tr), edgeAngle(bl, br)) +
      angleDelta(edgeAngle(tl, bl), edgeAngle(tr, br))) /
      Math.PI;
  const lengthBalance =
    1 -
    (Math.abs(top - bottom) / Math.max(top, bottom, 1e-6) +
      Math.abs(left - right) / Math.max(left, right, 1e-6)) /
      2;
  const edgeScore = Math.max(0, Math.min(1, parallelScore * 0.65 + lengthBalance * 0.35));

  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const coverage = Math.max(0, (maxX - minX) * (maxY - minY));
  // Prefer a dominant card that still leaves some margin vs the frame.
  const coverageScore = Math.max(
    0,
    Math.min(1, 1 - Math.abs(coverage - 0.55) / 0.55),
  );

  const inset = Math.min(minX, minY, 1 - maxX, 1 - maxY);
  const cornerScore = Math.max(0, Math.min(1, inset <= 0.01 ? 0.45 : 0.55 + inset));

  const sharpnessScore = Math.max(0, Math.min(1, options.sharpnessScore ?? 0.7));
  const confidence = Math.max(
    0,
    Math.min(
      1,
      aspectScore * 0.34 +
        edgeScore * 0.28 +
        coverageScore * 0.18 +
        cornerScore * 0.1 +
        sharpnessScore * 0.1,
    ),
  );

  return {
    aspectScore,
    edgeScore,
    cornerScore,
    coverageScore,
    sharpnessScore,
    confidence,
  };
}

/** Nudge only the top edge — useful when glare clips the name bar. */
export function adjustQuadTopEdge(
  quad: CardCornerQuad,
  deltaY: number,
): CardCornerQuad {
  return [
    { x: quad[0].x, y: Math.max(0, Math.min(1, quad[0].y + deltaY)) },
    { x: quad[1].x, y: Math.max(0, Math.min(1, quad[1].y + deltaY)) },
    { x: quad[2].x, y: quad[2].y },
    { x: quad[3].x, y: quad[3].y },
  ];
}

export function scaleCardQuad(
  quad: CardCornerQuad,
  scale: number,
): CardCornerQuad {
  const center = {
    x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
    y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
  };
  return quad.map((point) => ({
    x: Math.max(0, Math.min(1, center.x + (point.x - center.x) * scale)),
    y: Math.max(0, Math.min(1, center.y + (point.y - center.y) * scale)),
  })) as CardCornerQuad;
}

/**
 * Lightweight scene heuristic from geometry alone. Downstream matchers can
 * specialize (inner slab card, screenshot chrome) without a learned model.
 */
export function classifyScanScene(input: {
  imageAspect: number;
  cropQuality: CropQuality | null;
  coverage: number;
  isFullBleed: boolean;
}): SceneKind {
  if (input.isFullBleed) return "digital_card";
  if (!input.cropQuality) return "unknown";
  if (input.coverage < 0.22 && input.cropQuality.confidence >= 0.55) {
    return "slab";
  }
  if (input.imageAspect > 1.2 && input.coverage < 0.45) {
    return "screenshot";
  }
  if (input.cropQuality.confidence >= 0.45) return "loose_physical";
  return "unknown";
}
