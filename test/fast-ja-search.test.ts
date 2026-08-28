import assert from "node:assert/strict";
import test from "node:test";

import { findLocalizedPokemonNameAliases } from "../src/lib/pokemon-name-db.server";
import { getBundledSetsCatalog } from "../src/lib/pokemon-sets-db.server";
import {
  getOfficialJapaneseBrowseSeedAllItems,
  hasOfficialJapaneseBrowseSeedSet,
  searchOfficialJapaneseBrowseSeed,
} from "../src/lib/official-japanese-browse.server";
import {
  buildOfficialJapaneseDetailFromBrowseItem,
  normalizeOfficialJapaneseCard,
} from "../src/lib/pokemon-tcg/official-japanese-catalog";
import {
  lookupOfficialJpCollectorFallback,
  lookupOfficialJpCollectorFallbackByPartial,
  parseCollectorCodeQuery,
  parsePartialCollectorToken,
} from "../src/lib/pokemon-tcg/text-and-collector-utils";
import {
  decodeSetFilterValue,
  encodeSetFilterOptionValue,
  isLikelyOfficialJapaneseSetCode,
} from "../src/lib/japanese-set-filter";
import { hasUsableJapaneseOfficialFirstPaintIdentity } from "../src/lib/card-catalog";

test("071/067 and 100/095 resolve to official Japanese identity fallbacks", () => {
  const palkia = parseCollectorCodeQuery("071/067");
  const trio = parseCollectorCodeQuery("100/095");

  assert.ok(palkia);
  assert.ok(trio);
  assert.equal(lookupOfficialJpCollectorFallback(palkia)?.englishName, "Origin Forme Palkia V");
  assert.equal(lookupOfficialJpCollectorFallback(trio)?.englishName, "Arceus & Dialga & Palkia GX");
});

test("english Dialga maps to the Japanese species alias", async () => {
  const aliases = await findLocalizedPokemonNameAliases("dialga", "ja");
  assert.ok(aliases.includes("ディアルガ"), aliases.join(", "));
});

test("official Japanese browse seed matches Dialga by localized alias", () => {
  const seed = searchOfficialJapaneseBrowseSeed({
    aliases: ["ディアルガ"],
    page: 1,
    pageSize: 8,
  });

  assert.ok(seed.totalCount > 0);
  assert.ok(seed.matches.length > 0);
  assert.match(seed.matches[0]?.item.cardNameAltText ?? "", /ディアルガ/);
});

test("bundled set catalogs keep Japanese sets visible", () => {
  const japanese = getBundledSetsCatalog("ja");
  const all = getBundledSetsCatalog("all");

  assert.ok(japanese.length > 50, `expected Japanese sets, got ${japanese.length}`);
  assert.ok(japanese.every((set) => set.language === "ja"));
  assert.ok(all.some((set) => set.language === "ja"), "all-language list must keep Japanese sets");
  assert.ok(all.some((set) => set.language === "en"));
  assert.ok(all.length > japanese.length);
});

test("Alter Genesis / SM12 is in the official Japanese browse seed", () => {
  assert.equal(isLikelyOfficialJapaneseSetCode("SM12"), true);
  assert.equal(hasOfficialJapaneseBrowseSeedSet("SM12"), true);
  const seeded = getOfficialJapaneseBrowseSeedAllItems("SM12");
  assert.ok(seeded && seeded.items.length > 90, `expected SM12 cards, got ${seeded?.items.length}`);
  assert.ok(seeded.items.some((item) => item.cardID === "37382"));
});

test("seed card 37382 gets the known 100/095 collector identity", () => {
  const seeded = getOfficialJapaneseBrowseSeedAllItems("SM12");
  const item = seeded?.items.find((entry) => entry.cardID === "37382");
  assert.ok(item);
  const card = normalizeOfficialJapaneseCard(
    buildOfficialJapaneseDetailFromBrowseItem(item, 100, "SM12", 95),
  );
  assert.equal(card.collectorNumber, "100");
  assert.equal(card.setCode, "SM12");
  assert.equal(card.englishName, "Arceus & Dialga & Palkia GX");
  assert.equal(hasUsableJapaneseOfficialFirstPaintIdentity(card, "37382"), true);
});

test("Dialga 071 maps to Intense Fight Dialga without a live catalog", () => {
  const partial = parsePartialCollectorToken("071");
  assert.ok(partial);
  const match = lookupOfficialJpCollectorFallbackByPartial(partial, "dialga");
  assert.ok(match);
  assert.equal(match.fallback.englishName, "Dialga");
  assert.equal(match.fallback.setCode, "DPs-B");
  assert.equal(match.fallback.cardId, "19223");
});

test("all-language set option values are language-qualified", () => {
  assert.equal(
    encodeSetFilterOptionValue({ id: "sv10", code: "SV10", language: "en" }),
    "en:sv10",
  );
  assert.equal(
    encodeSetFilterOptionValue({ id: "SM12", code: "SM12", language: "ja" }),
    "ja:SM12",
  );
  assert.deepEqual(decodeSetFilterValue("ja:SM12"), {
    languageHint: "ja",
    setFilter: "SM12",
  });
  assert.deepEqual(decodeSetFilterValue("SM12"), { setFilter: "SM12" });
});
