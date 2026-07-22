import assert from "node:assert/strict";
import test from "node:test";

import seed from "../data/japanese-market-identity-seed.json";

test("bundled confirmed Japanese identities retain official and exact-product evidence", () => {
  assert.ok(seed.length >= 7);
  assert.equal(new Set(seed.map((identity) => identity.officialCardId)).size, seed.length);

  for (const identity of seed) {
    assert.equal(identity.identityStatus, "confirmed");
    assert.ok(identity.identitySource.includes("official-detail"));
    assert.ok(identity.identitySource.includes("pricecharting-discovery"));
    assert.match(identity.printedCollectorNumber, /^\d+[a-z]?$/i);
    assert.match(identity.priceChartingProductId, /^\d+$/);
    assert.match(
      identity.priceChartingProductUrl,
      /^https:\/\/www\.pricecharting\.com\/game\/pokemon-japanese-/,
    );
    assert.ok(Number.isFinite(Date.parse(identity.verifiedAt)));
  }
});

