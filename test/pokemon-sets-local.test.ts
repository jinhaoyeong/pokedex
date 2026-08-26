import assert from "node:assert/strict";
import test from "node:test";

import {
  getSetFromDatabase,
  getSetsFromDatabase,
  mergeSetCatalogs,
  searchSetsInDatabase,
} from "../src/lib/pokemon-sets-db.server";
import type { TcgSet } from "../src/types/pokemon";

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

test("Japanese sqlite set lists drop case-variant duplicate catalog ids", async () => {
  const sets = await getSetsFromDatabase("ja");
  assert.ok(sets);
  const ids = sets.map((set) => set.id.trim().toLowerCase());
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.filter((id) => id === "sv1a").length, 1);
});

test("sqlite set catalog merges newly discovered live sets instead of replacing them", () => {
  const local: TcgSet[] = [
    {
      id: "base1",
      name: "Base",
      code: "BASE",
      series: "Base",
      releaseDate: "1999-01-09",
      language: "en",
      languageLabel: "English",
    },
  ];
  const live: TcgSet[] = [
    {
      id: "me1",
      name: "Mega Evolution",
      code: "ME1",
      series: "Mega Evolution",
      releaseDate: "2026-09-26",
      language: "en",
      languageLabel: "English",
    },
  ];

  const merged = mergeSetCatalogs(local, live);
  assert.ok(merged.some((set) => set.id === "base1"));
  assert.ok(merged.some((set) => set.id === "me1"));
});
