import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCatalogFactsPatch,
  catalogMarketName,
  catalogStageFromSubtypes,
  inferStageFromCardName,
  isSameCatalogPrint,
  isThinCatalogCard,
  needsCatalogFactHydration,
} from "../src/lib/card-catalog-facts";
import {
  attachFinishMarketsToCard,
  inferPrimaryFinish,
  shouldShowFinishSwitcher,
  standardFinishesForRarity,
} from "../src/lib/card-finish";
import type { TcgCard } from "../src/types/pokemon";

function thinCard(overrides: Partial<TcgCard> = {}): TcgCard {
  return {
    id: "me2pt5-276",
    slug: "me2pt5-276",
    language: "en",
    languageLabel: "English",
    name: "Pikachu ex",
    englishName: "Pikachu ex",
    collectorNumber: "276",
    rarity: "Localized release",
    supertype: "Pokemon",
    hp: "-",
    types: [],
    setId: "me2pt5",
    setCode: "ME2PT5",
    setName: "ME2PT5",
    image: "https://example.com/pika.png",
    artist: "Unknown",
    imageStatus: "derived",
    marketPriceUsd: 29.7,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "test",
      fetchedAt: null,
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [],
    gradedPrices: [],
    recentSales: [],
    sources: [],
    ...overrides,
  } as TcgCard;
}

test("index stubs without types or a real rarity are thin catalog cards", () => {
  assert.equal(isThinCatalogCard(thinCard()), true);
  assert.equal(
    isThinCatalogCard(
      thinCard({
        hp: "200",
        types: ["Lightning"],
        rarity: "Special Illustration Rare",
      }),
    ),
    false,
  );
});

test("complete-looking grails still need stage, dex, and set size hydrated", () => {
  const grail = thinCard({
    id: "swsh7-215",
    slug: "swsh7-215",
    name: "Umbreon VMAX Alternate Art",
    englishName: undefined,
    collectorNumber: "215",
    hp: "310",
    types: ["Darkness"],
    rarity: "Secret Rare Alternate Art",
    setId: "swsh7",
    setCode: "EVS",
    setName: "Evolving Skies",
  });

  assert.equal(isThinCatalogCard(grail), false);
  assert.equal(needsCatalogFactHydration(grail), true);

  const hydrated = applyCatalogFactsPatch(grail, {
    collectorNumber: "215",
    setId: "swsh7",
    setCode: "swsh7",
    name: "Umbreon VMAX",
    englishName: "Umbreon VMAX",
    hp: "310",
    types: ["Darkness"],
    artist: "KEIICHIRO ITO",
    rarity: "Rare Rainbow",
    stage: "VMAX",
    dexIds: [197],
    setName: "Evolving Skies",
    setEnglishName: "Evolving Skies",
    setPrintedTotal: 203,
    setTotal: 237,
  });

  assert.equal(hydrated.stage, "VMAX");
  assert.deepEqual(hydrated.dexIds, [197]);
  assert.equal(hydrated.setPrintedTotal, 203);
  assert.equal(hydrated.setTotal, 237);
  assert.equal(hydrated.englishName, "Umbreon VMAX");
  assert.equal(needsCatalogFactHydration(hydrated), false);
});

test("Pokemon TCG subtypes expose VMAX instead of dropping the stage", () => {
  assert.equal(catalogStageFromSubtypes(["VMAX", "Single Strike"]), "VMAX");
  assert.equal(inferStageFromCardName("Umbreon VMAX Alternate Art"), "VMAX");
  assert.equal(catalogMarketName({ name: "Umbreon VMAX Alternate Art" }), "Umbreon VMAX");
});

test("same-print English aliases merge live Pokemon TCG facts onto the index stub", () => {
  const merged = applyCatalogFactsPatch(thinCard(), {
    collectorNumber: "276",
    setId: "me02.5",
    setCode: "me02.5",
    name: "Pikachu ex",
    englishName: "Pikachu ex",
    hp: "200",
    types: ["Lightning"],
    artist: "booota",
    rarity: "Special Illustration Rare",
    stage: "Basic",
    dexIds: [25],
    setName: "Ascended Heroes",
    setEnglishName: "Ascended Heroes",
    setTotal: 295,
  });

  assert.equal(isSameCatalogPrint(thinCard(), { setId: "me02.5", collectorNumber: "276" }), true);
  assert.equal(merged.hp, "200");
  assert.deepEqual(merged.types, ["Lightning"]);
  assert.equal(merged.artist, "booota");
  assert.equal(merged.rarity, "Special Illustration Rare");
  assert.equal(merged.stage, "Basic");
  assert.deepEqual(merged.dexIds, [25]);
  assert.equal(merged.setName, "Ascended Heroes");
});

test("a different set with the same name only donates species facts", () => {
  const merged = applyCatalogFactsPatch(
    thinCard({
      id: "official-pc-m5-118",
      slug: "ja--official-pc-m5-118",
      name: "Mega Darkrai ex",
      englishName: "Mega Darkrai ex",
      setId: "M5",
      setCode: "M5",
      collectorNumber: "118",
    }),
    {
    collectorNumber: "118",
    setId: "me2pt5",
    setCode: "me2pt5",
    name: "Mega Darkrai ex",
    englishName: "Mega Darkrai ex",
    hp: "330",
    types: ["Darkness"],
    artist: "Wrong Print",
    rarity: "Ultra Rare",
    dexIds: [491],
    stage: "Basic",
  });

  assert.equal(merged.hp, "-");
  assert.equal(merged.artist, "Unknown");
  assert.deepEqual(merged.types, ["Darkness"]);
  assert.deepEqual(merged.dexIds, [491]);
});

test("full-art and ex prints are identified as holofoil without a finish toggle", () => {
  assert.deepEqual(standardFinishesForRarity("Localized release", "Pikachu ex"), ["holofoil"]);
  assert.deepEqual(standardFinishesForRarity("Secret rare", "Mega Darkrai ex"), ["holofoil"]);
  assert.equal(inferPrimaryFinish("Localized release", ["normal", "holofoil", "reverseHolofoil"], "Pikachu ex"), "holofoil");

  const identified = attachFinishMarketsToCard(thinCard());
  assert.deepEqual(
    identified.finishMarkets?.map((market) => market.id),
    ["holofoil"],
  );
  assert.equal(identified.finish, "holofoil");
  assert.equal(shouldShowFinishSwitcher(identified), false);
});
