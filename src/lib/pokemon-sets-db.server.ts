import "server-only";

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

async function readSetsFromDatabase(language: CardLanguageFilter) {
  if (!isDatabaseConfigured()) {
    return null;
  }

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

    if (!rows.length) {
      return null;
    }

    const sets = withJapaneseSetSupplements(rows.map(rowToTcgSet), language);

    return language === "all"
      ? uniqueSetsByCatalogId(sets).sort(compareTcgSetsForDisplay)
      : sets.sort(compareTcgSetsForDisplay);
  } catch {
    return null;
  }
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

  if (!isDatabaseConfigured()) {
    return null;
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return readSetsFromDatabase(language);
  }

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

    return language === "all" ? uniqueSetsByCatalogId(sets) : sets;
  } catch {
    return null;
  }
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
    return language === "all" ? uniqueSetsByCatalogId(supplements) : supplements;
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

  return language === "ja" ? getOfficialJapaneseSetSupplementById(trimmed) : null;
}
