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
