import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSlabCalibration,
  type SlabCalibrationObservation,
} from "../src/lib/market/slab-calibration";
import { estimatePsaGrades } from "../src/lib/market/slab-estimate-v1";
import {
  estimatePsaGradesV2,
  SLAB_ESTIMATE_MODEL_VERSION,
} from "../src/lib/market/slab-estimate-v2";
import { applyModelOnlySlabEstimatesToCard } from "../src/lib/market/slab-estimate-card";
import type { TcgCard } from "../src/types/pokemon";

const identity = {
  name: "Pikachu ex",
  setCode: "sv8",
  setName: "Surging Sparks",
  collectorNumber: "238",
  language: "en",
};

test("v2 compresses the runaway premium on high-value modern chase raw", () => {
  const input = {
    identity,
    releaseDate: "2024-11-08",
    rarity: "Special Illustration Rare",
    language: "en",
    trustedRawPricesUsd: [338.33],
  };
  const v1 = estimatePsaGrades(input);
  const v2 = estimatePsaGradesV2(input);
  assert.notEqual(v1.outcome, "blocked");
  assert.notEqual(v2.outcome, "blocked");
  if (v1.outcome === "blocked" || v2.outcome === "blocked") return;

  assert.equal(v2.grades[0].modelVersion, SLAB_ESTIMATE_MODEL_VERSION);
  assert.ok(v2.grades[0].midpointUsd < v1.grades[0].midpointUsd);
  assert.ok(v2.grades[1].midpointUsd < v1.grades[1].midpointUsd);
  assert.ok(v2.grades[0].midpointUsd <= 560);
  assert.ok(v2.grades[1].midpointUsd <= 1_200);
  assert.ok(v2.reasonCodes.includes("high_value_compression"));
  assert.ok(v2.reasonCodes.includes("uncalibrated_model"));
  assert.equal(v2.grades[1].confidence, "low");
});

test("v2 retains v1 floors and multipliers below the high-value anchor", () => {
  const input = {
    identity,
    releaseDate: "2024-11-08",
    rarity: "Common",
    language: "en",
    trustedRawPricesUsd: [1],
  };
  const v1 = estimatePsaGrades(input);
  const v2 = estimatePsaGradesV2(input);
  assert.notEqual(v1.outcome, "blocked");
  assert.notEqual(v2.outcome, "blocked");
  if (v1.outcome === "blocked" || v2.outcome === "blocked") return;
  assert.deepEqual(
    v2.grades.map((row) => row.midpointUsd),
    v1.grades.map((row) => row.midpointUsd),
  );
});

test("first-party paired raw/slab observations calibrate the matching cohort", () => {
  const rows: SlabCalibrationObservation[] = [];
  for (const [index, psa10] of [180, 200, 220, 240, 260].entries()) {
    const cardKey = `modern-chase-${index}`;
    rows.push(
      { cardKey, contributorKey: `raw-${index}`, grade: "Ungraded", priceUsd: 100, era: "modern", rarity: "chase", language: "en" },
      { cardKey, contributorKey: `slab-${index}`, grade: "PSA 10", priceUsd: psa10, era: "modern", rarity: "chase", language: "en" },
    );
  }
  const calibration = buildSlabCalibration(rows, {
    cardKey: "target",
    era: "modern",
    rarity: "chase",
    language: "en",
  });
  assert.equal(calibration["PSA 10"]?.sampleCount, 5);
  assert.equal(calibration["PSA 10"]?.multiplier, 2.2);

  const result = estimatePsaGradesV2({
    identity,
    releaseDate: "2024-11-08",
    rarity: "Special Illustration Rare",
    language: "en",
    trustedRawPricesUsd: [100],
    calibration,
  });
  assert.notEqual(result.outcome, "blocked");
  if (result.outcome === "blocked") return;
  assert.ok(result.grades[1].reasonCodes.includes("first_party_calibration"));
  assert.equal(result.grades[1].confidence, "medium");
  assert.match(result.grades[1].explanation, /5 PokePokedex observed print ratios/);
});

test("conflicting asks widen v2 without replacing its midpoint", () => {
  const base = estimatePsaGradesV2({
    identity,
    releaseDate: "2024-11-08",
    rarity: "Special Illustration Rare",
    language: "en",
    trustedRawPricesUsd: [100],
  });
  const conflicted = estimatePsaGradesV2({
    identity,
    releaseDate: "2024-11-08",
    rarity: "Special Illustration Rare",
    language: "en",
    trustedRawPricesUsd: [100],
    cleanedAsksByGrade: { "PSA 10": [2_000, 2_100, 2_200] },
  });
  assert.notEqual(base.outcome, "blocked");
  assert.equal(conflicted.outcome, "widened");
  if (base.outcome === "blocked") return;
  assert.equal(conflicted.grades[1].midpointUsd, base.grades[1].midpointUsd);
  assert.ok(conflicted.grades[1].highUsd >= 2_100 * 1.3);
});

function exactPrintCard(): TcgCard {
  return {
    id: "neo4-107",
    slug: "neo4-107",
    language: "en",
    languageLabel: "English",
    name: "Shining Charizard",
    collectorNumber: "107",
    rarity: "Rare",
    supertype: "Pokemon",
    hp: "100",
    types: ["Fire"],
    setId: "neo4",
    setCode: "NEO4",
    setName: "Neo Destiny",
    setReleaseDate: "2002-02-28",
    image: "/icon.svg",
    artist: "Hironobu Yoshida",
    marketPriceUsd: 1_495,
    finish: "unlimitedHolofoil",
    finishMarkets: [
      {
        id: "unlimitedHolofoil",
        label: "Unlimited holo",
        shortLabel: "Unlimited",
        ungradedUsd: 1_495,
      },
    ],
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Live grading market",
      fetchedAt: null,
      note: "Waiting for first-party population data.",
    },
    gradedPrices: [
      {
        grade: "Ungraded",
        value: 1_495,
        populationCount: 0,
        evidenceType: "catalog",
      },
    ],
    priceHistory: [{ date: "2026-09-01", value: 1_495 }],
    recentSales: [],
    portfolioDefaultQuantity: 1,
    sources: [
      {
        source: "PokemonTCG public catalog",
        status: "verified",
        fetchedAt: "2026-09-03",
        confidence: 0.82,
        note: "Exact-print catalog price.",
      },
    ],
  };
}

test("exact-print catalog cards get PSA rows before live enrichment returns", () => {
  const card = applyModelOnlySlabEstimatesToCard(exactPrintCard());
  const psa9 = card.gradedPrices.find((row) => row.grade === "PSA 9");
  const psa10 = card.gradedPrices.find((row) => row.grade === "PSA 10");

  assert.equal(psa9?.estimate?.modelVersion, SLAB_ESTIMATE_MODEL_VERSION);
  assert.equal(psa10?.estimate?.modelVersion, SLAB_ESTIMATE_MODEL_VERSION);
  assert.ok((psa9?.value ?? 0) > card.marketPriceUsd);
  assert.ok((psa10?.value ?? 0) > (psa9?.value ?? 0));
  assert.ok(card.priceHistory.some((point) => point.isProjected && point.gradeValues?.["PSA 10"]));
});

test("a real guide row replaces only its matching immediate estimate", () => {
  const input = exactPrintCard();
  input.gradedPrices.push({
    grade: "PSA 9",
    value: 5_000,
    populationCount: 0,
    source: "PokePokedex market guide",
    evidenceType: "guide_snapshot",
  });
  const card = applyModelOnlySlabEstimatesToCard(input);
  const psa9 = card.gradedPrices.find((row) => row.grade === "PSA 9");
  const psa10 = card.gradedPrices.find((row) => row.grade === "PSA 10");

  assert.equal(psa9?.value, 5_000);
  assert.equal(psa9?.estimate, undefined);
  assert.equal(psa10?.estimate?.modelVersion, SLAB_ESTIMATE_MODEL_VERSION);
});
