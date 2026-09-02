import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_DETAIL_FIRST_PAINT_CLIENT_MS,
  CARD_DETAIL_FIRST_PAINT_MS,
  CORE_SOURCE_BUDGET_MS,
  ENGLISH_CORE_GRADING_BUDGET_MS,
  FULL_GRADING_BUDGET_MS,
  FULL_SOURCE_BUDGET_MS,
  LIVE_MARKET_CLIENT_TIMEOUT_MS,
  LOCALIZED_CORE_GRADING_BUDGET_MS,
  MAGERY_SOLD_COMP_BUDGET_MS,
  PRICECHARTING_HTML_BUDGET_MS,
} from "../src/lib/market/grading-budgets";
import { hasPrimaryLiveMarketPanels } from "../src/lib/market/live-market-merge";
import { cardNeedsSetGuideHydration } from "../src/lib/market/pricecharting-set-guide.server";
import { resolveGuideChartValue } from "../src/lib/market/price-chart-guide";
import { isIncompleteSetBrowseFallback } from "../src/lib/search-landing-fallback";
import type { TcgCard } from "../src/types/pokemon";

test("card-detail first paint stays inside 5s and targets 4.5s", () => {
  assert.ok(CARD_DETAIL_FIRST_PAINT_MS <= 4_500);
  assert.equal(CARD_DETAIL_FIRST_PAINT_CLIENT_MS, 5_000);
  assert.equal(CORE_SOURCE_BUDGET_MS, CARD_DETAIL_FIRST_PAINT_MS);
  assert.ok(ENGLISH_CORE_GRADING_BUDGET_MS <= CARD_DETAIL_FIRST_PAINT_CLIENT_MS);
  assert.ok(LOCALIZED_CORE_GRADING_BUDGET_MS <= CARD_DETAIL_FIRST_PAINT_CLIENT_MS);
  assert.ok(CARD_DETAIL_FIRST_PAINT_CLIENT_MS < MAGERY_SOLD_COMP_BUDGET_MS);
  assert.ok(CARD_DETAIL_FIRST_PAINT_CLIENT_MS < PRICECHARTING_HTML_BUDGET_MS);
});

test("full gather budgets still outlive Magery when sold comps are expanded", () => {
  assert.ok(FULL_SOURCE_BUDGET_MS >= MAGERY_SOLD_COMP_BUDGET_MS);
  assert.ok(FULL_GRADING_BUDGET_MS > FULL_SOURCE_BUDGET_MS);
  assert.ok(LIVE_MARKET_CLIENT_TIMEOUT_MS > FULL_GRADING_BUDGET_MS);
});

test("snapshot-only charts use the live ungraded value instead of a leftover history snapshot", () => {
  assert.equal(resolveGuideChartValue(40.74, [66.05], "snapshot_only"), 40.74);
  assert.equal(resolveGuideChartValue(40.74, [40.8], "available"), 40.8);
  assert.equal(resolveGuideChartValue(undefined, [66.05], "snapshot_only"), 66.05);
});

test("a two-card local stub is not a finished set browse", () => {
  assert.equal(
    isIncompleteSetBrowseFallback({
      setFilter: "base1",
      resultCount: 2,
      totalCount: 2,
      notice:
        "Live catalog is unreachable right now, so these results come from the local card index. Prices refresh as sources recover.",
    }),
    true,
  );
  assert.equal(
    isIncompleteSetBrowseFallback({
      setFilter: "base1",
      resultCount: 102,
      totalCount: 102,
      notice:
        "Live catalog is unreachable right now, so these results come from the local card index. Prices refresh as sources recover.",
    }),
    false,
  );
  assert.equal(
    isIncompleteSetBrowseFallback({
      resultCount: 2,
      notice:
        "Live catalog is unreachable right now, so these results come from the local card index. Prices refresh as sources recover.",
    }),
    false,
  );
});

test("catalog ungraded prices still need set-guide slab hydration", () => {
  const card = {
    marketPriceUsd: 2087,
    gradedPrices: [{ grade: "Ungraded", value: 2087, populationCount: 0, service: "RAW" }],
    finishMarkets: [],
  } as Pick<TcgCard, "marketPriceUsd" | "gradedPrices" | "finishMarkets" | "finish">;

  assert.equal(cardNeedsSetGuideHydration(card as TcgCard), true);
  assert.equal(
    cardNeedsSetGuideHydration({
      ...card,
      gradedPrices: [
        { grade: "Ungraded", value: 2087, populationCount: 0, service: "RAW" },
        { grade: "PSA 10", value: 4200, populationCount: 0, service: "PSA" },
      ],
    } as TcgCard),
    false,
  );
});

test("ungraded-only catalog prices are not a primary live market panel", () => {
  assert.equal(
    hasPrimaryLiveMarketPanels({
      gradedPrices: [{ grade: "Ungraded", value: 27.99 }],
    }),
    false,
  );
  assert.equal(
    hasPrimaryLiveMarketPanels({
      gradedPrices: [{ grade: "PSA 10", value: 180 }],
    }),
    true,
  );
});
