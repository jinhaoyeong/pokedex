import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCompleteJapaneseOfficialDetailIdentity,
  japaneseOfficialCardIdFromSlug,
  resolveJapaneseOfficialDetailForCatalog,
} from "../src/lib/card-catalog";
import { normalizeOfficialJapaneseCard } from "../src/lib/pokemon-tcg/official-japanese-catalog";
import type { PokemonCardJpDetail } from "../src/lib/pokemon-tcg/api-types";
import type { TcgCard } from "../src/types/pokemon";

function officialDetail(cardID = "49990", collectorNumber = "230"): PokemonCardJpDetail {
  return {
    cardID,
    name: cardID === "49990" ? "メガゲンガーex" : "メガルカリオex",
    image: "https://www.pokemon-card.com/card.jpg",
    setCode: "M2a",
    collectorNumber,
    collectorNumberSource: "official-detail",
    printedTotal: 193,
    rarity: "Special Art Rare",
    hp: "350",
    types: ["Psychic"],
    artist: "Fixture Artist",
  };
}

function completeCard(cardID = "49990", collectorNumber = "230") {
  return normalizeOfficialJapaneseCard(
    officialDetail(cardID, collectorNumber),
    cardID === "49990" ? "Mega Gengar ex" : "Mega Lucario ex",
  );
}

test("ja--official-49990 rejects an incomplete index card and hydrates the verified printed number", async () => {
  const incomplete = {
    ...completeCard(),
    collectorNumber: "",
    englishName: undefined,
    marketIdentity: undefined,
  } as TcgCard;
  let hydrations = 0;

  const result = await resolveJapaneseOfficialDetailForCatalog(
    "ja--official-49990",
    { indexed: incomplete },
    async () => {
      hydrations += 1;
      return completeCard();
    },
  );

  assert.equal(hydrations, 1);
  assert.equal(result.source, "live");
  assert.equal(result.card?.officialCardId, "49990");
  assert.equal(result.card?.collectorNumber, "230");
  assert.equal(result.card?.marketIdentity?.printedCollectorNumber, "230");
  assert.equal(result.card?.marketIdentity?.identityStatus, "confirmed");
});

test("a second Japanese official card uses the same generic hydration path", async () => {
  const result = await resolveJapaneseOfficialDetailForCatalog(
    "ja--official-48523",
    {},
    async () => completeCard("48523", "229"),
  );

  assert.equal(result.card?.officialCardId, "48523");
  assert.equal(result.card?.collectorNumber, "229");
  assert.equal(result.card?.marketIdentity?.officialCardId, "48523");
});

test("a complete verified Japanese index card is reused without hydration", async () => {
  let hydrations = 0;
  const result = await resolveJapaneseOfficialDetailForCatalog(
    "ja--official-49990",
    { indexed: completeCard() },
    async () => {
      hydrations += 1;
      return null;
    },
  );

  assert.equal(hydrations, 0);
  assert.equal(result.source, "local");
  assert.equal(result.card?.collectorNumber, "230");
});

test("browse positions cannot satisfy the Japanese official detail gate", () => {
  const browseCard = {
    ...completeCard(),
    collectorNumber: "173",
    marketIdentity: {
      ...completeCard().marketIdentity!,
      printedCollectorNumber: "173",
      identityStatus: "partial" as const,
      verifiedAt: null,
      identitySource: ["official-browse"] as const,
    },
  } as TcgCard;

  assert.equal(hasCompleteJapaneseOfficialDetailIdentity(browseCard, "49990"), false);
});

test("official hydration failure still paints seed identity instead of blocking the page", async () => {
  const indexed = {
    ...completeCard(),
    collectorNumber: "",
    marketIdentity: undefined,
  } as TcgCard;
  const result = await resolveJapaneseOfficialDetailForCatalog(
    "ja--official-49990",
    { indexed },
    async () => null,
  );

  assert.equal(result.lookupFailed, false);
  assert.equal(result.card?.officialCardId, "49990");
  assert.equal(result.card?.localizedName, "メガゲンガーex");
});

test("official hydration failure is retryable when no catalog identity exists", async () => {
  const result = await resolveJapaneseOfficialDetailForCatalog(
    "ja--official-49990",
    {},
    async () => null,
  );

  assert.equal(result.card, null);
  assert.equal(result.lookupFailed, true);
  assert.equal(result.identityRetryable, true);
});

test("English slugs do not enter the Japanese official detail path", () => {
  assert.equal(japaneseOfficialCardIdFromSlug("en--sv4-198"), null);
  assert.equal(japaneseOfficialCardIdFromSlug("ja--official-49990"), "49990");
  assert.equal(hasCompleteJapaneseOfficialDetailIdentity({ ...completeCard(), language: "en" }, "49990"), false);
});
