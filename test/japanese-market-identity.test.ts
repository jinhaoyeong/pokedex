import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveJapaneseMarketIdentity,
  type JapaneseMarketIdentityResolverDependencies,
} from "../src/lib/japanese-market-identity.server";
import { hasConfirmedJapaneseCanonicalMarketIdentity, applyCanonicalJapaneseIdentityToCard } from "../src/lib/japanese-market-identity";
import type { PokemonCardJpDetail } from "../src/lib/pokemon-tcg/api-types";
import { normalizeOfficialJapaneseCard } from "../src/lib/pokemon-tcg/official-japanese-catalog";
import {
  findOfficialJapaneseBrowseSeedByCardId,
  findOfficialJapaneseBrowseSeedBySetAndExactName,
  findOfficialJapaneseBrowseSeedCandidatesBySetAndExactName,
} from "../src/lib/official-japanese-browse.server";
import type { CardIdentityMapping } from "../src/lib/price/identity-cache.server";
import { resolveEnglishCatalogSetFilterId } from "../src/lib/pokemon-tcg/text-and-collector-utils";

const NOW = new Date("2026-07-22T00:00:00.000Z");

test("keeps the canonical English API id for Ascended Heroes", () => {
  assert.equal(resolveEnglishCatalogSetFilterId("me2pt5"), "me02.5");
});

function officialDetail(
  collectorNumber = "２３０／１９３",
): PokemonCardJpDetail {
  return {
    cardID: "49990",
    name: "メガゲンガーex",
    image:
      "https://www.pokemon-card.com/assets/images/card_images/large/M2a/049990_P_MGENGAEX.jpg",
    setCode: "M2a",
    collectorNumber,
    browseIndex: 173,
    collectorNumberSource: "official-detail",
    printedTotal: 193,
    rarity: "Special Art Rare",
    hp: "350",
    types: ["Psychic"],
    artist: "Fixture Artist",
  };
}

function confirmedMapping(
  overrides: Partial<CardIdentityMapping> = {},
): CardIdentityMapping {
  return {
    officialCardId: "49990",
    browseIndex: 173,
    japaneseName: "メガゲンガーex",
    printedCollectorNumber: "230",
    collectorNumberTotal: 193,
    setCode: "M2A",
    japaneseSetName: "Mega Dream ex",
    englishName: "Mega Gengar ex",
    englishMarketName: "Mega Gengar ex",
    englishSetName: "Mega Dream ex",
    priceChartingSlug: "pokemon-japanese-mega-dream-ex",
    priceChartingSetSlug: "pokemon-japanese-mega-dream-ex",
    priceChartingProductId: "987654",
    priceChartingProductUrl:
      "https://www.pricecharting.com/game/pokemon-japanese-mega-dream-ex/mega-gengar-ex-230",
    identityConfidence: 0.98,
    identitySource: ["official-detail", "pricecharting-discovery"],
    identityStatus: "confirmed",
    verifiedAt: "2026-07-21T00:00:00.000Z",
    identityVersion: 4,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<JapaneseMarketIdentityResolverDependencies> = {},
): Partial<JapaneseMarketIdentityResolverDependencies> {
  return {
    readIdentityMapping: async () => null,
    writeIdentityMapping: async () => true,
    fetchOfficialDetail: async () => null,
    resolveEnglishName: async () => undefined,
    getSetProfile: () => undefined,
    resolvePriceChartingIdentity: async () => null,
    now: () => NOW,
    ...overrides,
  };
}

test("Japanese market lookups require a confirmed canonical identity", () => {
  assert.equal(hasConfirmedJapaneseCanonicalMarketIdentity("ja", null), false);
  assert.equal(
    hasConfirmedJapaneseCanonicalMarketIdentity("ja", {
      officialCardId: "49990",
      browseIndex: 173,
      japaneseName: "Mega Gengar ex",
      englishMarketName: "Mega Gengar ex",
      printedCollectorNumber: "230",
      collectorNumberTotal: 193,
      japaneseSetCode: "M2A",
      japaneseSetName: "Mega Dream ex",
      englishSetName: "Mega Dream ex",
      priceChartingSetSlug: null,
      priceChartingProductId: null,
      priceChartingProductUrl: null,
      identityConfidence: 0.5,
      identitySource: ["caller-supplied"],
      identityStatus: "partial",
      verifiedAt: null,
      identityVersion: 1,
    }),
    false,
  );
  assert.equal(hasConfirmedJapaneseCanonicalMarketIdentity("en", null), true);
});

test("SV2A ミュウex has four same-name prints and must not pick browse order", () => {
  const unique = findOfficialJapaneseBrowseSeedBySetAndExactName("SV2A", ["ミュウex"]);
  assert.equal(unique, null);

  const matches = findOfficialJapaneseBrowseSeedCandidatesBySetAndExactName("SV2A", ["ミュウex"]);
  assert.equal(matches.length, 4);
  assert.deepEqual(
    matches.map((match) => match.item.cardID).sort(),
    ["43472", "43980", "43990", "44960"],
  );
});

test("a Japanese request without an official ID derives a verified canonical identity from one official browse name", async () => {
  const knownOfficialBrowseRecord = findOfficialJapaneseBrowseSeedByCardId("48523");
  assert.ok(knownOfficialBrowseRecord);
  const match = findOfficialJapaneseBrowseSeedBySetAndExactName("M2A", [
    knownOfficialBrowseRecord.item.cardNameAltText,
  ]);

  assert.ok(match);
  assert.equal(match.item.cardID, "48523");
  assert.equal(match.setCode, "M2A");
  const identity = await resolveJapaneseMarketIdentity(
    {
      officialCardId: match.item.cardID,
      browseIndex: match.setIndex + 1,
      browseItem: match.item,
      japaneseName: "ãƒ¡ã‚¬ã‚²ãƒ³ã‚¬ãƒ¼ex",
      // This stale browse position is a caller hint, not the confirmed number.
      printedCollectorNumber: "173",
      japaneseSetCode: "M2A",
    },
    {
      persist: false,
      dependencies: dependencies({
        fetchOfficialDetail: async (officialCardId) => ({
          ...officialDetail("230/193"),
          cardID: officialCardId,
          name: match.item.cardNameAltText,
        }),
        resolveEnglishName: async () => "Mega Gengar ex",
      }),
    },
  );

  assert.equal(identity.officialCardId, "48523");
  assert.equal(identity.printedCollectorNumber, "230");
  assert.equal(identity.identityStatus, "confirmed");
  assert.equal(
    findOfficialJapaneseBrowseSeedBySetAndExactName("M2A", ["does not exist"]),
    null,
  );
});

test("browse index and caller number hints never become a printed collector number", async () => {
  const identity = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "official-49990",
      browseIndex: 173,
      printedCollectorNumber: "173",
      japaneseName: "メガゲンガーex",
      japaneseSetCode: "M2A",
    },
    {
      hydrateOfficialDetail: false,
      persist: false,
      dependencies: dependencies(),
    },
  );

  assert.equal(identity.officialCardId, "49990");
  assert.equal(identity.browseIndex, 173);
  assert.equal(identity.printedCollectorNumber, null);
  assert.equal(identity.identityStatus, "partial");
});

test("official detail confirms the printed number and persists the canonical identity", async () => {
  const writes: CardIdentityMapping[] = [];
  const identity = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "49990",
      browseIndex: 173,
      printedCollectorNumber: "173",
      japaneseSetCode: "M2A",
    },
    {
      dependencies: dependencies({
        fetchOfficialDetail: async () => officialDetail(),
        resolveEnglishName: async () => "Mega Gengar ex",
        writeIdentityMapping: async (mapping) => {
          writes.push(mapping);
          return true;
        },
      }),
    },
  );

  assert.equal(identity.browseIndex, 173);
  assert.equal(identity.printedCollectorNumber, "230");
  assert.equal(identity.collectorNumberTotal, 193);
  assert.equal(identity.japaneseSetCode, "M2A");
  assert.equal(identity.englishMarketName, "Mega Gengar ex");
  assert.equal(identity.identityStatus, "confirmed");
  assert.equal(identity.verifiedAt, NOW.toISOString());
  assert.deepEqual(writes.map((mapping) => mapping.printedCollectorNumber), ["230"]);
});

test("a confirmed cached identity is reused without official-detail I/O or a redundant write", async () => {
  let detailFetches = 0;
  let writes = 0;
  const identity = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "49990",
      browseIndex: 173,
      printedCollectorNumber: "173",
    },
    {
      dependencies: dependencies({
        readIdentityMapping: async () => confirmedMapping(),
        fetchOfficialDetail: async () => {
          detailFetches += 1;
          return officialDetail();
        },
        writeIdentityMapping: async () => {
          writes += 1;
          return true;
        },
      }),
    },
  );

  assert.equal(detailFetches, 0);
  assert.equal(writes, 0);
  assert.equal(identity.printedCollectorNumber, "230");
  assert.equal(identity.priceChartingProductId, "987654");
  assert.equal(identity.identityVersion, 4);
});

test("corrected official identity increments its version and replaces stale cached material", async () => {
  const writes: CardIdentityMapping[] = [];
  const identity = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "49990",
      browseIndex: 173,
    },
    {
      forceRefresh: true,
      dependencies: dependencies({
        readIdentityMapping: async () =>
          confirmedMapping({
            printedCollectorNumber: "173",
            collectorNumberTotal: 250,
            priceChartingProductId: null,
            priceChartingProductUrl: null,
            identityVersion: 7,
          }),
        fetchOfficialDetail: async () => officialDetail("230/193"),
        resolveEnglishName: async () => "Mega Gengar ex",
        writeIdentityMapping: async (mapping) => {
          writes.push(mapping);
          return true;
        },
      }),
    },
  );

  assert.equal(identity.printedCollectorNumber, "230");
  assert.equal(identity.collectorNumberTotal, 193);
  assert.equal(identity.identityVersion, 8);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].identityVersion, 8);
});

test("unvalidated caller PriceCharting identity is neither persisted nor reused through a trusted cache shell", async () => {
  const callerProduct = {
    priceChartingSetSlug: "pokemon-japanese-mega-dream-ex",
    priceChartingProductId: "666999",
    priceChartingProductUrl:
      "https://www.pricecharting.com/game/pokemon-japanese-mega-dream-ex/mega-gengar-ex-230",
  };
  const freshWrites: CardIdentityMapping[] = [];
  const freshProviderInputs: Array<{
    productId: string | null;
    productUrl: string | null;
  }> = [];

  const fresh = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "49990",
      browseIndex: 173,
      japaneseSetCode: "M2A",
      identitySource: ["caller-supplied"],
      ...callerProduct,
    },
    {
      dependencies: dependencies({
        fetchOfficialDetail: async () => officialDetail(),
        resolveEnglishName: async () => "Mega Gengar ex",
        resolvePriceChartingIdentity: async (identity) => {
          freshProviderInputs.push({
            productId: identity.priceChartingProductId,
            productUrl: identity.priceChartingProductUrl,
          });
          return null;
        },
        writeIdentityMapping: async (mapping) => {
          freshWrites.push(mapping);
          return true;
        },
      }),
    },
  );

  assert.equal(fresh.priceChartingProductId, null);
  assert.equal(fresh.priceChartingProductUrl, null);
  assert.equal(freshWrites.length, 1);
  assert.equal(freshWrites[0]?.priceChartingProductId, null);
  assert.equal(freshWrites[0]?.priceChartingProductUrl, null);
  assert.deepEqual(freshProviderInputs, [{ productId: null, productUrl: null }]);

  const cachedProviderInputs: Array<{
    productId: string | null;
    productUrl: string | null;
  }> = [];
  const cached = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "49990",
      browseIndex: 173,
      identitySource: ["caller-supplied"],
      ...callerProduct,
    },
    {
      hydrateOfficialDetail: false,
      dependencies: dependencies({
        readIdentityMapping: async () =>
          confirmedMapping({
            priceChartingProductId: null,
            priceChartingProductUrl: null,
          }),
        resolvePriceChartingIdentity: async (identity) => {
          cachedProviderInputs.push({
            productId: identity.priceChartingProductId,
            productUrl: identity.priceChartingProductUrl,
          });
          return null;
        },
      }),
    },
  );

  assert.equal(cached.priceChartingProductId, null);
  assert.equal(cached.priceChartingProductUrl, null);
  assert.deepEqual(cachedProviderInputs, [{ productId: null, productUrl: null }]);
});

test("provider-validated PriceCharting identity is accepted and persisted", async () => {
  const writes: CardIdentityMapping[] = [];
  const product = {
    priceChartingSetSlug: "pokemon-japanese-mega-dream-ex",
    priceChartingProductId: "11302596",
    priceChartingProductUrl:
      "https://www.pricecharting.com/game/pokemon-japanese-mega-dream-ex/mega-gengar-ex-230",
  };
  let providerInputProductId: string | null = null;

  const identity = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "49990",
      browseIndex: 173,
      japaneseSetCode: "M2A",
      identitySource: ["pricecharting-discovery"],
      ...product,
    },
    {
      validatedPriceChartingIdentity: true,
      dependencies: dependencies({
        fetchOfficialDetail: async () => officialDetail(),
        resolveEnglishName: async () => "Mega Gengar ex",
        resolvePriceChartingIdentity: async (resolved) => {
          providerInputProductId = resolved.priceChartingProductId;
          return null;
        },
        writeIdentityMapping: async (mapping) => {
          writes.push(mapping);
          return true;
        },
      }),
    },
  );

  assert.equal(providerInputProductId, product.priceChartingProductId);
  assert.equal(identity.priceChartingProductId, product.priceChartingProductId);
  assert.equal(identity.priceChartingProductUrl, product.priceChartingProductUrl);
  assert.ok(identity.identitySource.includes("pricecharting-discovery"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.priceChartingProductId, product.priceChartingProductId);
  assert.equal(writes[0]?.priceChartingProductUrl, product.priceChartingProductUrl);
});

test("cached PriceCharting product URL number 117 is not trusted for expected collector 17", async () => {
  const writes: CardIdentityMapping[] = [];
  let providerInputProductId: string | null = "not-called";
  const identity = await resolveJapaneseMarketIdentity(
    {
      officialCardId: "31109",
      browseIndex: 17,
    },
    {
      hydrateOfficialDetail: false,
      dependencies: dependencies({
        readIdentityMapping: async () =>
          confirmedMapping({
            officialCardId: "31109",
            browseIndex: 17,
            japaneseName: "ディアルガ",
            printedCollectorNumber: "017",
            collectorNumberTotal: 27,
            setCode: "CP2",
            japaneseSetName: "Legendary Shine Collection",
            englishName: "Dialga",
            englishMarketName: "Dialga",
            englishSetName: "Legendary Shine Collection",
            priceChartingSlug:
              "pokemon-japanese-legendary-shine-collection",
            priceChartingSetSlug:
              "pokemon-japanese-legendary-shine-collection",
            priceChartingProductId: "117117",
            priceChartingProductUrl:
              "https://www.pricecharting.com/game/pokemon-japanese-legendary-shine-collection/dialga-117",
          }),
        resolvePriceChartingIdentity: async (resolved) => {
          providerInputProductId = resolved.priceChartingProductId;
          return null;
        },
        writeIdentityMapping: async (mapping) => {
          writes.push(mapping);
          return true;
        },
      }),
    },
  );

  assert.equal(providerInputProductId, null);
  assert.equal(identity.printedCollectorNumber, "017");
  assert.equal(identity.priceChartingProductId, null);
  assert.equal(identity.priceChartingProductUrl, null);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.priceChartingProductId, null);
  assert.equal(writes[0]?.priceChartingProductUrl, null);
});

test("legacy browse-position collector is quarantined before canonical official-detail repair", async () => {
  const browseDetail: PokemonCardJpDetail = {
    ...officialDetail("173"),
    cardID: "99999999",
    collectorNumberSource: "official-browse",
  };
  const legacyCard = normalizeOfficialJapaneseCard(
    browseDetail,
    "Mega Gengar ex",
  );

  assert.equal(legacyCard.browseIndex, 173);
  assert.equal(legacyCard.collectorNumber, "");
  assert.equal(legacyCard.marketIdentity?.printedCollectorNumber, null);
  assert.equal(legacyCard.marketIdentity?.identityStatus, "partial");
  assert.equal(legacyCard.marketIdentity?.priceChartingProductId, null);

  const repaired = await resolveJapaneseMarketIdentity(
    {
      officialCardId: legacyCard.officialCardId ?? "",
      browseIndex: legacyCard.browseIndex,
      japaneseName: legacyCard.localizedName,
      englishMarketName: legacyCard.englishName,
      printedCollectorNumber: legacyCard.collectorNumber,
      collectorNumberTotal: legacyCard.setPrintedTotal,
      japaneseSetCode: legacyCard.setCode,
      japaneseSetName: legacyCard.setLocalizedName,
      englishSetName: legacyCard.setEnglishName,
      identitySource: legacyCard.marketIdentity?.identitySource,
    },
    {
      persist: false,
      dependencies: dependencies({
        fetchOfficialDetail: async () => officialDetail("230/193"),
        resolveEnglishName: async () => "Mega Gengar ex",
      }),
    },
  );

  assert.equal(repaired.browseIndex, 173);
  assert.equal(repaired.printedCollectorNumber, "230");
  assert.equal(repaired.collectorNumberTotal, 193);
  assert.equal(repaired.identityStatus, "confirmed");
  assert.ok(repaired.identitySource.includes("official-detail"));
});

test("known cardId fallback numbers stay visible before official-detail confirmation", () => {
  const card = normalizeOfficialJapaneseCard(
    {
      cardID: "37382",
      name: "アルセウス&ディアルガ&パルキアGX",
      image: "https://www.pokemon-card.com/card.jpg",
      setCode: "SM12",
      collectorNumber: "",
      browseIndex: 12,
      collectorNumberSource: "official-browse",
      printedTotal: 95,
      rarity: "Super Rare",
      hp: "280",
      types: ["Dragon"],
      artist: "Kouki Saitou",
    },
    "Arceus & Dialga & Palkia GX",
  );

  const sanitized = applyCanonicalJapaneseIdentityToCard(card);
  assert.equal(sanitized.collectorNumber, "100");
  assert.equal(sanitized.marketIdentity?.printedCollectorNumber, "100");
  assert.equal(sanitized.marketIdentity?.identityStatus, "confirmed");
  assert.equal(sanitized.setEnglishName, "Alter Genesis");
  assert.equal(sanitized.marketPriceUsd, 0);
});
