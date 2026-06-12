#!/usr/bin/env node
/**
 * Deep-cleans the learned card cache database.
 *
 * The app uses this SQLite file as a local learning layer for search ranking and
 * price-confidence metadata. This script removes corrupt rows, backfills the
 * query-learning table from historical search rows, refreshes searchable card
 * metadata stored in columns, and compacts the database.
 *
 * Usage: npm run db:clean
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "pokemon-cards-cache.sqlite");

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_search_cache (
      slug TEXT PRIMARY KEY,
      language_code TEXT NOT NULL,
      collector_number TEXT,
      printed_total INTEGER,
      card_json TEXT NOT NULL,
      query_text TEXT,
      hit_count INTEGER NOT NULL DEFAULT 1,
      last_searched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      enriched_at TEXT,
      identity_status TEXT DEFAULT 'estimated',
      price_status TEXT DEFAULT 'estimated',
      trust_score REAL DEFAULT 0.5,
      search_hits INTEGER NOT NULL DEFAULT 0,
      detail_views INTEGER NOT NULL DEFAULT 0,
      wrong_price_flags INTEGER NOT NULL DEFAULT 0,
      wrong_card_flags INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS card_query_learning (
      normalized_query TEXT NOT NULL,
      slug TEXT NOT NULL,
      language_code TEXT NOT NULL,
      query_text TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (normalized_query, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_card_search_collector
      ON card_search_cache(language_code, collector_number, printed_total);
    CREATE INDEX IF NOT EXISTS idx_card_search_hits
      ON card_search_cache(hit_count DESC, trust_score DESC);
    CREATE INDEX IF NOT EXISTS idx_card_query_learning_query
      ON card_query_learning(normalized_query, hit_count DESC, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_card_query_learning_slug
      ON card_query_learning(slug, hit_count DESC);
  `);
}

function clampTrustScore(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0.5;
  }

  return Math.max(0.05, Math.min(0.98, numeric));
}

if (!fs.existsSync(DB_PATH)) {
  console.log(`No learned card cache exists at ${DB_PATH}; nothing to clean.`);
  process.exit(0);
}

const db = new Database(DB_PATH);
ensureSchema(db);

const stats = {
  scanned: 0,
  deletedMalformedCards: 0,
  refreshedMetadataRows: 0,
  backfilledQueryLinks: 0,
  deletedOrphanQueryLinks: 0,
  deletedMalformedQueryLinks: 0,
};

const deleteCard = db.prepare(`DELETE FROM card_search_cache WHERE slug = ?`);
const updateCardMetadata = db.prepare(`
  UPDATE card_search_cache
  SET language_code = @language_code,
      collector_number = @collector_number,
      printed_total = @printed_total,
      card_json = @card_json,
      hit_count = @hit_count,
      search_hits = @search_hits,
      detail_views = @detail_views,
      wrong_price_flags = @wrong_price_flags,
      wrong_card_flags = @wrong_card_flags,
      trust_score = @trust_score,
      identity_status = COALESCE(identity_status, 'estimated'),
      price_status = COALESCE(price_status, 'estimated')
  WHERE slug = @slug
`);
const upsertQueryLearning = db.prepare(`
  INSERT INTO card_query_learning (
    normalized_query, slug, language_code, query_text, hit_count, first_seen_at, last_seen_at
  ) VALUES (
    @normalized_query, @slug, @language_code, @query_text, @hit_count, @first_seen_at, @last_seen_at
  )
  ON CONFLICT(normalized_query, slug) DO UPDATE SET
    language_code = excluded.language_code,
    query_text = excluded.query_text,
    hit_count = MAX(card_query_learning.hit_count, excluded.hit_count),
    last_seen_at = MAX(card_query_learning.last_seen_at, excluded.last_seen_at)
`);

const cleanCards = db.transaction(() => {
  const rows = db
    .prepare(
      `SELECT slug, language_code, collector_number, printed_total, card_json, query_text,
              hit_count, last_searched_at, created_at, enriched_at, identity_status, price_status,
              trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
       FROM card_search_cache`,
    )
    .all();

  for (const row of rows) {
    stats.scanned += 1;

    let card;
    try {
      card = JSON.parse(row.card_json);
    } catch {
      deleteCard.run(row.slug);
      stats.deletedMalformedCards += 1;
      continue;
    }

    if (!card?.slug || !card?.id) {
      deleteCard.run(row.slug);
      stats.deletedMalformedCards += 1;
      continue;
    }

    const languageCode = card.language || row.language_code || "en";
    const collectorNumber = card.collectorNumber || row.collector_number || null;
    const printedTotal = Number.isFinite(card.setPrintedTotal)
      ? card.setPrintedTotal
      : Number.isFinite(card.setTotal)
        ? card.setTotal
        : row.printed_total;
    const hitCount = Math.max(1, Number(row.hit_count) || 1);
    const searchHits = Math.max(Number(row.search_hits) || 0, hitCount);
    const detailViews = Math.max(0, Number(row.detail_views) || 0);
    const wrongPriceFlags = Math.max(0, Number(row.wrong_price_flags) || 0);
    const wrongCardFlags = Math.max(0, Number(row.wrong_card_flags) || 0);
    const trustScore = clampTrustScore(row.trust_score);

    updateCardMetadata.run({
      slug: row.slug,
      language_code: languageCode,
      collector_number: collectorNumber,
      printed_total: Number.isFinite(printedTotal) ? printedTotal : null,
      card_json: JSON.stringify(card),
      hit_count: hitCount,
      search_hits: searchHits,
      detail_views: detailViews,
      wrong_price_flags: wrongPriceFlags,
      wrong_card_flags: wrongCardFlags,
      trust_score: trustScore,
    });
    stats.refreshedMetadataRows += 1;

    const normalizedQuery = normalizeSearchText(row.query_text);
    if (normalizedQuery.length >= 2) {
      upsertQueryLearning.run({
        normalized_query: normalizedQuery,
        slug: row.slug,
        language_code: languageCode,
        query_text: row.query_text.trim(),
        hit_count: searchHits,
        first_seen_at: row.created_at || row.last_searched_at || new Date().toISOString(),
        last_seen_at: row.last_searched_at || new Date().toISOString(),
      });
      stats.backfilledQueryLinks += 1;
    }
  }
});

cleanCards();

stats.deletedOrphanQueryLinks = db
  .prepare(
    `DELETE FROM card_query_learning
     WHERE slug NOT IN (SELECT slug FROM card_search_cache)`,
  )
  .run().changes;
stats.deletedMalformedQueryLinks = db
  .prepare(
    `DELETE FROM card_query_learning
     WHERE length(trim(normalized_query)) < 2 OR length(trim(slug)) = 0`,
  )
  .run().changes;

const integrity = db.prepare(`PRAGMA integrity_check`).get().integrity_check;
db.exec(`PRAGMA optimize; VACUUM;`);
const finalCounts = {
  cards: db.prepare(`SELECT COUNT(*) AS count FROM card_search_cache`).get().count,
  learnedQueries: db.prepare(`SELECT COUNT(*) AS count FROM card_query_learning`).get().count,
};

db.close();

console.log(JSON.stringify({ integrity, ...stats, ...finalCounts }, null, 2));
