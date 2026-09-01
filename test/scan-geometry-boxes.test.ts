import assert from "node:assert/strict";
import test from "node:test";

import {
  boundingRectFromQuad,
  classifyScanScene,
  estimateCardFrame,
  insetNestedAppCardQuad,
  isNestedAppCard,
  isSocialCaptionBand,
  scoreCropQuality,
  screenshotCaptionBox,
  slabLabelBoxFromQuad,
  type CardCornerQuad,
} from "../src/lib/scan/card-geometry";

const SLAB_INNER_QUAD: CardCornerQuad = [
  { x: 0.32, y: 0.261 },
  { x: 0.68, y: 0.261 },
  { x: 0.68, y: 0.691 },
  { x: 0.32, y: 0.691 },
];

test("slabLabelBoxFromQuad takes the original-frame band above the inner card", () => {
  const box = slabLabelBoxFromQuad(SLAB_INNER_QUAD);
  assert.ok(box);
  assert.ok(box.bottom <= 0.261);
  assert.ok(box.top < 0.05);
  assert.ok(box.left < 0.32);
  assert.ok(box.right > 0.68);
  assert.ok(box.bottom - box.top >= 0.05);
});

test("slabLabelBoxFromQuad is null when the card already starts at the top", () => {
  const fullBleed: CardCornerQuad = [
    { x: 0.05, y: 0.02 },
    { x: 0.95, y: 0.02 },
    { x: 0.95, y: 0.98 },
    { x: 0.05, y: 0.98 },
  ];
  assert.equal(slabLabelBoxFromQuad(fullBleed), null);
});

test("screenshotCaptionBox reads leftover chrome under a mid-frame card", () => {
  const crop = boundingRectFromQuad([
    { x: 0.21, y: 0.26 },
    { x: 0.43, y: 0.18 },
    { x: 0.79, y: 0.63 },
    { x: 0.35, y: 0.71 },
  ]);
  const caption = screenshotCaptionBox(crop);
  assert.ok(caption);
  assert.ok(caption.top >= crop.bottom);
  assert.ok(caption.bottom > caption.top);
});

test("screenshotCaptionBox is null when the crop already includes the bottom", () => {
  assert.equal(
    screenshotCaptionBox({ left: 0.1, top: 0.05, right: 0.9, bottom: 0.92 }),
    null,
  );
});

const COLLECTR_NESTED_QUAD: CardCornerQuad = [
  { x: 0.59, y: 0.19 },
  { x: 0.93, y: 0.19 },
  { x: 0.93, y: 0.42 },
  { x: 0.59, y: 0.42 },
];

const COLLECTR_CROP = boundingRectFromQuad(COLLECTR_NESTED_QUAD);

test("screenshotCaptionBox ignores leftover app chrome under a banner card", () => {
  assert.equal(screenshotCaptionBox(COLLECTR_CROP), null);
});

test("isNestedAppCard is true for a compact in-banner screenshot card", () => {
  assert.equal(
    isNestedAppCard({
      coverage: 0.081,
      cropTop: COLLECTR_CROP.top,
      cropBottom: COLLECTR_CROP.bottom,
    }),
    true,
  );
});

test("isNestedAppCard is false for a centered PSA slab crop", () => {
  const slab = boundingRectFromQuad(SLAB_INNER_QUAD);
  assert.equal(
    isNestedAppCard({
      coverage: (slab.right - slab.left) * (slab.bottom - slab.top),
      cropTop: slab.top,
      cropBottom: slab.bottom,
    }),
    false,
  );
});

test("isSocialCaptionBand matches Instagram leftover, not Collectr logo grids", () => {
  const social = boundingRectFromQuad([
    { x: 0.21, y: 0.26 },
    { x: 0.43, y: 0.18 },
    { x: 0.79, y: 0.63 },
    { x: 0.35, y: 0.71 },
  ]);
  assert.equal(
    isSocialCaptionBand({
      leftoverBottom: 1 - social.bottom,
      leftoverTop: social.top,
      coverage: (social.right - social.left) * (social.bottom - social.top),
      cropBottom: social.bottom,
    }),
    true,
  );
  assert.equal(
    isSocialCaptionBand({
      leftoverBottom: 1 - COLLECTR_CROP.bottom,
      leftoverTop: COLLECTR_CROP.top,
      coverage: 0.081,
      cropBottom: COLLECTR_CROP.bottom,
    }),
    false,
  );
});

test("portrait nested cards score as card-shaped once image aspect is applied", () => {
  const withoutAspect = scoreCropQuality(COLLECTR_NESTED_QUAD);
  const withAspect = scoreCropQuality(COLLECTR_NESTED_QUAD, {
    imageAspect: 1206 / 2622,
  });
  assert.ok(
    withAspect.aspectScore > withoutAspect.aspectScore + 0.4,
    `aspectScore ${withAspect.aspectScore} vs ${withoutAspect.aspectScore}`,
  );
  assert.ok(withAspect.aspectScore >= 0.7);
  assert.ok(withAspect.confidence >= 0.55);
});

test("classifyScanScene treats nested banner cards as screenshots, not slabs", () => {
  const quality = scoreCropQuality(COLLECTR_NESTED_QUAD, {
    imageAspect: 1206 / 2622,
  });
  const coverage =
    (COLLECTR_CROP.right - COLLECTR_CROP.left) *
    (COLLECTR_CROP.bottom - COLLECTR_CROP.top);
  assert.equal(
    classifyScanScene({
      imageAspect: 1206 / 2622,
      cropQuality: quality,
      coverage,
      isFullBleed: false,
      cropTop: COLLECTR_CROP.top,
      cropBottom: COLLECTR_CROP.bottom,
    }),
    "screenshot",
  );
});

test("classifyScanScene still labels a centered inner-card crop as a slab", () => {
  const quality = scoreCropQuality(SLAB_INNER_QUAD, { imageAspect: 0.72 });
  const slab = boundingRectFromQuad(SLAB_INNER_QUAD);
  const coverage = (slab.right - slab.left) * (slab.bottom - slab.top);
  assert.equal(
    classifyScanScene({
      imageAspect: 0.72,
      cropQuality: quality,
      coverage,
      isFullBleed: false,
      cropTop: slab.top,
      cropBottom: slab.bottom,
    }),
    "slab",
  );
});

test("insetNestedAppCardQuad drops phone-mockup chrome above the inner card", () => {
  const inset = boundingRectFromQuad(insetNestedAppCardQuad(COLLECTR_NESTED_QUAD));
  assert.ok(inset.top > COLLECTR_CROP.top + 0.03);
  assert.ok(inset.left > COLLECTR_CROP.left);
  assert.ok(inset.right < COLLECTR_CROP.right);
  assert.ok(inset.bottom <= COLLECTR_CROP.bottom + 0.001);
});

test("estimateCardFrame keeps an upright nested card on the right of a tall screenshot", () => {
  const width = 230;
  const height = 500;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(40);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const left = Math.round(0.585 * width);
  const right = Math.round(0.931 * width);
  const top = Math.round(0.192 * height);
  const bottom = Math.round(0.424 * height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      const edge = x <= left + 4 || x >= right - 5 || y <= top + 4 || y >= bottom - 5;
      pixels[offset] = edge ? 230 : 40;
      pixels[offset + 1] = edge ? 200 : 90;
      pixels[offset + 2] = edge ? 40 : 210;
      pixels[offset + 3] = 255;
    }
  }
  const frame = estimateCardFrame(pixels, width, height);
  assert.ok(frame);
  for (const corner of frame.corners) {
    assert.ok(
      corner.x / width > 0.45,
      `corner x ${corner.x / width} escaped across the screenshot`,
    );
  }
  const xs = frame.corners.map((corner) => corner.x / width);
  const ys = frame.corners.map((corner) => corner.y / height);
  assert.ok(Math.min(...xs) > 0.5);
  assert.ok(Math.min(...ys) > 0.12);
  assert.ok(Math.max(...ys) < 0.5);
});

test("estimateCardFrame prefers an upright nested card over a wide logo tile", () => {
  const width = 230;
  const height = 500;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(40);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const paint = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    red: number,
    green: number,
    blue: number,
  ) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = red;
        pixels[offset + 1] = green;
        pixels[offset + 2] = blue;
        pixels[offset + 3] = 255;
      }
    }
  };
  const cardLeft = Math.round(0.585 * width);
  const cardRight = Math.round(0.931 * width);
  const cardTop = Math.round(0.192 * height);
  const cardBottom = Math.round(0.424 * height);
  paint(cardLeft, cardTop, cardRight, cardBottom, 40, 90, 210);
  paint(cardLeft, cardTop, cardRight, cardTop + 5, 230, 200, 40);
  paint(cardLeft, cardBottom - 5, cardRight, cardBottom, 230, 200, 40);
  paint(cardLeft, cardTop, cardLeft + 5, cardBottom, 230, 200, 40);
  paint(cardRight - 5, cardTop, cardRight, cardBottom, 230, 200, 40);
  paint(
    Math.round(0.55 * width),
    Math.round(0.79 * height),
    Math.round(0.9 * width),
    Math.round(0.88 * height),
    220,
    40,
    40,
  );
  const frame = estimateCardFrame(pixels, width, height);
  assert.ok(frame);
  const centerY = frame.centerY / height;
  assert.ok(
    centerY < 0.5,
    `picked logo tile instead of nested card (centerY=${centerY.toFixed(3)})`,
  );
});
