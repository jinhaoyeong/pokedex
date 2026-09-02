import assert from "node:assert/strict";
import test from "node:test";

import {
  isLowConfidenceLocalizedEstimate,
  trustedListPriceUsd,
} from "../src/lib/price/list-price-trust";
import { PRICE_SORT_BATCH_BUDGET_MS } from "../src/lib/price/list-price-batch";
import { priceQueryFromLookupFields } from "../src/lib/price/price-query";
import {
  PRICE_SORT_REVEAL_BUDGET_MS,
  applyFrozenSearchOrder,
  collectTrustedListPrices,
  extractReliableBatchPrices,
  freezePriceSortedResults,
  mergePriceSortUsd,
  needsPriceSortBatch,
} from "../src/lib/search-price-sort";
import type { SearchResult, TcgCard } from "../src/types/pokemon";

function result(
  partial: Partial<TcgCard> & Pick<TcgCard, "id" | "name" | "marketPriceUsd">,
): SearchResult {
  return {
    score: 100,
    matchReason: "test",
    card: {
      slug: partial.slug ?? partial.id,
      language: "ja",
      languageLabel: "Japanese",
      collectorNumber: partial.collectorNumber ?? "1",
      rarity: "Rare",
      gradedPrices: [],
      recentSales: [],
      psaPopulation: {
        status: "ready",
        totalCertified: 0,
        grades: [],
        source: "test",
        fetchedAt: null,
      },
      priceHistory: [],
      sources: [],
      ...partial,
    } as TcgCard,
  };
}

test("price-sort reveal budget stays inside the 3s user-visible cap", () => {
  assert.equal(PRICE_SORT_REVEAL_BUDGET_MS, 3_000);
  assert.ok(PRICE_SORT_BATCH_BUDGET_MS <= PRICE_SORT_REVEAL_BUDGET_MS);
});

test("trusted PriceCharting guide prices skip the batch wait", () => {
  const priced = result({
    id: "sv2a-201",
    name: "Charizard ex",
    marketPriceUsd: 361.86,
    sources: [
      {
        source: "PriceCharting public guide",
        status: "verified",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        confidence: 0.62,
        note: "Guide snapshot",
      },
    ],
    priceConsensus: {
      finalEstimateUsd: 361.86,
      confidence: "medium",
      confidenceScore: 0.62,
      sourceCount: 1,
      sampleCount: 1,
      methodology: "Guide snapshot",
      sources: [
        {
          source: "PriceCharting public guide",
          value: 361.86,
          confidence: "medium",
          confidenceScore: 0.62,
          evidenceType: "guide_snapshot",
          note: "Guide snapshot",
        },
      ],
    },
  });

  assert.equal(isLowConfidenceLocalizedEstimate(priced.card), false);
  assert.equal(trustedListPriceUsd(priced.card), 361.86);
  assert.equal(needsPriceSortBatch([priced]), false);
  assert.deepEqual(collectTrustedListPrices([priced]), { "sv2a-201": 361.86 });
});

test("early market estimates are not trusted for display or sort", () => {
  const estimated = result({
    id: "base1-4",
    name: "Charizard",
    language: "en",
    languageLabel: "English",
    marketPriceUsd: 280,
    sources: [
      {
        source: "Early market estimate",
        status: "estimated",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        confidence: 0.28,
        note: "Launch-window estimate",
      },
    ],
    gradedPrices: [
      {
        grade: "Ungraded",
        value: 280,
        source: "Early market estimate",
        confidence: "low",
        confidenceScore: 0.28,
        populationCount: 0,
      },
    ],
    priceConsensus: {
      finalEstimateUsd: 280,
      confidence: "low",
      confidenceScore: 0.28,
      sourceCount: 1,
      sampleCount: 0,
      methodology: "Card-adjusted early market estimate",
      sources: [
        {
          source: "Early market estimate",
          value: 280,
          confidence: "low",
          confidenceScore: 0.28,
          evidenceType: "catalog",
          note: "Launch-window estimate",
        },
      ],
    },
  });

  assert.equal(isLowConfidenceLocalizedEstimate(estimated.card), true);
  assert.equal(trustedListPriceUsd(estimated.card), 0);
  assert.equal(needsPriceSortBatch([estimated]), true);
});

test("frozen price-desc order does not reshuffle when a late lookup arrives", () => {
  const cheap = result({ id: "sv2a-1", name: "Bulbasaur", marketPriceUsd: 0.4 });
  const chase = result({
    id: "sv2a-201",
    name: "Charizard ex",
    marketPriceUsd: 0,
  });
  const results = [cheap, chase];
  const frozen = freezePriceSortedResults(results, { "sv2a-1": 0.4 }, "price-desc").map(
    (item) => item.card.slug,
  );

  assert.deepEqual(frozen, ["sv2a-1", "sv2a-201"]);

  const afterLatePrice = applyFrozenSearchOrder(
    freezePriceSortedResults(results, { "sv2a-1": 0.4, "sv2a-201": 361.86 }, "price-desc"),
    frozen,
  );

  assert.deepEqual(
    afterLatePrice.map((item) => item.card.slug),
    ["sv2a-1", "sv2a-201"],
  );
});

test("batch payloads keep only verified guide or sold prices", () => {
  assert.deepEqual(
    extractReliableBatchPrices({
      cheap: {
        primaryProvider: "tcgdex",
        ungradedUsd: 300,
        confidenceScore: 0.9,
        results: [{ provider: "tcgdex", ungradedUsd: 300, evidenceType: "catalog" }],
      },
      chase: {
        primaryProvider: "pricecharting-api",
        ungradedUsd: 4200,
        confidenceScore: 0.9,
        results: [
          { provider: "pricecharting-api", ungradedUsd: 4200, evidenceType: "guide_snapshot" },
        ],
      },
    }),
    { chase: 4200 },
  );
});

test("trusted prices win a merge until a reliable batch value replaces them", () => {
  assert.deepEqual(mergePriceSortUsd({ a: 12, b: 40 }, { b: 4100 }), { a: 12, b: 4100 });
});

test("price lookup fields round-trip slug and set identity", () => {
  const query = priceQueryFromLookupFields({
    slug: "ja--neo3-1",
    name: "Zubat",
    language: "ja",
    setCode: "neo3",
    number: "41",
    englishName: "Zubat",
  });

  assert.equal(query?.slug, "ja--neo3-1");
  assert.equal(query?.collectorNumber, "41");
  assert.equal(query?.englishName, "Zubat");
});
