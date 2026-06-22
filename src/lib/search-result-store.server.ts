import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

/**
 * Persistent search-result store.
 *
 * Set browses (especially the default / number-sorted view) can take tens of
 * seconds cold because the result is gathered and enriched live. The in-memory
 * cache fixes repeat loads within a single instance, but every cold serverless
 * instance pays the full cost again. This store persists completed responses to
 * SQLite so any browse done once — or pre-seeded — is served locally in ~ms.
 *
 * Robustness mirrors the population store: graceful no-op writes on read-only
 * filesystems, busy_timeout for concurrent seeding, DELETE journal so the
 * committed/seeded DB stays a clean single file.
 */

type SearchRow = {
  response_json: string;
  fetched_at: string;
};

export type SearchResultParts = {
  query: string;
  setFilter?: string;
  page: number;
  language: string;
  sort: string;
  resultCount: number;
};

const WRITE_RETRY_MS = 60_000;

let readDatabase: Database.Database | null = null;
let writeUnavailable = false;
let writeUnavailableAt = 0;

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-search-cache.sqlite");
}

function ensureSchema(db: Database.Database) {
  db.pragma("journal_mode = DELETE");
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_cache (
      key TEXT PRIMARY KEY,
      query TEXT,
      set_filter TEXT,
      page INTEGER,
      language TEXT,
      sort TEXT,
      response_json TEXT NOT NULL,
      result_count INTEGER,
      fetched_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_cache_updated ON search_cache(updated_at DESC);
  `);
}

function getReadDatabase() {
  const dbPath = getDatabasePath();
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  if (readDatabase) {
    return readDatabase;
  }
  try {
    readDatabase = new Database(dbPath, { readonly: true, fileMustExist: true });
    return readDatabase;
  } catch {
    return null;
  }
}

function withWriteDatabase<T>(runner: (db: Database.Database) => T): T | null {
  if (writeUnavailable && Date.now() - writeUnavailableAt < WRITE_RETRY_MS) {
    return null;
  }
  writeUnavailable = false;

  const dbPath = getDatabasePath();
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma("busy_timeout = 8000");
    ensureSchema(db);
    try {
      return runner(db);
    } finally {
      db.close();
      readDatabase = null;
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? "";
    const message = error instanceof Error ? error.message : String(error);
    if (!/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(`${code} ${message}`)) {
      writeUnavailable = true;
      writeUnavailableAt = Date.now();
    }
    return null;
  }
}

export function readSearchResult<T>(key: string, ttlMs: number): T | null {
  let db: Database.Database | null;
  try {
    db = getReadDatabase();
  } catch {
    db = null;
  }
  if (!db) {
    return null;
  }
  let row: SearchRow | undefined;
  try {
    row = db
      .prepare(`SELECT response_json, fetched_at FROM search_cache WHERE key = ?`)
      .get(key) as SearchRow | undefined;
  } catch {
    return null;
  }
  if (!row) {
    return null;
  }
  const ts = Date.parse(row.fetched_at);
  if (!Number.isFinite(ts) || Date.now() - ts >= ttlMs) {
    return null;
  }
  try {
    return JSON.parse(row.response_json) as T;
  } catch {
    return null;
  }
}

export function writeSearchResult(key: string, value: unknown, parts: SearchResultParts): void {
  const now = new Date().toISOString();
  withWriteDatabase((db) => {
    db.prepare(
      `INSERT INTO search_cache (
         key, query, set_filter, page, language, sort, response_json, result_count, fetched_at, updated_at
       ) VALUES (@key, @query, @set_filter, @page, @language, @sort, @response_json, @result_count, @fetched_at, @updated_at)
       ON CONFLICT(key) DO UPDATE SET
         response_json = excluded.response_json,
         result_count = excluded.result_count,
         fetched_at = excluded.fetched_at,
         updated_at = excluded.updated_at`,
    ).run({
      key,
      query: parts.query ?? "",
      set_filter: parts.setFilter ?? "",
      page: parts.page ?? 1,
      language: parts.language ?? "all",
      sort: parts.sort ?? "relevance",
      response_json: JSON.stringify(value),
      result_count: parts.resultCount ?? 0,
      fetched_at: now,
      updated_at: now,
    });
    return true;
  });
}

export function searchCacheStats(): { rows: number; freshRows: number } | null {
  const db = getReadDatabase();
  if (!db) {
    return null;
  }
  try {
    const rows = (db.prepare(`SELECT COUNT(*) n FROM search_cache`).get() as { n: number }).n;
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const freshRows = (
      db.prepare(`SELECT COUNT(*) n FROM search_cache WHERE fetched_at >= ?`).get(cutoff) as {
        n: number;
      }
    ).n;
    return { rows, freshRows };
  } catch {
    return null;
  }
}
