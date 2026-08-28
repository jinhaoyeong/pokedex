import assert from "node:assert/strict";
import test from "node:test";

import {
  FAST_SEARCH_BUDGET_MS,
  isSimpleNameSearchQuery,
  remainingSearchBudget,
  withSearchBudget,
} from "../src/lib/search-deadline";

test("simple name queries skip set-catalog scans", () => {
  assert.equal(isSimpleNameSearchQuery("pikachu"), true);
  assert.equal(isSimpleNameSearchQuery("Pikachu ex"), true);
  assert.equal(isSimpleNameSearchQuery("charizard"), true);
  assert.equal(isSimpleNameSearchQuery("base1-4"), false);
  assert.equal(isSimpleNameSearchQuery("4/102"), false);
  assert.equal(isSimpleNameSearchQuery("Prismatic Evolutions Pikachu"), false);
});

test("search budget helper returns the fallback when the work is too slow", async () => {
  const started = Date.now();
  const value = await withSearchBudget(
    new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 200);
    }),
    20,
    "fast",
  );
  assert.equal(value, "fast");
  assert.ok(Date.now() - started < 80);
});

test("search budget helper keeps a fast result", async () => {
  const value = await withSearchBudget(Promise.resolve("ready"), 50, "fallback");
  assert.equal(value, "ready");
});

test("named search budget stays under 3 seconds", () => {
  assert.ok(FAST_SEARCH_BUDGET_MS <= 2_200);
  assert.equal(remainingSearchBudget(Date.now(), FAST_SEARCH_BUDGET_MS) <= FAST_SEARCH_BUDGET_MS, true);
});
