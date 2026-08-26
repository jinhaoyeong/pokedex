import assert from "node:assert/strict";
import test from "node:test";

import { applySearchResultSort } from "../src/lib/pokemon-tcg/market-enrichment";
import type { SearchResult, TcgCard } from "../src/types/pokemon";

function result(partial: Partial<TcgCard> & Pick<TcgCard, "id" | "name" | "marketPriceUsd">): SearchResult {
  return {
    score: 100,
    matchReason: "test",
    card: {
      slug: partial.id,
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

test("price-desc ranks a priced chase card above later collector numbers at $0", () => {
  const sorted = applySearchResultSort(
    [
      result({ id: "sv2a-208", name: "Basic Energy", collectorNumber: "208", marketPriceUsd: 1.5 }),
      result({ id: "sv2a-201", name: "Charizard ex", collectorNumber: "201", marketPriceUsd: 361.86 }),
      result({ id: "sv2a-205", name: "Trainer", collectorNumber: "205", marketPriceUsd: 0 }),
    ],
    "price-desc",
  );

  assert.equal(sorted[0]?.card.id, "sv2a-201");
  assert.equal(sorted[0]?.card.marketPriceUsd, 361.86);
  assert.ok((sorted[0]?.card.marketPriceUsd ?? 0) > (sorted[1]?.card.marketPriceUsd ?? 0));
});

test("price-asc keeps unpriced cards after real cheap cards", () => {
  const sorted = applySearchResultSort(
    [
      result({ id: "sv2a-201", name: "Charizard ex", collectorNumber: "201", marketPriceUsd: 361.86 }),
      result({ id: "sv2a-1", name: "Bulbasaur", collectorNumber: "1", marketPriceUsd: 0.41 }),
      result({ id: "sv2a-2", name: "Ivysaur", collectorNumber: "2", marketPriceUsd: 0 }),
    ],
    "price-asc",
  );

  assert.equal(sorted[0]?.card.id, "sv2a-1");
  assert.equal(sorted[sorted.length - 1]?.card.id, "sv2a-2");
});
