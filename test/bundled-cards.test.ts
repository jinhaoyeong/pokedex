import assert from "node:assert/strict";
import test from "node:test";

import { lookupBundledCardBySlug, searchBundledCards } from "../src/lib/bundled-cards";
import { expandSearchResultEditions } from "../src/lib/card-finish";

test("bundled catalog fallback returns a full Charizard page, not a stub", () => {
  const cards = searchBundledCards({ query: "charizard", language: "en", limit: 24 });

  assert.ok(cards.length >= 5, `expected several Charizard prints, got ${cards.length}`);
  assert.ok(cards.some((card) => card.slug === "base1-4"));
  assert.ok(cards.every((card) => /charizard/i.test(card.name)));
});

test("bundled Base Set Charizard keeps 1st Edition off the unlimited headline", () => {
  const cards = searchBundledCards({
    query: "charizard",
    setFilter: "base1",
    language: "en",
    limit: 24,
  });
  const baseCharizard = cards.find((card) => card.slug === "base1-4");

  assert.ok(baseCharizard);
  const expanded = expandSearchResultEditions([
    { card: baseCharizard!, score: 100, matchReason: "bundled" },
  ]);
  const unlimited = expanded.find((result) => result.card.slug === "base1-4");
  const firstEdition = expanded.find((result) => result.card.slug === "base1-4-1st-edition");

  assert.ok(unlimited);
  assert.ok(firstEdition);
  assert.equal(firstEdition!.card.finish, "firstEditionHolofoil");
  assert.equal(unlimited!.card.finish, "holofoil");
  assert.ok((unlimited!.card.marketPriceUsd ?? 0) > 0);
  assert.equal(firstEdition!.card.marketPriceUsd, 0);
  assert.notEqual(firstEdition!.card.marketPriceUsd, unlimited!.card.marketPriceUsd);
});

test("bundled slug lookup skips homepage grail previews so 1st Edition can load live", () => {
  const preview = lookupBundledCardBySlug("base1-4-1st-edition");
  assert.equal(preview, null);
});
