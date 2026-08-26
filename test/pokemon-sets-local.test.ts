import assert from "node:assert/strict";
import test from "node:test";

import { getSetFromDatabase, getSetsFromDatabase, searchSetsInDatabase } from "../src/lib/pokemon-sets-db.server";

test("local sqlite set catalog returns a full English list without Postgres", async () => {
  const sets = await getSetsFromDatabase("en");

  assert.ok(sets);
  assert.ok(sets.length >= 150, `expected a full English set list, got ${sets.length}`);
  assert.ok(sets.some((set) => set.id === "base1" || set.code === "BASE"));
});

test("local sqlite set search finds Base Set and Japanese 151", async () => {
  const english = await searchSetsInDatabase("base", "en", 20);
  const japanese = await searchSetsInDatabase("151", "ja", 20);

  assert.ok(english?.some((set) => /base/i.test(set.name) || set.id === "base1"));
  assert.ok(
    japanese?.some((set) => /151|sv2a/i.test(`${set.id} ${set.code} ${set.name} ${set.englishName ?? ""}`)),
  );
});

test("local sqlite resolves Base Set and Japanese 151 by id", async () => {
  const base = await getSetFromDatabase("base1", "en");
  const japanese151 = await getSetFromDatabase("SV2a", "ja");

  assert.ok(base);
  assert.equal(base?.id.toLowerCase(), "base1");
  assert.ok(japanese151);
});
