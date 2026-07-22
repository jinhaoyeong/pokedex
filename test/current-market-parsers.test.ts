import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsePriceChartingPublicPagePrices } from "../src/lib/market/pricecharting-provider";
import { parseOfficialJapaneseCardDetail } from "../src/lib/pokemon-tcg/official-japanese-catalog";
import {
  normalizeSearchText,
  parseCollectorCodeQuery,
} from "../src/lib/pokemon-tcg/text-and-collector-utils";

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("official Japanese detail keeps cardID separate from printed collector number", () => {
  const detail = parseOfficialJapaneseCardDetail(
    "49990",
    fixture("official-japanese-m2a-49990.html"),
  );

  assert.equal(detail.cardID, "49990");
  assert.equal(detail.setCode, "M2a");
  assert.equal(detail.collectorNumber, "230");
  assert.equal(detail.printedTotal, 193);
  assert.equal(detail.name, "メガゲンガーex");
  assert.equal(detail.rarity, "Special Art Rare");
  assert.match(detail.image, /\/M2a\/049990_P_MGENGAEX\.jpg$/);
});

test("existing text and collector helpers normalize full-width collector digits", () => {
  const sample = JSON.parse(fixture("full-width-collector-number.json")) as {
    raw: string;
    normalizedAscii: string;
    collectorNumber: string;
    printedTotal: number;
  };

  const normalized = normalizeSearchText(sample.raw);
  assert.equal(normalized, sample.normalizedAscii);
  assert.deepEqual(parseCollectorCodeQuery(normalized), {
    rawNumber: "00230",
    number: sample.collectorNumber,
    printedTotal: sample.printedTotal,
  });
});

test("PriceCharting public guide parser preserves grade labels and snapshot provenance", () => {
  const sourceUrl =
    "https://www.pricecharting.com/game/pokemon-japanese-mega-dream-ex/mega-gengar-ex-230";
  const prices = parsePriceChartingPublicPagePrices(
    fixture("pricecharting-guide.md"),
    sourceUrl,
  );

  assert.deepEqual(
    prices.map(({ grade, value }) => ({ grade, value })),
    [
      { grade: "Ungraded", value: 12.34 },
      { grade: "PSA 7", value: 18 },
      { grade: "PSA 8", value: 25.5 },
      { grade: "PSA 9", value: 44.75 },
      { grade: "PSA 9.5", value: 60 },
      { grade: "PSA 10", value: 149.99 },
    ],
  );
  assert.ok(prices.every((price) => price.evidenceType === "guide_snapshot"));
  assert.ok(prices.every((price) => price.sourceUrl === sourceUrl));
});
