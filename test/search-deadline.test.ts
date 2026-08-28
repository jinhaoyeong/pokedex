import assert from "node:assert/strict";
import test from "node:test";

import {
  FAST_SEARCH_BUDGET_MS,
  firstSuccessfulSearch,
  isCollectorNumberSearchQuery,
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

test("standalone collector codes are detected without a name", () => {
  assert.equal(isCollectorNumberSearchQuery("071/067"), true);
  assert.equal(isCollectorNumberSearchQuery("100/095"), true);
  assert.equal(isCollectorNumberSearchQuery("288/SV-P"), true);
  assert.equal(isCollectorNumberSearchQuery("dialga"), false);
  assert.equal(isCollectorNumberSearchQuery("Dialga 071/067"), false);
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

test("firstSuccessfulSearch returns the first payload that has results", async () => {
  const started = Date.now();
  const value = await firstSuccessfulSearch(
    [
      new Promise<{ results: string[] }>((resolve) => {
        setTimeout(() => resolve({ results: ["slow"] }), 80);
      }),
      Promise.resolve({ results: ["fast"] }),
    ],
    200,
    { results: [] },
  );
  assert.deepEqual(value.results, ["fast"]);
  assert.ok(Date.now() - started < 50);
});
