import assert from "node:assert/strict";
import test from "node:test";

import {
  boundingRectFromQuad,
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
