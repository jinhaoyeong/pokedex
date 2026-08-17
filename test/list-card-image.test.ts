import assert from "node:assert/strict";
import test from "node:test";

import { listCardImageSrc } from "../src/lib/list-card-image";

test("Pokemon TCG hi-res scans drop to the standard list image", () => {
  assert.equal(
    listCardImageSrc("https://images.pokemontcg.io/sv3/1_hires.png"),
    "https://images.pokemontcg.io/sv3/1.png",
  );
});

test("TCGdex high assets drop to the low list derivative", () => {
  assert.equal(
    listCardImageSrc("https://assets.tcgdex.net/en/sv/sv03/001/high.webp"),
    "https://assets.tcgdex.net/en/sv/sv03/001/low.webp",
  );
});

test("placeholder and unknown hosts stay unchanged", () => {
  assert.equal(listCardImageSrc("/icon.svg"), "/icon.svg");
  assert.equal(
    listCardImageSrc("https://www.pokemon-card.com/assets/images/card_images/large/SV8/045123_P_RIZADONEX.jpg"),
    "https://www.pokemon-card.com/assets/images/card_images/large/SV8/045123_P_RIZADONEX.jpg",
  );
});
