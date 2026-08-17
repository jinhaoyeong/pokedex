export type PerspectivePoint = {
  x: number;
  y: number;
};

export type PerspectiveQuad = [
  PerspectivePoint,
  PerspectivePoint,
  PerspectivePoint,
  PerspectivePoint,
];

export type ProjectiveTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
};

/**
 * Build a transform from a normalized upright rectangle to the source quad.
 * Points must be ordered top-left, top-right, bottom-right, bottom-left.
 */
export function projectiveTransformForQuad(
  quad: PerspectiveQuad,
): ProjectiveTransform | null {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const denominator = dx1 * dy2 - dx2 * dy1;

  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) {
    return null;
  }

  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const transform = {
    a: topRight.x - topLeft.x + g * topRight.x,
    b: bottomLeft.x - topLeft.x + h * bottomLeft.x,
    c: topLeft.x,
    d: topRight.y - topLeft.y + g * topRight.y,
    e: bottomLeft.y - topLeft.y + h * bottomLeft.y,
    f: topLeft.y,
    g,
    h,
  };

  return Object.values(transform).every(Number.isFinite) ? transform : null;
}

export function projectPoint(
  transform: ProjectiveTransform,
  u: number,
  v: number,
): PerspectivePoint | null {
  const denominator = transform.g * u + transform.h * v + 1;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) {
    return null;
  }
  return {
    x: (transform.a * u + transform.b * v + transform.c) / denominator,
    y: (transform.d * u + transform.e * v + transform.f) / denominator,
  };
}

export function isValidPerspectiveQuad(quad: PerspectiveQuad): boolean {
  const crossProducts = quad.map((point, index) => {
    const next = quad[(index + 1) % quad.length];
    const after = quad[(index + 2) % quad.length];
    return (
      (next.x - point.x) * (after.y - next.y) -
      (next.y - point.y) * (after.x - next.x)
    );
  });
  const consistentlyClockwise = crossProducts.every((value) => value > 0.002);
  const consistentlyCounterClockwise = crossProducts.every((value) => value < -0.002);
  const doubledArea = Math.abs(
    quad.reduce((sum, point, index) => {
      const next = quad[(index + 1) % quad.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0),
  );

  return (consistentlyClockwise || consistentlyCounterClockwise) && doubledArea > 0.02;
}
