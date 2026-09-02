import assert from "node:assert/strict";
import test from "node:test";

import { readSearchResult, writeSearchResult } from "../src/lib/search-result-store.server";

test("priced Dex payloads round-trip through the shared cache without a database", async () => {
  const key = `test-shared-${Date.now()}`;
  await writeSearchResult(
    key,
    { results: [{ card: { slug: "me02.5-295", marketPriceUsd: 227.12 } }] },
    {
      query: "",
      setFilter: "me2pt5",
      page: 1,
      language: "all",
      sort: "price-desc",
      resultCount: 1,
    },
  );

  const cached = await readSearchResult<{
    results: Array<{ card: { slug: string; marketPriceUsd: number } }>;
  }>(key, 60_000);

  assert.equal(cached?.results[0]?.card.slug, "me02.5-295");
  assert.equal(cached?.results[0]?.card.marketPriceUsd, 227.12);
});
