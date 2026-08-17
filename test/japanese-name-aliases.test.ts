import assert from "node:assert/strict";
import test from "node:test";

import { findJapaneseCardNameSearchAliases } from "../src/lib/pokemon-name-db.server";

test("English Mew ex expands to the Japanese browse name ミュウex", async () => {
  const aliases = await findJapaneseCardNameSearchAliases("Mew ex");
  assert.ok(aliases.includes("ミュウex"), aliases.join(", "));
});
