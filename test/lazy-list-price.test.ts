import assert from "node:assert/strict";
import test from "node:test";

import { resolveLazyListPrice } from "../src/lib/price/price-query";

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

test("lazy list prices ignore a much cheaper verified wrong-card match", () => {
  assert.equal(
    resolveLazyListPrice({ incomingUsd: 27, initialUsd: 9200, verified: true }),
    null,
  );
  assert.deepEqual(
    resolveLazyListPrice({ incomingUsd: 6500, initialUsd: 6500, verified: true }),
    { priceUsd: 6500, isEstimate: false },
  );
});
