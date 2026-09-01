import assert from "node:assert/strict";
import test from "node:test";

import {
  canTrustLowResClipIdentity,
  isLowQualityScan,
  isLowResCardShapedScan,
  isLowResolutionScan,
  measureScanDegradation,
  shouldQueryScanHash,
  shouldSeedCatalogFromVisualHits,
} from "../src/lib/scan/low-res";
import { correctOcrSpeciesName } from "../src/lib/scan/ocr-species";
import {
  canAcceptLowResTextIdentity,
  catalogAgreesWithSpecies,
  isTrustedLowResCollectorNumber,
  restrictLowConfidenceScanResults,
  speciesFromLowResHeaderTokens,
} from "../src/lib/scan/low-res-identity";
import { fuseVisualHitsForScanQuality } from "../src/lib/scan/visual-hits";
import type { VisualIndexHit } from "../src/lib/scan/types";

function hit(id: string, name: string, score: number): VisualIndexHit {
  return {
    id,
    name,
    setName: "",
    localId: "",
    lang: "en",
    image: "",
    score,
  };
}

test("tiny chat-share photos are low-resolution scans", () => {
  assert.equal(isLowResolutionScan(169, 225), true);
  assert.equal(isLowResolutionScan(320, 450), true);
  assert.equal(isLowResolutionScan(1080, 1440), false);
  assert.equal(isLowResolutionScan(640, 890), false);
});

test("a pixelated card-shaped thumb skips table-quad detection", () => {
  assert.equal(isLowResCardShapedScan(169, 225), true);
  assert.equal(isLowResCardShapedScan(169, 400), false);
  assert.equal(isLowResCardShapedScan(1080, 1440), false);
});

test("low-res scans must not query catalog dHash", () => {
  assert.equal(shouldQueryScanHash(true), false);
  assert.equal(shouldQueryScanHash(false), true);
});

test("low-res fusion ignores a confident dHash collision", () => {
  const fused = fuseVisualHitsForScanQuality(
    [hit("B1a-101", "Solgaleo ex", 0.781), hit("swsh4-47", "Jolteon", 0.75)],
    [hit("swsh9-TG16", "Mimikyu V", 0.7), hit("swsh9-068", "Mimikyu V", 0.66)],
    "low",
  );
  assert.equal(fused[0]?.id, "swsh9-TG16");
  assert.equal(
    fused.some((row) => row.id === "B1a-101"),
    false,
  );
});

test("normal fusion still protects a glare dHash identity", () => {
  const fused = fuseVisualHitsForScanQuality(
    [hit("SV3-125", "Charizard ex", 0.766)],
    [hit("sv2-40", "Clefable", 0.81), hit("SV3-125", "Charizard ex", 0.7)],
    "normal",
  );
  assert.equal(fused[0]?.id, "SV3-125");
});

test("mixed CLIP neighbors at 0.73-0.79 are not a trusted low-res identity", () => {
  assert.equal(
    canTrustLowResClipIdentity([
      { name: "Zeraora VSTAR", score: 0.79 },
      { name: "Dracozolt", score: 0.74 },
      { name: "Galarian Obstagoon", score: 0.73 },
    ]),
    false,
  );
  assert.equal(
    shouldSeedCatalogFromVisualHits(
      [
        { name: "Dracozolt", score: 0.74 },
        { name: "Zeraora VSTAR", score: 0.79 },
      ],
      true,
      0.6,
    ),
    false,
  );
});

test("a same-species CLIP cluster can be trusted on a low-res scan", () => {
  assert.equal(
    canTrustLowResClipIdentity([
      { name: "Mimikyu V", score: 0.84 },
      { name: "Mimikyu V", score: 0.81 },
    ]),
    true,
  );
});

test("a 0.74 Fezandipiti CLIP pile is not a trusted identity", () => {
  assert.equal(
    canTrustLowResClipIdentity([
      { name: "Fezandipiti ex", score: 0.74 },
      { name: "Fezandipiti ex", score: 0.72 },
      { name: "Fezandipiti ex", score: 0.72 },
    ]),
    false,
  );
  assert.equal(
    shouldSeedCatalogFromVisualHits(
      [
        { name: "Fezandipiti ex", score: 0.74 },
        { name: "Fezandipiti ex", score: 0.72 },
      ],
      true,
      0.6,
    ),
    false,
  );
});

function rgbaFill(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const [r, g, b] = fill(x, y);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

test("1080p camera photos of a blurry or pixelated card are low quality", () => {
  assert.equal(
    isLowQualityScan({ width: 1920, height: 1080, sharpnessScore: 0.2 }),
    true,
  );
  assert.equal(
    isLowQualityScan({
      width: 1920,
      height: 1080,
      sharpnessScore: 0.7,
      degradationScore: 0.2,
    }),
    false,
  );
  assert.equal(
    isLowQualityScan({
      width: 1920,
      height: 1080,
      sharpnessScore: 0.5,
      degradationScore: 0.8,
    }),
    true,
  );
  const flat = rgbaFill(64, 64, () => [80, 40, 90]);
  const checker = rgbaFill(64, 64, (x, y) =>
    (x + y) % 2 === 0 ? [20, 20, 20] : [220, 220, 220],
  );
  const blocks = rgbaFill(64, 64, (x, y) => {
    const cell = Math.floor(x / 8) + Math.floor(y / 8);
    return cell % 2 === 0 ? [40, 40, 40] : [200, 180, 60];
  });
  assert.ok(measureScanDegradation(flat, 64, 64) >= 0.85);
  assert.ok(measureScanDegradation(checker, 64, 64) < 0.45);
  assert.ok(measureScanDegradation(blocks, 64, 64) >= 0.68);
});

test("garbled Mimikyu OCR still maps to the species", () => {
  const hit = correctOcrSpeciesName(["Mimlkvu", "Mimikyu V"]);
  assert.ok(hit);
  assert.equal(hit?.name, "Mimikyu");
  assert.ok((hit?.score ?? 0) >= 0.72);
});

test("low-res header identity rejects Vullaby 49 circular catalog hits", () => {
  assert.equal(isTrustedLowResCollectorNumber("49"), false);
  assert.equal(isTrustedLowResCollectorNumber("4/102"), true);
  assert.equal(isTrustedLowResCollectorNumber("TG16"), true);
  assert.equal(isTrustedLowResCollectorNumber("233/184"), true);
  assert.equal(
    speciesFromLowResHeaderTokens(["Jealous", "Dummy", "Ability", "Eyes"]),
    null,
  );
  const mimikyu = speciesFromLowResHeaderTokens(["Mimikyu V", "Mimlkvu"]);
  assert.equal(mimikyu?.name, "Mimikyu");
  assert.equal(
    canAcceptLowResTextIdentity({
      species: null,
      catalogNameScore: 1,
      catalogCard: { name: "Vullaby", englishName: "Vullaby" },
    }),
    false,
  );
  assert.equal(
    canAcceptLowResTextIdentity({
      species: { name: "Mimikyu", score: 0.9 },
      catalogNameScore: 0.95,
      catalogCard: { name: "Vullaby", englishName: "Vullaby" },
    }),
    false,
  );
  assert.equal(
    canAcceptLowResTextIdentity({
      species: { name: "Mimikyu", score: 0.9 },
      catalogNameScore: 0.95,
      catalogCard: { name: "Mimikyu V", englishName: "Mimikyu V" },
    }),
    true,
  );
  assert.equal(
    catalogAgreesWithSpecies({ name: "Mimikyu V" }, "Mimikyu"),
    true,
  );
  assert.equal(
    catalogAgreesWithSpecies({ name: "Vullaby" }, "Mimikyu"),
    false,
  );
});

test("unique printed ability and attack titles identify Mimikyu", () => {
  const fromAbility = speciesFromLowResHeaderTokens(
    ["Dummy", "Doll"],
    ["Ability Dummy Doll"],
  );
  assert.equal(fromAbility?.name, "Mimikyu");
  const fromAttack = speciesFromLowResHeaderTokens(
    [],
    ["Jeal0us Eyes 90"],
  );
  assert.equal(fromAttack?.name, "Mimikyu");
  const fromNoise = speciesFromLowResHeaderTokens(
    ["Jealous", "Dummy", "Ability", "Eyes"],
    ["Ability Dummy Doll Jealous Eyes"],
  );
  assert.equal(fromNoise?.name, "Mimikyu");
});

test("low-confidence scans show nothing instead of a pile of guesses", () => {
  const guesses = [
    { name: "Fezandipiti ex", visualScore: 0.74 },
    { name: "Fezandipiti ex", visualScore: 0.72 },
    { name: "Vullaby", visualScore: 0.59 },
  ];
  assert.deepEqual(
    restrictLowConfidenceScanResults(guesses, {
      scoreOf: (item) => item.visualScore,
      nameOf: (item) => item.name,
      trustedSpecies: null,
      clipTrusted: false,
    }),
    [],
  );
  const named = restrictLowConfidenceScanResults(
    [
      { name: "Mimikyu V", visualScore: 0.7 },
      { name: "Mimikyu V", visualScore: 0.68 },
      { name: "Mimikyu V", visualScore: 0.66 },
      { name: "Mimikyu V", visualScore: 0.64 },
      { name: "Vullaby", visualScore: 0.6 },
    ],
    {
      scoreOf: (item) => item.visualScore,
      nameOf: (item) => item.name,
      trustedSpecies: "Mimikyu",
      clipTrusted: false,
    },
  );
  assert.equal(named.length, 3);
  assert.equal(
    named.every((item) => item.name.startsWith("Mimikyu")),
    true,
  );
});
