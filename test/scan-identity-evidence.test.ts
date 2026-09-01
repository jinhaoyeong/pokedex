import assert from "node:assert/strict";
import test from "node:test";

import {
  canAcceptFastVisualIdentity,
  inferLanguageHints,
  inferScriptHint,
  sameArtLanguageToExpand,
  scoreEvidence,
  visualPrintConflictsWithPrintedIdentity,
} from "../src/lib/scan/identity-evidence";

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

test("PSA JPN.SWSH and concatenated JPNSWSH are Japanese print hints", () => {
  assert.deepEqual(inferLanguageHints("latin", "2021 POKEMON JPN.SWSH"), ["ja"]);
  assert.deepEqual(inferLanguageHints("latin", "2021 POKEMON JPNSWSH"), ["ja"]);
  assert.deepEqual(inferLanguageHints("latin", "2021 POKEMON JPN SWSH"), ["ja"]);
  assert.deepEqual(inferLanguageHints("latin", "2023 POKEMON JPN.SV"), ["ja"]);
  assert.deepEqual(inferLanguageHints("latin", "illus.saino misaki s8b 233/184 CSR"), [
    "ja",
  ]);
  assert.deepEqual(inferLanguageHints("latin", "sv4a 187/190 SAR"), ["ja"]);
  assert.deepEqual(inferLanguageHints("latin", "SV8a 217/187"), ["ja"]);
});

test("pixelated English OCR does not become Japanese from CJK noise", () => {
  assert.deepEqual(
    inferLanguageHints("japanese", "Mimikyu V 160 HP の", { requireStrongScript: true }),
    [],
  );
  assert.deepEqual(
    inferLanguageHints("latin", "Mimikyu V TG16 s8b", { requireStrongScript: true }),
    [],
  );
  assert.deepEqual(
    inferLanguageHints("latin", "2021 POKEMON JPN.SWSH", { requireStrongScript: true }),
    ["ja"],
  );
  assert.equal(
    inferScriptHint("Mimikyu V 160 HP Ability Dummy Doll の Jealous Eyes"),
    "latin",
  );
  assert.equal(inferScriptHint("ミミッキュV 160 HP"), "japanese");
});

test("English Trainer Gallery TG16 conflicts with Japanese 233 / JPN label", () => {
  const englishHit = { lang: "en", localId: "TG16" };
  assert.equal(
    visualPrintConflictsWithPrintedIdentity(englishHit, {
      number: "233",
      languageHints: ["ja"],
    }),
    true,
  );
  assert.equal(
    visualPrintConflictsWithPrintedIdentity(englishHit, {
      languageHints: ["ja"],
    }),
    true,
  );
  assert.equal(
    visualPrintConflictsWithPrintedIdentity(englishHit, {
      number: "TG16",
      languageHints: [],
    }),
    false,
  );
  assert.equal(
    canAcceptFastVisualIdentity(
      englishHit,
      { number: "233", languageHints: ["ja"] },
      { includePsaLabel: true },
    ),
    false,
  );
  assert.equal(
    canAcceptFastVisualIdentity(englishHit, { number: "TG16" }, { includePsaLabel: true }),
    true,
  );
  assert.equal(
    canAcceptFastVisualIdentity(englishHit, null, { includePsaLabel: true }),
    false,
  );
  assert.equal(sameArtLanguageToExpand("en", ["ja"], "233", "TG16"), "ja");
  assert.equal(sameArtLanguageToExpand("en", [], "233", "TG16"), "ja");
  assert.equal(sameArtLanguageToExpand("en", [], "TG16", "TG16"), null);
});

test("same-art English print loses to Japanese identity when language is JA", () => {
  const englishArt = scoreEvidence({
    visualScore: 0.92,
    clipScore: 0.88,
    nameScore: 0.95,
    collectorScore: 0,
    languageScore: 0.15,
  });
  const japanesePrint = scoreEvidence({
    visualScore: 0.78,
    clipScore: 0.8,
    nameScore: 0.95,
    collectorScore: 1,
    languageScore: 1,
    setMatch: true,
  });
  assert.ok(
    japanesePrint.finalScore > englishArt.finalScore,
    `expected JA ${japanesePrint.finalScore} > EN ${englishArt.finalScore}`,
  );
});
