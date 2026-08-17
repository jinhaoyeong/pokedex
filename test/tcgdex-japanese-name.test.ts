import assert from "node:assert/strict";
import test from "node:test";

import {
  inferEnglishNameFromTcgdexLocalizedName,
  tcgdexEnglishCompanionNameAgrees,
} from "../src/lib/tcgdex-japanese-name";

test("same-id English companions are rejected when the Japanese print is a different Pokemon", () => {
  assert.equal(tcgdexEnglishCompanionNameAgrees("Zubat", "Ampharos"), false);
  assert.equal(tcgdexEnglishCompanionNameAgrees("Zubat (Ampharos)", "Ampharos"), false);
  assert.equal(tcgdexEnglishCompanionNameAgrees("Dark Ampharos", "Ampharos"), false);
  assert.equal(tcgdexEnglishCompanionNameAgrees("Cacnea", "Cacnea"), true);
  assert.equal(tcgdexEnglishCompanionNameAgrees("ズバット", "Zubat"), false);
});

test("vintage TCGdex Japanese names that are already English stay on that print", () => {
  assert.equal(inferEnglishNameFromTcgdexLocalizedName("Zubat"), "Zubat");
  assert.equal(inferEnglishNameFromTcgdexLocalizedName("Zubat (Ampharos)"), "Zubat");
  assert.equal(inferEnglishNameFromTcgdexLocalizedName("Dark Ampharos"), "Dark Ampharos");
  assert.equal(inferEnglishNameFromTcgdexLocalizedName("ズバット"), undefined);
});
