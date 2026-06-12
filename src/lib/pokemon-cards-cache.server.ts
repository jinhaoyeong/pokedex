import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

type CollectorLookup = {
  number: string;
  printedTotal?: number;
};

type CachedCardRow = {
  slug: string;
  language_code: string;
  collector_number: string | null;
  printed_total: number | null;
  card_json: string;
  query_text: string | null;
  hit_count: number;
  last_searched_at: string;
};

let database: Database.Database | null = null;
let writeDatabaseUnavailable = false;

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-cards-cache.sqlite");
}

function ensureSchema(db: Database.Database) {
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
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_card_search_collector
      ON card_search_cache(language_code, collector_number, printed_total);
  `);
}

function getReadDatabase() {
  const dbPath = getDatabasePath();

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  if (database) {
    return database;
  }

  try {
    database = new Database(dbPath, { readonly: true, fileMustExist: true });
    return database;
  } catch {
    return null;
  }
}

function getWriteDatabase() {
  if (writeDatabaseUnavailable) {
    return null;
  }

  const dbPath = getDatabasePath();

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    ensureSchema(db);
    return db;
  } catch {
    writeDatabaseUnavailable = true;
    return null;
  }
}

function normalizeCollectorNumber(value: string) {
  return value.replace(/^0+(?=\d)/, "") || value;
}

function rowToCard(row: CachedCardRow): TcgCard | null {
  try {
    return JSON.parse(row.card_json) as TcgCard;
  } catch {
    return null;
  }
}

function collectorMatchesRow(row: CachedCardRow, collectorCode: CollectorLookup) {
  if (!row.collector_number) {
    return false;
  }

  const rowNumber = normalizeCollectorNumber(row.collector_number);
  const targetNumber = normalizeCollectorNumber(collectorCode.number);

  if (rowNumber !== targetNumber) {
    return false;
  }

  if (collectorCode.printedTotal == null) {
    return true;
  }

  return row.printed_total === collectorCode.printedTotal;
}

export function lookupCachedCardsByCollectorCode(
  language: CardLanguageCode | "all",
  collectorCode: CollectorLookup,
): TcgCard[] {
  const db = getReadDatabase();

  if (!db) {
    return [];
  }

  const normalizedNumber = normalizeCollectorNumber(collectorCode.number);
  const rows = db
    .prepare(
      `SELECT slug, language_code, collector_number, printed_total, card_json, query_text, hit_count, last_searched_at
       FROM card_search_cache
       WHERE collector_number IS NOT NULL
         AND (
           collector_number = @number
           OR collector_number = @padded
           OR collector_number = @raw
         )
       ORDER BY hit_count DESC, last_searched_at DESC
       LIMIT 24`,
    )
    .all({
      number: normalizedNumber,
      padded: normalizedNumber.padStart(3, "0"),
      raw: collectorCode.number,
    }) as CachedCardRow[];

  const seen = new Set<string>();

  return rows
    .filter((row) => {
      if (language !== "all" && row.language_code !== language) {
        return false;
      }

      return collectorMatchesRow(row, collectorCode);
    })
    .map(rowToCard)
    .filter((card): card is TcgCard => {
      if (!card?.slug || seen.has(card.slug)) {
        return false;
      }

      seen.add(card.slug);
      return true;
    });
}

export function persistSearchResultCards(cards: TcgCard[], query = "") {
  const db = getWriteDatabase();

  if (!db || !cards.length) {
    return;
  }

  const now = new Date().toISOString();
  const cleanQuery = query.trim().slice(0, 256) || null;
  const upsert = db.prepare(`
    INSERT INTO card_search_cache (
      slug,
      language_code,
      collector_number,
      printed_total,
      card_json,
      query_text,
      hit_count,
      last_searched_at,
      created_at
    ) VALUES (
      @slug,
      @language_code,
      @collector_number,
      @printed_total,
      @card_json,
      @query_text,
      1,
      @now,
      @now
    )
    ON CONFLICT(slug) DO UPDATE SET
      card_json = excluded.card_json,
      query_text = COALESCE(excluded.query_text, card_search_cache.query_text),
      hit_count = card_search_cache.hit_count + 1,
      last_searched_at = excluded.last_searched_at
  `);

  const writeMany = db.transaction((items: TcgCard[]) => {
    for (const card of items) {
      if (!card.slug?.trim() || !card.id?.trim()) {
        continue;
      }

      upsert.run({
        slug: card.slug,
        language_code: card.language,
        collector_number: card.collectorNumber || null,
        printed_total: card.setPrintedTotal ?? card.setTotal ?? null,
        card_json: JSON.stringify(card),
        query_text: cleanQuery,
        now,
      });
    }
  });

  try {
    writeMany(cards);
  } catch {
    writeDatabaseUnavailable = true;
  } finally {
    db.close();
  }
}
