import assert from "node:assert/strict";
import test from "node:test";

import {
  applySelectedFinish,
  extractFinishMarketsFromPriceMap,
  filterSalesForFinish,
  inferPrimaryFinish,
  productUrlMatchesFinish,
  saleMatchesFinish,
  standardFinishesForRarity,
  withPriceChartingFinishSuffixes,
} from "../src/lib/card-finish";
import { buildSetSearchHref } from "../src/lib/set-search-href";
import type { SaleRecord, TcgCard } from "../src/types/pokemon";

test("catalog price buckets become distinct non-holo, holo, and reverse markets", () => {
  const markets = extractFinishMarketsFromPriceMap({
    normal: { market: 0.73 },
    holofoil: { market: 4.2 },
    reverseHolofoil: { market: 198 },
  });

  assert.deepEqual(
    markets.map((market) => [market.id, market.ungradedUsd]),
    [
      ["normal", 0.73],
      ["holofoil", 4.2],
      ["reverseHolofoil", 198],
    ],
  );
});

test("commons default to non-holo while rare holos default to holofoil", () => {
  assert.equal(inferPrimaryFinish("Common", ["normal", "reverseHolofoil"]), "normal");
  assert.equal(inferPrimaryFinish("Rare Holo", ["holofoil", "reverseHolofoil"]), "holofoil");
  assert.equal(inferPrimaryFinish("Common", []), "normal");
});

test("missing catalog buckets still expose the finishes collectors actually trade", () => {
  assert.deepEqual(standardFinishesForRarity("Common"), ["normal", "reverseHolofoil"]);
  assert.deepEqual(standardFinishesForRarity("Rare Holo"), ["holofoil", "reverseHolofoil"]);
  assert.deepEqual(standardFinishesForRarity("Promo"), ["holofoil"]);
  assert.deepEqual(standardFinishesForRarity("Unknown", "Charizard ex"), ["holofoil"]);
});

test("sold titles are kept on the matching finish only", () => {
  const reverse: SaleRecord = {
    date: "2026-08-14",
    title: "Machop 51/108 Reverse Holo XY Evolutions",
    condition: "Ungraded",
    price: 12,
    source: "PriceCharting completed eBay sales",
  };
  const raw: SaleRecord = {
    date: "2026-08-14",
    title: "Machop 51/108 XY Evolutions",
    condition: "Ungraded",
    price: 1,
    source: "PriceCharting completed eBay sales",
  };

  assert.equal(saleMatchesFinish(reverse, "reverseHolofoil"), true);
  assert.equal(saleMatchesFinish(raw, "reverseHolofoil"), false);
  assert.equal(saleMatchesFinish(raw, "normal"), true);
  assert.deepEqual(filterSalesForFinish([reverse, raw], "reverseHolofoil"), [reverse]);
});

test("PriceCharting reverse URLs are not reused for the non-holo print", () => {
  const reverseUrl = "https://www.pricecharting.com/game/pokemon-xy-evolutions/machop-51-reverse-holo";
  const normalUrl = "https://www.pricecharting.com/game/pokemon-xy-evolutions/machop-51";

  assert.equal(productUrlMatchesFinish(reverseUrl, "reverseHolofoil"), true);
  assert.equal(productUrlMatchesFinish(reverseUrl, "normal"), false);
  assert.equal(productUrlMatchesFinish(normalUrl, "normal"), true);
  assert.equal(productUrlMatchesFinish(normalUrl, "reverseHolofoil"), false);
  assert.deepEqual(
    withPriceChartingFinishSuffixes(normalUrl, "reverseHolofoil"),
    [`${normalUrl}-reverse-holo`, `${normalUrl}-reverse`],
  );
});

test("selected reverse finish clears mixed comps so that print can load its own market", () => {
  const card = {
    slug: "xy12-51",
    finish: "normal",
    finishMarkets: [
      { id: "normal", label: "Non-holo", shortLabel: "Non-holo", ungradedUsd: 0.73 },
      { id: "reverseHolofoil", label: "Reverse holo", shortLabel: "Reverse", ungradedUsd: 198 },
    ],
    marketPriceUsd: 0.73,
    gradedPrices: [{ grade: "Ungraded", value: 0.73, populationCount: 0 }],
    recentSales: [{ date: "2026-08-14", title: "Machop", condition: "Ungraded", price: 1, source: "x" }],
    psaPopulation: { status: "ready", totalCertified: 12, grades: [], source: "x", fetchedAt: null },
    priceHistory: [],
  } as unknown as TcgCard;

  const reversed = applySelectedFinish(card, "reverseHolofoil");
  assert.equal(reversed.finish, "reverseHolofoil");
  assert.equal(reversed.marketPriceUsd, 198);
  assert.equal(reversed.recentSales.length, 0);
});

test("set name links browse that set's English card list by collector number", () => {
  assert.equal(
    buildSetSearchHref({ setId: "smp", setCode: "SMP", language: "en" }),
    "/search?set=smp&lang=en&sort=number-asc",
  );
});
