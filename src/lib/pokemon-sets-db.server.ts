import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { compareTcgSetsForDisplay } from "@/lib/set-display-sort";
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

type SeedSet = TcgSet & {
  searchText?: string;
};

type SeedPayload = {
  version?: number;
  exportedAt?: string;
  sets?: SeedSet[];
};

let database: Database.Database | null = null;
let databaseUnavailable = false;
let databaseMtimeMs = 0;
let seedSets: SeedSet[] | null | undefined;
let seedMtimeMs = 0;

function normalizeForSearch(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getDataFileCandidates(fileName: string) {
  const roots = new Set<string>([process.cwd(), path.join(process.cwd(), "..")]);

  if (process.env.VERCEL) {
    roots.add(path.join(process.cwd(), ".next", "standalone"));
  }

  return [...roots].map((root) => path.join(root, "data", fileName));
}

function resolveExistingDataFile(fileName: string) {
  for (const candidate of getDataFileCandidates(fileName)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(process.cwd(), "data", fileName);
}

function getDatabasePath() {
  return resolveExistingDataFile("pokemon-sets.sqlite");
}

function getSeedPath() {
  return resolveExistingDataFile("pokemon-sets-seed.json");
}

function getDatabase() {
  const dbPath = getDatabasePath();

  if (databaseUnavailable) {
    if (!fs.existsSync(dbPath)) {
      return null;
    }

    databaseUnavailable = false;
    database = null;
  }

  if (!fs.existsSync(dbPath)) {
    databaseUnavailable = true;
    return null;
  }

  try {
    const nextMtimeMs = fs.statSync(dbPath).mtimeMs;

    if (database && databaseMtimeMs !== nextMtimeMs) {
      database.close();
      database = null;
    }

    if (!database) {
      database = new Database(dbPath, { readonly: true, fileMustExist: true });
      databaseMtimeMs = nextMtimeMs;
    }

    databaseUnavailable = false;
    return database;
  } catch {
    database = null;
    databaseUnavailable = true;
    return null;
  }
}

function loadSeedSets(): SeedSet[] | null {
  const seedPath = getSeedPath();

  if (!fs.existsSync(seedPath)) {
    seedSets = null;
    return null;
  }

  try {
    const nextMtimeMs = fs.statSync(seedPath).mtimeMs;

    if (seedSets !== undefined && seedMtimeMs === nextMtimeMs) {
      return seedSets;
    }

    const payload = JSON.parse(fs.readFileSync(seedPath, "utf8")) as SeedPayload;
    const sets = Array.isArray(payload.sets)
      ? payload.sets.filter((set) => Boolean(set?.id?.trim()))
      : [];

    seedSets = sets.length ? sets : null;
    seedMtimeMs = nextMtimeMs;
    return seedSets;
  } catch {
    seedSets = null;
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

function seedSetToTcgSet(set: SeedSet): TcgSet {
  const language = set.language as CardLanguageCode;

  return {
    id: set.id,
    name: set.name,
    localizedName: set.localizedName,
    englishName: set.englishName,
    code: set.code,
    series: set.series ?? LANGUAGE_LABELS[language] ?? language,
    releaseDate: set.releaseDate ?? "",
    language,
    languageLabel: set.languageLabel ?? LANGUAGE_LABELS[language] ?? language,
    printedTotal: set.printedTotal,
    total: set.total,
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

function filterSeedSets(language: CardLanguageFilter) {
  const seed = loadSeedSets();

  if (!seed?.length) {
    return null;
  }

  const sets = (
    language === "all" ? seed : seed.filter((set) => set.language === language)
  ).map(seedSetToTcgSet);

  if (!sets.length) {
    return null;
  }

  return language === "all"
    ? uniqueSetsByCatalogId(sets).sort(compareTcgSetsForDisplay)
    : sets.sort(compareTcgSetsForDisplay);
}

function searchSeedSets(query: string, language: CardLanguageFilter, limit = 80) {
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return filterSeedSets(language);
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return filterSeedSets(language);
  }

  const seed = loadSeedSets();

  if (!seed?.length) {
    return null;
  }

  const matches = seed
    .filter((set) => {
      if (language !== "all" && set.language !== language) {
        return false;
      }

      const haystack = normalizeForSearch(
        set.searchText ??
          [set.name, set.englishName, set.code, set.series, set.id].filter(Boolean).join(" "),
      );

      return terms.every((term) => haystack.includes(term));
    })
    .slice(0, limit)
    .map(seedSetToTcgSet);

  if (!matches.length) {
    return [];
  }

  return language === "all" ? uniqueSetsByCatalogId(matches) : matches;
}

function readSetsFromDatabase(language: CardLanguageFilter) {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  try {
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
      ? uniqueSetsByCatalogId(sets).sort(compareTcgSetsForDisplay)
      : sets.sort(compareTcgSetsForDisplay);
  } catch {
    database = null;
    databaseUnavailable = true;
    return null;
  }
}

function searchSetsInDatabaseRows(
  query: string,
  language: CardLanguageFilter,
  limit = 80,
) {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return readSetsFromDatabase(language);
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return readSetsFromDatabase(language);
  }

  try {
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
  } catch {
    database = null;
    databaseUnavailable = true;
    return null;
  }
}

export function isPokemonSetsDatabaseAvailable() {
  return fs.existsSync(getDatabasePath()) || Boolean(loadSeedSets()?.length);
}

export function getSetsFromDatabase(language: CardLanguageFilter = "all"): TcgSet[] | null {
  return readSetsFromDatabase(language) ?? filterSeedSets(language);
}

export function searchSetsInDatabase(
  query: string,
  language: CardLanguageFilter = "all",
  limit = 80,
): TcgSet[] | null {
  return (
    searchSetsInDatabaseRows(query, language, limit) ??
    searchSeedSets(query, language, limit)
  );
}

export function getSetFromDatabase(
  setId: string,
  language: CardLanguageCode = "en",
): TcgSet | null {
  const db = getDatabase();

  if (db) {
    try {
      const row = db
        .prepare(
          `SELECT set_id, language_code, name, english_name, code, series, release_date, printed_total, total
           FROM tcg_sets
           WHERE set_id = ? AND language_code = ?
           LIMIT 1`,
        )
        .get(setId, language) as SetRow | undefined;

      if (row) {
        return rowToTcgSet(row);
      }
    } catch {
      database = null;
      databaseUnavailable = true;
    }
  }

  const seed = loadSeedSets();
  const match = seed?.find((set) => set.id === setId && set.language === language);

  return match ? seedSetToTcgSet(match) : null;
}
