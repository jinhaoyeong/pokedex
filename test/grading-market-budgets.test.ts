import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_SOURCE_BUDGET_MS,
  ENGLISH_CORE_GRADING_BUDGET_MS,
  FULL_GRADING_BUDGET_MS,
  FULL_SOURCE_BUDGET_MS,
  LIVE_MARKET_CLIENT_TIMEOUT_MS,
  LOCALIZED_CORE_GRADING_BUDGET_MS,
  MAGERY_SOLD_COMP_BUDGET_MS,
  POPULATION_SOURCE_BUDGET_MS,
  PRICECHARTING_HTML_BUDGET_MS,
  SOLD_COMP_SOURCE_BUDGET_MS,
} from "../src/lib/market/grading-budgets";
import { resolveGuideChartValue } from "../src/lib/market/price-chart-guide";

test("full gather budgets outlive Magery and PriceCharting HTML timeouts", () => {
  assert.ok(CORE_SOURCE_BUDGET_MS >= PRICECHARTING_HTML_BUDGET_MS);
  assert.ok(POPULATION_SOURCE_BUDGET_MS >= PRICECHARTING_HTML_BUDGET_MS);
  assert.equal(SOLD_COMP_SOURCE_BUDGET_MS, MAGERY_SOLD_COMP_BUDGET_MS);
  assert.ok(FULL_SOURCE_BUDGET_MS >= MAGERY_SOLD_COMP_BUDGET_MS);
  assert.ok(FULL_GRADING_BUDGET_MS > FULL_SOURCE_BUDGET_MS);
  assert.ok(LOCALIZED_CORE_GRADING_BUDGET_MS > CORE_SOURCE_BUDGET_MS);
  assert.ok(ENGLISH_CORE_GRADING_BUDGET_MS > CORE_SOURCE_BUDGET_MS);
  assert.ok(LIVE_MARKET_CLIENT_TIMEOUT_MS > FULL_GRADING_BUDGET_MS);
});

test("snapshot-only charts use the live ungraded value instead of a leftover history snapshot", () => {
  assert.equal(
    resolveGuideChartValue(40.74, [66.05], "snapshot_only"),
    40.74,
  );
  assert.equal(
    resolveGuideChartValue(40.74, [40.8], "available"),
    40.8,
  );
  assert.equal(
    resolveGuideChartValue(undefined, [66.05], "snapshot_only"),
    66.05,
  );
});
