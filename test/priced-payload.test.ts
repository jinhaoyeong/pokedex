import assert from "node:assert/strict";
import test from "node:test";

import { findResolvedPsa10Usd } from "../src/lib/price/sanity";
import {
  findNmMarketUsd,
  hasPricedMarketPayload,
  isPricedResolvedPrice,
  shouldShowNmSecondary,
} from "../src/lib/price/priced-payload";
import { flagThinGradedPrices } from "../src/lib/price/thin-grades";
import { priceCacheSlugAliases } from "../src/lib/price/price-cache-keys";
import type { ProviderPriceResult } from "../src/lib/price/types";

test("empty PriceCharting $0 payloads are not priced", () => {
  assert.equal(
    hasPricedMarketPayload({ ungradedUsd: 0, gradedPrices: [] }),
    false,
  );
  assert.equal(
    hasPricedMarketPayload({
      ungradedUsd: 0,
      gradedPrices: [{ grade: "Ungraded", value: 0 }],
    }),
    false,
  );
});

test("a positive slab is enough to count as priced", () => {
  assert.equal(
    hasPricedMarketPayload({
      ungradedUsd: 0,
      gradedPrices: [{ grade: "PSA 10", value: 28144.52 }],
    }),
    true,
  );
});

test("PSA 10 aliases pick the best positive slab across providers", () => {
  const psa10 = findResolvedPsa10Usd({
    results: [
      {
        provider: "pricecharting-api",
        sourceLabel: "PriceCharting public page",
        ungradedUsd: 0,
        confidenceScore: 0.2,
        matchConfidence: 0.9,
        evidenceType: "guide_snapshot",
        gradedPrices: [{ grade: "PSA 10", value: 0, populationCount: 0 }],
        fetchedAt: "2026-08-15T00:00:00.000Z",
      },
      {
        provider: "ebay",
        sourceLabel: "Grading market consensus",
        ungradedUsd: 372.83,
        confidenceScore: 0.8,
        matchConfidence: 0.9,
        evidenceType: "sold_comp",
        gradedPrices: [{ grade: "PSA 10", value: 28144.52, populationCount: 486 }],
        fetchedAt: "2026-08-15T00:00:00.000Z",
      },
    ],
  });

  assert.equal(psa10, 28144.52);
});

test("catalog NM is exposed separately and shown only when it diverges", () => {
  const results: ProviderPriceResult[] = [
    {
      provider: "pokemontcg",
      sourceLabel: "PokemonTCG catalog market",
      ungradedUsd: 846,
      confidenceScore: 0.64,
      matchConfidence: 1,
      evidenceType: "catalog",
      fetchedAt: "2026-08-15T00:00:00.000Z",
    },
  ];

  assert.equal(findNmMarketUsd(results), 846);
  assert.equal(shouldShowNmSecondary(372.83, 846), true);
  assert.equal(shouldShowNmSecondary(371, 371.03), false);
});

test("price cache aliases include set-number and official Japanese ids", () => {
  const slugs = priceCacheSlugAliases({
    slug: "base1-4",
    language: "en",
    setCode: "base1",
    collectorNumber: "4",
  });
  assert.ok(slugs.includes("base1-4"));
  assert.ok(slugs.includes("en--base1-4"));

  const ja = priceCacheSlugAliases({
    slug: "sv2a-205",
    language: "ja",
    setCode: "SV2A",
    collectorNumber: "205",
    officialCardId: "43990",
  });
  assert.ok(ja.includes("ja--official-43990"));
});

test("thin inverted slabs get a warning", () => {
  const flagged = flagThinGradedPrices([
    { grade: "Ungraded", value: 215, populationCount: 0 },
    { grade: "PSA 8", value: 62, populationCount: 0, saleCount: 1 },
  ]);

  assert.match(flagged[1].warning ?? "", /below the raw/);
  assert.match(flagged[1].warning ?? "", /fewer than 3/);
});

test("a resolved price with only slabs is still priced", () => {
  assert.equal(
    isPricedResolvedPrice({
      ungradedUsd: 0,
      results: [
        {
          provider: "pricecharting-api",
          sourceLabel: "PriceCharting API",
          ungradedUsd: 0,
          confidenceScore: 0.62,
          matchConfidence: 0.9,
          evidenceType: "guide_snapshot",
          gradedPrices: [{ grade: "PSA 10", value: 161.76, populationCount: 0 }],
          fetchedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    }),
    true,
  );
});
