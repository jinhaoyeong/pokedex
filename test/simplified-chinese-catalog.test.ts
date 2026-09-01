import assert from "node:assert/strict";
import test from "node:test";

import {
  getSetFromDatabase,
  getSetsFromDatabase,
  searchSetsInDatabase,
} from "../src/lib/pokemon-sets-db.server";
import { searchBundledCards, lookupBundledCardBySlug } from "../src/lib/bundled-cards";
import {
  getSimplifiedChineseSetById,
  lookupSimplifiedChineseCardBySlug,
  searchSimplifiedChineseCatalog,
} from "../src/lib/simplified-chinese-catalog";
import { parseCollectorCodeQuery } from "../src/lib/pokemon-tcg/text-and-collector-utils";

test("Simplified Chinese catalog resolves Mew ex 003/SV-P, not Paldean Fates", () => {
  const byName = searchSimplifiedChineseCatalog({
    query: "Mew ex 003",
    language: "zh-cn",
  });
  const mew = byName.find((card) => card.collectorNumber === "003");

  assert.ok(mew, "expected Mew ex 003 in the Simplified Chinese catalog");
  assert.equal(mew?.language, "zh-cn");
  assert.equal(mew?.setCode, "SV-P");
  assert.equal(mew?.setId, "SV-P-CS");
  assert.equal(mew?.englishName, "Mew ex");
  assert.ok(mew?.localizedName?.includes("梦幻"));
  assert.equal(mew?.slug, "zh-cn--cn-svp-cs-003");
  assert.ok(!byName.some((card) => /paldean fates/i.test(`${card.setName} ${card.setId}`)));
  assert.ok(!byName.some((card) => card.collectorNumber === "232"));
});

test("Simplified Chinese catalog matches 003/SV-P collector codes and 梦幻", () => {
  const collector = parseCollectorCodeQuery("003/SV-P");
  assert.ok(collector);
  const byCode = searchSimplifiedChineseCatalog({
    collectorCode: collector,
    query: "Mew ex",
    language: "zh-cn",
  });
  assert.equal(byCode[0]?.id, "cn-svp-cs-003");

  const byChineseName = searchSimplifiedChineseCatalog({
    query: "梦幻",
    language: "zh-cn",
  });
  assert.ok(byChineseName.some((card) => card.id === "cn-svp-cs-003"));
});

test("Chinese Simplified set filter lists SV-P promos and membership aliases", async () => {
  const sets = await getSetsFromDatabase("zh-cn");
  assert.ok(sets);
  assert.ok(
    sets.some((set) => set.id === "SV-P-CS" && set.language === "zh-cn"),
    "expected SV-P-CS in the Chinese Simplified set list",
  );

  const membership = await searchSetsInDatabase("membership", "zh-cn", 20);
  assert.ok(membership?.some((set) => set.id === "SV-P-CS"));
  assert.ok(
    !membership?.some((set) => set.id === "CBB2C"),
    "Gem Pack should not appear in a membership set search",
  );

  const byCode = await getSetFromDatabase("SV-P", "zh-cn");
  assert.equal(byCode?.id, "SV-P-CS");
  assert.equal(getSimplifiedChineseSetById("SV-P-CS")?.code, "SV-P");
});

test("Chinese Simplified set browse returns the SV-P promo list", () => {
  const cards = searchSimplifiedChineseCatalog({
    setFilter: "SV-P",
    language: "zh-cn",
  });
  assert.ok(cards.length >= 200, `expected a full SV-P CS promo list, got ${cards.length}`);
  assert.ok(cards.every((card) => card.language === "zh-cn"));
  assert.ok(cards.some((card) => card.id === "cn-svp-cs-001"));
  assert.ok(cards.some((card) => card.id === "cn-svp-cs-003"));
});

test("bundled fallback and slug lookup serve Simplified Chinese Mew ex 003", () => {
  const cards = searchBundledCards({
    query: "Mew ex 003",
    language: "zh-cn",
    limit: 12,
  });
  assert.ok(cards.some((card) => card.slug === "zh-cn--cn-svp-cs-003"));

  const bySlug = lookupBundledCardBySlug("zh-cn--cn-svp-cs-003");
  assert.equal(bySlug?.englishName, "Mew ex");
  assert.equal(lookupSimplifiedChineseCardBySlug("zh-cn--cn-svp-cs-003")?.collectorNumber, "003");
});

test("Japanese and English filters do not surface the Simplified Chinese promo catalog", () => {
  assert.equal(searchSimplifiedChineseCatalog({ query: "Mew ex 003", language: "ja" }).length, 0);
  assert.equal(searchSimplifiedChineseCatalog({ query: "Mew ex 003", language: "en" }).length, 0);
  assert.equal(
    searchSimplifiedChineseCatalog({ setFilter: "SV-P", language: "all" }).length,
    0,
  );
  assert.ok(
    searchSimplifiedChineseCatalog({ setFilter: "SV-P-CS", language: "all" }).some(
      (card) => card.id === "cn-svp-cs-003",
    ),
  );
});
