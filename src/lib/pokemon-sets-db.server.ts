import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { LANGUAGE_LABELS } from "@/lib/search-constants";
import type { CardLanguageCode, CardLanguageFilter, TcgSet } from "@/types/pokemon";

type SetRow = {
  set_id: string;
  language_code: string;
  name: string;
  english_name: string | null;
  code: string;
  series: string | null;
  release_date: string;
  printed_total: number | null;
  total: number | null;
};

let database: Database.Database | null = null;
let databaseUnavailable = false;

function normalizeForSearch(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-sets.sqlite");
}

function getDatabase() {
  if (databaseUnavailable) {
    return null;
  }

  if (database) {
    return database;
  }

  const dbPath = getDatabasePath();

  if (!fs.existsSync(dbPath)) {
    databaseUnavailable = true;
    return null;
  }

  try {
    database = new Database(dbPath, { readonly: true, fileMustExist: true });
    return database;
  } catch {
    databaseUnavailable = true;
    return null;
  }
}

function rowToTcgSet(row: SetRow): TcgSet {
  const language = row.language_code as CardLanguageCode;

  return {
    id: row.set_id,
    name: row.name,
    localizedName: language === "en" ? undefined : row.name.split(" (")[0],
    englishName: row.english_name ?? undefined,
    code: row.code,
    series: row.series ?? LANGUAGE_LABELS[language] ?? row.language_code,
    releaseDate: row.release_date,
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? row.language_code,
    printedTotal: row.printed_total ?? undefined,
    total: row.total ?? undefined,
  };
}

function uniqueSetsByCatalogId(sets: TcgSet[]) {
  const byId = new Map<string, TcgSet>();

  for (const set of sets) {
    const key = set.id.trim().toLowerCase();

    if (!key) {
      continue;
    }

    const existing = byId.get(key);

    if (
      !existing ||
      set.language === "en" ||
      (!existing.releaseDate && set.releaseDate)
    ) {
      byId.set(key, set);
    }
  }

  return [...byId.values()];
}

export function isPokemonSetsDatabaseAvailable() {
  return fs.existsSync(getDatabasePath());
}

export function getSetsFromDatabase(language: CardLanguageFilter = "all"): TcgSet[] | null {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  const rows = (
    language === "all"
      ? db
          .prepare(
            `SELECT set_id, language_code, name, english_name, code, series, release_date, printed_total, total
             FROM tcg_sets
             ORDER BY release_date DESC, name ASC`,
          )
          .all()
      : db
          .prepare(
            `SELECT set_id, language_code, name, english_name, code, series, release_date, printed_total, total
             FROM tcg_sets
             WHERE language_code = ?
             ORDER BY release_date DESC, name ASC`,
          )
          .all(language)
  ) as SetRow[];

  if (!rows.length) {
    return null;
  }

  const sets = rows.map(rowToTcgSet);

  return language === "all"
    ? uniqueSetsByCatalogId(sets).sort((left, right) => {
        if (left.releaseDate || right.releaseDate) {
          return right.releaseDate.localeCompare(left.releaseDate);
        }

        return left.name.localeCompare(right.name);
      })
    : sets;
}

export function searchSetsInDatabase(
  query: string,
  language: CardLanguageFilter = "all",
  limit = 80,
): TcgSet[] | null {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return getSetsFromDatabase(language);
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return getSetsFromDatabase(language);
  }

  const whereClauses = terms.map(() => "search_text LIKE ?").join(" AND ");
  const params: Array<string | number> = terms.map((term) => `%${term}%`);
  const languageClause = language === "all" ? "" : "AND language_code = ?";

  if (language !== "all") {
    params.push(language);
  }

  params.push(limit);

  const rows = db
    .prepare(
      `SELECT set_id, language_code, name, english_name, code, series, release_date, printed_total, total
       FROM tcg_sets
       WHERE ${whereClauses} ${languageClause}
       ORDER BY release_date DESC, name ASC
       LIMIT ?`,
    )
    .all(...params) as SetRow[];

  if (!rows.length) {
    return [];
  }

  const sets = rows.map(rowToTcgSet);

  return language === "all" ? uniqueSetsByCatalogId(sets) : sets;
}

export function getSetFromDatabase(
  setId: string,
  language: CardLanguageCode = "en",
): TcgSet | null {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  const row = db
    .prepare(
      `SELECT set_id, language_code, name, english_name, code, series, release_date, printed_total, total
       FROM tcg_sets
       WHERE set_id = ? AND language_code = ?
       LIMIT 1`,
    )
    .get(setId, language) as SetRow | undefined;

  return row ? rowToTcgSet(row) : null;
}
