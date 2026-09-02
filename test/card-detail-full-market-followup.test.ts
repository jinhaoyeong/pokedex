import assert from "node:assert/strict";
import test from "node:test";

import { shouldFetchFullMarketAfterCore } from "../src/lib/grading-market-lookup";
import {
  liveMarketRichness,
  preferRicherLiveMarket,
} from "../src/lib/market/live-market-merge";

test("incomplete core payloads do not auto-start Magery or product HTML scrapes", () => {
  assert.equal(
    shouldFetchFullMarketAfterCore({
      gradedPrices: [
        { grade: "Ungraded", value: 1435, populationCount: 0 },
        { grade: "PSA 10", value: 15_400, populationCount: 0 },
        { grade: "PSA 9", value: 3310, populationCount: 0 },
      ],
      psaPopulation: {
        status: "pending",
        totalCertified: null,
        grades: [],
        source: "Live grading market",
        fetchedAt: null,
        note: "Population census is loading from the matched PriceCharting product.",
      },
      recentSales: [],
      priceConsensus: {
        finalEstimateUsd: 1435,
        confidence: "high",
        confidenceScore: 0.81,
        sourceCount: 4,
        sampleCount: 1,
        methodology: "Catalog consensus",
        sources: [],
      },
    }),
    false,
  );
});

test("ungraded-only core payload does not auto-start a full market follow-up", () => {
  assert.equal(
    shouldFetchFullMarketAfterCore({
      gradedPrices: [{ grade: "Ungraded", value: 4300, populationCount: 0, source: "Pokemon TCG API" }],
      psaPopulation: {
        status: "pending",
        totalCertified: null,
        grades: [],
        source: "Live grading market",
        fetchedAt: null,
        note: "Population census is loading.",
      },
      recentSales: [],
    }),
    false,
  );
});

test("complete census, slabs, and sold comps skip the full follow-up", () => {
  assert.equal(
    shouldFetchFullMarketAfterCore({
      gradedPrices: [
        { grade: "Ungraded", value: 1400, populationCount: 0 },
        { grade: "PSA 10", value: 15_000, populationCount: 100 },
        { grade: "PSA 9", value: 3300, populationCount: 80 },
        { grade: "PSA 8", value: 2100, populationCount: 40 },
        { grade: "PSA 7", value: 1500, populationCount: 20 },
      ],
      psaPopulation: {
        status: "verified",
        totalCertified: 2388,
        grades: [{ grade: "PSA 10", count: 100 }],
        source: "PriceCharting public population",
        fetchedAt: "2026-09-02T00:00:00.000Z",
        note: "Census",
      },
      recentSales: [
        {
          date: "2026-07-18",
          title: "Pikachu",
          condition: "Ungraded",
          price: 1400,
          source: "Magery",
        },
      ],
    }),
    false,
  );
});

test("a two-row set-guide overlay does not beat a full product-page scrape", () => {
  const overlay = {
    gradedPrices: [
      { grade: "Ungraded", value: 1435 },
      { grade: "PSA 10", value: 15_400 },
      { grade: "PSA 9", value: 3310 },
    ],
    psaPopulation: { grades: [], totalCertified: null },
    recentSales: [],
  };
  const scraped = {
    gradedPrices: [
      { grade: "Ungraded", value: 1435 },
      { grade: "PSA 10", value: 15_400 },
      { grade: "PSA 9", value: 3310 },
      { grade: "PSA 8", value: 2100 },
      { grade: "PSA 7", value: 1500 },
      { grade: "PSA 9.5", value: 4000 },
    ],
    psaPopulation: { grades: [{ grade: "PSA 10" }], totalCertified: 2388 },
    recentSales: [{ date: "2026-07-18" }],
  };

  assert.ok(liveMarketRichness(scraped) > liveMarketRichness(overlay));
  assert.equal(
    preferRicherLiveMarket(
      overlay as { gradedPrices: Array<{ grade: string; value: number }> },
      scraped as { gradedPrices: Array<{ grade: string; value: number }> },
    ),
    scraped,
  );
});
