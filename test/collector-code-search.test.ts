import assert from "node:assert/strict";
import test from "node:test";

import { buildOfficialJapaneseFallbackSearchCard } from "../src/lib/pokemon-tcg/official-japanese-catalog";
import {
  lookupOfficialJpCollectorFallback,
  parseCollectorCodeQuery,
} from "../src/lib/pokemon-tcg/text-and-collector-utils";

test("017/027 is the Legendary Shine Dialga collector code", () => {
  const code = parseCollectorCodeQuery("017/027");

  assert.ok(code);
  assert.equal(code.rawNumber, "017");
  assert.equal(code.number, "17");
  assert.equal(code.printedTotal, 27);

  const fallback = lookupOfficialJpCollectorFallback(code);
  assert.equal(fallback?.cardId, "31109");
  assert.equal(fallback?.setCode, "CP2");
  assert.equal(fallback?.englishName, "Dialga");
});

test("017/027 paints a Japanese Dialga identity without live catalogs", () => {
  const code = parseCollectorCodeQuery("017/027");
  assert.ok(code);

  const card = buildOfficialJapaneseFallbackSearchCard(code);
  assert.ok(card);
  assert.equal(card.language, "ja");
  assert.equal(card.setCode, "CP2");
  assert.equal(card.englishName, "Dialga");
  assert.equal(card.officialCardId, "31109");
  assert.match(card.image, /031109|DEIARUGA/i);
});

test("100/095 still resolves to the TAG TEAM trio fallback", () => {
  const code = parseCollectorCodeQuery("100/095");
  assert.ok(code);

  const card = buildOfficialJapaneseFallbackSearchCard(code);
  assert.ok(card);
  assert.equal(card.setCode, "SM12");
  assert.match(card.englishName ?? "", /Arceus & Dialga & Palkia/i);
});
