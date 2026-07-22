import assert from "node:assert/strict";
import test from "node:test";

import { hasRetryableMarketSourceFailure } from "../src/lib/market/cache-policy";
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

