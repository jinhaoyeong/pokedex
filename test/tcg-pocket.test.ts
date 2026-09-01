import assert from "node:assert/strict";
import test from "node:test";

import {
  isPokemonTcgPocketPrint,
  isPokemonTcgPocketSet,
  isPokemonTcgPocketSetId,
  isPokemonTcgPocketTcgdexItem,
  isPokemonTcgPocketTcgdexUrl,
  stripPokemonTcgPocketFromTcgdexPayload,
} from "../src/lib/pokemon-tcg/tcg-pocket";

test("Pokémon TCG Pocket set ids cover the whole digital catalog, not one Dialga hit", () => {
  for (const id of ["A1", "A2", "A2a", "A2b", "A4a", "B1", "B1a", "B2", "B2a", "C1", "D2a", "P-A", "P-B"]) {
    assert.equal(isPokemonTcgPocketSetId(id), true, id);
  }

  for (const id of ["swsh10", "sm12", "me01", "dp1", "S2", "S8a", "M1", "M5", "CP4", "XY7", "base1", "sv8"]) {
    assert.equal(isPokemonTcgPocketSetId(id), false, id);
  }
});

test("Pokémon TCG Pocket prints are excluded by series, art path, rarity, and future set ids", () => {
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "A1-001",
      setId: "A1",
      setName: "Genetic Apex",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "B2a-010",
      setId: "B2a",
      setName: "Paldean Wonders",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "A2-119",
      slug: "ja--A2-119",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "C1-001",
      image: "https://assets.tcgdex.net/en/tcgp/C1/001",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "unknown-1",
      series: "tcgp",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "unknown-2",
      rarity: "Four Diamond",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "unknown-3",
      text: "Put this Pokémon into your Energy Zone.",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "swsh10-113",
      setId: "swsh10",
      setName: "Astral Radiance",
      rarity: "Holo Rare VSTAR",
    }),
    false,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "S2-001",
      setId: "S2",
      setName: "Rebellion Crash",
      rarity: "Rare",
    }),
    false,
  );
  assert.equal(
    isPokemonTcgPocketPrint({
      id: "me01-001",
      setId: "me01",
      setName: "Mega Evolution",
    }),
    false,
  );
});

test("Pokémon TCG Pocket expansions are excluded from Dex set browse", () => {
  assert.equal(
    isPokemonTcgPocketSet({
      id: "A2",
      name: "Space-Time Smackdown",
      series: "Pokémon TCG Pocket",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketSet({
      id: "B2",
      logo: "https://assets.tcgdex.net/en/tcgp/B2/logo",
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketSet({
      id: "swsh10",
      name: "Astral Radiance",
      series: "Sword & Shield",
    }),
    false,
  );
});

test("TCGdex Pocket URLs and payloads are rejected before they enter the catalog", () => {
  assert.equal(isPokemonTcgPocketTcgdexUrl("https://api.tcgdex.net/v2/en/sets/A2"), true);
  assert.equal(isPokemonTcgPocketTcgdexUrl("https://api.tcgdex.net/v2/en/cards/A2-119"), true);
  assert.equal(isPokemonTcgPocketTcgdexUrl("https://api.tcgdex.net/v2/en/series/tcgp"), true);
  assert.equal(isPokemonTcgPocketTcgdexUrl("https://api.tcgdex.net/v2/en/cards?name=dialga"), false);
  assert.equal(isPokemonTcgPocketTcgdexUrl("https://api.tcgdex.net/v2/en/sets/swsh10"), false);

  assert.equal(
    isPokemonTcgPocketTcgdexItem({
      id: "A2-119",
      set: { id: "A2", name: "Space-Time Smackdown", serie: { id: "tcgp" } },
    }),
    true,
  );
  assert.equal(
    isPokemonTcgPocketTcgdexItem({
      id: "swsh10-113",
      set: { id: "swsh10", name: "Astral Radiance" },
    }),
    false,
  );

  const stripped = stripPokemonTcgPocketFromTcgdexPayload([
    { id: "A2-119", set: { id: "A2" } },
    { id: "B1-326", set: { id: "B1" } },
    { id: "swsh10-113", set: { id: "swsh10" } },
  ]);
  assert.deepEqual(
    stripped.map((item) => item.id),
    ["swsh10-113"],
  );

  assert.throws(() =>
    stripPokemonTcgPocketFromTcgdexPayload({
      id: "A2",
      name: "Space-Time Smackdown",
      serie: { id: "tcgp" },
    }),
  );
});
