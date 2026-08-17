import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJapaneseMarketCacheKey,
  japanesePrintedCollectorNumbersEqual,
  normalizeJapanesePrintedCollectorNumber,
} from "../src/lib/japanese-market-identity";

const identity = {
  officialCardId: "49990",
  printedCollectorNumber: "230",
  japaneseSetCode: "M2A",
  priceChartingProductId: "11302596",
  identityVersion: 4,
};

test("canonical identity preserves official zero padding while provider comparison ignores width", () => {
  assert.equal(normalizeJapanesePrintedCollectorNumber("０７１/０６７"), "071");
  assert.equal(japanesePrintedCollectorNumbersEqual("071", "71"), true);
});

test("Japanese market cache keys are stable for an unchanged normalized identity", () => {
  const key = buildJapaneseMarketCacheKey(identity);
  const equivalentKey = buildJapaneseMarketCacheKey({
    officialCardId: " official-49990 ",
    printedCollectorNumber: " ０２３０/１９３ ",
    japaneseSetCode: " m2a ",
    priceChartingProductId: " 11302596 ",
    identityVersion: 4,
  });

  assert.equal(key, "ja-market-v1:49990:230:m2a:11302596:i4");
  assert.equal(equivalentKey, key);
});

test("Japanese market cache keys change after collector, product, or identity-version correction", () => {
  const originalKey = buildJapaneseMarketCacheKey(identity);
  const correctedNumberKey = buildJapaneseMarketCacheKey({
    ...identity,
    printedCollectorNumber: "240",
  });
  const correctedProductKey = buildJapaneseMarketCacheKey({
    ...identity,
    priceChartingProductId: "11302606",
  });
  const correctedVersionKey = buildJapaneseMarketCacheKey({
    ...identity,
    identityVersion: 5,
  });

  assert.equal(
    new Set([
      originalKey,
      correctedNumberKey,
      correctedProductKey,
      correctedVersionKey,
    ]).size,
    4,
  );
});
