import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCollectorNumber,
  extractCollectorNumberForRegion,
  parseOcrText,
  parsePsaLabelText,
  stripScanUiChrome,
} from "../src/lib/scan/ocr";

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

test("PSA labels still read Team Rocket 4/82 after chrome stripping", () => {
  const parsed = parsePsaLabelText(
    ["PSA", "DARK CHARIZARD", "TEAM ROCKET · 4/82", "9", "GEM MT"].join("\n"),
  );
  assert.equal(parsed.number, "4/82");
});
