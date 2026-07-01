import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { CardLanguageCode } from "@/types/pokemon";

const CARD_SUFFIX_RULES: Array<[RegExp, string]> = [
  [/^(.*)V-UNION$/i, " V-UNION"],
  [/^(.*)VMAX$/i, " VMAX"],
  [/^(.*)VSTAR$/i, " VSTAR"],
  [/^(.*)GX$/i, " GX"],
  [/^(.*)ex$/i, " ex"],
  [/^(.*)EX$/i, " EX"],
  [/^(.*)V$/i, " V"],
];

type SpeciesNameRow = {
  species_id: number;
  english_name: string;
  name: string;
  app_language: string | null;
  pokeapi_language: string;
};

type OverrideRow = {
  english_name: string;
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

function parseCardNameSuffix(name: string): { base: string; englishSuffix: string } {
  const trimmed = name.trim();

  for (const [pattern, suffix] of CARD_SUFFIX_RULES) {
    const match = trimmed.match(pattern);

    if (match?.[1] !== undefined) {
      return { base: match[1].trim(), englishSuffix: suffix };
    }
  }

  return { base: trimmed, englishSuffix: "" };
}

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-names.sqlite");
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

function lookupOverride(localizedName: string, language?: CardLanguageCode): string | null {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  const normalized = normalizeForSearch(localizedName);
  const row = db
    .prepare(
      `SELECT english_name
       FROM card_name_overrides
       WHERE localized_normalized = ?
         AND (language_code = ? OR ? IS NULL)
       ORDER BY CASE WHEN language_code = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(normalized, language ?? null, language ?? null, language ?? "") as OverrideRow | undefined;

  return row?.english_name ?? null;
}

function lookupSpeciesEnglishName(localizedName: string, language?: CardLanguageCode): string | null {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  const normalized = normalizeForSearch(localizedName);
  const rows = db
    .prepare(
      `SELECT species_id, english_name, name, app_language, pokeapi_language
       FROM pokemon_species_names
       JOIN pokemon_species USING (species_id)
       WHERE name_normalized = ?
       ORDER BY
         CASE WHEN app_language = ? THEN 0 ELSE 1 END,
         CASE WHEN pokeapi_language = 'en' THEN 1 ELSE 0 END
       LIMIT 8`,
    )
    .all(normalized, language ?? null) as SpeciesNameRow[];

  if (!rows.length) {
    return null;
  }

  return rows[0]?.english_name ?? null;
}

/**
 * Resolve any localized Pokémon species (or override) name to its English equivalent.
 */
export function resolvePokemonNameToEnglish(
  localizedName: string,
  language?: CardLanguageCode,
): string | null {
  const trimmed = localizedName.trim();

  if (!trimmed) {
    return null;
  }

  const override = lookupOverride(trimmed, language);

  if (override) {
    return override;
  }

  const { base, englishSuffix } = parseCardNameSuffix(trimmed);
  const baseOverride = lookupOverride(base, language);

  if (baseOverride) {
    return `${baseOverride}${englishSuffix}`;
  }

  const directEnglish = lookupSpeciesEnglishName(trimmed, language);

  if (directEnglish) {
    return directEnglish;
  }

  const baseEnglish = lookupSpeciesEnglishName(base, language);

  if (baseEnglish) {
    return `${baseEnglish}${englishSuffix}`;
  }

  return null;
}

/**
 * Given an English species query term, return localized aliases for search expansion.
 */
export function findLocalizedPokemonNameAliases(
  query: string,
  targetLanguage: CardLanguageCode,
): string[] {
  const db = getDatabase();

  if (!db) {
    return [];
  }

  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => normalizeForSearch(term))
    .filter((term) => term.length > 1);

  if (!terms.length) {
    return [];
  }

  const aliases = new Set<string>();

  for (const term of terms) {
    const speciesRows = db
      .prepare(
        `SELECT species_id, english_name
         FROM pokemon_species
         WHERE english_name_normalized = ?
            OR english_name_normalized LIKE ?
         LIMIT 12`,
      )
      .all(term, `${term}%`) as Array<{ species_id: number; english_name: string }>;

    for (const species of speciesRows) {
      const localizedRows = db
        .prepare(
          `SELECT name
           FROM pokemon_species_names
           WHERE species_id = ?
             AND (app_language = ? OR pokeapi_language IN ('ja', 'ja-Hrkt', 'ko', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'es', 'it'))
           LIMIT 24`,
        )
        .all(species.species_id, targetLanguage) as Array<{ name: string }>;

      for (const row of localizedRows) {
        aliases.add(row.name);
      }
    }
  }

  return [...aliases];
}

/**
 * Given a localized query (any script), resolve English search terms for cross-catalog lookup.
 */
export function resolveLocalizedQueryToEnglishTerms(query: string): string[] {
  const db = getDatabase();

  if (!db) {
    return [];
  }

  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  const englishTerms = new Set<string>();
  const directEnglish = resolvePokemonNameToEnglish(trimmed);

  if (directEnglish) {
    englishTerms.add(directEnglish);
  }

  const normalized = normalizeForSearch(trimmed);
  const prefixRows = db
    .prepare(
      `SELECT DISTINCT english_name
       FROM pokemon_species_names
       JOIN pokemon_species USING (species_id)
       WHERE name_normalized LIKE ?
       LIMIT 16`,
    )
    .all(`${normalized}%`) as Array<{ english_name: string }>;

  for (const row of prefixRows) {
    englishTerms.add(row.english_name);
  }

  const overrideRows = db
    .prepare(
      `SELECT english_name
       FROM card_name_overrides
       WHERE localized_normalized LIKE ?
       LIMIT 8`,
    )
    .all(`${normalized}%`) as Array<{ english_name: string }>;

  for (const row of overrideRows) {
    englishTerms.add(row.english_name);
  }

  return [...englishTerms];
}

export type PokemonNameSearchHit = {
  name: string;
  englishName: string;
  language: string;
  speciesId: number;
};

/** Search the name index for autocomplete / debugging. */
export function searchPokemonNames(query: string, limit = 20): PokemonNameSearchHit[] {
  const db = getDatabase();

  if (!db || !query.trim()) {
    return [];
  }

  const normalized = normalizeForSearch(query);
  const like = `%${normalized}%`;

  const speciesHits = db
    .prepare(
      `SELECT n.name, s.english_name, COALESCE(n.app_language, n.pokeapi_language) AS language, s.species_id
       FROM pokemon_species_names n
       JOIN pokemon_species s USING (species_id)
       WHERE n.name_normalized LIKE ?
          OR s.english_name_normalized LIKE ?
       ORDER BY
         CASE WHEN n.name_normalized = ? THEN 0
              WHEN n.name_normalized LIKE ? THEN 1
              ELSE 2 END,
         length(n.name)
       LIMIT ?`,
    )
    .all(like, like, normalized, `${normalized}%`, limit) as Array<{
      name: string;
      english_name: string;
      language: string;
      species_id: number;
    }>;

  const overrideHits = db
    .prepare(
      `SELECT localized_name AS name, english_name, language_code AS language
       FROM card_name_overrides
       WHERE localized_normalized LIKE ? OR english_normalized LIKE ?
       LIMIT ?`,
    )
    .all(like, like, Math.max(0, limit - speciesHits.length)) as Array<{
      name: string;
      english_name: string;
      language: string;
    }>;

  const merged: PokemonNameSearchHit[] = [];
  const seen = new Set<string>();

  for (const row of [...speciesHits, ...overrideHits.map((hit) => ({ ...hit, species_id: 0 }))]) {
    const key = `${row.language}:${row.name}:${row.english_name}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({
      name: row.name,
      englishName: row.english_name,
      language: row.language,
      speciesId: "species_id" in row ? row.species_id : 0,
    });

    if (merged.length >= limit) {
      break;
    }
  }

  return merged;
}

export function isPokemonNameDatabaseReady() {
  return fs.existsSync(getDatabasePath());
}

export function getPokemonNameDatabaseStats() {
  const db = getDatabase();

  if (!db) {
    return null;
  }

  const speciesCount = (
    db.prepare("SELECT COUNT(*) AS c FROM pokemon_species").get() as { c: number }
  ).c;
  const nameCount = (
    db.prepare("SELECT COUNT(*) AS c FROM pokemon_species_names").get() as { c: number }
  ).c;
  const languageCount = (
    db.prepare("SELECT COUNT(DISTINCT pokeapi_language) AS c FROM pokemon_species_names").get() as {
      c: number;
    }
  ).c;
  const overrideCount = (
    db.prepare("SELECT COUNT(*) AS c FROM card_name_overrides").get() as { c: number }
  ).c;

  return { speciesCount, nameCount, languageCount, overrideCount };
}
