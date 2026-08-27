import assert from "node:assert/strict";
import test from "node:test";

import {
  listCardDisplaySrc,
  listCardImageSrc,
  listCardPreloadHref,
  shouldOptimizeCardImage,
  shouldProxyCardImage,
} from "../src/lib/list-card-image";

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

test("catalog CDNs use the image optimizer; pokemon-card.com does not", () => {
  assert.equal(shouldOptimizeCardImage("https://images.pokemontcg.io/ex8/107.png"), true);
  assert.equal(shouldOptimizeCardImage("https://assets.tcgdex.net/en/sv/sv03/001/low.webp"), true);
  assert.equal(shouldOptimizeCardImage("https://serebii.net/card/xypromo/294.jpg"), true);
  assert.equal(
    shouldOptimizeCardImage(
      "https://www.pokemon-card.com/assets/images/card_images/large/SV8/045123_P_RIZADONEX.jpg",
    ),
    false,
  );
  assert.equal(shouldOptimizeCardImage("/api/card-image?url=https://example.com/x.jpg"), false);
  assert.equal(shouldOptimizeCardImage("/icon.svg"), false);
});

test("official JP art is proxied so Dex tiles skip hotlink protection", () => {
  const official =
    "https://www.pokemon-card.com/assets/images/card_images/large/SV8/045123_P_RIZADONEX.jpg";
  assert.equal(shouldProxyCardImage(official), true);
  assert.equal(
    listCardDisplaySrc(official),
    `/api/card-image?url=${encodeURIComponent(official)}`,
  );
});

test("Dex preloads go through Next image optimizer for pokemontcg scans", () => {
  assert.equal(
    listCardPreloadHref("https://images.pokemontcg.io/ex8/107_hires.png"),
    "/_next/image?url=" +
      encodeURIComponent("https://images.pokemontcg.io/ex8/107.png") +
      "&w=384&q=60",
  );
  assert.equal(
    listCardDisplaySrc("https://images.pokemontcg.io/ex8/107_hires.png"),
    "https://images.pokemontcg.io/ex8/107.png",
  );
});
