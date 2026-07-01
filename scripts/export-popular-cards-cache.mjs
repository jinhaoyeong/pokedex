#!/usr/bin/env node
/**
 * Export the most searched cached cards into data/pokemon-cards-seed.json
 * Run weekly (or in CI) so new deploys boot with community-learned coverage.
 *
 * Usage: npm run db:export:cards-cache
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "pokemon-cards-cache.sqlite");
const OUT_PATH = path.join(ROOT, "data", "pokemon-cards-seed.json");
const LIMIT = Number.parseInt(process.env.CARD_SEED_EXPORT_LIMIT ?? "100", 10);

if (!fs.existsSync(DB_PATH)) {
  console.error("No cache database found at", DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const columns = new Set(
  db.prepare(`PRAGMA table_info(card_search_cache)`).all().map((row) => row.name),
);
const hasTrustScore = columns.has("trust_score");
const rows = db
  .prepare(
    hasTrustScore
      ? `SELECT card_json, hit_count, trust_score, last_searched_at
         FROM card_search_cache
         WHERE COALESCE(trust_score, 0.5) >= 0.35
         ORDER BY hit_count DESC, trust_score DESC
         LIMIT ?`
      : `SELECT card_json, hit_count, last_searched_at
         FROM card_search_cache
         ORDER BY hit_count DESC
         LIMIT ?`,
  )
  .all(LIMIT);

const cards = rows
  .map((row) => {
    try {
      return JSON.parse(row.card_json);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const payload = {
  exportedAt: new Date().toISOString(),
  cardCount: cards.length,
  cards,
};

fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Exported ${cards.length} cards to ${OUT_PATH}`);
