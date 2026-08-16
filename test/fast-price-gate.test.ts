import assert from "node:assert/strict";
import test from "node:test";

import {
  isMarketReferenceFastResult,
  isWithinMarketReferenceTolerance,
} from "../src/lib/price/fast-price-gate";
import type { ProviderPriceResult } from "../src/lib/price/types";

function result(overrides: Partial<ProviderPriceResult>): ProviderPriceResult {
  return {
    provider: "tcgdex",
    sourceLabel: "TCGdex catalog",
    ungradedUsd: 12,
    matchConfidence: 0.9,
    confidenceScore: 0.5,
    evidenceType: "catalog",
    fetchedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

test("catalog and TCGdex cannot early-return ahead of Collectr or PriceCharting", () => {
  assert.equal(isMarketReferenceFastResult(result({})), false);
  assert.equal(
    isMarketReferenceFastResult(
      result({ provider: "pokemon-tcg", sourceLabel: "Pokemon TCG API", evidenceType: "catalog" }),
    ),
    false,
  );
});

test("Collectr, PriceCharting, and eBay sold comps are valid 5s references", () => {
  assert.equal(
    isMarketReferenceFastResult(
      result({
        provider: "collectr-fallback",
        sourceLabel: "Collectr catalog",
        evidenceType: "guide_snapshot",
        ungradedUsd: 100,
      }),
    ),
    true,
  );
  assert.equal(
    isMarketReferenceFastResult(
      result({
        provider: "pricecharting-api",
        sourceLabel: "PriceCharting",
        evidenceType: "guide_snapshot",
        ungradedUsd: 98,
      }),
    ),
    true,
  );
  assert.equal(
    isMarketReferenceFastResult(
      result({
        provider: "ebay",
        sourceLabel: "eBay sold",
        evidenceType: "sold_comp",
        ungradedUsd: 102,
      }),
    ),
    true,
  );
  assert.equal(
    isMarketReferenceFastResult(
      result({
        provider: "ebay",
        sourceLabel: "eBay active",
        evidenceType: "catalog",
        ungradedUsd: 140,
      }),
    ),
    false,
  );
});

test("headline must stay within 10% of a market reference", () => {
  assert.equal(isWithinMarketReferenceTolerance(100, 109), true);
  assert.equal(isWithinMarketReferenceTolerance(100, 111), false);
  assert.equal(isWithinMarketReferenceTolerance(100, 90), true);
  assert.equal(isWithinMarketReferenceTolerance(100, 85), false);
});
