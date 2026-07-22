import assert from "node:assert/strict";
import test from "node:test";

import { classifyLocalizedPriceChartingSetSlug } from "../src/lib/localized-set-market";
import {
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
    /^v3-native-japanese-attribution\|/,
  );
});
