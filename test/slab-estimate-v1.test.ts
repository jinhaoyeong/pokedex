import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySlabEra,
  classifySlabRarity,
  estimatePsaGrades,
  extractTrustedCatalogRawPrices,
  roundSlabEstimateUsd,
  slabMultiplier,
  type SlabEstimateIdentity,
} from "../src/lib/market/slab-estimate-v1";

function identity(overrides: Partial<SlabEstimateIdentity> = {}): SlabEstimateIdentity {
  return {
    name: "Pikachu",
    setCode: "sv3pt5",
    setName: "151",
    collectorNumber: "025",
    language: "en",
    ...overrides,
  };
}

function midpoints(rawUsd: number, releaseDate: string, rarity: string) {
  const result = estimatePsaGrades({
    identity: identity(),
    releaseDate,
    rarity,
    language: "en",
    trustedRawPricesUsd: [rawUsd],
  });
  assert.equal(result.outcome === "blocked", false);
  if (result.outcome === "blocked") {
    throw new Error("expected published estimates");
  }
  return {
    psa9: result.grades[0].midpointUsd,
    psa10: result.grades[1].midpointUsd,
    result,
  };
}

test("era classification uses vintage / mid-era / modern / unknown cutoffs", () => {
  assert.equal(classifySlabEra("1999-10-20"), "vintage");
  assert.equal(classifySlabEra("2002-12-31"), "vintage");
  assert.equal(classifySlabEra("2003-01-01"), "mid-era");
  assert.equal(classifySlabEra("2015-11-01"), "mid-era");
  assert.equal(classifySlabEra("2016-02-03"), "modern");
  assert.equal(classifySlabEra(""), "unknown");
  assert.equal(classifySlabEra(null), "unknown");
});

test("rarity classification maps normalized names to bulk / standard / chase", () => {
  assert.equal(classifySlabRarity("Common"), "bulk");
  assert.equal(classifySlabRarity("Uncommon"), "bulk");
  assert.equal(classifySlabRarity("Rare Holo"), "standard");
  assert.equal(classifySlabRarity("Double Rare"), "standard");
  assert.equal(classifySlabRarity("Illustration Rare"), "chase");
  assert.equal(classifySlabRarity("Special Illustration Rare"), "chase");
  assert.equal(classifySlabRarity("Secret Rare"), "chase");
});

test("every era/rarity/grade multiplier is applied to the catalog raw median", () => {
  const cases = [
    ["2018-01-01", "Common", 1.5, 3],
    ["2018-01-01", "Rare Holo", 1.8, 4.5],
    ["2018-01-01", "Illustration Rare", 2.2, 6],
    ["2010-01-01", "Common", 1.8, 4.5],
    ["2010-01-01", "Rare Holo", 2.3, 7],
    ["2010-01-01", "Secret Rare", 3, 10],
    ["1999-01-01", "Common", 2.2, 7],
    ["1999-01-01", "Rare Holo", 3, 12],
    ["1999-01-01", "Secret Rare", 4, 18],
  ] as const;

  for (const [date, rarity, psa9, psa10] of cases) {
    const era = classifySlabEra(date);
    const rarityClass = classifySlabRarity(rarity);
    assert.equal(slabMultiplier(era, rarityClass, "PSA 9"), psa9, `${date} ${rarity} PSA 9`);
    assert.equal(slabMultiplier(era, rarityClass, "PSA 10"), psa10, `${date} ${rarity} PSA 10`);
    const { psa9: mid9, psa10: mid10 } = midpoints(20, date, rarity);
    assert.equal(mid9, roundSlabEstimateUsd(20 * psa9));
    assert.equal(mid10, roundSlabEstimateUsd(20 * psa10));
  }
});

test("unknown release dates use modern multipliers", () => {
  assert.equal(slabMultiplier("unknown", "chase", "PSA 10"), 6);
  const unknown = midpoints(20, "", "Illustration Rare");
  const modern = midpoints(20, "2023-01-01", "Illustration Rare");
  assert.equal(unknown.psa9, modern.psa9);
  assert.equal(unknown.psa10, modern.psa10);
  assert.ok(unknown.result.reasonCodes.includes("unknown_release_date"));
});

test("floors are $12 PSA 9 and $20 PSA 10 after the multiplier", () => {
  const { psa9, psa10 } = midpoints(1, "2023-01-01", "Common");
  assert.equal(psa9, 12);
  assert.equal(psa10, 20);
});

test("rounding uses $0.50 below $10, $1 below $100, and $5 at or above $100", () => {
  assert.equal(roundSlabEstimateUsd(9.24), 9);
  assert.equal(roundSlabEstimateUsd(9.3), 9.5);
  assert.equal(roundSlabEstimateUsd(12.4), 12);
  assert.equal(roundSlabEstimateUsd(102), 100);
  assert.equal(roundSlabEstimateUsd(103), 105);
});

test("base ranges are 0.80-1.25x for PSA 9 and 0.75-1.40x for PSA 10", () => {
  const { result } = midpoints(100, "2023-01-01", "Rare Holo");
  const psa9 = result.grades[0];
  const psa10 = result.grades[1];
  assert.equal(psa9.lowUsd, roundSlabEstimateUsd(psa9.midpointUsd * 0.8));
  assert.equal(psa9.highUsd, roundSlabEstimateUsd(psa9.midpointUsd * 1.25));
  assert.equal(psa10.lowUsd, roundSlabEstimateUsd(psa10.midpointUsd * 0.75));
  assert.equal(psa10.highUsd, roundSlabEstimateUsd(psa10.midpointUsd * 1.4));
});

test("unknown date, non-English, and first-edition/shadowless widen the range", () => {
  const base = estimatePsaGrades({
    identity: identity(),
    releaseDate: "2023-01-01",
    rarity: "Rare Holo",
    language: "en",
    trustedRawPricesUsd: [40],
  });
  const unknown = estimatePsaGrades({
    identity: identity(),
    rarity: "Rare Holo",
    language: "en",
    trustedRawPricesUsd: [40],
  });
  const japanese = estimatePsaGrades({
    identity: identity({
      language: "ja",
      identityStatus: "confirmed",
      printedCollectorNumber: "025",
      identitySources: ["official-detail"],
    }),
    releaseDate: "2023-01-01",
    rarity: "Rare Holo",
    language: "ja",
    trustedRawPricesUsd: [40],
  });
  const firstEd = estimatePsaGrades({
    identity: identity({ finish: "firstEditionHolofoil", setName: "Base Set" }),
    releaseDate: "1999-01-01",
    rarity: "Rare Holo",
    finish: "firstEditionHolofoil",
    language: "en",
    trustedRawPricesUsd: [40],
  });

  assert.equal(base.outcome === "blocked" || unknown.outcome === "blocked", false);
  if (base.outcome === "blocked" || unknown.outcome === "blocked" || japanese.outcome === "blocked" || firstEd.outcome === "blocked") {
    throw new Error("expected published estimates");
  }
  assert.ok(unknown.grades[0].lowUsd < base.grades[0].lowUsd);
  assert.ok(unknown.grades[0].highUsd > base.grades[0].highUsd);
  assert.ok(japanese.reasonCodes.includes("non_english_print"));
  assert.ok(japanese.grades[0].lowUsd < base.grades[0].lowUsd);
  assert.ok(firstEd.reasonCodes.includes("ambiguous_premium_variant"));
});

test("identity failures withhold both PSA estimates", () => {
  const incomplete = estimatePsaGrades({
    identity: identity({ collectorNumber: "", setCode: "", setName: "" }),
    language: "en",
    trustedRawPricesUsd: [40],
  });
  assert.equal(incomplete.outcome, "blocked");
  assert.ok(incomplete.reasonCodes.includes("identity_incomplete"));
  assert.equal(incomplete.grades.length, 0);

  const conflict = estimatePsaGrades({
    identity: identity({
      language: "ja",
      collectorNumber: "025",
      printedCollectorNumber: "171",
      identityStatus: "confirmed",
      identitySources: ["official-detail"],
      conflictingCatalogIdentities: true,
    }),
    language: "ja",
    trustedRawPricesUsd: [40],
  });
  assert.equal(conflict.outcome, "blocked");
  assert.ok(conflict.reasonCodes.includes("identity_conflict"));
});

test("rarity-derived raw prices are never used as the slab baseline", () => {
  assert.deepEqual(
    extractTrustedCatalogRawPrices({
      marketPriceUsd: 88,
      sources: [{ source: "Card-adjusted rarity estimate", note: "rarity estimate" }],
      gradedPrices: [{ grade: "Ungraded", value: 88, source: "Card-adjusted rarity estimate" }],
    }),
    [],
  );

  const blocked = estimatePsaGrades({
    identity: identity(),
    language: "en",
    trustedRawPricesUsd: [],
  });
  assert.equal(blocked.outcome, "blocked");
  assert.ok(blocked.reasonCodes.includes("missing_catalog_raw"));
});

test("discarded junk listings keep the model range with a warning", () => {
  const result = estimatePsaGrades({
    identity: identity(),
    releaseDate: "2023-01-01",
    rarity: "Rare Holo",
    language: "en",
    trustedRawPricesUsd: [40],
    cleanedAsksByGrade: { "PSA 9": [], "PSA 10": [] },
    discardedJunkCount: 6,
  });
  assert.notEqual(result.outcome, "blocked");
  if (result.outcome === "blocked") {
    return;
  }
  assert.equal(result.outcome, "published");
  assert.ok(result.reasonCodes.includes("model_only_no_valid_asks"));
  assert.equal(result.grades[0].confidence, "medium");
});

test("agreeing asks keep the base range at medium confidence", () => {
  const model = estimatePsaGrades({
    identity: identity(),
    releaseDate: "2023-01-01",
    rarity: "Rare Holo",
    language: "en",
    trustedRawPricesUsd: [40],
  });
  assert.notEqual(model.outcome, "blocked");
  if (model.outcome === "blocked") {
    return;
  }
  const result = estimatePsaGrades({
    identity: identity(),
    releaseDate: "2023-01-01",
    rarity: "Rare Holo",
    language: "en",
    trustedRawPricesUsd: [40],
    cleanedAsksByGrade: {
      "PSA 9": [model.grades[0].midpointUsd],
      "PSA 10": [model.grades[1].midpointUsd],
    },
  });
  assert.notEqual(result.outcome, "blocked");
  if (result.outcome === "blocked") {
    return;
  }
  assert.equal(result.outcome, "published");
  assert.ok(result.reasonCodes.includes("asks_agree"));
  assert.equal(result.grades[0].confidence, "medium");
  assert.equal(result.grades[0].lowUsd, model.grades[0].lowUsd);
  assert.equal(result.grades[0].highUsd, model.grades[0].highUsd);
});

test("conflicting asks publish the model midpoint and union a wide range at low confidence", () => {
  const three = estimatePsaGrades({
    identity: identity(),
    releaseDate: "2023-01-01",
    rarity: "Rare Holo",
    language: "en",
    trustedRawPricesUsd: [40],
    cleanedAsksByGrade: {
      "PSA 10": [800, 820, 840],
    },
  });
  assert.equal(three.outcome, "widened");
  if (three.outcome !== "widened") {
    throw new Error("expected widened estimates");
  }
  const psa10 = three.grades[1];
  assert.equal(psa10.midpointUsd, midpoints(40, "2023-01-01", "Rare Holo").psa10);
  assert.equal(psa10.confidence, "low");
  assert.ok(psa10.reasonCodes.includes("asks_disagree"));
  assert.ok(psa10.highUsd >= roundSlabEstimateUsd(820 * 1.3));

  const thin = estimatePsaGrades({
    identity: identity(),
    releaseDate: "2023-01-01",
    rarity: "Rare Holo",
    language: "en",
    trustedRawPricesUsd: [40],
    cleanedAsksByGrade: {
      "PSA 10": [800],
    },
  });
  assert.equal(thin.outcome, "widened");
  if (thin.outcome !== "widened") {
    throw new Error("expected widened estimates");
  }
  assert.ok(thin.grades[1].highUsd >= roundSlabEstimateUsd(800 * 1.6));
});
