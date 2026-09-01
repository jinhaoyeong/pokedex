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

/**
 * Split saturated regions into coarse connected components. Busy screenshots
 * contain text and window chrome all over the frame; taking one global hull in
 * those scenes swallows the UI. A card's artwork/border is instead a compact,
 * dense component, and quantile trimming ignores thin crop-guide lines that
 * cross it.
 */
function collectColorfulComponents(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Array<Array<[number, number]>> {
  const cellSize = Math.max(2, Math.round(Math.min(width, height) / 90));
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const counts = new Uint16Array(columns * rows);
  const colorfulPoints: Array<[number, number]> = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      if (high < 65 || high - low < 32) continue;
      colorfulPoints.push([x, y]);
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      counts[cellY * columns + cellX] += 1;
    }
  }

  const active = new Uint8Array(columns * rows);
  const minimumCellPixels = Math.max(1, Math.floor(cellSize * cellSize * 0.12));
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] >= minimumCellPixels) active[index] = 1;
  }

  // One coarse-cell dilation bridges artwork/border gaps without joining UI
  // elements that are meaningfully separated from the card.
  const connected = active.slice();
  for (let cellY = 0; cellY < rows; cellY += 1) {
    for (let cellX = 0; cellX < columns; cellX += 1) {
      const index = cellY * columns + cellX;
      if (!active[index]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextX = cellX + dx;
          const nextY = cellY + dy;
          if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) {
            continue;
          }
          connected[nextY * columns + nextX] = 1;
        }
      }
    }
  }

  const labels = new Int32Array(columns * rows);
  labels.fill(-1);
  let label = 0;
  for (let start = 0; start < connected.length; start += 1) {
    if (!connected[start] || labels[start] >= 0) continue;
    const queue = [start];
    labels[start] = label;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentX = current % columns;
      const currentY = Math.floor(current / columns);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = currentX + dx;
          const nextY = currentY + dy;
          if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) {
            continue;
          }
          const next = nextY * columns + nextX;
          if (!connected[next] || labels[next] >= 0) continue;
          labels[next] = label;
          queue.push(next);
        }
      }
    }
    label += 1;
  }

  const components = Array.from(
    { length: label },
    () => [] as Array<[number, number]>,
  );
  for (const point of colorfulPoints) {
    const cellX = Math.floor(point[0] / cellSize);
    const cellY = Math.floor(point[1] / cellSize);
    const componentLabel = labels[cellY * columns + cellX];
    if (componentLabel >= 0) components[componentLabel].push(point);
  }
  const minimumPoints = Math.max(48, Math.floor(width * height * 0.004));
  return components.filter((component) => component.length >= minimumPoints);
}

function frameFromRotatedBounds(
  points: Array<[number, number]>,
  width: number,
  height: number,
  trimRatio = 0.015,
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
    const left = quantile(xs, trimRatio);
    const right = quantile(xs, 1 - trimRatio);
    const top = quantile(ys, trimRatio);
    const bottom = quantile(ys, 1 - trimRatio);
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

/** Axis-aligned quantile box. Nested screenshot cards are upright; rotating
 *  them can sling one corner across a tall phone frame. */
function axisAlignedFrameFromPoints(
  points: Array<[number, number]>,
  width: number,
  height: number,
  trimRatio = 0.04,
): CardFrameEstimate | null {
  if (points.length < 24) return null;
  const xs = points.map((point) => point[0]).sort((a, b) => a - b);
  const ys = points.map((point) => point[1]).sort((a, b) => a - b);
  const left = quantile(xs, trimRatio);
  const right = quantile(xs, 1 - trimRatio);
  const top = quantile(ys, trimRatio);
  const bottom = quantile(ys, 1 - trimRatio);
  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (boxWidth < 8 || boxHeight < 8) return null;
  const aspect = boxWidth / boxHeight;
  const aspectError = Math.abs(aspect - CARD_ASPECT);
  if (aspectError > 0.34) return null;
  const area = (boxWidth * boxHeight) / (width * height);
  if (area < 0.018 || area > 0.72) return null;
  const padX = boxWidth * 0.012;
  const padY = boxHeight * 0.012;
  return {
    rotation: 0,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    width: boxWidth,
    height: boxHeight,
    confidence: Math.max(0, Math.min(1, 1 - aspectError / 0.34)),
    corners: [
      { x: left - padX, y: top - padY },
      { x: right + padX, y: top - padY },
      { x: right + padX, y: bottom + padY },
      { x: left - padX, y: bottom + padY },
    ],
  };
}

function frameFromColorfulComponents(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): CardFrameEstimate | null {
  const components = collectColorfulComponents(pixels, width, height);
  let best: { frame: CardFrameEstimate; score: number } | null = null;
  for (const component of components) {
    const rotated = frameFromRotatedBounds(component, width, height, 0.04);
    const aligned = axisAlignedFrameFromPoints(component, width, height, 0.04);
    // Upright nested cards already match 0.716 in the AABB. Prefer that over
    // a rotated unproject that can throw one corner across the screenshot.
    const frame =
      aligned && aligned.confidence >= 0.75
        ? aligned
        : rotated && aligned && aligned.confidence >= rotated.confidence - 0.05
          ? aligned
          : rotated ?? aligned;
    if (!frame) continue;
    const area = (frame.width * frame.height) / (width * height);
    if (area < 0.018 || area > 0.72) continue;
    const density = Math.min(
      1,
      component.length / Math.max(1, frame.width * frame.height),
    );
    const aspect = frame.width / Math.max(1, frame.height);
    const aspectError = Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT;
    const compactNested =
      area >= 0.018 && area <= 0.25 && aspectError <= 0.22;
    // Nested in-banner cards are small. Prefer card aspect over raw area so a
    // phone-mockup Vaporeon beats a hull of app chrome / logo tiles.
    const score =
      frame.confidence * 0.5 +
      Math.min(1, density / 0.32) * 0.22 +
      Math.max(0, 1 - aspectError / 0.28) * 0.16 +
      (compactNested ? 0.14 : Math.min(1, area / 0.16) * 0.12);
    if (!best || score > best.score) best = { frame, score };
  }

  // Strong diagonal glare can erase a wide strip of saturated pixels. The
  // robust 4% component trim keeps a trustworthy center but then underestimates
  // the card footprint. In that narrowly recognizable shape, recover low-trim
  // extents, keep the robust center, and restore the physical card aspect in
  // the candidate's local axes. The guards exclude ordinary artwork-only
  // components and busy screenshot/slab unions.
  if (best && best.frame.confidence >= 0.38 && best.frame.confidence < 0.52) {
    const combined = components.flat();
    const pointRatio = combined.length / Math.max(1, width * height);
    const lowTrim = frameFromRotatedBounds(combined, width, height, 0.002);
    if (lowTrim && lowTrim.confidence >= 0.75) {
      const primaryArea = polygonArea(
        best.frame.corners.map((corner) => [corner.x, corner.y]),
      );
      const lowTrimArea = polygonArea(
        lowTrim.corners.map((corner) => [corner.x, corner.y]),
      );
      const normalizedArea = lowTrimArea / Math.max(1, width * height);
      const areaGrowth = lowTrimArea / Math.max(1, primaryArea);
      const centerDistance = Math.hypot(
        (lowTrim.centerX - best.frame.centerX) / width,
        (lowTrim.centerY - best.frame.centerY) / height,
      );
      if (
        pointRatio >= 0.015 &&
        pointRatio <= 0.1 &&
        normalizedArea >= 0.1 &&
        normalizedArea <= 0.2 &&
        areaGrowth >= 1.35 &&
        areaGrowth <= 1.85 &&
        centerDistance <= 0.04
      ) {
        const widthScale = 1.03;
        const lowTrimAspect = lowTrim.width / Math.max(1, lowTrim.height);
        const heightScale = Math.max(
          1.03,
          Math.min(1.15, (widthScale * lowTrimAspect) / CARD_ASPECT),
        );
        const candidateWidth = lowTrim.width * widthScale;
        const candidateHeight = lowTrim.height * heightScale;
        const halfWidth = candidateWidth / 2;
        const halfHeight = candidateHeight / 2;
        const cosine = Math.cos(lowTrim.rotation);
        const sine = Math.sin(lowTrim.rotation);
        const centerX = best.frame.centerX;
        const centerY = best.frame.centerY;
        const corner = (localX: number, localY: number): CardCorner => ({
          x: centerX + localX * cosine + localY * sine,
          y: centerY - localX * sine + localY * cosine,
        });
        return {
          rotation: lowTrim.rotation,
          centerX,
          centerY,
          width: candidateWidth,
          height: candidateHeight,
          confidence: Math.max(0.8, lowTrim.confidence),
          corners: [
            corner(-halfWidth, -halfHeight),
            corner(halfWidth, -halfHeight),
            corner(halfWidth, halfHeight),
            corner(-halfWidth, halfHeight),
          ],
        };
      }
    }
  }
  return best?.frame ?? null;
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

function isCompactNestedCardFrame(
  frame: CardFrameEstimate,
  width: number,
  height: number,
): boolean {
  const area = (frame.width * frame.height) / Math.max(1, width * height);
  const aspect = frame.width / Math.max(1, frame.height);
  const aspectError = Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT;
  return (
    area >= 0.025 &&
    area <= 0.25 &&
    aspectError <= 0.22 &&
    frame.confidence >= 0.55
  );
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

  const componentFrame = frameFromColorfulComponents(pixels, width, height);
  // A strongly card-shaped colourful component is usually the complete card
  // (for example, the yellow border around Dark Charizard). Less certain
  // components can be artwork-only when a silver/grey card border is not
  // saturated enough to join the component, so compare them with the broader
  // foreground hull before accepting a destructive inner crop.
  if (componentFrame && componentFrame.confidence >= 0.8) {
    return componentFrame;
  }

  const points = collectForegroundPoints(pixels, width, height);
  const hullFrame = frameFromConvexHull(points, width, height);
  if (componentFrame && hullFrame && hullFrame.confidence >= 0.5) {
    const componentArea = polygonArea(
      componentFrame.corners.map((corner) => [corner.x, corner.y]),
    );
    const hullArea = polygonArea(
      hullFrame.corners.map((corner) => [corner.x, corner.y]),
    );
    const areaRatio = hullArea / Math.max(1, componentArea);
    const centerDistance = Math.hypot(
      (hullFrame.centerX - componentFrame.centerX) / width,
      (hullFrame.centerY - componentFrame.centerY) / height,
    );
    // Nested in-banner cards: the hull of app chrome is many times larger
    // than the card. Keep the compact component instead of swallowing the UI.
    if (
      isCompactNestedCardFrame(componentFrame, width, height) &&
      areaRatio > 2.4
    ) {
      return componentFrame;
    }
    if (areaRatio >= 1.2 && areaRatio <= 2.2 && centerDistance <= 0.08) {
      return hullFrame;
    }
  }

  if (componentFrame && componentFrame.confidence >= 0.45) {
    return componentFrame;
  }
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
  options: { sharpnessScore?: number; imageAspect?: number } = {},
): CropQuality {
  const [tl, tr, br, bl] = quad;
  const top = segmentLength(tl, tr);
  const bottom = segmentLength(bl, br);
  const left = segmentLength(tl, bl);
  const right = segmentLength(tr, br);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  // Normalized 0–1 quads are anisotropic on portrait phone screenshots: a
  // real 0.716 card looks "wide" in unit space. Convert with the source
  // width/height so nested banner cards still score as card-shaped.
  const imageAspect = options.imageAspect ?? 1;
  const aspect = height > 0 ? (width / height) * imageAspect : 0;
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

export type NormalizedRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function boundingRectFromQuad(quad: CardCornerQuad): NormalizedRect {
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * Region of the original photo that sits above an inner-card quad — the PSA/CGC
 * paper label on a graded slab. Null when the card already starts at the top.
 */
export function slabLabelBoxFromQuad(quad: CardCornerQuad): NormalizedRect | null {
  const bounds = boundingRectFromQuad(quad);
  if (bounds.top < 0.08) return null;
  const width = Math.max(0.05, bounds.right - bounds.left);
  const pad = Math.min(0.08, width * 0.12);
  const box: NormalizedRect = {
    left: clampUnit(bounds.left - pad),
    top: clampUnit(bounds.top * 0.06),
    right: clampUnit(bounds.right + pad),
    bottom: clampUnit(bounds.top - 0.008),
  };
  if (box.bottom - box.top < 0.05 || box.right - box.left < 0.12) return null;
  return box;
}

/**
 * Caption / chrome under a screenshot card. Null when the crop already includes
 * the bottom of the frame (no leftover caption band).
 */
export function screenshotCaptionBox(
  cropRect: NormalizedRect,
): NormalizedRect | null {
  if (cropRect.bottom >= 0.84) return null;
  // Nested banner cards sit in the upper third; leftover under them is app
  // chrome (search, logo grids), not an Instagram caption.
  if (cropRect.bottom < 0.48) return null;
  const leftover = 1 - cropRect.bottom;
  if (leftover > 0.4) return null;
  const top = Math.max(cropRect.bottom + 0.01, 0.78);
  if (1 - top < 0.08) return null;
  return { left: 0.04, top, right: 0.96, bottom: 0.99 };
}

/**
 * Compact card sitting in a hero/banner with a large stretch of app UI under
 * it (Collectr-style home screenshot). Not a centered PSA slab.
 */
export function isNestedAppCard(input: {
  coverage: number;
  cropTop: number;
  cropBottom: number;
}): boolean {
  const leftoverBottom = 1 - input.cropBottom;
  return (
    input.coverage > 0.02 &&
    input.coverage < 0.25 &&
    leftoverBottom >= 0.38 &&
    input.cropTop >= 0.06
  );
}

/**
 * Thin leftover strip under a mid-frame card, typical of a social caption.
 * Logo-grid home screens leave half the UI under a nested promo card.
 */
export function isSocialCaptionBand(input: {
  leftoverBottom: number;
  leftoverTop: number;
  coverage: number;
  cropBottom: number;
}): boolean {
  return (
    input.leftoverBottom >= 0.14 &&
    input.leftoverBottom <= 0.38 &&
    input.leftoverTop >= 0.08 &&
    input.coverage > 0.12 &&
    input.coverage < 0.55 &&
    input.cropBottom >= 0.5 &&
    input.cropBottom < 0.86
  );
}

/** Axis-aligned quad from a normalized rectangle. */
export function quadFromNormalizedRect(rect: NormalizedRect): CardCornerQuad {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

/**
 * Phone-mockup chrome (dropdown, close button, viewfinder) sits around an
 * in-banner card. Inset so OCR hits the printed name instead of "Trading Card
 * Games".
 */
export function insetNestedAppCardQuad(quad: CardCornerQuad): CardCornerQuad {
  const box = boundingRectFromQuad(quad);
  const width = Math.max(0.02, box.right - box.left);
  const height = Math.max(0.02, box.bottom - box.top);
  const inset: NormalizedRect = {
    left: clampUnit(box.left + width * 0.08),
    top: clampUnit(box.top + height * 0.24),
    right: clampUnit(box.right - width * 0.08),
    bottom: clampUnit(box.bottom - height * 0.05),
  };
  if (inset.right - inset.left < 0.04 || inset.bottom - inset.top < 0.04) {
    return quad;
  }
  return quadFromNormalizedRect(inset);
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
  cropTop?: number;
  cropBottom?: number;
}): SceneKind {
  if (input.isFullBleed) return "digital_card";
  if (!input.cropQuality) return "unknown";
  if (
    input.cropTop != null &&
    input.cropBottom != null &&
    isNestedAppCard({
      coverage: input.coverage,
      cropTop: input.cropTop,
      cropBottom: input.cropBottom,
    }) &&
    input.cropQuality.confidence >= 0.38
  ) {
    return "screenshot";
  }
  if (input.coverage < 0.22 && input.cropQuality.confidence >= 0.55) {
    return "slab";
  }
  if (input.imageAspect > 1.2 && input.coverage < 0.45) {
    return "screenshot";
  }
  if (input.cropQuality.confidence >= 0.45) return "loose_physical";
  return "unknown";
}

export type ScanSourceHint = "camera" | "upload";

/** Coarse input classes used to choose the appropriate scan pipeline. */
export type ScanImageKind =
  | "digital"
  | "camera"
  | "slab"
  | "screenshot"
  | "unknown";

export type DecodedScanImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export type ScanImageObservations = {
  /** Similarity of the complete image to a portrait trading-card aspect ratio. */
  cardAspectScore: number;
  /** Low luminance variance along the outside edge of the image. */
  borderUniformity: number;
  /** Strength of a consistent rectangular boundary inset from the image edge. */
  borderTransitionScore: number;
  /** Colour/luminance difference between the outer edge and image centre. */
  borderCenterDifference: number;
  /** Conservative evidence that a card sits within a larger background. */
  visibleBackgroundScore: number;
  /** Fraction of the image covered by a detected card, when one is found. */
  detectedCardCoverage: number | null;
  detectedCardConfidence: number;
  /** Null means no reliable card boundary was found. */
  cardTouchesFrame: boolean | null;
  /** General image variation, used to avoid treating a blank rectangle as a card. */
  contentVariationScore: number;
  slabScore: number;
  screenshotScore: number;
};

export type ScanImageDiagnostics = {
  inputType: ScanImageKind;
  sourceHint?: ScanSourceHint;
  /** Source width divided by source height. */
  aspectRatio: number;
  fullBleedScore: number;
  cameraPhotoScore: number;
  /** Variance of a discrete luminance Laplacian, normalized to 0-1. */
  sharpnessScore: number;
  /** Alias of observations.detectedCardCoverage for convenient routing. */
  coverageRatio: number | null;
  observations: ScanImageObservations;
};

type PixelRegionStats = {
  count: number;
  meanRed: number;
  meanGreen: number;
  meanBlue: number;
  meanLuma: number;
  lumaDeviation: number;
};

type BoundaryPeak = {
  depth: number;
  strength: number;
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function hasUsablePixelData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    pixels.length >= width * height * 4
  );
}

function compositedChannel(channel: number, alpha: number): number {
  const opacity = alpha / 255;
  return channel * opacity + 255 * (1 - opacity);
}

function scanPixelRegions(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { border: PixelRegionStats; center: PixelRegionStats; image: PixelRegionStats } {
  const border = { count: 0, red: 0, green: 0, blue: 0, luma: 0, lumaSquared: 0 };
  const center = { count: 0, red: 0, green: 0, blue: 0, luma: 0, lumaSquared: 0 };
  const image = { count: 0, red: 0, green: 0, blue: 0, luma: 0, lumaSquared: 0 };
  const borderX = Math.max(1, Math.round(width * 0.035));
  const borderY = Math.max(1, Math.round(height * 0.035));
  const centerLeft = Math.floor(width * 0.24);
  const centerRight = Math.ceil(width * 0.76);
  const centerTop = Math.floor(height * 0.24);
  const centerBottom = Math.ceil(height * 0.76);
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / 90_000)));

  const add = (
    target: typeof border,
    red: number,
    green: number,
    blue: number,
    luma: number,
  ) => {
    target.count += 1;
    target.red += red;
    target.green += green;
    target.blue += blue;
    target.luma += luma;
    target.lumaSquared += luma * luma;
  };

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3] ?? 255;
      const red = compositedChannel(pixels[offset] ?? 0, alpha);
      const green = compositedChannel(pixels[offset + 1] ?? 0, alpha);
      const blue = compositedChannel(pixels[offset + 2] ?? 0, alpha);
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      add(image, red, green, blue, luma);
      if (x < borderX || x >= width - borderX || y < borderY || y >= height - borderY) {
        add(border, red, green, blue, luma);
      }
      if (
        x >= centerLeft &&
        x < centerRight &&
        y >= centerTop &&
        y < centerBottom
      ) {
        add(center, red, green, blue, luma);
      }
    }
  }

  const finish = (input: typeof border): PixelRegionStats => {
    const divisor = Math.max(1, input.count);
    const meanLuma = input.luma / divisor;
    return {
      count: input.count,
      meanRed: input.red / divisor,
      meanGreen: input.green / divisor,
      meanBlue: input.blue / divisor,
      meanLuma,
      lumaDeviation: Math.sqrt(
        Math.max(0, input.lumaSquared / divisor - meanLuma * meanLuma),
      ),
    };
  };

  return { border: finish(border), center: finish(center), image: finish(image) };
}

function regionDifference(left: PixelRegionStats, right: PixelRegionStats): number {
  if (left.count === 0 || right.count === 0) return 0;
  const colourDistance =
    Math.hypot(
      left.meanRed - right.meanRed,
      left.meanGreen - right.meanGreen,
      left.meanBlue - right.meanBlue,
    ) /
    (255 * Math.sqrt(3));
  const deviationDifference = Math.abs(left.lumaDeviation - right.lumaDeviation) / 255;
  return clampUnit(colourDistance * 1.55 + deviationDifference * 0.45);
}

function pixelDifference(
  pixels: Uint8ClampedArray,
  width: number,
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
): number {
  const leftOffset = (leftY * width + leftX) * 4;
  const rightOffset = (rightY * width + rightX) * 4;
  const leftAlpha = pixels[leftOffset + 3] ?? 255;
  const rightAlpha = pixels[rightOffset + 3] ?? 255;
  const redDifference = Math.abs(
    compositedChannel(pixels[leftOffset] ?? 0, leftAlpha) -
      compositedChannel(pixels[rightOffset] ?? 0, rightAlpha),
  );
  const greenDifference = Math.abs(
    compositedChannel(pixels[leftOffset + 1] ?? 0, leftAlpha) -
      compositedChannel(pixels[rightOffset + 1] ?? 0, rightAlpha),
  );
  const blueDifference = Math.abs(
    compositedChannel(pixels[leftOffset + 2] ?? 0, leftAlpha) -
      compositedChannel(pixels[rightOffset + 2] ?? 0, rightAlpha),
  );
  return (redDifference + greenDifference + blueDifference) / (3 * 255);
}

function strongestInsetBoundary(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  side: "top" | "right" | "bottom" | "left",
): BoundaryPeak {
  const vertical = side === "top" || side === "bottom";
  const dimension = vertical ? height : width;
  const span = vertical ? width : height;
  const offset = Math.max(1, Math.round(dimension * 0.012));
  const minimumDepth = Math.max(offset + 1, Math.round(dimension * 0.07));
  const maximumDepth = Math.min(
    Math.floor(dimension * 0.36),
    Math.floor(dimension / 2) - offset - 1,
  );
  const depthStep = Math.max(1, Math.round(dimension * 0.018));
  const alongStep = Math.max(1, Math.round(span / 100));
  let peak: BoundaryPeak = { depth: 0, strength: 0 };

  for (let depth = minimumDepth; depth <= maximumDepth; depth += depthStep) {
    let difference = 0;
    let samples = 0;
    const start = Math.max(1, Math.round(span * 0.08));
    const end = Math.min(span - 2, Math.round(span * 0.92));
    for (let along = start; along <= end; along += alongStep) {
      let outerX: number;
      let outerY: number;
      let innerX: number;
      let innerY: number;
      if (side === "top") {
        outerX = along;
        innerX = along;
        outerY = depth - offset;
        innerY = depth + offset;
      } else if (side === "bottom") {
        outerX = along;
        innerX = along;
        outerY = height - 1 - depth + offset;
        innerY = height - 1 - depth - offset;
      } else if (side === "left") {
        outerX = depth - offset;
        innerX = depth + offset;
        outerY = along;
        innerY = along;
      } else {
        outerX = width - 1 - depth + offset;
        innerX = width - 1 - depth - offset;
        outerY = along;
        innerY = along;
      }
      difference += pixelDifference(
        pixels,
        width,
        outerX,
        outerY,
        innerX,
        innerY,
      );
      samples += 1;
    }
    const meanDifference = difference / Math.max(1, samples);
    const strength = clampUnit((meanDifference - 0.025) / 0.2);
    if (strength > peak.strength) {
      peak = { depth: depth / dimension, strength };
    }
  }
  return peak;
}

function pairedBoundaryScore(left: BoundaryPeak, right: BoundaryPeak): number {
  const positionAgreement = clampUnit(1 - Math.abs(left.depth - right.depth) / 0.14);
  return Math.sqrt(left.strength * right.strength) * positionAgreement;
}

function measureInsetBoundary(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 24 || height < 24) return 0;
  const top = strongestInsetBoundary(pixels, width, height, "top");
  const right = strongestInsetBoundary(pixels, width, height, "right");
  const bottom = strongestInsetBoundary(pixels, width, height, "bottom");
  const left = strongestInsetBoundary(pixels, width, height, "left");
  const horizontal = pairedBoundaryScore(top, bottom);
  const vertical = pairedBoundaryScore(left, right);
  return clampUnit(Math.sqrt(horizontal * vertical));
}

/**
 * Estimate edge sharpness from the variance of a 4-neighbour luminance
 * Laplacian. The response is sampled for very large images and mapped to 0-1.
 */
export function computeLaplacianSharpness(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (!hasUsablePixelData(pixels, width, height) || width < 3 || height < 3) {
    return 0;
  }
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 120_000)));
  let count = 0;
  let sum = 0;
  let sumSquared = 0;
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const response =
        4 * lumaAt(pixels, width, x, y) -
        lumaAt(pixels, width, x - 1, y) -
        lumaAt(pixels, width, x + 1, y) -
        lumaAt(pixels, width, x, y - 1) -
        lumaAt(pixels, width, x, y + 1);
      sum += response;
      sumSquared += response * response;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  const deviation = Math.sqrt(Math.max(0, sumSquared / count - mean * mean));
  // Roughly 4 to 48 luma levels of Laplacian deviation spans blurred to crisp.
  return clampUnit((deviation - 4) / 44);
}

function cardFrameObservations(
  frame: CardFrameEstimate | null,
  width: number,
  height: number,
): {
  coverage: number | null;
  confidence: number;
  touchesFrame: boolean | null;
  visibleBackground: number;
} {
  if (!frame) {
    return { coverage: null, confidence: 0, touchesFrame: null, visibleBackground: 0 };
  }
  const points = frame.corners.map((corner) => [corner.x, corner.y] as [number, number]);
  const coverage = clampUnit(polygonArea(points) / (width * height));
  const left = Math.min(...frame.corners.map((corner) => corner.x)) / width;
  const right = 1 - Math.max(...frame.corners.map((corner) => corner.x)) / width;
  const top = Math.min(...frame.corners.map((corner) => corner.y)) / height;
  const bottom = 1 - Math.max(...frame.corners.map((corner) => corner.y)) / height;
  const margins = [left, right, top, bottom];
  const minimumMargin = Math.min(...margins);
  const averageMargin = margins.reduce((sum, margin) => sum + Math.max(0, margin), 0) / 4;
  const coverageGap = clampUnit((0.92 - coverage) / 0.68);
  const marginEvidence = clampUnit(averageMargin / 0.16);
  const visibleBackground =
    clampUnit(coverageGap * 0.55 + marginEvidence * 0.45) * clampUnit(frame.confidence);
  return {
    coverage,
    confidence: clampUnit(frame.confidence),
    touchesFrame: minimumMargin <= 0.025,
    visibleBackground,
  };
}

function emptyScanDiagnostics(
  width: number,
  height: number,
  sourceHint?: ScanSourceHint,
): ScanImageDiagnostics {
  const aspectRatio = width > 0 && height > 0 ? width / height : 0;
  const inputType: ScanImageKind = sourceHint === "camera" ? "camera" : "unknown";
  return {
    inputType,
    sourceHint,
    aspectRatio,
    fullBleedScore: 0,
    cameraPhotoScore: sourceHint === "camera" ? 0.9 : 0,
    sharpnessScore: 0,
    coverageRatio: null,
    observations: {
      cardAspectScore: 0,
      borderUniformity: 0,
      borderTransitionScore: 0,
      borderCenterDifference: 0,
      visibleBackgroundScore: 0,
      detectedCardCoverage: null,
      detectedCardConfidence: 0,
      cardTouchesFrame: null,
      contentVariationScore: 0,
      slabScore: 0,
      screenshotScore: 0,
    },
  };
}

/**
 * Diagnose a decoded RGBA sample. Aspect ratio is deliberately only one input:
 * full-bleed decisions also require edge, background, coverage, and content
 * evidence. A camera source hint is treated as provenance and cannot become a
 * digital classification merely because a tight capture has card dimensions.
 */
export function diagnoseScanPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: { sourceHint?: ScanSourceHint } = {},
): ScanImageDiagnostics {
  if (!hasUsablePixelData(pixels, width, height)) {
    return emptyScanDiagnostics(width, height, options.sourceHint);
  }

  const aspectRatio = width / height;
  const aspectError = Math.abs(aspectRatio - CARD_ASPECT) / CARD_ASPECT;
  const cardAspectScore = clampUnit(1 - aspectError / 0.2);
  const regions = scanPixelRegions(pixels, width, height);
  const borderUniformity = clampUnit(1 - regions.border.lumaDeviation / 58);
  const borderCenterDifference = regionDifference(regions.border, regions.center);
  const borderTransitionScore = measureInsetBoundary(pixels, width, height);
  const contentVariationScore = clampUnit((regions.image.lumaDeviation - 6) / 48);
  const frame = estimateCardFrame(pixels, width, height);
  const frameObservations = cardFrameObservations(frame, width, height);
  const statisticalBackground =
    borderTransitionScore *
    (borderUniformity * 0.55 + borderCenterDifference * 0.45);
  const visibleBackgroundScore = clampUnit(
    Math.max(frameObservations.visibleBackground, statisticalBackground * 0.88),
  );
  const coverageFillScore =
    frameObservations.coverage === null
      ? 0.5
      : clampUnit((frameObservations.coverage - 0.68) / 0.25);
  const fullBleedScore = clampUnit(
    cardAspectScore * 0.35 +
      (1 - visibleBackgroundScore) * 0.22 +
      (1 - borderTransitionScore) * 0.15 +
      coverageFillScore * 0.12 +
      contentVariationScore * 0.16,
  );

  const coverageGapEvidence =
    frameObservations.coverage === null
      ? 0
      : clampUnit((0.9 - frameObservations.coverage) / 0.68) *
        frameObservations.confidence;
  const inferredCameraScore = clampUnit(
    visibleBackgroundScore * 0.4 +
      borderTransitionScore * 0.18 +
      coverageGapEvidence * 0.22 +
      (1 - cardAspectScore) * 0.12 +
      frameObservations.confidence * 0.08,
  );
  const cameraPhotoScore =
    options.sourceHint === "camera" ? Math.max(0.9, inferredCameraScore) : inferredCameraScore;

  const smallContainedCard =
    frameObservations.coverage === null
      ? 0
      : clampUnit((0.7 - frameObservations.coverage) / 0.48);
  const slabScore = clampUnit(
    smallContainedCard * 0.28 +
      borderUniformity * 0.22 +
      borderTransitionScore * 0.18 +
      frameObservations.confidence * 0.18 +
      cardAspectScore * 0.14,
  );
  const screenshotAspectEvidence = clampUnit(
    (Math.abs(Math.log(Math.max(0.01, aspectRatio) / CARD_ASPECT)) - 0.28) / 0.72,
  );
  const screenshotScore = clampUnit(
    screenshotAspectEvidence * 0.34 +
      visibleBackgroundScore * 0.24 +
      borderUniformity * 0.16 +
      borderTransitionScore * 0.14 +
      smallContainedCard * 0.12,
  );

  let inputType: ScanImageKind = "unknown";
  const credibleSlab =
    slabScore >= 0.8 &&
    smallContainedCard >= 0.35 &&
    borderUniformity >= 0.55 &&
    frameObservations.confidence >= 0.5;
  const credibleScreenshot =
    options.sourceHint !== "camera" &&
    screenshotScore >= 0.72 &&
    screenshotAspectEvidence >= 0.45 &&
    visibleBackgroundScore >= 0.35 &&
    borderUniformity >= 0.4;
  const tightCardShapedUpload =
    options.sourceHint === "upload" &&
    cardAspectScore >= 0.9 &&
    fullBleedScore >= 0.6 &&
    cameraPhotoScore <= 0.72 &&
    contentVariationScore >= 0.18;

  if (credibleSlab) {
    inputType = "slab";
  } else if (options.sourceHint === "camera") {
    inputType = "camera";
  } else if (credibleScreenshot) {
    inputType = "screenshot";
  } else if (
    tightCardShapedUpload ||
    (fullBleedScore >= 0.79 &&
      fullBleedScore >= cameraPhotoScore + 0.12 &&
      contentVariationScore >= 0.18)
  ) {
    inputType = "digital";
  } else if (cameraPhotoScore >= 0.54) {
    inputType = "camera";
  }

  return {
    inputType,
    sourceHint: options.sourceHint,
    aspectRatio,
    fullBleedScore,
    cameraPhotoScore,
    sharpnessScore: computeLaplacianSharpness(pixels, width, height),
    coverageRatio: frameObservations.coverage,
    observations: {
      cardAspectScore,
      borderUniformity,
      borderTransitionScore,
      borderCenterDifference,
      visibleBackgroundScore,
      detectedCardCoverage: frameObservations.coverage,
      detectedCardConfidence: frameObservations.confidence,
      cardTouchesFrame: frameObservations.touchesFrame,
      contentVariationScore,
      slabScore,
      screenshotScore,
    },
  };
}

/**
 * Downsample a browser-decoded image to a small canvas and classify it. This is
 * synchronous after image decoding and has no dependencies beyond browser DOM
 * canvas APIs.
 */
export function classifyDecodedScanImage(
  source: DecodedScanImage,
  options: { sourceHint?: ScanSourceHint; maxSampleDimension?: number } = {},
): ScanImageDiagnostics {
  const sourceWidth = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sourceHeight = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (sourceWidth <= 0 || sourceHeight <= 0 || typeof document === "undefined") {
    return emptyScanDiagnostics(sourceWidth, sourceHeight, options.sourceHint);
  }
  const maxSampleDimension = Math.max(
    48,
    Math.min(720, Math.round(options.maxSampleDimension ?? 360)),
  );
  const scale = Math.min(1, maxSampleDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return emptyScanDiagnostics(sourceWidth, sourceHeight, options.sourceHint);
  }
  context.drawImage(source, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const diagnostics = diagnoseScanPixels(imageData.data, width, height, options);
  return { ...diagnostics, aspectRatio: sourceWidth / sourceHeight };
}
