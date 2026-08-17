import assert from "node:assert/strict";
import test from "node:test";

import { lookupBundledCardBySlug } from "../src/lib/bundled-cards";
import { buildEnglishCardIdCandidates } from "../src/lib/pokemon-tcg/tcgdex-normalizers";

test("bundled seed serves Base Set Charizard without a live catalog fetch", () => {
  const card = lookupBundledCardBySlug("base1-4");
  assert.ok(card);
  assert.equal(card?.name, "Charizard");
  assert.equal(card?.collectorNumber, "4");
  assert.ok(card?.image && card.image !== "/icon.svg");
});

test("English 151 ids try the TCGdex padded set id as well as the Pokemon TCG id", () => {
  const candidates = buildEnglishCardIdCandidates("sv3pt5-199");
  assert.ok(candidates.includes("sv3pt5-199"));
  assert.ok(candidates.includes("sv03.5-199"));
});
