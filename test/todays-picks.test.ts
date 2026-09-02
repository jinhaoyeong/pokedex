import assert from "node:assert/strict";
import test from "node:test";

import { TODAYS_PICKS_LIMIT } from "../src/lib/preview-constants";
import { slimHomePreviewCard } from "../src/lib/preview-selection";
import { selectTodaysPicks } from "../src/lib/todays-picks";
import type { TcgCard } from "../src/types/pokemon";

function card(id: string, name: string): TcgCard {
  return {
    id,
    slug: id,
    language: "en",
    languageLabel: "English",
    name,
    collectorNumber: "1",
    rarity: "Rare Holo",
    setId: "sv4pt5",
    setCode: "sv4pt5",
    setName: "Paldean Fates",
    image: "https://images.pokemontcg.io/sv4pt5/232.png",
    artist: "test",
    supertype: "Pokemon",
    hp: "100",
    types: ["Psychic"],
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
    marketPriceUsd: 20 + Number(id.replace(/\D/g, "") || 0),
  } as unknown as TcgCard;
}

test("today's picks keep three cards from a larger live pool", () => {
  const pool = Array.from({ length: 12 }, (_, index) =>
    card(`live-${index + 1}`, `Mover ${index + 1}`),
  );
  const picks = selectTodaysPicks(pool, TODAYS_PICKS_LIMIT);

  assert.equal(TODAYS_PICKS_LIMIT, 3);
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks.map((item) => item.slug)).size, 3);
  assert.ok(picks.every((item) => pool.some((entry) => entry.slug === item.slug)));
});

test("today's picks stay stable for the same UTC day", () => {
  const pool = Array.from({ length: 12 }, (_, index) =>
    card(`live-${index + 1}`, `Mover ${index + 1}`),
  );

  assert.deepEqual(
    selectTodaysPicks(pool, 3).map((item) => item.slug),
    selectTodaysPicks(pool, 3).map((item) => item.slug),
  );
});

test("hero and picks come from the same live pool", () => {
  const pool = Array.from({ length: 12 }, (_, index) =>
    card(`live-${index + 1}`, `Mover ${index + 1}`),
  );
  const hero = pool.slice(0, 5);
  const picks = selectTodaysPicks(pool, 3);

  assert.equal(hero.length, 5);
  assert.ok(picks.every((item) => pool.some((entry) => entry.slug === item.slug)));
});

test("slim home preview card drops heavy market panels", () => {
  const full = card("sv4pt5-232", "Mew ex");
  full.recentSales = [
    {
      date: "2026-01-01",
      title: "sale",
      condition: "Ungraded",
      price: 10,
      source: "test",
    },
  ];
  full.sources = [
    {
      source: "test",
      status: "estimated",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      confidence: 0.5,
      note: "test",
    },
  ];

  const slim = slimHomePreviewCard(full);

  assert.equal(slim.slug, "sv4pt5-232");
  assert.equal(slim.recentSales.length, 0);
  assert.equal(slim.sources.length, 0);
  assert.equal(slim.image, full.image);
});
