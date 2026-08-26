import assert from "node:assert/strict";
import test from "node:test";

import { classifyLocalizedPriceChartingSetSlug, getLocalizedSetMarketProfile } from "../src/lib/localized-set-market";
import {
  findPriceChartingSetGuideEntry,
  guideEntryMatchesFinish,
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
  assert.equal(
    priceChartingSetGuideEntryMatchesQuery(
      {
        language: "ja",
        setCode: "SM12",
        collectorNumber: "100",
        englishName: "Arceus & Dialga & Palkia GX",
      },
      "pokemon-japanese-alter-genesis",
      {
        name: "Arceus &amp; Dialga &amp; Palkia GX",
        numberBase: "100",
        ungradedUsd: 550,
        grade9Usd: 287,
        psa10Usd: 1112.5,
        productUrl:
          "https://www.pricecharting.com/game/pokemon-japanese-alter-genesis/arceus-&amp;-dialga-&amp;-palkia-gx-100",
      },
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

test("Japanese 151 guide rows still match when product URLs keep HTML entities", () => {
  const matched = findPriceChartingSetGuideEntry(
    {
      language: "ja",
      setCode: "SV2A",
      collectorNumber: "201",
      englishName: "Charizard ex",
    },
    "pokemon-japanese-scarlet-&-violet-151",
    [
      {
        name: "Charizard EX",
        numberBase: "201",
        ungradedUsd: 361.86,
        grade9Usd: 500,
        psa10Usd: 900,
        productUrl:
          "https://www.pricecharting.com/game/pokemon-japanese-scarlet-&amp;-violet-151/charizard-ex-201",
      },
    ],
  );

  assert.equal(matched?.ungradedUsd, 361.86);
  assert.equal(matched?.numberBase, "201");
});

test("Japanese DP4 Intense Fight Dialga resolves to the Destroyed Sky PriceCharting console", () => {
  const profile = getLocalizedSetMarketProfile("DPs-B");
  assert.equal(profile?.englishName, "Intense Fight in the Destroyed Sky");
  assert.equal(
    profile?.priceChartingSlug,
    "pokemon-japanese-intense-fight-in-the-destroyed-sky",
  );
  assert.equal(getLocalizedSetMarketProfile("DPS-B")?.priceChartingSlug, profile?.priceChartingSlug);
  assert.ok(profile?.aliases?.includes("Intense Fight in the Destined Skies"));
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

test("English Base Set guide rows keep unlimited Charizard off the 1st edition tile", () => {
  const unlimited = {
    name: "Charizard",
    numberBase: "4",
    ungradedUsd: 799.22,
    grade9Usd: 1200,
    psa10Usd: 8000,
    productUrl: "https://www.pricecharting.com/game/pokemon-base-set/charizard-4",
  } satisfies PriceChartingSetGuideEntry;
  const firstEdition = {
    name: "Charizard 1st Edition",
    numberBase: "4",
    ungradedUsd: 4200,
    grade9Usd: 9000,
    psa10Usd: 40000,
    productUrl: "https://www.pricecharting.com/game/pokemon-base-set/charizard-4-1st-edition",
  } satisfies PriceChartingSetGuideEntry;
  const entries = [unlimited, firstEdition];

  assert.equal(guideEntryMatchesFinish(unlimited, "holofoil"), true);
  assert.equal(guideEntryMatchesFinish(unlimited, "firstEditionHolofoil"), false);
  assert.equal(guideEntryMatchesFinish(firstEdition, "firstEditionHolofoil"), true);
  assert.equal(guideEntryMatchesFinish(firstEdition, "holofoil"), false);

  assert.equal(
    findPriceChartingSetGuideEntry(
      {
        language: "en",
        setCode: "base1",
        collectorNumber: "4",
        englishName: "Charizard",
        finish: "holofoil",
      },
      "pokemon-base-set",
      entries,
    )?.ungradedUsd,
    799.22,
  );
  assert.equal(
    findPriceChartingSetGuideEntry(
      {
        language: "en",
        setCode: "base1",
        collectorNumber: "4",
        englishName: "Charizard",
        finish: "firstEditionHolofoil",
      },
      "pokemon-base-set",
      entries,
    )?.ungradedUsd,
    4200,
  );
});
