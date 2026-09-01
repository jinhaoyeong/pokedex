import assert from "node:assert/strict";
import test from "node:test";

import {
  expandCatalogSetFilterKeys,
  isEnglishCatalogSetFilter,
  localizedLanguageCodesForSetFilter,
} from "../src/lib/pokemon-tcg/text-and-collector-utils";

test("Ascended Heroes Dex filter expands to TCGdex and Pokemon TCG API ids", () => {
  const keys = expandCatalogSetFilterKeys("me2pt5").map((key) => key.toLowerCase());

  assert.ok(keys.includes("me2pt5"));
  assert.ok(keys.includes("me02.5"));
  assert.ok(keys.includes("me2.5"));
});

test("English Mega Evolution ids are English catalog filters", () => {
  assert.equal(isEnglishCatalogSetFilter("me2pt5"), true);
  assert.equal(isEnglishCatalogSetFilter("me02.5"), true);
  assert.equal(isEnglishCatalogSetFilter("sv8"), true);
  assert.equal(isEnglishCatalogSetFilter("M5"), false);
  assert.equal(isEnglishCatalogSetFilter("SV11W"), false);
});

test("All-language set browse does not wait on JA/ZH for English ids", () => {
  assert.deepEqual(localizedLanguageCodesForSetFilter("me2pt5"), []);
  assert.deepEqual(localizedLanguageCodesForSetFilter("base1"), []);
  assert.deepEqual(localizedLanguageCodesForSetFilter("sv8"), []);
});

test("English sets with a Japanese parallel still search JA", () => {
  assert.deepEqual(localizedLanguageCodesForSetFilter("sv3pt5"), ["ja"]);
});

test("Japanese set records stay on the Japanese catalog", () => {
  assert.deepEqual(
    localizedLanguageCodesForSetFilter("M5", { hasJapaneseSetRecord: true }),
    ["ja"],
  );
});
