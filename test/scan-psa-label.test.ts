import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeParsedOcrText,
  parsePsaLabelText,
} from "../src/lib/scan/ocr";
import { extractSetHintsFromText } from "../src/lib/scan/text-identity";

test("vintage PSA label reads Dark Charizard name and Team Rocket 4/82", () => {
  const parsed = parsePsaLabelText(
    ["PSA", "DARK CHARIZARD", "TEAM ROCKET · 4/82", "9", "GEM MT"].join("\n"),
  );

  assert.ok(
    parsed.nameCandidates.some((name) => /dark charizard/i.test(name)),
    `names: ${parsed.nameCandidates.join(", ")}`,
  );
  assert.equal(parsed.number, "4/82");
  assert.ok(
    parsed.setHints?.some((hint) => /team rocket/i.test(hint)),
    `setHints: ${parsed.setHints?.join(", ")}`,
  );
});

test("modern FA/MIMIKYU VMAX label still expands to Mimikyu VMAX", () => {
  const parsed = parsePsaLabelText("FA/MIMIKYU VMAX\n#234\nVMAX CLIMAX");
  assert.ok(parsed.nameCandidates.some((name) => /mimikyu/i.test(name)));
  assert.ok(parsed.nameCandidates.some((name) => /vmax/i.test(name)));
  assert.equal(parsed.number, "234");
  assert.ok(parsed.setHints?.some((hint) => /vmax climax/i.test(hint)));
});

test("Japanese Mimikyu V CSR slab label reads name, 233, and VMAX Climax", () => {
  const parsed = parsePsaLabelText(
    [
      "2021 POKEMON JPN.SWSH",
      "FA/MIMIKYU V",
      "VMAX CLIMAX",
      "#233",
      "MINT 9",
    ].join("\n"),
  );
  assert.ok(parsed.nameCandidates.some((name) => /mimikyu/i.test(name)));
  assert.equal(parsed.number, "233");
  assert.ok(parsed.setHints?.some((hint) => /vmax climax/i.test(hint)));
  const aliases = extractSetHintsFromText(parsed.lines.join("\n"));
  assert.ok(
    aliases.setCodes.some((code) => /^s8b$/i.test(code)),
    `setCodes: ${aliases.setCodes.join(", ")}`,
  );
});

test("Japanese PSA labels for other same-art prints keep name, set, and number", () => {
  const charizard = parsePsaLabelText(
    "2021 POKEMON JPN.SWSH\nFA/CHARIZARD VMAX\nVMAX CLIMAX\n#103",
  );
  assert.ok(charizard.nameCandidates.some((name) => /charizard/i.test(name)));
  assert.equal(charizard.number, "103");
  assert.ok(charizard.setHints?.some((hint) => /vmax climax/i.test(hint)));

  const umbreon = parsePsaLabelText(
    "2023 POKEMON JPN.SV\nUMBREON EX\nSHINY TREASURE EX\n#217",
  );
  assert.ok(umbreon.nameCandidates.some((name) => /umbreon/i.test(name)));
  assert.equal(umbreon.number, "217");
  assert.ok(umbreon.setHints?.some((hint) => /shiny treasure/i.test(hint)));
});

test("Instagram caption Name · Set becomes a name plus set hint", () => {
  const parsed = parsePsaLabelText("Dark Charizard · Team Rocket");
  assert.ok(parsed.nameCandidates.some((name) => /dark charizard/i.test(name)));
  assert.ok(parsed.setHints?.some((hint) => /team rocket/i.test(hint)));
});

test("slab grade 9 is not treated as the collector number", () => {
  const parsed = parsePsaLabelText("DARK CHARIZARD\n9\nGEM MT");
  assert.ok(parsed.nameCandidates.some((name) => /dark charizard/i.test(name)));
  assert.equal(parsed.number, undefined);
});

test("Team Rocket set alias maps to base5", () => {
  const hints = extractSetHintsFromText("Dark Charizard\nTeam Rocket · 4/82");
  assert.ok(hints.setCodes.includes("base5"));
  assert.ok(hints.setHints.some((hint) => /team rocket/i.test(hint)));
});

test("mergeParsedOcrText keeps set hints from the label pass", () => {
  const merged = mergeParsedOcrText([
    parsePsaLabelText("DARK CHARIZARD"),
    parsePsaLabelText("TEAM ROCKET · 4/82"),
  ]);
  assert.ok(merged);
  assert.ok(merged.nameCandidates.some((name) => /dark charizard/i.test(name)));
  assert.equal(merged.number, "4/82");
  assert.ok(merged.setHints?.some((hint) => /team rocket/i.test(hint)));
});

test("year and hash on the same OCR line still yield Charmander 46", () => {
  const parsed = parsePsaLabelText("1999 | #46 CHARMANDER WN\nSHADOWLESS");
  assert.equal(parsed.nameCandidates[0].toLowerCase(), "charmander");
  assert.equal(parsed.number, "46");
});

test("Chinese Mew ex label OCR keeps Mew ex 003 without leading junk", () => {
  const parsed = parsePsaLabelText("8 MEW ex 图\n#003\nPOKEMON CARD MEMBERSHIP");
  assert.ok(parsed.nameCandidates.some((name) => /^mew$/i.test(name) || /^mew ex$/i.test(name)));
  assert.equal(parsed.number, "003");
  assert.equal(parsed.suffix, "ex");
});

test("noisy table-top Charmander OCR still yields Charmander 46", () => {
  const parsed = parsePsaLabelText(
    [
      "1999 POKEMON GAME #46",
      "Il Charmander Bee",
      "CHARMANDER NM -MT",
      "57389769",
      "46/102",
    ].join("\n"),
  );
  assert.equal(parsed.nameCandidates[0].toLowerCase(), "charmander");
  assert.equal(parsed.number, "46");
});

test("Dark Charizard stays ahead of a bare Charizard token", () => {
  const parsed = parsePsaLabelText("DARK CHARIZARD\nTEAM ROCKET · 4/82");
  assert.match(parsed.nameCandidates[0], /dark charizard/i);
});

test("PSA hash mark misread as plus still yields the collector number", () => {
  const parsed = parsePsaLabelText("1999 POKEMON GAME +3\nMEWTWO\nMOVIEPROMO");
  assert.ok(parsed.nameCandidates.some((name) => /mewtwo/i.test(name)));
  assert.equal(parsed.number, "3");
});

test("shadowless Charmander PSA label reads name, number, and Base Set hint", () => {
  const parsed = parsePsaLabelText(
    [
      "1999 POKEMON GAME",
      "CHARMANDER",
      "SHADOWLESS",
      "#46",
      "NM-MT 8",
      "57389769",
    ].join("\n"),
  );
  assert.ok(parsed.nameCandidates.some((name) => /^charmander$/i.test(name)));
  assert.equal(parsed.number, "46");
  assert.ok(parsed.setHints?.some((hint) => /shadowless|pokemon game/i.test(hint)));
});

test("Mewtwo movie promo PSA label reads name and #3", () => {
  const parsed = parsePsaLabelText(
    ["1999 POKEMON GAME", "MEWTWO", "MOVIE PROMO", "#3", "GEM MT 10"].join("\n"),
  );
  assert.ok(parsed.nameCandidates.some((name) => /^mewtwo$/i.test(name)));
  assert.equal(parsed.number, "3");
  assert.ok(parsed.setHints?.some((hint) => /movie promo/i.test(hint)));
});

test("Legendary Treasures Charizard holo label drops HOLO and keeps #19", () => {
  const parsed = parsePsaLabelText(
    [
      "2013 POKEMON B & W",
      "CHARIZARD - HOLO",
      "LEGENDARY TREASURES",
      "#19",
      "MINT 9",
    ].join("\n"),
  );
  assert.ok(parsed.nameCandidates.some((name) => /^charizard$/i.test(name)));
  assert.equal(parsed.number, "19");
  assert.ok(parsed.setHints?.some((hint) => /legendary treasures/i.test(hint)));
});

test("Chinese Mew ex membership promo label reads Mew ex #003", () => {
  const parsed = parsePsaLabelText(
    [
      "2025 POKEMON SV-P CS",
      "MEW ex",
      "POKEMON CARD MEMBERSHIP",
      "#003",
      "MINT",
      "9",
    ].join("\n"),
  );
  assert.ok(parsed.nameCandidates.some((name) => /mew/i.test(name)));
  assert.ok(parsed.suffix === "ex" || parsed.nameCandidates.some((name) => /ex/i.test(name)));
  assert.equal(parsed.number, "003");
});

test("PSA set aliases map Legendary Treasures, movie promo, shadowless, and membership", () => {
  assert.ok(
    extractSetHintsFromText("CHARIZARD\nLEGENDARY TREASURES\n#19").setCodes.includes(
      "bw11",
    ),
  );
  assert.ok(
    extractSetHintsFromText("MEWTWO\nMOVIE PROMO\n#3").setCodes.includes("basep"),
  );
  assert.ok(
    extractSetHintsFromText("CHARMANDER\nSHADOWLESS\n#46").setCodes.includes(
      "base1",
    ),
  );
  const membership = extractSetHintsFromText("2025 POKEMON SV-P CS\nMEW ex");
  assert.ok(membership.setCodes.includes("SV-P"));
});

test("Japanese Raging Bolt ex SAR label reads name, #222, not the rarity line", () => {
  const parsed = parsePsaLabelText(
    [
      "2024 POKEMON SV8a JP",
      "RAGING BOLT ex",
      "SPECIAL ART RARE",
      "#222",
      "GEM MT 10",
    ].join("\n"),
  );
  assert.ok(parsed.nameCandidates.some((name) => /raging bolt/i.test(name)));
  assert.equal(parsed.number, "222");
  assert.ok(!parsed.nameCandidates.some((name) => /special art/i.test(name)));
});
