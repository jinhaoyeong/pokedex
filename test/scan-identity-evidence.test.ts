import assert from "node:assert/strict";
import test from "node:test";

import { inferLanguageHints, scoreEvidence } from "../src/lib/scan/identity-evidence";

const DISPLAY_FLOOR = 0.58;

test("OCR-silent 0.90 artwork match stays above the scanner display floor", () => {
  const evidence = scoreEvidence({
    visualScore: 0.9,
    clipScore: 0.765,
    nameScore: 0,
    collectorScore: 0,
    languageScore: 0.5,
    geometryQuality: 0.46,
  });

  assert.ok(
    evidence.finalScore >= DISPLAY_FLOOR,
    `expected ${evidence.finalScore} >= ${DISPLAY_FLOOR}`,
  );
  assert.ok(evidence.finalScore >= 0.87);
});

test("OCR-silent 0.70 HD-scan hash still displays instead of vanishing", () => {
  const evidence = scoreEvidence({
    visualScore: 0.7,
    clipScore: 0.595,
    nameScore: 0,
    collectorScore: 0,
    languageScore: 0.5,
    geometryQuality: 0.5,
  });

  assert.ok(
    evidence.finalScore >= DISPLAY_FLOOR,
    `expected ${evidence.finalScore} >= ${DISPLAY_FLOOR}`,
  );
});

test("weak artwork without OCR stays below the display floor", () => {
  const evidence = scoreEvidence({
    visualScore: 0.5,
    clipScore: 0.42,
    nameScore: 0,
    collectorScore: 0,
  });

  assert.ok(evidence.finalScore < DISPLAY_FLOOR);
});

test("PSA label JP/CS tokens become language hints", () => {
  assert.deepEqual(inferLanguageHints("latin", "2024 POKEMON SV8a JP"), ["ja"]);
  assert.deepEqual(inferLanguageHints("latin", "2025 POKEMON SV-P CS"), ["zh-cn"]);
});
