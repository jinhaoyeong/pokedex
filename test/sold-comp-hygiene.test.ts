import assert from "node:assert/strict";
import test from "node:test";

import { classifySoldCompJunk } from "../src/lib/market/sold-comp-hygiene";

test("Celebrations Classic Collection paper titles are not treated as lots", () => {
  assert.equal(
    classifySoldCompJunk(
      "2021 POKEMON CELEBRATIONS CLASSIC COLLECTION #4 CHARIZARD-HOLO PSA 10 #4",
      { cardName: "Charizard" },
    ),
    null,
  );
});

test("signed celebrity slabs, gold metal UPC promos, and cracked PSA 10s are junk", () => {
  assert.equal(
    classifySoldCompJunk(
      "LOGAN PAUL SIGNED - 1999 POKEMON BASE SET UNLIMITED #4 CHARIZARD HOLO PSA 9",
    ),
    "signed_autograph",
  );
  assert.equal(
    classifySoldCompJunk(
      "Pokemon Gold Metal Charizard Trading Card Celebrations Promo UPC 4/102",
      { cardName: "Charizard" },
    ),
    "metal_jumbo_promo",
  );
  assert.equal(
    classifySoldCompJunk(
      "Pokemon TCG Mew ex 205/165 SV2a Card 151 Japanese SAR Holo PSA 10. Slight Crack",
    ),
    "damaged_slab",
  );
});

test("metal/jumbo product titles are kept when the audited card is itself metal", () => {
  assert.equal(
    classifySoldCompJunk("Charizard Gold Metal #4 Celebrations Promo", {
      cardName: "Charizard",
      rarity: "Gold Metal",
    }),
    null,
  );
});
