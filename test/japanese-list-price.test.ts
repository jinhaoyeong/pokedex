import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseJapaneseSetGuideWithoutOfficialIdentity,
  isGuideSecretRareCardId,
  isOfficialJapaneseCatalogCardId,
  isTcgdexStyleJapaneseCardId,
  listEnglishNameForJapaneseSetGuide,
  resolveJapaneseListEnglishName,
} from "../src/lib/price/japanese-list-price";
import { extractParentheticalEnglish } from "../src/lib/price/price-query";

test("TCGdex Japanese list ids are eligible for set-guide pricing", () => {
  assert.equal(isTcgdexStyleJapaneseCardId("neo3-001", "ja--neo3-001"), true);
  assert.equal(isTcgdexStyleJapaneseCardId("SV1S-001", "ja--SV1S-001"), true);
  assert.equal(isTcgdexStyleJapaneseCardId("SV1a-001", "ja--SV1a-001"), true);
});

test("official catalog ids stay behind the official-detail identity gate", () => {
  assert.equal(isTcgdexStyleJapaneseCardId("official-49990", "ja--official-49990"), false);
  assert.equal(isTcgdexStyleJapaneseCardId("49990", "ja--official-49990"), false);
  assert.equal(isOfficialJapaneseCatalogCardId("official-47780", "ja--official-47780"), true);
  assert.equal(isOfficialJapaneseCatalogCardId("official-pc-m5-118", "ja--official-pc-m5-118"), false);
});

test("PriceCharting secret-rare supplements can use the set guide without an official id", () => {
  assert.equal(isGuideSecretRareCardId("official-pc-m5-118", "ja--official-pc-m5-118"), true);
  assert.equal(isGuideSecretRareCardId("official-49990", "ja--official-49990"), false);
  assert.equal(
    canUseJapaneseSetGuideWithoutOfficialIdentity({
      language: "ja",
      cardId: "official-pc-m5-118",
      slug: "ja--official-pc-m5-118",
      setCode: "M5",
      collectorNumber: "118",
      englishName: "Mega Darkrai ex",
      setEnglishName: "Abyss Eye",
    }),
    true,
  );
});

test("set-guide without official identity requires a Japanese TCGdex print", () => {
  assert.equal(
    canUseJapaneseSetGuideWithoutOfficialIdentity({
      language: "ja",
      cardId: "neo3-001",
      slug: "ja--neo3-001",
      setCode: "NEO3",
      collectorNumber: "001",
      englishName: "Zubat",
      setEnglishName: "Awakening Legends",
    }),
    true,
  );

  assert.equal(
    canUseJapaneseSetGuideWithoutOfficialIdentity({
      language: "ja",
      cardId: "official-49990",
      slug: "ja--official-49990",
      setCode: "M2A",
      collectorNumber: "230",
      englishName: "Mega Gengar ex",
    }),
    false,
  );

  assert.equal(
    canUseJapaneseSetGuideWithoutOfficialIdentity({
      language: "en",
      cardId: "neo3-001",
      slug: "ja--neo3-001",
      setCode: "NEO3",
      collectorNumber: "001",
      englishName: "Zubat",
    }),
    false,
  );
});

test("official Japanese Dex browse tiles can use the set guide by English name", () => {
  assert.equal(
    canUseJapaneseSetGuideWithoutOfficialIdentity({
      language: "ja",
      cardId: "official-47780",
      slug: "ja--official-47780",
      officialCardId: "47780",
      setCode: "S12A",
      collectorNumber: "",
      englishName: "Dialga",
      setEnglishName: "VSTAR Universe",
    }),
    true,
  );

  assert.equal(
    canUseJapaneseSetGuideWithoutOfficialIdentity({
      language: "ja",
      cardId: "official-47780",
      slug: "ja--official-47780",
      setCode: "S12A",
      englishName: "Dialga",
    }),
    true,
  );

  assert.equal(
    canUseJapaneseSetGuideWithoutOfficialIdentity({
      language: "ja",
      cardId: "official-47780",
      slug: "ja--official-47780",
      setCode: "S12A",
      collectorNumber: "",
    }),
    false,
  );
});

test("official Japanese list names keep the catalog English name", () => {
  assert.equal(
    listEnglishNameForJapaneseSetGuide({
      cardId: "official-47780",
      slug: "ja--official-47780",
      name: "ディアルガ (Dialga)",
      englishName: "Dialga",
    }),
    "Dialga",
  );

  assert.equal(
    listEnglishNameForJapaneseSetGuide({
      cardId: "neo3-001",
      slug: "ja--neo3-001",
      name: "キャタピー (Espeon)",
      englishName: "Espeon",
    }),
    undefined,
  );
});

test("Japanese list English names prefer the localized print over a same-id companion", () => {
  assert.equal(
    resolveJapaneseListEnglishName({
      name: "Zubat (Ampharos)",
      englishName: "Ampharos",
    }),
    "Zubat",
  );
  assert.equal(
    resolveJapaneseListEnglishName({
      name: "Dark Ampharos",
      englishName: "Ampharos",
    }),
    "Dark Ampharos",
  );
  assert.equal(
    resolveJapaneseListEnglishName({
      name: "Cacnea",
      englishName: "Cacnea",
    }),
    "Cacnea",
  );
  assert.equal(
    resolveJapaneseListEnglishName({
      name: "キャタピー (Espeon)",
      englishName: "Espeon",
    }),
    undefined,
  );
});

test("parenthetical English names ignore language tags like (JP)", () => {
  assert.equal(extractParentheticalEnglish("ディアルガ (Dialga)"), "Dialga");
  assert.equal(extractParentheticalEnglish("Dialga (JP)"), undefined);
  assert.equal(extractParentheticalEnglish("Dialga (JA)"), undefined);
  assert.equal(extractParentheticalEnglish("Pikachu (Japanese)"), undefined);
});
