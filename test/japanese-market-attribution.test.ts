import assert from "node:assert/strict";
import test from "node:test";

import { classifyLocalizedPriceChartingSetSlug } from "../src/lib/localized-set-market";
import {
  findPriceChartingSetGuideEntry,
  priceChartingSetGuideEntryMatchesQuery,
  type PriceChartingSetGuideEntry,
  type SetGuidePriceQuery,
} from "../src/lib/market/pricecharting-set-guide.server";
import { buildPopulationKey } from "../src/lib/psa-population-store.server";

const japaneseQuery: SetGuidePriceQuery = {
  language: "ja",
  setCode: "M2A",
  setName: "MEGA Dream ex",
  setEnglishName: "MEGA Dream ex",
  collectorNumber: "230",
  englishName: "Mega Gengar ex",
};

const japaneseEntry: PriceChartingSetGuideEntry = {
  name: "Mega Gengar ex",
  numberBase: "230",
  ungradedUsd: 12.34,
  grade9Usd: 44.75,
  psa10Usd: 149.99,
  productId: "13077406",
  productUrl:
    "https://www.pricecharting.com/game/pokemon-japanese-mega-dream-ex/mega-gengar-ex-230",
};

test("Japanese and English-parallel PriceCharting consoles have distinct attribution", () => {
  assert.equal(
    classifyLocalizedPriceChartingSetSlug(
      "M2A",
      "pokemon-japanese-mega-dream-ex",
    ),
    "native",
  );
  assert.equal(
    classifyLocalizedPriceChartingSetSlug(
      "M2A",
      "https://www.pricecharting.com/pop/item/pokemon-ascended-heroes/mega-gengar-ex-230",
    ),
    "english_parallel",
  );
  assert.equal(
    classifyLocalizedPriceChartingSetSlug(
      "UNKNOWN",
      "pokemon-japanese-new-expansion",
    ),
    "native",
  );
  assert.equal(
    classifyLocalizedPriceChartingSetSlug(
      "M2A",
      "pokemon-japanese-ninja-spinner",
    ),
    "unknown",
  );
});

test("Japanese set-guide matching requires native set, exact number, and any known name to match exactly", () => {
  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      japaneseQuery,
      "pokemon-japanese-mega-dream-ex",
      japaneseEntry,
    ),
    true,
  );

  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      japaneseQuery,
      "pokemon-ascended-heroes",
      {
        ...japaneseEntry,
        productUrl:
          "https://www.pricecharting.com/game/pokemon-ascended-heroes/mega-gengar-ex-230",
      },
    ),
    false,
  );

  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      japaneseQuery,
      "pokemon-japanese-ninja-spinner",
      {
        ...japaneseEntry,
        productUrl:
          "https://www.pricecharting.com/game/pokemon-japanese-ninja-spinner/mega-gengar-ex-230",
      },
    ),
    false,
  );

  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      japaneseQuery,
      "pokemon-japanese-mega-dream-ex",
      { ...japaneseEntry, name: "Gengar ex" },
    ),
    false,
  );
  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      japaneseQuery,
      "pokemon-japanese-mega-dream-ex",
      { ...japaneseEntry, numberBase: "23" },
    ),
    false,
  );
  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      { ...japaneseQuery, englishName: undefined },
      "pokemon-japanese-mega-dream-ex",
      japaneseEntry,
    ),
    true,
  );
});

test("English set-guide matching keeps its existing loose name behavior", () => {
  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      {
        language: "en",
        setCode: "BS",
        collectorNumber: "4",
        englishName: "Charizard",
      },
      "pokemon-base-set",
      {
        ...japaneseEntry,
        name: "Charizard Holo",
        numberBase: "4",
        productUrl:
          "https://www.pricecharting.com/game/pokemon-base-set/charizard-4",
      },
    ),
    true,
  );
});

test("vintage Japanese TCGdex numbers can still match a unique native-console name", () => {
  const zubat = {
    name: "Zubat",
    numberBase: "41",
    ungradedUsd: 1.25,
    grade9Usd: 8,
    psa10Usd: 40,
    productUrl:
      "https://www.pricecharting.com/game/pokemon-japanese-awakening-legends/zubat-41",
  } satisfies PriceChartingSetGuideEntry;

  const matched = findPriceChartingSetGuideEntry(
    {
      language: "ja",
      setCode: "NEO3",
      collectorNumber: "001",
      englishName: "Zubat",
    },
    "pokemon-japanese-awakening-legends",
    [
      {
        ...zubat,
        name: "Chikorita",
        numberBase: "1",
        productUrl:
          "https://www.pricecharting.com/game/pokemon-japanese-awakening-legends/chikorita-1",
      },
      zubat,
    ],
  );

  assert.equal(matched?.numberBase, "41");
  assert.equal(matched?.ungradedUsd, 1.25);
});

test("vintage Japanese same-name prints pick the cheapest base number", () => {
  const matched = findPriceChartingSetGuideEntry(
    {
      language: "ja",
      setCode: "NEO2",
      collectorNumber: "001",
      englishName: "Caterpie",
    },
    "pokemon-japanese-crossing-the-ruins",
    [
      {
        name: "Caterpie",
        numberBase: "10",
        ungradedUsd: 2.98,
        grade9Usd: 12,
        psa10Usd: 40,
        productUrl:
          "https://www.pricecharting.com/game/pokemon-japanese-crossing-the-ruins/caterpie-10",
      },
      {
        name: "Caterpie",
        numberBase: "69",
        ungradedUsd: 8.5,
        grade9Usd: 20,
        psa10Usd: 80,
        productUrl:
          "https://www.pricecharting.com/game/pokemon-japanese-crossing-the-ruins/caterpie-69",
      },
    ],
  );

  assert.equal(matched?.numberBase, "10");
  assert.equal(matched?.ungradedUsd, 2.98);
});

test("population cache namespace invalidates pre-separation Japanese rows", () => {
  assert.match(
    buildPopulationKey({
      language: "ja",
      setCode: "M2A",
      setName: "MEGA Dream ex",
      cardName: "Mega Gengar ex",
      cardNumber: "230",
      officialCardId: "49990",
      identityVersion: 1,
    }),
    /^v4-finish-separated-population\|/,
  );
  assert.match(
    buildPopulationKey({
      language: "en",
      setCode: "xy12",
      setName: "XY Evolutions",
      cardName: "Machop",
      cardNumber: "51",
      finish: "reverseHolofoil",
    }),
    /\|reverseholofoil\|/,
  );
});
