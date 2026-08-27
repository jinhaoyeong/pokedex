import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketCardIdentity,
  priceChartingProductMatchesIdentity,
} from "../src/lib/market/card-identity";
import { getLocalizedSetMarketProfile } from "../src/lib/localized-set-market";
import { isVintageEnglishMarketCard, selectBest } from "../src/lib/price/resolve.server";
import type { PriceQuery, ProviderPriceResult } from "../src/lib/price/types";

function query(overrides: Partial<PriceQuery>): PriceQuery {
  return {
    slug: "ex8-107",
    language: "en",
    name: "Rayquaza Gold Star",
    setName: "EX Deoxys",
    setCode: "DX",
    collectorNumber: "107",
    rarity: "Gold Star Ultra Rare",
    ...overrides,
  };
}

function result(overrides: Partial<ProviderPriceResult>): ProviderPriceResult {
  return {
    provider: "tcgdex",
    sourceLabel: "TCGdex catalog",
    ungradedUsd: 27.29,
    matchConfidence: 1,
    confidenceScore: 0.5,
    evidenceType: "catalog",
    fetchedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

test("XY-P promo set codes resolve to the PriceCharting XY promo profile", () => {
  assert.equal(getLocalizedSetMarketProfile("XY-P")?.englishName, "XY Black Star Promos");
  assert.equal(getLocalizedSetMarketProfile("XYP")?.priceChartingSlug, "pokemon-promo");
});

test("EX Gold Stars are vintage English market cards for PriceCharting", () => {
  assert.equal(isVintageEnglishMarketCard(query({})), true);
  assert.equal(
    isVintageEnglishMarketCard(
      query({
        slug: "swsh7-215",
        name: "Umbreon VMAX",
        setName: "Evolving Skies",
        setCode: "EVS",
        rarity: "Secret Rare Alternate Art",
      }),
    ),
    false,
  );
});

test("catalog-only Gold Star TCGdex lows are not selected as the headline", () => {
  const selected = selectBest(
    [result({ ungradedUsd: 27.29 })],
    query({}),
  );
  assert.equal(selected, null);
});

test("PriceCharting matches Gold Star products that use bracketed titles", () => {
  const identity = buildMarketCardIdentity({
    language: "en",
    name: "Rayquaza Gold Star",
    setName: "EX Deoxys",
    setCode: "DX",
    collectorNumber: "107",
    rarity: "Gold Star Ultra Rare",
  });

  assert.equal(
    priceChartingProductMatchesIdentity(identity, {
      "product-name": "Rayquaza [Gold Star] #107",
      "console-name": "Pokemon EX Deoxys",
    }),
    true,
  );
  assert.equal(
    priceChartingProductMatchesIdentity(identity, {
      "product-name": "Rayquaza #107",
      "console-name": "Pokemon EX Deoxys",
    }),
    false,
  );
});

test("Mario Pikachu Japanese XY promos match PriceCharting promo titles", () => {
  const identity = buildMarketCardIdentity({
    language: "en",
    name: "Mario Pikachu Promo",
    setName: "Japanese XY Promos",
    setCode: "XY-P",
    collectorNumber: "294",
    rarity: "Japanese XY-P Promo",
  });

  assert.equal(identity.englishSetName, "XY Black Star Promos");
  assert.equal(
    priceChartingProductMatchesIdentity(identity, {
      "product-name": "Pikachu [Mario] #294",
      "console-name": "Pokemon Japanese XY Promo",
    }),
    true,
  );
});
