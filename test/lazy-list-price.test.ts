import assert from "node:assert/strict";
import test from "node:test";

import {
  pickTrustedMarketUsd,
  resolveLazyListPrice,
  isVerifiedPriceResult,
} from "../src/lib/price/price-query";
import type { PriceLookupPayload, PriceLookupProviderResult } from "../src/lib/price/price-query";

function result(overrides: Partial<PriceLookupProviderResult>): PriceLookupProviderResult {
  return {
    provider: "tcgdex",
    sourceLabel: "TCGdex catalog",
    ungradedUsd: 12,
    matchConfidence: 1,
    confidenceScore: 0.5,
    evidenceType: "catalog",
    fetchedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

function payload(overrides: Partial<PriceLookupPayload> & { results: PriceLookupProviderResult[] }): PriceLookupPayload {
  return {
    status: "success",
    ungradedUsd: overrides.ungradedUsd ?? overrides.results[0]?.ungradedUsd ?? 0,
    primaryProvider: overrides.primaryProvider ?? overrides.results[0]?.provider,
    confidenceScore: overrides.confidenceScore ?? 0.5,
    ...overrides,
  };
}

test("lazy list prices keep a curated value instead of pending or a worse estimate", () => {
  assert.equal(
    resolveLazyListPrice({ incomingUsd: 2410, initialUsd: 1450, verified: false }),
    null,
  );
  assert.deepEqual(
    resolveLazyListPrice({ incomingUsd: 2410, initialUsd: 0, verified: false }),
    { priceUsd: 2410, isEstimate: true },
  );
});

test("lazy list prices ignore a much cheaper verified wrong-card match on trusted headlines", () => {
  assert.equal(
    resolveLazyListPrice({ incomingUsd: 27, initialUsd: 9200, verified: true }),
    null,
  );
  assert.deepEqual(
    resolveLazyListPrice({ incomingUsd: 6500, initialUsd: 6500, verified: true }),
    { priceUsd: 6500, isEstimate: false },
  );
});

test("untrusted grail headlines may be replaced by a lower trusted market reference", () => {
  assert.deepEqual(
    resolveLazyListPrice({
      incomingUsd: 2500,
      initialUsd: 9200,
      verified: true,
      initialIsUntrusted: true,
    }),
    { priceUsd: 2500, isEstimate: false },
  );
});

test("TCGdex catalog is never a trusted list/detail price", () => {
  const data = payload({
    primaryProvider: "tcgdex",
    ungradedUsd: 27.29,
    results: [
      result({
        provider: "tcgdex",
        ungradedUsd: 27.29,
        evidenceType: "catalog",
      }),
    ],
  });

  assert.equal(pickTrustedMarketUsd(data), null);
  assert.equal(isVerifiedPriceResult(data), false);
});

test("PriceCharting wins over a mismatched TCGdex catalog price", () => {
  const data = payload({
    primaryProvider: "tcgdex",
    ungradedUsd: 27.29,
    results: [
      result({
        provider: "tcgdex",
        ungradedUsd: 27.29,
        evidenceType: "catalog",
      }),
      result({
        provider: "pricecharting-api",
        sourceLabel: "PriceCharting API",
        ungradedUsd: 2500.99,
        evidenceType: "guide_snapshot",
        matchConfidence: 0.9,
        confidenceScore: 0.62,
      }),
    ],
  });

  assert.equal(pickTrustedMarketUsd(data), 2500.99);
  assert.equal(isVerifiedPriceResult(data), true);
});

test("TCGPlayer catalog can verify a list price when no guide/sold reference answers", () => {
  const data = payload({
    primaryProvider: "pokemontcg",
    ungradedUsd: 1969.69,
    results: [
      result({
        provider: "pokemontcg",
        sourceLabel: "PokemonTCG catalog market",
        ungradedUsd: 1969.69,
        evidenceType: "catalog",
        matchConfidence: 1,
        confidenceScore: 0.64,
      }),
    ],
  });

  assert.equal(pickTrustedMarketUsd(data), 1969.69);
});
