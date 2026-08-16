import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_UNAVAILABLE_NOTICE,
  isEmptyLandingSearch,
  isSearchUnavailableNotice,
  shouldReplaceWithStaticTrending,
} from "../src/lib/search-landing-fallback";
import { getStaticTrendingSearchResponse } from "../src/lib/static-trending";

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
});
