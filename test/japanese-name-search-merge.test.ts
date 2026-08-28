import assert from "node:assert/strict";
import test from "node:test";

import { mergeOfficialJapaneseAndTcgdexNameResults } from "../src/lib/japanese-name-search-merge";
import type { SearchResult, TcgCard } from "../src/types/pokemon";

function card(
  overrides: Partial<TcgCard> &
    Pick<TcgCard, "id" | "collectorNumber" | "setCode" | "name">,
): TcgCard {
  return {
    slug: overrides.id,
    language: "ja",
    languageLabel: "Japanese",
    rarity: "Rare",
    supertype: "Pokémon",
    hp: "-",
    types: [],
    setId: overrides.setCode,
    setName: overrides.setCode,
    image: "",
    artist: "",
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "test",
      fetchedAt: null,
      note: "",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [],
    gradedPrices: [],
    recentSales: [],
    sources: [],
    ...overrides,
  };
}

function result(entry: TcgCard, score = 100): SearchResult {
  return {
    card: entry,
    score,
    matchReason: "test",
  };
}

test("unique TCGdex match fills the official browse seed collector number", () => {
  const official = result(
    card({
      id: "official-19223",
      collectorNumber: "",
      setCode: "DPs-B",
      name: "ディアルガ (Dialga)",
      localizedName: "ディアルガ",
      englishName: "Dialga",
      officialCardId: "19223",
    }),
  );
  const tcgdex = result(
    card({
      id: "dps-b-071",
      collectorNumber: "071",
      setCode: "DPs-B",
      name: "ディアルガ",
      localizedName: "ディアルガ",
      setPrintedTotal: 92,
    }),
  );

  const merged = mergeOfficialJapaneseAndTcgdexNameResults([official], [tcgdex]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.card.id, "official-19223");
  assert.equal(merged[0]?.card.collectorNumber, "71");
  assert.equal(merged[0]?.card.setPrintedTotal, 92);
});

test("exact collector numbers still collapse official and TCGdex tiles", () => {
  const official = result(
    card({
      id: "official-37382",
      collectorNumber: "100",
      setCode: "SM12",
      name: "アルセウス&ディアルガ&パルキアGX",
      localizedName: "アルセウス&ディアルガ&パルキアGX",
    }),
  );
  const tcgdex = result(
    card({
      id: "sm12-100",
      collectorNumber: "100",
      setCode: "SM12",
      name: "アルセウス&ディアルガ&パルキアGX",
      localizedName: "アルセウス&ディアルガ&パルキアGX",
    }),
  );

  const merged = mergeOfficialJapaneseAndTcgdexNameResults([official], [tcgdex]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.card.id, "official-37382");
});

test("one numberless official against two numbered prints keeps the numbered tiles", () => {
  const official = result(
    card({
      id: "official-seed",
      collectorNumber: "",
      setCode: "SM12",
      name: "ディアルガ",
      localizedName: "ディアルガ",
      englishName: "Dialga",
    }),
  );
  const first = result(
    card({
      id: "sm12-047",
      collectorNumber: "047",
      setCode: "SM12",
      name: "ディアルガ",
      localizedName: "ディアルガ",
    }),
  );
  const second = result(
    card({
      id: "sm12-071",
      collectorNumber: "071",
      setCode: "SM12",
      name: "ディアルガ",
      localizedName: "ディアルガ",
    }),
  );

  const merged = mergeOfficialJapaneseAndTcgdexNameResults([official], [first, second]);

  assert.deepEqual(
    merged.map((item) => item.card.id).sort(),
    ["sm12-047", "sm12-071"],
  );
});

test("two numberless official prints drop same-set TCGdex duplicates", () => {
  const officialA = result(
    card({
      id: "official-a",
      collectorNumber: "",
      setCode: "SM12",
      name: "ディアルガ",
      localizedName: "ディアルガ",
      englishName: "Dialga",
    }),
  );
  const officialB = result(
    card({
      id: "official-b",
      collectorNumber: "",
      setCode: "SM12",
      name: "ディアルガ",
      localizedName: "ディアルガ",
      englishName: "Dialga",
    }),
  );
  const tcgdex = result(
    card({
      id: "sm12-047",
      collectorNumber: "047",
      setCode: "SM12",
      name: "ディアルガ",
      localizedName: "ディアルガ",
    }),
  );

  const merged = mergeOfficialJapaneseAndTcgdexNameResults(
    [officialA, officialB],
    [tcgdex],
  );

  assert.deepEqual(
    merged.map((item) => item.card.id).sort(),
    ["official-a", "official-b"],
  );
});

test("TCGdex cards from another set stay in the list", () => {
  const official = result(
    card({
      id: "official-19223",
      collectorNumber: "",
      setCode: "DPs-B",
      name: "ディアルガ",
      localizedName: "ディアルガ",
      englishName: "Dialga",
    }),
  );
  const otherSet = result(
    card({
      id: "sm12-047",
      collectorNumber: "047",
      setCode: "SM12",
      name: "ディアルガ",
      localizedName: "ディアルガ",
    }),
  );

  const merged = mergeOfficialJapaneseAndTcgdexNameResults([official], [otherSet]);

  assert.equal(merged.length, 2);
});
