import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_UNAVAILABLE_NOTICE,
  isEmptyLandingSearch,
  isSearchUnavailableNotice,
  shouldApplyStoredSearchDefaults,
  shouldCommitStaticDexLanding,
  shouldReplaceWithStaticTrending,
  shouldUseBootHotSearchForRequest,
} from "../src/lib/search-landing-fallback";
import { SEARCH_PAGE_SIZE } from "../src/lib/search-constants";
import {
  getStaticMarketPool,
  getStaticTrendingSearchResponse,
} from "../src/lib/static-trending";
import { searchPrintIdentityKey } from "../src/lib/card-finish";

test("empty Dex landing is the no-query first page", () => {
  assert.equal(isEmptyLandingSearch("", undefined, 1), true);
  assert.equal(isEmptyLandingSearch("  ", "", 1), true);
  assert.equal(isEmptyLandingSearch("pikachu", undefined, 1), false);
  assert.equal(isEmptyLandingSearch("", "sv8pt5", 1), false);
  assert.equal(isEmptyLandingSearch("", undefined, 2), false);
});

test("empty Dex landing never keeps an unavailable or empty live miss", () => {
  assert.equal(
    shouldReplaceWithStaticTrending({
      query: "",
      resultsLength: 0,
      notice: SEARCH_UNAVAILABLE_NOTICE,
    }),
    true,
  );
  assert.equal(
    shouldReplaceWithStaticTrending({
      query: "",
      resultsLength: 0,
    }),
    true,
  );
  assert.equal(
    shouldReplaceWithStaticTrending({
      query: "charizard",
      resultsLength: 0,
      notice: SEARCH_UNAVAILABLE_NOTICE,
    }),
    false,
  );
  assert.equal(
    shouldReplaceWithStaticTrending({
      query: "",
      resultsLength: 12,
    }),
    false,
  );
  assert.equal(isSearchUnavailableNotice(SEARCH_UNAVAILABLE_NOTICE), true);
});

test("empty Dex landing commits bundled trending instead of live or boot-hot lists", () => {
  assert.equal(
    shouldCommitStaticDexLanding({ query: "", sort: "relevance" }),
    true,
  );
  assert.equal(
    shouldCommitStaticDexLanding({ query: "", sort: undefined }),
    true,
  );
  assert.equal(
    shouldCommitStaticDexLanding({ query: "", sort: "price-desc" }),
    false,
  );
  assert.equal(
    shouldCommitStaticDexLanding({ query: "pikachu", sort: "relevance" }),
    false,
  );
  assert.equal(
    shouldCommitStaticDexLanding({ query: "", setFilter: "sv8pt5", sort: "relevance" }),
    false,
  );
  assert.equal(
    shouldUseBootHotSearchForRequest({ query: "", setFilter: "", page: 1, sort: "price-desc" }),
    true,
  );
  assert.equal(
    shouldUseBootHotSearchForRequest({ query: "", setFilter: "", page: 1, sort: "relevance" }),
    false,
  );
  assert.equal(shouldApplyStoredSearchDefaults({ query: "", setFilter: "" }), false);
  assert.equal(shouldApplyStoredSearchDefaults({ query: "charizard", setFilter: "" }), true);
  assert.equal(shouldApplyStoredSearchDefaults({ query: "", setFilter: "base1" }), true);
});

test("bundled trending has cards and no outage notice", () => {
  const response = getStaticTrendingSearchResponse();

  assert.ok(response.results.length > 0);
  assert.equal(response.notice, undefined);
  assert.ok(response.results.every((result) => result.card.slug && result.card.name));
  assert.ok(response.results.length <= SEARCH_PAGE_SIZE);
  assert.equal(response.pageSize, SEARCH_PAGE_SIZE);
});

test("static Dex trending keeps 1st Edition Charizard at the live raw market", () => {
  const charizard = getStaticMarketPool().find((card) => card.slug === "base1-4-1st-edition");

  assert.ok(charizard);
  assert.equal(charizard.finish, "firstEditionHolofoil");
  assert.equal(charizard.marketPriceUsd, 6500);
  assert.notEqual(charizard.marketPriceUsd, 185000);
  assert.ok(
    getStaticMarketPool().every((card) => card.marketPriceUsd > 0),
    "Dex fallback tiles must ship with a visible market value",
  );
});

test("static Dex trending shows one tile per print, not holo and 1st Edition side by side", () => {
  const response = getStaticTrendingSearchResponse();
  const keys = response.results.map((result) => searchPrintIdentityKey(result.card));

  assert.equal(keys.length, new Set(keys).size);
  assert.equal(
    response.results.filter((result) => /charizard/i.test(result.card.name)).length,
    new Set(
      response.results
        .filter((result) => /charizard/i.test(result.card.name))
        .map((result) => searchPrintIdentityKey(result.card)),
    ).size,
  );
});
