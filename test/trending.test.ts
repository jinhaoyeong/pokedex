import assert from "node:assert/strict";
import test from "node:test";

import {
  cardTrendingScore,
  cardWeekChange,
  formatWeekChangePercent,
  rankSearchResultsByTrending,
} from "../src/lib/trending";
import type { SearchResult, TcgCard } from "../src/types/pokemon";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

function card(partial: Partial<TcgCard> & Pick<TcgCard, "id" | "name" | "marketPriceUsd">): TcgCard {
  return {
    slug: partial.id,
    language: "en",
    languageLabel: "English",
    collectorNumber: partial.collectorNumber ?? "1",
    rarity: "Rare Holo",
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
  } as TcgCard;
}

function result(partial: Partial<TcgCard> & Pick<TcgCard, "id" | "name" | "marketPriceUsd">): SearchResult {
  return {
    score: 0,
    matchReason: "Trending & Hot",
    card: card(partial),
  };
}

test("a modest modern mover outranks a flat vintage grail", () => {
  const mover = card({
    id: "sv8-247",
    name: "Pikachu ex SIR",
    marketPriceUsd: 24,
    priceHistory: [
      { date: "2026-08-25", value: 18 },
      { date: "2026-09-01", value: 24 },
    ],
  });
  const grail = card({
    id: "base1-4",
    name: "Charizard",
    marketPriceUsd: 6500,
    priceHistory: [
      { date: "2026-08-25", value: 6480 },
      { date: "2026-09-01", value: 6500 },
    ],
  });

  assert.ok(cardTrendingScore(mover, NOW) > cardTrendingScore(grail, NOW));

  const ranked = rankSearchResultsByTrending(
    [
      result({
        id: grail.id,
        name: grail.name,
        marketPriceUsd: grail.marketPriceUsd,
        priceHistory: grail.priceHistory,
      }),
      result({
        id: mover.id,
        name: mover.name,
        marketPriceUsd: mover.marketPriceUsd,
        priceHistory: mover.priceHistory,
      }),
    ],
    NOW,
  );

  assert.equal(ranked[0]?.card.id, "sv8-247");
});

test("cards below the trending price floor do not rank on noise", () => {
  const penny = card({
    id: "sv1-1",
    name: "Sprigatito",
    marketPriceUsd: 0.4,
    priceHistory: [
      { date: "2026-08-25", value: 0.2 },
      { date: "2026-09-01", value: 0.4 },
    ],
  });

  assert.equal(cardTrendingScore(penny, NOW), 0);
});

test("week change reports the 7-day percent used to rank movers", () => {
  const mover = card({
    id: "sv8-247",
    name: "Pikachu ex SIR",
    marketPriceUsd: 24,
    priceHistory: [
      { date: "2026-08-25", value: 18 },
      { date: "2026-09-01", value: 24 },
    ],
  });
  const change = cardWeekChange(mover, NOW);

  assert.ok(change);
  assert.equal(Math.round(change.percent * 100), 33);
  assert.equal(formatWeekChangePercent(change), "+33.3%");
});
