import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateMarketObservations,
  findPokedexMarketGuideEntry,
  isUsableMarketPriceUsd,
  mergeGradedPricesWithLiveGuide,
  mergeSeedAndLiveMarketGuide,
  pokedexMarketGuideToProviderResult,
  type PokedexMarketGuideEntry,
  type PokedexMarketObservation,
} from "../src/lib/market/pokedex-market-guide";

const mew: PokedexMarketGuideEntry = {
  slug: "sv4pt5-232",
  setCode: "SV4PT5",
  collectorNumber: "232",
  language: "en",
  name: "Mew ex",
  ungradedUsd: 968.49,
  grades: [{ grade: "PSA 10", valueUsd: 2400, sampleCount: 3, kind: "curator" }],
};

function observation(
  contributorKey: string,
  priceUsd: number,
  options: Partial<PokedexMarketObservation> = {},
): PokedexMarketObservation {
  return {
    contributorKey,
    priceUsd,
    kind: "sold",
    grade: "Ungraded",
    observedAt: "2026-08-01T00:00:00.000Z",
    ...options,
  };
}

test("first-party guide matches set code and collector number", () => {
  const hit = findPokedexMarketGuideEntry(
    { setCode: "SV4PT5", collectorNumber: "232", language: "en" },
    [mew],
  );
  assert.equal(hit?.slug, "sv4pt5-232");
});

test("first-party guide matches slug even when the set code is missing", () => {
  const hit = findPokedexMarketGuideEntry({ slug: "sv4pt5-232" }, [mew]);
  assert.equal(hit?.ungradedUsd, 968.49);
});

test("guide snapshot exposes ungraded plus PSA rows as PokePokedex market", () => {
  const result = pokedexMarketGuideToProviderResult(mew);
  assert.equal(result?.provider, "pokedex-market");
  assert.equal(result?.sourceLabel, "PokePokedex market");
  assert.equal(result?.ungradedUsd, 968.49);
  assert.ok(result?.gradedPrices?.some((price) => price.grade === "PSA 10" && price.value === 2400));
});

test("empty guide file does not invent a market row", () => {
  assert.equal(
    findPokedexMarketGuideEntry({ setCode: "SV4PT5", collectorNumber: "232", language: "en" }, []),
    null,
  );
});

test("one vote per contributor keeps the latest price", () => {
  const aggregated = aggregateMarketObservations([
    observation("anon:a", 10, { observedAt: "2026-08-01T00:00:00.000Z" }),
    observation("anon:a", 40, { observedAt: "2026-08-20T00:00:00.000Z" }),
  ]);
  assert.equal(aggregated?.ungradedUsd, 40);
  assert.equal(aggregated?.grades?.find((grade) => grade.grade === "Ungraded")?.sampleCount, 1);
});

test("sold aggregation uses the median after dropping extreme outliers", () => {
  const aggregated = aggregateMarketObservations([
    observation("a", 100),
    observation("b", 110),
    observation("c", 90),
    observation("d", 10_000),
  ]);
  assert.equal(aggregated?.ungradedUsd, 100);
  assert.equal(aggregated?.grades?.[0]?.kind, "sold");
  assert.equal(aggregated?.grades?.[0]?.sampleCount, 3);
});

test("seed beats a single thin paid report", () => {
  const live = aggregateMarketObservations([
    observation("anon:a", 12, { kind: "paid", grade: "PSA 10" }),
  ]);
  const merged = mergeSeedAndLiveMarketGuide(mew, live);
  assert.equal(merged?.grades?.find((grade) => grade.grade === "PSA 10")?.valueUsd, 2400);
  assert.equal(merged?.grades?.find((grade) => grade.grade === "PSA 10")?.kind, "curator");
});

test("three independent sold reports override the curator seed", () => {
  const live = aggregateMarketObservations([
    observation("a", 2100, { grade: "PSA 10" }),
    observation("b", 2200, { grade: "PSA 10" }),
    observation("c", 2300, { grade: "PSA 10" }),
  ]);
  const merged = mergeSeedAndLiveMarketGuide(mew, live);
  assert.equal(merged?.grades?.find((grade) => grade.grade === "PSA 10")?.valueUsd, 2200);
  assert.equal(merged?.grades?.find((grade) => grade.grade === "PSA 10")?.kind, "sold");
});

test("a single sold report does not override the curator seed", () => {
  const live = aggregateMarketObservations([
    observation("a", 99, { grade: "PSA 10" }),
  ]);
  const merged = mergeSeedAndLiveMarketGuide(mew, live);
  assert.equal(merged?.grades?.find((grade) => grade.grade === "PSA 10")?.valueUsd, 2400);
});

test("live paid fills a grade the seed does not have", () => {
  const live = aggregateMarketObservations([
    observation("a", 350, { kind: "paid", grade: "PSA 9" }),
    observation("b", 360, { kind: "paid", grade: "PSA 9" }),
  ]);
  const merged = mergeSeedAndLiveMarketGuide(mew, live);
  const psa9 = merged?.grades?.find((grade) => grade.grade === "PSA 9");
  assert.equal(psa9?.kind, "paid");
  assert.equal(psa9?.valueUsd, 355);
});

test("rejects zero and absurd prices", () => {
  assert.equal(isUsableMarketPriceUsd(0), false);
  assert.equal(isUsableMarketPriceUsd(0.1), false);
  assert.equal(isUsableMarketPriceUsd(1_000_000), false);
  assert.equal(isUsableMarketPriceUsd(12.5), true);
  assert.equal(aggregateMarketObservations([observation("a", 0)]), null);
});

test("overlay keeps catalog ungraded and adds live slab rows", () => {
  const live = pokedexMarketGuideToProviderResult({
    ungradedUsd: 12,
    grades: [{ grade: "PSA 10", valueUsd: 80, sampleCount: 1, kind: "paid" }],
  });
  const merged = mergeGradedPricesWithLiveGuide(
    [
      {
        grade: "Ungraded",
        value: 40,
        populationCount: 0,
        source: "Catalog",
        evidenceType: "catalog",
        confidence: "medium",
        confidenceScore: 0.5,
      },
    ],
    live,
  );
  assert.equal(merged.find((price) => price.grade === "Ungraded")?.value, 40);
  assert.equal(merged.find((price) => price.grade === "PSA 10")?.value, 80);
});
