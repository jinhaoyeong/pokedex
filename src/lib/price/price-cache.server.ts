import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { sanitizeResolvedPrice } from "./sanity";
import type { ProviderPriceResult, ResolvedPrice } from "./types";

/**
 * Local price cache. The request path reads a card's price from HERE first so a
 * page view never triggers an external fetch (let alone a scrape burst). Misses
 * are filled out-of-band by the background warmer / per-view refresh queue.
 *
 * Mirrors the proven psa-population-store pattern: a single committed SQLite
 * artifact under data/, read-only-FS tolerant, best-effort writes that degrade to
 * no-ops so the runtime never breaks because of this store.
 */

type PriceRow = {
  ungraded_usd: number | null;
  confidence_score: number | null;
  primary_provider: string | null;
  results_json: string | null;
  fetched_at: string;
};

const WRITE_RETRY_MS = 60_000;

let readDatabase: Database.Database | null = null;
let writeUnavailable = false;
let writeUnavailableAt = 0;

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-prices-cache.sqlite");
}

function ensureSchema(db: Database.Database) {
  db.pragma("journal_mode = DELETE");
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_cache (
      slug TEXT PRIMARY KEY,
      language TEXT,
      set_code TEXT,
      ungraded_usd REAL,
      confidence_score REAL,
      primary_provider TEXT,
      results_json TEXT,
      fetched_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_price_cache_updated
      ON price_cache(updated_at DESC);
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
    const isTransientLock = /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(`${code} ${message}`);
    if (!isTransientLock) {
      writeUnavailable = true;
      writeUnavailableAt = Date.now();
    }
    return null;
  }
}

export function isPriceFresh(fetchedAt: string | null, ttlMs: number): boolean {
  if (!fetchedAt) {
    return false;
  }
  const ts = Date.parse(fetchedAt);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts < ttlMs;
}

/** Read a cached price for a slug. Pass `ttlMs` to reject stale rows. */
export function readCachedPrice(slug: string, ttlMs?: number): ResolvedPrice | null {
  const db = getReadDatabase();
  if (!db) {
    return null;
  }

  try {
    const row = db
      .prepare(
        `SELECT ungraded_usd, confidence_score, primary_provider, results_json, fetched_at
         FROM price_cache WHERE slug = ?`,
      )
      .get(slug) as PriceRow | undefined;

    if (!row) {
      return null;
    }

    if (typeof ttlMs === "number" && !isPriceFresh(row.fetched_at, ttlMs)) {
      return null;
    }

    let results: ProviderPriceResult[] = [];
    if (row.results_json) {
      try {
        results = JSON.parse(row.results_json) as ProviderPriceResult[];
      } catch {
        results = [];
      }
    }

    return sanitizeResolvedPrice({
      slug,
      ungradedUsd: row.ungraded_usd ?? 0,
      confidenceScore: row.confidence_score ?? 0,
      primaryProvider: row.primary_provider ?? "",
      results,
      fetchedAt: row.fetched_at,
    });
  } catch {
    return null;
  }
}

export function readCachedPriceBySlugs(slugs: string[], ttlMs?: number): ResolvedPrice | null {
  const seen = new Set<string>();

  for (const slug of slugs) {
    const clean = slug.trim();

    if (!clean || seen.has(clean.toLowerCase())) {
      continue;
    }

    seen.add(clean.toLowerCase());
    const cached = readCachedPrice(clean, ttlMs);

    if (cached && cached.ungradedUsd > 0) {
      return cached;
    }
  }

  return null;
}

/** Upsert a resolved price. Best-effort: returns false when the FS is read-only. */
export function writeCachedPrice(
  resolved: ResolvedPrice,
  identity: { language?: string; setCode?: string } = {},
): boolean {
  const now = new Date().toISOString();

  const result = withWriteDatabase((db) => {
    db.prepare(
      `INSERT INTO price_cache (
         slug, language, set_code, ungraded_usd, confidence_score,
         primary_provider, results_json, fetched_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         language = excluded.language,
         set_code = excluded.set_code,
         ungraded_usd = excluded.ungraded_usd,
         confidence_score = excluded.confidence_score,
         primary_provider = excluded.primary_provider,
         results_json = excluded.results_json,
         fetched_at = excluded.fetched_at,
         updated_at = excluded.updated_at`,
    ).run(
      resolved.slug,
      identity.language ?? null,
      identity.setCode ?? null,
      resolved.ungradedUsd,
      resolved.confidenceScore,
      resolved.primaryProvider,
      JSON.stringify(resolved.results),
      resolved.fetchedAt || now,
      now,
    );
    return true;
  });

  return result === true;
}
