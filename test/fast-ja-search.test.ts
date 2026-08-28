import assert from "node:assert/strict";
import test from "node:test";

import { findLocalizedPokemonNameAliases } from "../src/lib/pokemon-name-db.server";
import { getBundledSetsCatalog } from "../src/lib/pokemon-sets-db.server";
import { searchOfficialJapaneseBrowseSeed } from "../src/lib/official-japanese-browse.server";
import {
  lookupOfficialJpCollectorFallback,
  parseCollectorCodeQuery,
} from "../src/lib/pokemon-tcg/text-and-collector-utils";

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
