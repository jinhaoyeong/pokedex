import assert from "node:assert/strict";
import test from "node:test";

import { buildTcgdexSetIdCandidateFromEnglishSetId } from "../src/lib/pokemon-tcg/text-and-collector-utils";
import { buildLocalizedSetIdCandidates } from "../src/lib/pokemon-tcg/tcgdex-normalizers";

test("English Mega Evolution ids pad to TCGdex zero-padded set ids", () => {
  assert.equal(buildTcgdexSetIdCandidateFromEnglishSetId("me5"), "me05");
  assert.equal(buildTcgdexSetIdCandidateFromEnglishSetId("me1"), "me01");
  assert.equal(buildTcgdexSetIdCandidateFromEnglishSetId("me2pt5"), "me02.5");
});

test("Japanese set codes are not rewritten to English padded ids", () => {
  assert.equal(buildTcgdexSetIdCandidateFromEnglishSetId("M5"), null);
  assert.equal(buildTcgdexSetIdCandidateFromEnglishSetId("SV11W"), null);
});

test("English set browse tries the TCGdex padded id first", () => {
  const candidates = buildLocalizedSetIdCandidates("en", "me5");
  assert.equal(candidates[0], "me05");
  assert.ok(candidates.includes("me5"));
});
