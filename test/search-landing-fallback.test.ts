import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_UNAVAILABLE_NOTICE,
  isEmptyLandingSearch,
  isSearchUnavailableNotice,
  shouldReplaceWithStaticTrending,
} from "../src/lib/search-landing-fallback";
import { SEARCH_PAGE_SIZE } from "../src/lib/search-constants";
import {
  getStaticMarketPool,
  getStaticTrendingSearchResponse,
} from "../src/lib/static-trending";

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

test("bundled trending has cards and no outage notice", () => {
  const response = getStaticTrendingSearchResponse();

  assert.ok(response.results.length > 0);
  assert.equal(response.notice, undefined);
  assert.ok(response.results.every((result) => result.card.slug && result.card.name));
  assert.ok(response.results.length <= SEARCH_PAGE_SIZE);
  assert.equal(response.pageSize, SEARCH_PAGE_SIZE);
});

test("static Dex trending does not show the $185k 1st Edition Charizard showcase", () => {
  const charizard = getStaticMarketPool().find((card) => card.slug === "base1-4-1st-edition");

  assert.ok(charizard);
  assert.equal(charizard.finish, "firstEditionHolofoil");
  assert.notEqual(charizard.marketPriceUsd, 185000);
  assert.equal(charizard.marketPriceUsd, 0);
  assert.equal(
    charizard.finishMarkets?.every((market) => market.ungradedUsd === 0) ?? true,
    true,
  );
});
