import assert from "node:assert/strict";
import test from "node:test";

import { hasBlockingGradingMarketIncomplete, hasRetryableMarketSourceFailure } from "../src/lib/market/cache-policy";
import type { MarketSourceStatus } from "../src/types/pokemon";

function status(state: MarketSourceStatus["state"]): MarketSourceStatus {
  return {
    source: "fixture",
    state,
    confidence: "low",
    confidenceScore: 0.2,
    note: "fixture",
  };
}

test("timeouts, open circuits, and provider errors remain retryable and uncached", () => {
  for (const state of ["timeout", "circuit_open", "provider_error", "failed"] as const) {
    assert.equal(hasRetryableMarketSourceFailure([status(state)]), true, state);
  }
});

test("ready, partial, cached, and definitive no-match states may use normal cache policy", () => {
  for (const state of ["ready", "partial", "cached", "no_match"] as const) {
    assert.equal(hasRetryableMarketSourceFailure([status(state)]), false, state);
  }
});

test("catalog no_match does not block success when PriceCharting pop and sold comps are ready", () => {
  assert.equal(
    hasBlockingGradingMarketIncomplete([
      {
        source: "PriceCharting public population",
        state: "ready",
        confidence: "high",
        confidenceScore: 0.8,
        note: "pc pop",
      },
      {
        source: "Public sold-listing comps",
        state: "ready",
        confidence: "medium",
        confidenceScore: 0.7,
        note: "sold",
      },
      {
        source: "PokemonTCG/Cardmarket catalog",
        state: "no_match",
        confidence: "low",
        confidenceScore: 0.2,
        note: "catalog",
      },
      {
        source: "TCGFish public page",
        state: "disabled",
        confidence: "low",
        confidenceScore: 0.2,
        note: "tcgfish",
      },
    ]),
    false,
  );
});

test("TCGFish timeout does not block success when PriceCharting pop and sold comps are ready", () => {
  assert.equal(
    hasBlockingGradingMarketIncomplete([
      {
        source: "PriceCharting public population",
        state: "ready",
        confidence: "high",
        confidenceScore: 0.8,
        note: "pc pop",
      },
      {
        source: "Public sold-listing comps",
        state: "ready",
        confidence: "medium",
        confidenceScore: 0.7,
        note: "sold",
      },
      {
        source: "TCGFish public page",
        state: "timeout",
        confidence: "low",
        confidenceScore: 0.2,
        note: "tcgfish",
      },
    ]),
    false,
  );
});

test("a PriceCharting guide timeout still blocks when TCGFish is not the only failure", () => {
  assert.equal(
    hasBlockingGradingMarketIncomplete([
      {
        source: "PriceCharting public population",
        state: "ready",
        confidence: "high",
        confidenceScore: 0.8,
        note: "pc pop",
      },
      {
        source: "Public sold-listing comps",
        state: "ready",
        confidence: "medium",
        confidenceScore: 0.7,
        note: "sold",
      },
      {
        source: "PriceCharting public guide",
        state: "timeout",
        confidence: "low",
        confidenceScore: 0.2,
        note: "guide",
      },
    ]),
    true,
  );
});

