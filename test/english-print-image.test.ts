import assert from "node:assert/strict";
import test from "node:test";

import {
  pokemonTcgPrintImageUrl,
  resolveTrainerGalleryEnglishSetId,
  withDerivedEnglishPrintImage,
} from "../src/lib/pokemon-tcg/english-print-image";

test("Trainer Gallery parent set codes map to the English TG subset", () => {
  assert.equal(resolveTrainerGalleryEnglishSetId("SWSH09", "TG16"), "swsh9tg");
  assert.equal(resolveTrainerGalleryEnglishSetId("swsh9", "TG16"), "swsh9tg");
  assert.equal(resolveTrainerGalleryEnglishSetId("swsh9tg", "TG16"), "swsh9tg");
  assert.equal(resolveTrainerGalleryEnglishSetId("swsh11", "TG16"), "swsh11tg");
  assert.equal(resolveTrainerGalleryEnglishSetId("swsh12pt5", "GG70"), "swsh12pt5gg");
});

test("Missing Brilliant Stars TG16 art is filled from the Pokémon TCG image host", () => {
  const filled = withDerivedEnglishPrintImage({
    id: "swsh9-TG16",
    language: "en",
    setId: "swsh9",
    setCode: "SWSH09",
    collectorNumber: "TG16",
    image: "/icon.svg",
    imageStatus: "placeholder",
  });

  assert.equal(filled.setId, "swsh9tg");
  assert.equal(filled.image, pokemonTcgPrintImageUrl("swsh9tg", "TG16"));
  assert.equal(filled.imageStatus, "derived");
});

test("Japanese official prints are not given English catalog artwork", () => {
  const card = {
    id: "official-46537",
    language: "ja",
    setCode: "SVM",
    collectorNumber: "TG16",
    image: "/icon.svg",
    imageStatus: "placeholder" as const,
  };

  assert.deepEqual(withDerivedEnglishPrintImage(card), card);
});
