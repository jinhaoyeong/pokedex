import assert from "node:assert/strict";
import test from "node:test";

import { firstPaintDeferredSourceState } from "../src/lib/market/first-paint-status";

test("first paint does not stamp timeout or API-blocked onto skipped Magery/HTML work", () => {
  assert.equal(
    firstPaintDeferredSourceState({ skipSoldComps: true, timedOut: true, blocked: true }),
    "partial",
  );
  assert.equal(
    firstPaintDeferredSourceState({ skipSoldComps: true, hasSignal: true, blocked: true }),
    "ready",
  );
});

test("full gather still reports timeout and Cloudflare blocks", () => {
  assert.equal(
    firstPaintDeferredSourceState({ skipSoldComps: false, timedOut: true }),
    "timeout",
  );
  assert.equal(
    firstPaintDeferredSourceState({ skipSoldComps: false, blocked: true }),
    "circuit_open",
  );
  assert.equal(firstPaintDeferredSourceState({ skipSoldComps: false }), "no_match");
});
