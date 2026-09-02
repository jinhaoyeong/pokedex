import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMarketFailureFromText,
  classifyMarketSourceFailure,
  isPublicHtmlTransportBlocked,
  retryableMarketFailureState,
  summarizeMarketSourceFailures,
} from "../src/lib/market/source-failure";
import type { MarketSourceStatus } from "../src/types/pokemon";

function status(
  state: MarketSourceStatus["state"],
  source = "PriceCharting public population",
  extra: Partial<MarketSourceStatus> = {},
): MarketSourceStatus {
  return {
    source,
    state,
    confidence: "low",
    confidenceScore: 0.2,
    note: extra.note ?? "fixture",
    warning: extra.warning,
  };
}

test("Cloudflare / 403 / 429 text is classified as an API ban, not a code bug", () => {
  assert.equal(classifyMarketFailureFromText("Public page request failed: 403"), "api_ban");
  assert.equal(classifyMarketFailureFromText("Cloudflare challenge blocked the request"), "api_ban");
  assert.equal(classifyMarketFailureFromText("source circuit open after repeated failures"), "api_ban");
  assert.equal(classifyMarketFailureFromText("Market source rate-limited the request"), "api_ban");
});

test("timeouts and parser failures stay distinct from API bans", () => {
  assert.equal(classifyMarketFailureFromText("source budget exceeded"), "timeout");
  assert.equal(classifyMarketFailureFromText("Unexpected token in JSON"), "code");
});

test("source status circuit_open is an API ban even without warning text", () => {
  assert.equal(classifyMarketSourceFailure(status("circuit_open")), "api_ban");
  assert.equal(classifyMarketSourceFailure(status("timeout")), "timeout");
  assert.equal(classifyMarketSourceFailure(status("provider_error")), "code");
  assert.equal(classifyMarketSourceFailure(status("no_match")), "no_match");
});

test("retryable state maps blocked 403s onto circuit_open", () => {
  assert.equal(
    retryableMarketFailureState(new Error("Public page request failed: 403; reader fallback failed")),
    "circuit_open",
  );
  assert.equal(retryableMarketFailureState(new Error("source budget exceeded")), "timeout");
});

test("summarizeMarketSourceFailures prefers API ban over timeout copy", () => {
  const summary = summarizeMarketSourceFailures([
    status("timeout", "PriceCharting public guide"),
    status("circuit_open", "PriceCharting public population", {
      warning: "Skipping www.pricecharting.com: source circuit open after repeated failures",
    }),
    status("ready", "PokemonTCG/Cardmarket catalog"),
  ]);

  assert.equal(summary?.kind, "api_ban");
  assert.match(summary?.copy ?? "", /blocked or rate-limited/i);
  assert.deepEqual(summary?.sources, [
    "PriceCharting public guide",
    "PriceCharting public population",
  ]);
});

test("first-paint partial sources do not surface timeout or API-blocked copy", () => {
  const summary = summarizeMarketSourceFailures([
    status("partial", "Public sold-listing comps"),
    status("timeout", "PriceCharting public population"),
    status("circuit_open", "TCGFish public page"),
    status("ready", "PriceCharting set guide"),
  ]);

  assert.equal(summary, null);
});

test("blocked origin plus reader cooldown is an API ban, not a missing print", () => {
  assert.equal(
    isPublicHtmlTransportBlocked({
      originDirectBlocked: true,
      originCircuitOpen: false,
      readerCircuitOpen: true,
    }),
    true,
  );
  assert.equal(
    isPublicHtmlTransportBlocked({
      originDirectBlocked: false,
      originCircuitOpen: false,
      readerCircuitOpen: true,
    }),
    false,
  );
  assert.equal(
    isPublicHtmlTransportBlocked({
      originDirectBlocked: true,
      originCircuitOpen: false,
      readerCircuitOpen: false,
    }),
    false,
  );
});
