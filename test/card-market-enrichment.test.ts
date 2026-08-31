import assert from "node:assert/strict";
import test from "node:test";

import { resolveGradingMarketLookupCardName, resolveGradingMarketLookupSetName } from "../src/lib/grading-market-lookup";
import { cardMarketEnrichmentKey } from "../src/lib/grading-market-params";
import {
  getPriceChartingSetSlugVariants,
  rankPriceChartingSetSlugs,
} from "../src/lib/localized-set-market";
import {
  buildMarketCardIdentity,
  priceChartingProductMatchesIdentity,
} from "../src/lib/market/card-identity";
import { buildMarketResultCacheKey } from "../src/lib/psa-population";

test("card detail market identity ignores catalog price and set-total hydration", () => {
  const first = cardMarketEnrichmentKey({
    slug: "base1-4-1st-edition",
    finish: "firstEditionHolofoil",
    language: "en",
    setCode: "BASE1",
    collectorNumber: "4",
  });
  const afterHydration = cardMarketEnrichmentKey({
    slug: "base1-4-1st-edition",
    finish: "firstEditionHolofoil",
    language: "en",
    setCode: "BASE1",
    collectorNumber: "4",
  });

  assert.equal(first, afterHydration);
  assert.notEqual(
    first,
    cardMarketEnrichmentKey({
      slug: "base1-4",
      finish: "holofoil",
      language: "en",
      setCode: "BASE1",
      collectorNumber: "4",
    }),
  );
});

test("market result cache key does not change when list price or set size hydrates", () => {
  const identity = {
    language: "en",
    setCode: "BASE1",
    finish: "firstEditionHolofoil",
  };
  const emptyPrice = buildMarketResultCacheKey("Base Set", "Charizard", "4", identity);
  const afterPrice = buildMarketResultCacheKey("Base Set", "Charizard", "4", identity);
  const coreKey = buildMarketResultCacheKey("Base Set", "Charizard", "4", {
    ...identity,
    skipSoldComps: true,
  });
  const fullKey = buildMarketResultCacheKey("Base Set", "Charizard", "4", {
    ...identity,
    skipSoldComps: false,
  });

  assert.equal(emptyPrice, afterPrice);
  assert.match(emptyPrice, /v38-cf-reader/);
  assert.notEqual(coreKey, fullKey);
  assert.doesNotMatch(emptyPrice, /6500|102|rare/i);
});

test("grading lookup uses Base Set instead of a hydrated set-code alias", () => {
  assert.equal(
    resolveGradingMarketLookupSetName({
      setCode: "BS",
      setName: "Base Set",
      setEnglishName: "BS",
      rarity: "Rare",
    }),
    "Base Set",
  );
});

test("grading lookup strips finish marketing from Base Set Charizard", () => {
  assert.equal(
    resolveGradingMarketLookupCardName({
      name: "Charizard 1st Edition Holo",
      englishName: "Charizard 1st Edition Holo",
      language: "en",
    }),
    "Charizard",
  );
});

test("Trainer Gallery lookup uses the parent Silver Tempest set", () => {
  assert.equal(
    resolveGradingMarketLookupSetName({
      setCode: "SWSH12TG",
      setName: "Silver Tempest Trainer Gallery",
      setEnglishName: "SWSH12TG",
      rarity: "Holo Rare VMAX",
    }),
    "Silver Tempest",
  );
});

test("Trainer Gallery PriceCharting slugs prefer pokemon-silver-tempest", () => {
  const slugs = getPriceChartingSetSlugVariants("Silver Tempest", {
    setCode: "SWSH12TG",
    language: "en",
  });
  assert.equal(slugs[0], "pokemon-silver-tempest");
  assert.ok(slugs.includes("pokemon-swsh-silver-tempest"));
  assert.deepEqual(
    rankPriceChartingSetSlugs(["pokemon-swsh-silver-tempest", "pokemon-silver-tempest"]),
    ["pokemon-silver-tempest", "pokemon-swsh-silver-tempest"],
  );
});

test("PriceCharting identity accepts Trainer Gallery collector numbers", () => {
  const identity = buildMarketCardIdentity({
    name: "Rayquaza VMAX",
    englishName: "Rayquaza VMAX",
    setName: "Silver Tempest Trainer Gallery",
    setEnglishName: "Silver Tempest",
    setCode: "SWSH12TG",
    collectorNumber: "TG20",
    setTotal: 30,
    language: "en",
    finish: "holofoil",
  });

  assert.equal(identity.setSlug, "pokemon-silver-tempest");
  assert.equal(
    priceChartingProductMatchesIdentity(identity, {
      "product-name": "Rayquaza VMAX #TG20",
      "console-name": "Pokemon Silver Tempest",
    }),
    true,
  );
  assert.equal(
    priceChartingProductMatchesIdentity(identity, {
      "product-name": "Charizard #4",
      "console-name": "Pokemon Base Set",
    }),
    false,
  );
});
