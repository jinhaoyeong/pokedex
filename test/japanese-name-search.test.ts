import assert from "node:assert/strict";
import test from "node:test";

import { applyJapaneseMarketSetLabels, getLocalizedSetMarketProfile, resolveLocalizedSetEnglishName } from "../src/lib/localized-set-market";
import { searchOfficialJapaneseBrowseSeed } from "../src/lib/official-japanese-browse.server";
import { isVerifiedPriceResult } from "../src/lib/price/price-query";
import {
  findJapaneseCardNameSearchAliases,
  resolveJapanesePrintedNameToEnglishSync,
  resolvePokemonNameToEnglish,
} from "../src/lib/pokemon-name-db.server";
import { setCodeFromOfficialJapaneseThumb } from "../src/lib/pokemon-tcg/official-japanese-catalog";
import {
  localizedCardMatchesNameQuery,
  pickJapaneseCatalogSearchKeyword,
} from "../src/lib/pokemon-tcg/text-and-collector-utils";

test("Japanese Dialga resolves to the English species name", async () => {
  assert.equal(await resolvePokemonNameToEnglish("ディアルガ", "ja"), "Dialga");
  assert.equal(resolveJapanesePrintedNameToEnglishSync("ディアルガ"), "Dialga");
  assert.equal(resolveJapanesePrintedNameToEnglishSync("オリジンディアルガVSTAR"), "Origin Forme Dialga VSTAR");
  assert.equal(
    resolveJapanesePrintedNameToEnglishSync("アルセウス&ディアルガ&パルキアGX"),
    "Arceus & Dialga & Palkia GX",
  );
});

test("English Dialga expands to the Japanese browse name ディアルガ", async () => {
  const aliases = await findJapaneseCardNameSearchAliases("dialga");
  assert.ok(aliases.includes("ディアルガ"), aliases.join(", "));
});

test("official Japanese search prefers a CJK keyword over the English query", () => {
  assert.equal(
    pickJapaneseCatalogSearchKeyword(["dialga", "ディアルガ", "Dialga"]),
    "ディアルガ",
  );
});

test("Japanese Dialga prints match a Dialga name search", () => {
  const aliases = ["ディアルガ"];
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "ディアルガ (Dialga)",
        localizedName: "ディアルガ",
        englishName: "Dialga",
      },
      "dialga",
      aliases,
    ),
    true,
  );
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "オリジンディアルガVSTAR",
        localizedName: "オリジンディアルガVSTAR",
        englishName: "Origin Forme Dialga VSTAR",
      },
      "dialga",
      aliases,
    ),
    true,
  );
});

test("wrong Pokémon with a patched Dialga englishName are rejected", () => {
  const aliases = ["ディアルガ"];
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "アーマルド (Dialga)",
        localizedName: "アーマルド",
        englishName: "Dialga",
      },
      "dialga",
      aliases,
    ),
    false,
  );
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "コスモッグ (Dialga)",
        localizedName: "コスモッグ",
        englishName: "Dialga",
      },
      "dialga",
      aliases,
    ),
    false,
  );
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "アーマルド (Dialga)",
        localizedName: "アーマルド",
        englishName: "Dialga",
      },
      "dialga",
    ),
    false,
  );
});

test("Japanese set profiles win over English-parallel companion set names", () => {
  assert.equal(resolveLocalizedSetEnglishName("SM12", "Cosmic Eclipse"), "Alter Genesis");
  assert.equal(resolveLocalizedSetEnglishName("M1L", "Mega Brave"), "Mega Brave");
  assert.equal(resolveLocalizedSetEnglishName("S12A", "Crown Zenith"), "VSTAR Universe");
  assert.equal(resolveLocalizedSetEnglishName("S3A", "Darkness Ablaze"), "Legendary Pulse");
  assert.equal(resolveLocalizedSetEnglishName("S10A", "Lost Origin"), "Dark Phantasma");
  assert.equal(resolveLocalizedSetEnglishName("CP3", "CP3"), "PokeKyun Collection");
  assert.equal(resolveLocalizedSetEnglishName("SM0", "SM0"), "Sun & Moon New Friends");
});

test("PriceCharting set-guide snapshots count as verified list prices", () => {
  assert.equal(
    isVerifiedPriceResult({
      ungradedUsd: 12.5,
      primaryProvider: "",
      results: [
        {
          evidenceType: "guide_snapshot",
          ungradedUsd: 12.5,
        },
      ],
    }),
    true,
  );
});

test("official Japanese browse seed returns a full Dialga page", () => {
  const result = searchOfficialJapaneseBrowseSeed({
    aliases: ["dialga", "ディアルガ"],
    page: 1,
    pageSize: 24,
  });
  assert.ok(result.totalCount >= 8, `expected Dialga prints in the browse seed, got ${result.totalCount}`);
  assert.ok(result.matches.length >= 8);
  assert.ok(
    result.matches.every(
      (match) =>
        (match.item.cardNameAltText ?? "").includes("ディアルガ") ||
        (match.item.cardNameViewText ?? "").includes("ディアルガ"),
    ),
  );
});

test("Japanese market set labels replace English-parallel companion names", () => {
  const labeled = applyJapaneseMarketSetLabels({
    language: "ja" as const,
    setCode: "SM12",
    setName: "Cosmic Eclipse",
    setEnglishName: "Cosmic Eclipse",
  });
  assert.equal(labeled.setEnglishName, "Alter Genesis");
  assert.equal(labeled.setName, "Alter Genesis");
});

test("Japanese Giratina printed names resolve for list pricing", async () => {
  assert.equal(await resolvePokemonNameToEnglish("ギラティナ", "ja"), "Giratina");
  assert.equal(resolveJapanesePrintedNameToEnglishSync("ギラティナ"), "Giratina");
  assert.equal(
    resolveJapanesePrintedNameToEnglishSync("ギラティナ プリズムスター"),
    "Giratina Prism Star",
  );
  assert.equal(
    resolveJapanesePrintedNameToEnglishSync("ガブリアス&ギラティナGX"),
    "Garchomp & Giratina GX",
  );
  assert.equal(
    resolveJapanesePrintedNameToEnglishSync("オリジンギラティナVSTAR"),
    "Origin Forme Giratina VSTAR",
  );
});

test("English Giratina expands to the Japanese browse name ギラティナ", async () => {
  const aliases = await findJapaneseCardNameSearchAliases("giratina");
  assert.ok(aliases.includes("ギラティナ"), aliases.join(", "));
  assert.equal(pickJapaneseCatalogSearchKeyword(aliases), "ギラティナ");
});

test("Japanese Giratina TAG TEAM and Prism Star prints match a Giratina name search", () => {
  const aliases = ["ギラティナ"];
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "ギラティナ プリズムスター",
        localizedName: "ギラティナ プリズムスター",
        englishName: "Giratina Prism Star",
      },
      "giratina",
      aliases,
    ),
    true,
  );
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "ガブリアス&ギラティナGX",
        localizedName: "ガブリアス&ギラティナGX",
        englishName: "Garchomp & Giratina GX",
      },
      "giratina",
      aliases,
    ),
    true,
  );
});

test("Japanese set profiles cover Giratina Dex sets that used to lack market slugs", () => {
  assert.equal(resolveLocalizedSetEnglishName("SM7B", "SM7b"), "Fairy Rise");
  assert.equal(resolveLocalizedSetEnglishName("SM8B", "SM8b"), "GX Ultra Shiny");
  assert.equal(resolveLocalizedSetEnglishName("XY7", "XY7"), "Bursting Volcano");
  assert.equal(resolveLocalizedSetEnglishName("XY7-B", "XY7-B"), "Bursting Volcano");
  assert.equal(resolveLocalizedSetEnglishName("M6", "M6"), "Storm Emeralda");
  assert.equal(resolveLocalizedSetEnglishName("DP5", "DP5"), "Cry from the Mysterious");
  assert.equal(
    getLocalizedSetMarketProfile("SM7b")?.priceChartingSlug,
    "pokemon-japanese-fairy-rise",
  );
  assert.equal(
    getLocalizedSetMarketProfile("XY7-B")?.priceChartingSlug,
    "pokemon-japanese-bursting-volcano",
  );
});

test("official Japanese thumbs expose set codes for keyword-search tiles", () => {
  assert.equal(
    setCodeFromOfficialJapaneseThumb("/assets/images/card_images/large/SM7b/035254_P_GIRATEINA.jpg"),
    "SM7B",
  );
  assert.equal(
    setCodeFromOfficialJapaneseThumb("/assets/images/card_images/large/XY7-B/035821_P_GIRATEINAEX.jpg"),
    "XY7-B",
  );
});

test("a missing Japanese englishName is not treated as the search query", () => {
  assert.equal(
    localizedCardMatchesNameQuery(
      {
        name: "アーマルド",
        localizedName: "アーマルド",
      },
      "dialga",
      ["ディアルガ"],
    ),
    false,
  );
});
