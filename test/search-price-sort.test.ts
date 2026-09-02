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

test("price-desc ignores sibling/group estimates so chase cards are not buried", () => {
  const sorted = applySearchResultSort(
    [
      result({
        id: "me2pt5-226",
        name: "Psyduck",
        collectorNumber: "226",
        language: "ja",
        marketPriceUsd: 66.5,
        sources: [
          {
            source: "Localized search group estimate",
            status: "estimated",
            fetchedAt: "2026-01-01T00:00:00.000Z",
            confidence: 0.2,
            note: "Group estimate",
          },
        ],
        priceConsensus: {
          finalEstimateUsd: 66.5,
          confidence: "low",
          confidenceScore: 0.2,
          sourceCount: 1,
          sampleCount: 0,
          methodology: "Group estimate",
          sources: [
            {
              source: "Localized search group estimate",
              value: 66.5,
              confidence: "low",
              confidenceScore: 0.2,
              evidenceType: "catalog",
              note: "Group estimate",
            },
          ],
        },
      }),
      result({
        id: "me2pt5-295",
        name: "Mega Dragonite ex",
        collectorNumber: "295",
        language: "en",
        marketPriceUsd: 420,
        sources: [
          {
            source: "PriceCharting set guide",
            status: "verified",
            fetchedAt: "2026-01-01T00:00:00.000Z",
            confidence: 0.62,
            note: "Set guide",
          },
        ],
        priceConsensus: {
          finalEstimateUsd: 420,
          confidence: "medium",
          confidenceScore: 0.62,
          sourceCount: 1,
          sampleCount: 1,
          methodology: "Set guide",
          sources: [
            {
              source: "PriceCharting set guide",
              value: 420,
              confidence: "medium",
              confidenceScore: 0.62,
              evidenceType: "guide_snapshot",
              note: "Set guide",
            },
          ],
        },
      }),
    ],
    "price-desc",
  );

  assert.equal(sorted[0]?.card.id, "me2pt5-295");
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
