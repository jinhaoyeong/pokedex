import assert from "node:assert/strict";
import test from "node:test";

import {
  hasLiveMarketSignal,
  mergeLiveMarketHistory,
  mergeLiveRecentSales,
  shouldApplyLiveMarketPayload,
} from "../src/lib/market/live-market-merge";
import type { MarketHistorySummary, SaleRecord } from "../src/types/pokemon";

function sale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    date: "2026-07-18",
    title: "Charizard #4 Base Set",
    condition: "Ungraded",
    price: 1406.55,
    source: "PriceCharting completed eBay sales",
    sourceUrl: "https://www.pricecharting.com/game/pokemon-base-set/charizard-4",
    evidenceType: "sold_comp",
    ...overrides,
  };
}

const availableHistory: MarketHistorySummary = {
  status: "available",
  historyUnavailable: false,
  realSaleCount: 3,
  note: "Dated accepted sold listings support the market-history chart.",
};

const timeoutHistory: MarketHistorySummary = {
  status: "unavailable",
  historyUnavailable: true,
  realSaleCount: 0,
  note: "No real dated market history is available for this print.",
};

test("timeout payloads without signal are not applied", () => {
  assert.equal(
    shouldApplyLiveMarketPayload({
      timedOut: true,
      status: "timeout",
      psaPopulation: null,
      gradedPrices: [],
      priceHistory: [],
      recentSales: [],
      marketHistory: timeoutHistory,
    }),
    false,
  );
  assert.equal(
    shouldApplyLiveMarketPayload({
      status: "timeout",
      gradedPrices: [{ value: 1406.55 }],
      recentSales: [sale()],
    }),
    true,
  );
});

test("empty timeout payloads do not look like live market signal", () => {
  assert.equal(
    hasLiveMarketSignal({
      timedOut: true,
      psaPopulation: null,
      gradedPrices: [],
      priceHistory: [],
      recentSales: [],
    }),
    false,
  );
});

test("empty incoming sales keep accepted comps and drop preview-only rows", () => {
  assert.deepEqual(mergeLiveRecentSales([sale()], []), [sale()]);
  assert.deepEqual(
    mergeLiveRecentSales(
      [sale({ source: "Bundled grail preview", listingUrl: "preview" })],
      [],
    ),
    [],
  );
  assert.deepEqual(mergeLiveRecentSales([sale()], [sale({ price: 199 })]), [
    sale({ price: 199 }),
  ]);
});

test("timeout history does not clobber sold-backed history", () => {
  assert.deepEqual(mergeLiveMarketHistory(availableHistory, timeoutHistory), availableHistory);
  assert.equal(
    mergeLiveMarketHistory(availableHistory, {
      ...timeoutHistory,
      realSaleCount: 1,
      status: "limited",
      historyUnavailable: false,
    })?.status,
    "available",
  );
  assert.equal(
    mergeLiveMarketHistory(timeoutHistory, availableHistory)?.status,
    "available",
  );
});
