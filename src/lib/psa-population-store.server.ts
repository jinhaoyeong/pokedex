import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { GradedPrice, PsaPopulationSnapshot } from "@/types/pokemon";

/**
 * Self-hosted graded-population store.
 *
 * Population data changes slowly, but scraping it live (PriceCharting pop pages)
 * is slow and rate-limit-prone. This module persists parsed population snapshots
 * to a local SQLite file so the runtime can serve them with zero network on the
 * hot path, and only falls back to a live fetch on a cold miss / stale row.
 *
 * Robustness: a seeded DB committed under `data/` is readable in serverless
 * (read-only FS); writes are best-effort and degrade to no-ops when the FS is
 * read-only, so the runtime never breaks because of this store.
 */

export type StoredPopulationPayload = {
  snapshot: PsaPopulationSnapshot;
  gradedPrices: Array<[string, GradedPrice]>;
  sourceKind: "item" | "set_index";
  matchScore?: number;
};

export type StoredPopulation = StoredPopulationPayload & {
  fetchedAt: string;
  ageMs: number;
};

export type PopulationIdentity = {
  setName: string;
  cardName: string;
  cardNumber: string;
  setCode?: string;
  language?: string;
};

type PopulationRow = {
  snapshot_json: string;
  graded_prices_json: string | null;
  source_kind: string | null;
  match_score: number | null;
  fetched_at: string;
};

const WRITE_RETRY_MS = 60_000;

let readDatabase: Database.Database | null = null;
let writeUnavailable = false;
let writeUnavailableAt = 0;

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-psa-population.sqlite");
}

function ensureSchema(db: Database.Database) {
  // DELETE journal keeps the committed artifact a single clean file (no -wal/-shm
  // sidecars), which is also what serverless read-only readers need.
  db.pragma("journal_mode = DELETE");
  db.exec(`
    CREATE TABLE IF NOT EXISTS psa_population (
      key TEXT PRIMARY KEY,
      set_name TEXT,
      card_name TEXT,
      card_number TEXT,
      set_code TEXT,
      language TEXT,
      snapshot_json TEXT NOT NULL,
      graded_prices_json TEXT,
      source TEXT,
      source_kind TEXT,
      total_certified INTEGER,
      grade_count INTEGER,
      confidence_score REAL,
      match_score REAL,
      fetched_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_psa_population_updated
      ON psa_population(updated_at DESC);
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
    // Wait for the lock instead of dropping the write when seeding concurrently.
    db.pragma("busy_timeout = 8000");
    ensureSchema(db);

    try {
      return runner(db);
    } finally {
      db.close();
      // Invalidate the cached read handle so subsequent reads see new writes.
      readDatabase = null;
    }
  } catch (error) {
    // Only back off for genuinely unavailable filesystems (read-only serverless,
    // permission errors). Transient lock contention must NOT disable writes for
    // the whole batch — just skip this one write and let the next retry.
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

/** Stable identity key — independent of price context so it's reused widely. */
export function buildPopulationKey(identity: PopulationIdentity): string {
  const norm = (value: string | undefined) =>
    (value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  return [
    "v1",
    norm(identity.language || "en"),
    norm(identity.setCode),
    norm(identity.setName),
    norm(identity.cardName),
    norm(identity.cardNumber),
  ].join("|");
}

export function isPopulationFresh(fetchedAt: string | null, ttlMs: number): boolean {
  if (!fetchedAt) {
    return false;
  }
  const ts = Date.parse(fetchedAt);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts < ttlMs;
}

export function readStoredPopulation(key: string): StoredPopulation | null {
  let db: Database.Database | null;
  try {
    db = getReadDatabase();
  } catch {
    db = null;
  }
  if (!db) {
    return null;
  }

  let row: PopulationRow | undefined;
  try {
    row = db
      .prepare(
        `SELECT snapshot_json, graded_prices_json, source_kind, match_score, fetched_at
         FROM psa_population WHERE key = ?`,
      )
      .get(key) as PopulationRow | undefined;
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  try {
    const snapshot = JSON.parse(row.snapshot_json) as PsaPopulationSnapshot;
    const gradedPrices = row.graded_prices_json
      ? (JSON.parse(row.graded_prices_json) as Array<[string, GradedPrice]>)
      : [];
    const fetchedAt = row.fetched_at;
    return {
      snapshot,
      gradedPrices,
      sourceKind: (row.source_kind as "item" | "set_index") ?? "item",
      matchScore: row.match_score ?? undefined,
      fetchedAt,
      ageMs: Math.max(0, Date.now() - Date.parse(fetchedAt)),
    };
  } catch {
    return null;
  }
}

export function writeStoredPopulation(
  key: string,
  identity: PopulationIdentity,
  payload: StoredPopulationPayload,
): void {
  const snapshot = payload.snapshot;
  const fetchedAt = snapshot.fetchedAt ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();

  withWriteDatabase((db) => {
    db.prepare(
      `INSERT INTO psa_population (
        key, set_name, card_name, card_number, set_code, language,
        snapshot_json, graded_prices_json, source, source_kind,
        total_certified, grade_count, confidence_score, match_score,
        fetched_at, updated_at
      ) VALUES (
        @key, @set_name, @card_name, @card_number, @set_code, @language,
        @snapshot_json, @graded_prices_json, @source, @source_kind,
        @total_certified, @grade_count, @confidence_score, @match_score,
        @fetched_at, @updated_at
      )
      ON CONFLICT(key) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        graded_prices_json = excluded.graded_prices_json,
        source = excluded.source,
        source_kind = excluded.source_kind,
        total_certified = excluded.total_certified,
        grade_count = excluded.grade_count,
        confidence_score = excluded.confidence_score,
        match_score = excluded.match_score,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at`,
    ).run({
      key,
      set_name: identity.setName,
      card_name: identity.cardName,
      card_number: identity.cardNumber,
      set_code: identity.setCode ?? null,
      language: identity.language ?? "en",
      snapshot_json: JSON.stringify(snapshot),
      graded_prices_json: JSON.stringify(payload.gradedPrices ?? []),
      source: snapshot.source ?? null,
      source_kind: payload.sourceKind ?? "item",
      total_certified: typeof snapshot.totalCertified === "number" ? snapshot.totalCertified : null,
      grade_count: snapshot.grades?.length ?? 0,
      confidence_score: typeof snapshot.confidenceScore === "number" ? snapshot.confidenceScore : null,
      match_score: typeof payload.matchScore === "number" ? payload.matchScore : null,
      fetched_at: fetchedAt,
      updated_at: updatedAt,
    });
    return true;
  });
}

export function populationStoreStats(): {
  rows: number;
  withGrades: number;
  freshRows: number;
} | null {
  const db = getReadDatabase();
  if (!db) {
    return null;
  }
  try {
    const rows = (db.prepare(`SELECT COUNT(*) AS n FROM psa_population`).get() as { n: number }).n;
    const withGrades = (
      db.prepare(`SELECT COUNT(*) AS n FROM psa_population WHERE grade_count > 0`).get() as {
        n: number;
      }
    ).n;
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const freshRows = (
      db.prepare(`SELECT COUNT(*) AS n FROM psa_population WHERE fetched_at >= ?`).get(cutoff) as {
        n: number;
      }
    ).n;
    return { rows, withGrades, freshRows };
  } catch {
    return null;
  }
}
