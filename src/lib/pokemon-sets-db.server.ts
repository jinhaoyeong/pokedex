import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { and, desc, eq, like, or } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { pokemonSetsDict } from "@/db/schema";
import {
  getOfficialJapaneseSetSupplementById,
  mergeOfficialJapaneseSetSupplements,
  searchOfficialJapaneseSetSupplements,
} from "@/lib/official-japanese-sets.server";
import { compareTcgSetsForDisplay } from "@/lib/set-display-sort";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import type { CardLanguageCode, CardLanguageFilter, TcgSet } from "@/types/pokemon";

type SetRow = typeof pokemonSetsDict.$inferSelect;
type SqliteSetsDb = InstanceType<typeof Database>;

const LOCAL_SETS_SQLITE_PATH = path.join(process.cwd(), "data", "pokemon-sets.sqlite");

const globalForSetsSqlite = globalThis as unknown as {
  __pokedexSetsSqlite?: SqliteSetsDb | null;
  __pokedexLocalSets?: TcgSet[] | null;
};

function getLocalSetsSqlite(): SqliteSetsDb | null {
  if (globalForSetsSqlite.__pokedexSetsSqlite !== undefined) {
    return globalForSetsSqlite.__pokedexSetsSqlite;
  }

  try {
    if (!fs.existsSync(LOCAL_SETS_SQLITE_PATH)) {
      globalForSetsSqlite.__pokedexSetsSqlite = null;
      return null;
    }

    globalForSetsSqlite.__pokedexSetsSqlite = new Database(LOCAL_SETS_SQLITE_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    return globalForSetsSqlite.__pokedexSetsSqlite;
  } catch {
    globalForSetsSqlite.__pokedexSetsSqlite = null;
    return null;
  }
}

function sqliteRowToTcgSet(row: {
  set_id: string;
  language_code: string;
  name: string;
  english_name: string | null;
  code: string;
  series: string | null;
  release_date: string;
  printed_total: number | null;
  total: number | null;
}): TcgSet {
  const language = row.language_code as CardLanguageCode;

  return {
    id: row.set_id,
    name: row.name,
    localizedName: language === "en" ? undefined : row.name.split(" (")[0],
    englishName: row.english_name ?? undefined,
    code: row.code,
    series: row.series ?? LANGUAGE_LABELS[language] ?? row.language_code,
    releaseDate: row.release_date ?? "",
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? row.language_code,
    printedTotal: row.printed_total ?? undefined,
    total: row.total ?? undefined,
  };
}

function loadAllLocalSets(): TcgSet[] | null {
  if (globalForSetsSqlite.__pokedexLocalSets !== undefined) {
    return globalForSetsSqlite.__pokedexLocalSets;
  }

  const db = getLocalSetsSqlite();
  if (!db) {
    globalForSetsSqlite.__pokedexLocalSets = null;
    return null;
  }

  try {
    const rows = db
      .prepare(
        `SELECT set_id, language_code, name, english_name, code, series, release_date, printed_total, total
         FROM tcg_sets`,
      )
      .all() as Array<{
      set_id: string;
      language_code: string;
      name: string;
      english_name: string | null;
      code: string;
      series: string | null;
      release_date: string;
      printed_total: number | null;
      total: number | null;
    }>;
    globalForSetsSqlite.__pokedexLocalSets = rows.map(sqliteRowToTcgSet);
    return globalForSetsSqlite.__pokedexLocalSets;
  } catch {
    globalForSetsSqlite.__pokedexLocalSets = null;
    return null;
  }
}

function setSearchBlob(set: TcgSet) {
  return normalizeForSearch(
    [set.name, set.englishName, set.code, set.series, set.id].filter(Boolean).join(" "),
  );
}

function filterLocalSets(language: CardLanguageFilter) {
  const all = loadAllLocalSets();
  if (!all?.length) {
    return null;
  }

  const filtered =
    language === "all" ? all : all.filter((set) => set.language === language);
  const withSupplements = withJapaneseSetSupplements(filtered, language);

  return uniqueSetsByCatalogId(withSupplements).sort(compareTcgSetsForDisplay);
}

function searchLocalSets(
  query: string,
  language: CardLanguageFilter,
  limit: number,
) {
  const catalog = filterLocalSets(language);
  if (!catalog) {
    return null;
  }

  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  const matched = terms.length
    ? catalog.filter((set) => {
        const blob = setSearchBlob(set);
        return terms.every((term) => blob.includes(term));
      })
    : catalog;

  return mergeJapaneseSupplementSearchResults(matched, query, language, limit);
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldMergeJapaneseSetSupplements(language: CardLanguageFilter) {
  return language === "ja" || language === "all";
}

function withJapaneseSetSupplements(sets: TcgSet[], language: CardLanguageFilter) {
  if (!shouldMergeJapaneseSetSupplements(language)) {
    return sets;
  }

  return mergeOfficialJapaneseSetSupplements(sets);
}

function mergeJapaneseSupplementSearchResults(
  sets: TcgSet[],
  query: string,
  language: CardLanguageFilter,
  limit = 80,
) {
  if (!shouldMergeJapaneseSetSupplements(language)) {
    return sets;
  }

  const supplementMatches = searchOfficialJapaneseSetSupplements(query, limit);
  const merged = mergeOfficialJapaneseSetSupplements([...sets, ...supplementMatches]);

  return merged.slice(0, limit);
}

function rowToTcgSet(row: SetRow): TcgSet {
  const language = row.languageCode as CardLanguageCode;

  return {
    id: row.setId,
    name: row.name,
    localizedName: language === "en" ? undefined : row.name.split(" (")[0],
    englishName: row.englishName ?? undefined,
    code: row.code,
    series: row.series ?? LANGUAGE_LABELS[language] ?? row.languageCode,
    releaseDate: row.releaseDate,
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? row.languageCode,
    printedTotal: row.printedTotal ?? undefined,
    total: row.total ?? undefined,
  };
}

function uniqueSetsByCatalogId(sets: TcgSet[]) {
  const byId = new Map<string, TcgSet>();

  for (const set of sets) {
    const id = set.id.trim().toLowerCase();

    if (!id) {
      continue;
    }

    const key = `${set.language}:${id}`;
    const existing = byId.get(key);

    if (!existing || (!existing.releaseDate && set.releaseDate)) {
      byId.set(key, set);
    }
  }

  return [...byId.values()];
}

export function setMatchesSearchQuery(set: TcgSet, query: string) {
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return true;
  }

  const blob = setSearchBlob(set);
  return terms.every((term) => blob.includes(term));
}

export function mergeSetCatalogs(
  local?: TcgSet[] | null,
  live?: TcgSet[] | null,
): TcgSet[] {
  return uniqueSetsByCatalogId([...(local ?? []), ...(live ?? [])]).sort(
    compareTcgSetsForDisplay,
  );
}

async function readSetsFromDatabase(language: CardLanguageFilter) {
  if (isDatabaseConfigured()) {
    try {
      const rows =
        language === "all"
          ? await getDb()
              .select()
              .from(pokemonSetsDict)
              .orderBy(desc(pokemonSetsDict.releaseDate), pokemonSetsDict.name)
          : await getDb()
              .select()
              .from(pokemonSetsDict)
              .where(eq(pokemonSetsDict.languageCode, language))
              .orderBy(desc(pokemonSetsDict.releaseDate), pokemonSetsDict.name);

      if (rows.length) {
        const sets = withJapaneseSetSupplements(rows.map(rowToTcgSet), language);

        return uniqueSetsByCatalogId(sets).sort(compareTcgSetsForDisplay);
      }
    } catch {
      // Fall through to the bundled sqlite catalog.
    }
  }

  return filterLocalSets(language);
}

async function searchSetsInDatabaseRows(
  query: string,
  language: CardLanguageFilter,
  limit = 80,
) {
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return readSetsFromDatabase(language);
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return readSetsFromDatabase(language);
  }

  if (isDatabaseConfigured()) {
    const searchConditions = terms.map((term) =>
      like(pokemonSetsDict.searchText, `%${term}%`),
    );

    try {
      const rows = await getDb()
        .select()
        .from(pokemonSetsDict)
        .where(
          language === "all"
            ? and(...searchConditions)
            : and(eq(pokemonSetsDict.languageCode, language), ...searchConditions),
        )
        .orderBy(desc(pokemonSetsDict.releaseDate), pokemonSetsDict.name)
        .limit(limit);

      const sets = mergeJapaneseSupplementSearchResults(
        rows.map(rowToTcgSet),
        query,
        language,
        limit,
      );

      if (sets.length) {
        return uniqueSetsByCatalogId(sets);
      }
    } catch {
      // Fall through to the bundled sqlite catalog.
    }
  }

  return searchLocalSets(query, language, limit);
}

export function getBundledSetsCatalog(
  language: CardLanguageFilter = "all",
): TcgSet[] {
  return filterLocalSets(language) ?? [];
}

export async function getSetsFromDatabase(
  language: CardLanguageFilter = "all",
): Promise<TcgSet[] | null> {
  return readSetsFromDatabase(language);
}

export async function searchSetsInDatabase(
  query: string,
  language: CardLanguageFilter = "all",
  limit = 80,
): Promise<TcgSet[] | null> {
  const rows = await searchSetsInDatabaseRows(query, language, limit);

  if (rows !== null) {
    return rows;
  }

  if (shouldMergeJapaneseSetSupplements(language)) {
    const supplements = searchOfficialJapaneseSetSupplements(query, limit);
    return uniqueSetsByCatalogId(supplements);
  }

  return null;
}

export async function getSetFromDatabase(
  setId: string,
  language: CardLanguageCode = "en",
): Promise<TcgSet | null> {
  const trimmed = setId.trim();

  if (!trimmed) {
    return null;
  }

  if (isDatabaseConfigured()) {
    try {
      const [row] = await getDb()
        .select()
        .from(pokemonSetsDict)
        .where(
          and(
            eq(pokemonSetsDict.languageCode, language),
            or(
              eq(pokemonSetsDict.setId, trimmed),
              eq(pokemonSetsDict.code, trimmed.toUpperCase()),
            ),
          ),
        )
        .limit(1);

      if (row) {
        return rowToTcgSet(row);
      }
    } catch {
      // Fall through to static Japanese supplements below.
    }
  }

  const localSets = loadAllLocalSets() ?? [];
  const localMatch = localSets.find((set) => {
    if (set.language !== language) {
      return false;
    }

    return (
      set.id.trim().toLowerCase() === trimmed.toLowerCase() ||
      set.code.trim().toUpperCase() === trimmed.toUpperCase()
    );
  });

  if (localMatch) {
    return localMatch;
  }

  return language === "ja" ? getOfficialJapaneseSetSupplementById(trimmed) : null;
}
