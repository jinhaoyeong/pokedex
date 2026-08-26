import assert from "node:assert/strict";
import test from "node:test";

import { findLocalizedPokemonNameAliases } from "../src/lib/pokemon-name-db.server";

test("local name DB expands Charizard into Simplified and Traditional aliases", async () => {
  const simplified = await findLocalizedPokemonNameAliases("Charizard", "zh-cn");
  const traditional = await findLocalizedPokemonNameAliases("Charizard", "zh-tw");
  const japanese = await findLocalizedPokemonNameAliases("Charizard", "ja");

  assert.ok(
    simplified.some((name) => name.includes("喷火龙")),
    `zh-cn aliases: ${simplified.join(", ")}`,
  );
  assert.ok(
    traditional.some((name) => name.includes("噴火龍")),
    `zh-tw aliases: ${traditional.join(", ")}`,
  );
  assert.ok(japanese.includes("リザードン"), `ja aliases: ${japanese.join(", ")}`);
});
