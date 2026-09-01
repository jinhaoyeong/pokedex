import assert from "node:assert/strict";
import test from "node:test";

import { listCardImageDisplaySrc, listCardImageSrc } from "../src/lib/list-card-image";

test("Pokemon TCG hi-res scans drop to the standard list image", () => {
  assert.equal(
    listCardImageSrc("https://images.pokemontcg.io/sv3/1_hires.png"),
    "https://images.pokemontcg.io/sv3/1.png",
  );
});

test("Scrydex large scans drop to the small list image", () => {
  assert.equal(
    listCardImageSrc("https://images.scrydex.com/pokemon/me2pt5-281/large"),
    "https://images.scrydex.com/pokemon/me2pt5-281/small",
  );
  assert.equal(
    listCardImageSrc("https://images.scrydex.com/pokemon/me2pt5-79/medium"),
    "https://images.scrydex.com/pokemon/me2pt5-79/small",
  );
});

test("TCGdex high assets drop to the low list derivative", () => {
  assert.equal(
    listCardImageSrc("https://assets.tcgdex.net/en/sv/sv03/001/high.webp"),
    "https://assets.tcgdex.net/en/sv/sv03/001/low.webp",
  );
  assert.equal(
    listCardImageSrc("https://assets.tcgdex.net/en/sv/sv03/001"),
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

test("official Japanese scans use the same-origin proxy in the Dex list", () => {
  const official =
    "https://www.pokemon-card.com/assets/images/card_images/large/SV8/045123_P_RIZADONEX.jpg";

  assert.equal(
    listCardImageDisplaySrc(official),
    `/api/card-image?url=${encodeURIComponent(official)}`,
  );
  assert.equal(
    listCardImageDisplaySrc("https://assets.tcgdex.net/en/sv/sv03/001/high.webp"),
    "https://assets.tcgdex.net/en/sv/sv03/001/low.webp",
  );
  assert.equal(
    listCardImageDisplaySrc("https://images.scrydex.com/pokemon/me2pt5-281/large"),
    "https://images.scrydex.com/pokemon/me2pt5-281/small",
  );
});
