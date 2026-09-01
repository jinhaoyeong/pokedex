import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCollectorNumber,
  extractCollectorNumberForRegion,
  parseOcrText,
  parsePsaLabelText,
  stripScanUiChrome,
} from "../src/lib/scan/ocr";
import {
  correctOcrSpeciesName,
  extractNestedOcrNameTokens,
} from "../src/lib/scan/ocr-species";
import {
  extractSetHintsFromText,
  localizedPrintSlugs,
  textIdentitySearchLanguages,
} from "../src/lib/scan/text-identity";

test("stripScanUiChrome removes status-bar clocks without flattening OCR lines", () => {
  const stripped = stripScanUiChrome("7:00\nVaporeon\n70 HP\n12/64");
  assert.equal(stripped.includes("7:00"), false);
  assert.match(stripped, /Vaporeon/);
  assert.match(stripped, /12\/64/);
  assert.ok(stripped.includes("\n"), "card lines stay separate");
  assert.equal(stripped.split("\n").filter(Boolean).length, 3);
});

test("a phone clock is not a collector number", () => {
  assert.equal(extractCollectorNumber("7:00"), undefined);
  assert.equal(extractCollectorNumber("10:02 AM\n21%"), undefined);
  assert.equal(
    extractCollectorNumberForRegion("7:00\nSearch for products", "full"),
    undefined,
  );
  assert.equal(
    extractCollectorNumberForRegion("7:00", "footer"),
    undefined,
  );
  assert.equal(parseOcrText("7:00\n5G\n21%").number, undefined);
});

test("real collector fractions still parse after chrome stripping", () => {
  assert.equal(extractCollectorNumber("Vaporeon\n12/64"), "12/64");
  assert.equal(extractCollectorNumber("#7"), "7");
  assert.equal(extractCollectorNumberForRegion("4/82", "footer"), "4/82");
  assert.equal(extractCollectorNumberForRegion("4", "footer"), "4");
});

test("parseOcrText keeps Vaporeon from a nested-card name band", () => {
  const parsed = parseOcrText("Vaporeon\n70 HP\n12/64", { region: "header" });
  assert.ok(
    parsed.nameCandidates.some((name) => /vaporeon/i.test(name)),
    `names: ${parsed.nameCandidates.join(", ")}`,
  );
  assert.equal(parsed.number, "12/64");
});

test("parseOcrText keeps Vaporeon from noisy nested-crop OCR", () => {
  const parsed = parseOcrText("é) Vaporeon 70M @)\n= AE Ss\nBY Fl i", {
    region: "header",
  });
  assert.ok(
    parsed.nameCandidates.some((name) => /vaporeon/i.test(name)),
    `names: ${parsed.nameCandidates.join(", ")}`,
  );
});

test("PSA labels still read Team Rocket 4/82 after chrome stripping", () => {
  const parsed = parsePsaLabelText(
    ["PSA", "DARK CHARIZARD", "TEAM ROCKET · 4/82", "9", "GEM MT"].join("\n"),
  );
  assert.equal(parsed.number, "4/82");
});

test("correctOcrSpeciesName maps garbled nested OCR onto Vaporeon", () => {
  const tokens = extractNestedOcrNameTokens("é) VSpooreon 70M @)\n= AE Ss\nBY Fl i");
  const corrected = correctOcrSpeciesName(["VSpooreon", "vaporeon", ...tokens]);
  assert.equal(corrected?.name, "Vaporeon");
  assert.ok((corrected?.score ?? 0) >= 0.72);
});

test("correctOcrSpeciesName ignores Collectr screenshot chrome tokens", () => {
  assert.equal(
    correctOcrSpeciesName(["Trading", "Games", "Collectr", "Products", "Search"]),
    null,
  );
});

test("text identity catalog lookup prefers English before all-language fanout", () => {
  assert.deepEqual(textIdentitySearchLanguages([]), ["en", "all"]);
  assert.deepEqual(textIdentitySearchLanguages(["en"]), ["en", "all"]);
  assert.deepEqual(textIdentitySearchLanguages(["ja"]), ["ja", "all"]);
  assert.deepEqual(textIdentitySearchLanguages(["zh-cn"]), ["zh-cn", "en", "all"]);
});

test("Japanese PSA set+number maps to a direct catalog slug", () => {
  const slugs = localizedPrintSlugs("ja", ["S8b", "S8B"], "233");
  assert.ok(slugs.includes("ja--S8b-233"), slugs.join(", "));
  assert.equal(localizedPrintSlugs("en", ["swsh9"], "TG16").length, 0);
});

test("any Japanese set+number can build a catalog slug", () => {
  assert.ok(localizedPrintSlugs("ja", ["SV4a"], "187").includes("ja--SV4a-187"));
  assert.ok(localizedPrintSlugs("ja", ["SV8A"], "217").includes("ja--SV8A-217"));
  assert.ok(localizedPrintSlugs("ja", ["SM12a"], "105").includes("ja--SM12a-105"));
});

test("Japanese print text maps English PSA set titles to catalog codes", () => {
  const climax = extractSetHintsFromText(
    "2021 POKEMON JPN.SWSH\nFA/CHARIZARD VMAX\nVMAX CLIMAX\n#103",
  );
  assert.ok(
    climax.setCodes.some((code) => /^s8b$/i.test(code)),
    `climax codes: ${climax.setCodes.join(", ")}`,
  );

  const treasure = extractSetHintsFromText(
    "2023 POKEMON JPN.SV\nUMBREON EX\nSHINY TREASURE EX\n#217",
  );
  assert.ok(
    treasure.setCodes.some((code) => /^sv4a$/i.test(code)),
    `treasure codes: ${treasure.setCodes.join(", ")}`,
  );

  const festival = extractSetHintsFromText(
    "2024 POKEMON JPN.SV\nTERASTAL FESTIVAL EX\n#217",
  );
  assert.ok(
    festival.setCodes.some((code) => /^sv8a$/i.test(code)),
    `festival codes: ${festival.setCodes.join(", ")}`,
  );

  const footer = extractSetHintsFromText("illus saino misaki sv4a 187/190 SAR");
  assert.ok(
    footer.setCodes.some((code) => /^sv4a$/i.test(code)),
    `footer codes: ${footer.setCodes.join(", ")}`,
  );
});

test("English Brilliant Stars labels do not pick a Japanese set code", () => {
  const hints = extractSetHintsFromText(
    "2022 POKEMON SWSH\nFA/MIMIKYU V\nBRILLIANT STARS\n#TG16",
  );
  assert.equal(
    hints.setCodes.filter((code) => /^s8b$/i.test(code)).length,
    0,
    `codes: ${hints.setCodes.join(", ")}`,
  );
});
