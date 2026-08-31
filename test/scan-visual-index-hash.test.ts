import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { DHASH_MATCH_MAX_DISTANCE } from "../src/lib/scan/dhash-core";

const INDEX_PATH = path.join(process.cwd(), "data", "scan-visual-index.sqlite");

function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

test("Umbreon VMAX is the unique exact hash in the shipped catalog", () => {
  assert.equal(fs.existsSync(INDEX_PATH), true);
  const db = new Database(INDEX_PATH, { readonly: true, fileMustExist: true });
  const rows = db
    .prepare("SELECT id, name, hash FROM card_hashes")
    .all() as Array<{ id: string; name: string; hash: string }>;
  db.close();

  const umbreon = rows.find((row) => row.id === "swsh7-215");
  assert.ok(umbreon, "swsh7-215 must be in the visual index");
  const query = BigInt(umbreon.hash);

  const neighbors = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      distance: hamming(query, BigInt(row.hash)),
    }))
    .filter((row) => row.distance <= DHASH_MATCH_MAX_DISTANCE)
    .sort((left, right) => left.distance - right.distance);

  assert.equal(neighbors[0]?.id, "swsh7-215");
  assert.equal(neighbors[0]?.distance, 0);
  const rival = neighbors.find((row) => row.id !== "swsh7-215");
  assert.ok(
    rival == null || rival.distance >= 6,
    `unexpected near-duplicate ${rival?.id} at distance ${rival?.distance}`,
  );
});
