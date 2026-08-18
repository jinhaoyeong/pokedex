import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsePriceChartingPublicPagePrices } from "../src/lib/market/pricecharting-provider";
import { parseOfficialJapaneseCardDetail } from "../src/lib/pokemon-tcg/official-japanese-catalog";
import {
  findCollectorCodeInQuery,
  lookupOfficialJpCollectorFallbackByPartial,
  normalizeSearchText,
  parseCollectorCodeQuery,
  parsePartialCollectorToken,
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

test("collector queries parse printed totals, trainer gallery, and promo set codes", () => {
  assert.deepEqual(parseCollectorCodeQuery("100/095"), {
    rawNumber: "100",
    number: "100",
    printedTotal: 95,
  });
  assert.deepEqual(parseCollectorCodeQuery("tg06/tg30"), {
    rawNumber: "TG06",
    number: "TG06",
    printedTotal: 30,
  });
  assert.deepEqual(parseCollectorCodeQuery("288/sv-p"), {
    rawNumber: "288",
    number: "288",
    setCode: "SV-P",
  });
  assert.deepEqual(parseCollectorCodeQuery("288/SVP"), {
    rawNumber: "288",
    number: "288",
    setCode: "SV-P",
  });
  assert.equal(parseCollectorCodeQuery("Dialga"), null);
});

test("collector queries keep a name hint next to slash codes", () => {
  const dialgaPrinted = findCollectorCodeInQuery("Dialga 100/095");
  assert.equal(dialgaPrinted?.nameQuery, "Dialga");
  assert.equal(dialgaPrinted?.collectorCode.printedTotal, 95);

  const promo = findCollectorCodeInQuery("288/SV-P");
  assert.equal(promo?.nameQuery, "");
  assert.equal(promo?.collectorCode.setCode, "SV-P");
  assert.equal(promo?.collectorCode.number, "288");
});

test("partial collector tokens keep padded numbers for Dialga 071-style queries", () => {
  assert.deepEqual(parsePartialCollectorToken("071"), {
    rawNumber: "071",
    number: "71",
  });
  assert.deepEqual(parsePartialCollectorToken("017"), {
    rawNumber: "017",
    number: "17",
  });
});

test("Dialga 071 maps to official JP 071/092 Intense Fight Dialga", () => {
  const match = lookupOfficialJpCollectorFallbackByPartial(
    { rawNumber: "071", number: "71" },
    "Dialga",
  );

  assert.equal(match?.fullCode.printedTotal, 92);
  assert.equal(match?.fallback.cardId, "19223");
  assert.equal(match?.fallback.setCode, "DPs-B");
  assert.equal(match?.fallback.englishName, "Dialga");
});
