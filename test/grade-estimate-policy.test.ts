import assert from "node:assert/strict";
import test from "node:test";

import { resolveBinderGradeMarket } from "../src/lib/binder-market";
import {
  displayableGradeRows,
  isEstimatedGradePrice,
  mergeGradeRowsByPrecedence,
} from "../src/lib/market/grade-row-merge";
import {
  buildExactPrintPopulationQuery,
  cgcPopulationSearchHref,
  psaPopulationSearchHref,
} from "../src/lib/market/population-search";
import { findPsa10Usd } from "../src/lib/price/sanity";
import type { GradedPrice } from "../src/types/pokemon";

function price(grade: string, value: number, extras: Partial<GradedPrice> = {}): GradedPrice {
  return {
    grade,
    value,
    populationCount: 0,
    ...extras,
  };
}

const estimate10 = price("PSA 10", 180, {
  evidenceType: "estimate",
  source: "PSA grade estimate",
  estimate: {
    lowUsd: 140,
    midpointUsd: 180,
    highUsd: 250,
    modelVersion: "slab-estimate-v1",
    confidence: "medium",
    reasonCodes: [],
  },
});
const estimate9 = price("PSA 9", 70, {
  evidenceType: "estimate",
  source: "PSA grade estimate",
  estimate: {
    lowUsd: 55,
    midpointUsd: 70,
    highUsd: 90,
    modelVersion: "slab-estimate-v1",
    confidence: "medium",
    reasonCodes: [],
  },
});

test("validated binder/sale evidence replaces only the matching estimated grade", () => {
  const merged = mergeGradeRowsByPrecedence(
    [price("Ungraded", 40, { evidenceType: "catalog" }), estimate9, estimate10],
    [price("PSA 10", 310, { evidenceType: "sold_comp", saleCount: 4 })],
  );
  assert.equal(merged.find((row) => row.grade === "PSA 10")?.value, 310);
  assert.equal(merged.find((row) => row.grade === "PSA 10")?.evidenceType, "sold_comp");
  assert.equal(merged.find((row) => row.grade === "PSA 9")?.evidenceType, "estimate");
  assert.equal(merged.find((row) => row.grade === "Ungraded")?.value, 40);
});

test("a curated guide beats an estimate, and an estimate never overwrites a sold row", () => {
  const merged = mergeGradeRowsByPrecedence(
    [price("PSA 10", 400, { evidenceType: "sold_comp", saleCount: 3 })],
    [estimate10],
  );
  assert.equal(merged[0].evidenceType, "sold_comp");
  assert.equal(merged[0].value, 400);

  const guided = mergeGradeRowsByPrecedence(
    [estimate10],
    [price("PSA 10", 260, { evidenceType: "guide_snapshot", source: "PokePokedex market" })],
  );
  assert.equal(guided[0].evidenceType, "guide_snapshot");
  assert.equal(guided[0].value, 260);
});

test("generated rows are PSA 9 and PSA 10 only; other empty grades stay hidden", () => {
  const visible = displayableGradeRows([
    price("Ungraded", 40, { evidenceType: "catalog" }),
    estimate9,
    estimate10,
    price("PSA 8", 0),
    price("BGS 10", 0),
    price("CGC 10", 220, { evidenceType: "guide_snapshot" }),
  ]);
  assert.deepEqual(
    visible.map((row) => row.grade),
    ["Ungraded", "PSA 9", "PSA 10", "CGC 10"],
  );
});

test("estimates are excluded from binder valuation, PSA 10 sanity, and observation-style book values", () => {
  assert.equal(isEstimatedGradePrice(estimate10), true);
  assert.equal(resolveBinderGradeMarket("PSA 10", [estimate9, estimate10]).value, undefined);
  assert.equal(
    resolveBinderGradeMarket("PSA 10", [
      estimate10,
      price("PSA 10", 310, { evidenceType: "sold_comp", saleCount: 3 }),
    ]).value,
    310,
  );
  assert.equal(findPsa10Usd([estimate10]), 0);
  assert.equal(findPsa10Usd([estimate10, price("PSA 10", 310, { evidenceType: "sold_comp" })]), 310);
});

test("missing population renders official search links and a copyable exact-print query, not fabricated totals", () => {
  const query = buildExactPrintPopulationQuery({
    name: "Pikachu",
    englishName: "Pikachu",
    setName: "151",
    setEnglishName: "Scarlet & Violet 151",
    collectorNumber: "025",
    language: "en",
  });
  assert.equal(query, "Pikachu Scarlet & Violet 151 025");
  assert.ok(psaPopulationSearchHref(query).includes("psacard.com/pop"));
  assert.ok(cgcPopulationSearchHref(query).includes("cgccards.com/census"));
  assert.equal(query.includes("Estimated pop"), false);
  assert.equal(query.includes("totalCertified"), false);
});
