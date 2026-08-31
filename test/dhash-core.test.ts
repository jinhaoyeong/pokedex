import assert from "node:assert/strict";
import test from "node:test";

import {
  DHASH_MATCH_MAX_DISTANCE,
  dHashFromWorkGray,
  equalizeGray,
} from "../src/lib/scan/dhash-core";

test("catalog hash lookup radius is tight enough to reject random collisions", () => {
  assert.equal(DHASH_MATCH_MAX_DISTANCE, 16);
});

test("equalizeGray stretches a low-contrast ramp to full 0-255", () => {
  const source = Array.from({ length: 256 }, (_, index) => 80 + (index % 40));
  const equalized = equalizeGray(source);
  assert.equal(equalized.length, 256);
  assert.ok(Math.min(...equalized) <= 5);
  assert.ok(Math.max(...equalized) >= 250);
});

test("dHashFromWorkGray is stable for a repeated luma pattern", () => {
  const work = Array.from({ length: 72 * 64 }, (_, index) =>
    index % 72 < 36 ? 200 : 40,
  );
  const hash = dHashFromWorkGray(work);
  assert.notEqual(hash, 0n);
  assert.equal(dHashFromWorkGray(work), hash);
});
