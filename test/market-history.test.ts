import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMarketHistory,
  mergeMarketHistoryPointType,
} from "../src/lib/market/market-history";
import type { PricePoint, SaleRecord } from "../src/types/pokemon";

function sale(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    date: "2026-07-18",
    title: "Mega Gengar ex #230 Japanese M2a",
    condition: "PSA 10",
    price: 155,
    source: "PriceCharting completed sales",
    sourceUrl:
      "https://www.pricecharting.com/game/pokemon-japanese-mega-dream-ex/mega-gengar-ex-230",
    evidenceType: "sold_comp",
    ...overrides,
  };
}

test("guide and projected points are snapshot-only, never real market history", () => {
  const points: PricePoint[] = [
    {
      date: "2026-07-22",
      value: 149.99,
      pointType: "guide-snapshot",
    },
    {
      date: "2026-07-23",
      value: 149.99,
      pointType: "projected",
      isProjected: true,
    },
  ];

  assert.deepEqual(classifyMarketHistory(points, []), {
    status: "snapshot_only",
    historyUnavailable: true,
    realSaleCount: 0,
    note: "Current guide/catalog snapshots are available, but no real dated sale history was accepted.",
  });
});

test("one accepted dated sale is limited history while two are available history", () => {
  const points: PricePoint[] = [
    { date: "2026-07-18", value: 155, pointType: "sold" },
  ];

  const limited = classifyMarketHistory(points, [sale()]);
  const available = classifyMarketHistory(points, [
    sale(),
    sale({ date: "2026-07-10", price: 147 }),
  ]);

  assert.equal(limited.status, "limited");
  assert.equal(limited.historyUnavailable, false);
  assert.equal(limited.realSaleCount, 1);
  assert.equal(available.status, "available");
  assert.equal(available.historyUnavailable, false);
  assert.equal(available.realSaleCount, 2);
});

test("preview records do not qualify as real dated sales", () => {
  const result = classifyMarketHistory(
    [{ date: "2026-07-22", value: 149.99, pointType: "guide-snapshot" }],
    [sale({ source: "Bundled grail preview" })],
  );

  assert.equal(result.status, "snapshot_only");
  assert.equal(result.historyUnavailable, true);
  assert.equal(result.realSaleCount, 0);
});

test("realized sales outrank guide, baseline, and projected point types", () => {
  assert.equal(mergeMarketHistoryPointType("projected", "catalog-baseline"), "catalog-baseline");
  assert.equal(mergeMarketHistoryPointType("catalog-baseline", "guide-snapshot"), "guide-snapshot");
  assert.equal(mergeMarketHistoryPointType("guide-snapshot", "sold"), "sold");
  assert.equal(mergeMarketHistoryPointType("sold", "projected"), "sold");
});
