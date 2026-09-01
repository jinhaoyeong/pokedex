import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { and, count, eq, like, or, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { pokemonNamesDict } from "@/db/schema";
import { JAPANESE_CARD_NAME_OVERRIDES, parseJapaneseCardNameAffixes } from "@/lib/japanese-name-overrides";
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

/** Local seed from `npm run db:seed` — used when DATABASE_URL (Postgres) is unset. */
const LOCAL_NAMES_SQLITE_PATH = path.join(process.cwd(), "data", "pokemon-names.sqlite");

type SqliteNamesDb = InstanceType<typeof Database>;

const globalForNamesSqlite = globalThis as unknown as {
  __pokedexNamesSqlite?: SqliteNamesDb | null;
};

export type PokemonNameSearchHit = {
  name: string;
  englishName: string;
  language: string;
  speciesId: number;
};

function normalizeForSearch(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocalNamesSqlite(): SqliteNamesDb | null {
  if (globalForNamesSqlite.__pokedexNamesSqlite) {
    return globalForNamesSqlite.__pokedexNamesSqlite;
  }

  try {
    if (!fs.existsSync(LOCAL_NAMES_SQLITE_PATH)) {
      return null;
    }

    globalForNamesSqlite.__pokedexNamesSqlite = new Database(LOCAL_NAMES_SQLITE_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    return globalForNamesSqlite.__pokedexNamesSqlite;
  } catch {
    return null;
  }
}

function lookupOverrideFromSqlite(
  localizedName: string,
  language?: CardLanguageCode,
): string | null {
  const db = getLocalNamesSqlite();
  if (!db) return null;

  const normalized = normalizeForSearch(localizedName);

  try {
    if (language) {
      const row = db
        .prepare(
          `SELECT english_name AS englishName
           FROM card_name_overrides
           WHERE localized_normalized = ?
             AND (language_code = ? OR language_code IS NULL OR language_code = '')
           ORDER BY CASE WHEN language_code = ? THEN 0 ELSE 1 END
           LIMIT 1`,
        )
        .get(normalized, language, language) as { englishName?: string } | undefined;
      return row?.englishName ?? null;
    }

    const row = db
      .prepare(
        `SELECT english_name AS englishName
         FROM card_name_overrides
         WHERE localized_normalized = ?
         LIMIT 1`,
      )
      .get(normalized) as { englishName?: string } | undefined;
    return row?.englishName ?? null;
  } catch {
    return null;
  }
}

export function resolveEnglishNameByDexId(dexId: number): string | null {
  if (!Number.isFinite(dexId) || dexId <= 0) {
    return null;
  }

  const db = getLocalNamesSqlite();
  if (!db) {
    return null;
  }

  try {
    const row = db
      .prepare(
        `SELECT english_name AS englishName
         FROM pokemon_species
         WHERE species_id = ?
         LIMIT 1`,
      )
      .get(dexId) as { englishName?: string } | undefined;
    return row?.englishName?.trim() || null;
  } catch {
    return null;
  }
}

function lookupSpeciesEnglishNameFromSqlite(
  localizedName: string,
  language?: CardLanguageCode,
): string | null {
  const db = getLocalNamesSqlite();
  if (!db) return null;

  const normalized = normalizeForSearch(localizedName);

  try {
    const row = db
      .prepare(
        `SELECT s.english_name AS englishName
         FROM pokemon_species_names n
         JOIN pokemon_species s ON s.species_id = n.species_id
         WHERE n.name_normalized = ?
         ORDER BY
           CASE WHEN n.app_language = ? THEN 0 ELSE 1 END,
           CASE WHEN n.pokeapi_language = 'en' THEN 1 ELSE 0 END
         LIMIT 1`,
      )
      .get(normalized, language ?? "") as { englishName?: string } | undefined;
    return row?.englishName ?? null;
  } catch {
    return null;
  }
}

function lookupJapaneseSpeciesNamesFromSqlite(englishBase: string): string[] {
  const db = getLocalNamesSqlite();
  if (!db) {
    return [];
  }

  const normalized = normalizeForSearch(englishBase);

  try {
    const rows = db
      .prepare(
        `SELECT n.name AS name
         FROM pokemon_species s
         JOIN pokemon_species_names n ON n.species_id = s.species_id
         WHERE s.english_name_normalized = ?
           AND n.app_language = 'ja'
         LIMIT 8`,
      )
      .all(normalized) as Array<{ name?: string }>;

    return [...new Set(rows.map((row) => row.name?.trim()).filter(Boolean) as string[])];
  } catch {
    return [];
  }
}

/**
 * Expand an English or Japanese card name into Japanese browse-seed aliases
 * (e.g. "Mew ex" → "ミュウex") without guessing a print.
 */
export async function findJapaneseCardNameSearchAliases(name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) {
    return [];
  }

  const aliases = new Set<string>([trimmed, trimmed.replace(/\s+/g, "")]);
  const hasCjk = /[\u3040-\u30ff\u4e00-\u9fff]/.test(trimmed);

  for (const [jp, en] of Object.entries(JAPANESE_CARD_NAME_OVERRIDES)) {
    if (normalizeForSearch(en) === normalizeForSearch(trimmed)) {
      aliases.add(jp);
    }
  }

  if (hasCjk) {
    return [...aliases];
  }

  const { base, englishSuffix } = parseCardNameSuffix(trimmed);
  const jpSuffix = englishSuffix.replace(/\s+/g, "");
  const jpBases = lookupJapaneseSpeciesNamesFromSqlite(base);

  // Search must not wait on a remote name dictionary. Local sqlite is the
  // multilingual alias source for Dex name queries.

  for (const jpBase of jpBases) {
    aliases.add(`${jpBase}${jpSuffix}`);
    if (jpSuffix) {
      aliases.add(`${jpBase} ${jpSuffix}`);
    }
  }

  return [...aliases];
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

/** Local-only JP→EN name resolve for search tiles. Never waits on Postgres. */
export function resolveJapanesePrintedNameToEnglishSync(jpName: string): string | undefined {
  const trimmed = jpName.trim();
  if (!trimmed) {
    return undefined;
  }

  const override = JAPANESE_CARD_NAME_OVERRIDES[trimmed];
  if (override) {
    return override;
  }

  const fromSqlite = lookupSpeciesEnglishNameFromSqlite(trimmed, "ja")
    || lookupOverrideFromSqlite(trimmed, "ja");
  if (fromSqlite) {
    return fromSqlite;
  }

  const { base, englishPrefix, englishSuffix } = parseJapaneseCardNameAffixes(trimmed);
  if (base !== trimmed || englishPrefix || englishSuffix) {
    const baseOverride = JAPANESE_CARD_NAME_OVERRIDES[base];
    const baseEnglish =
      baseOverride ||
      lookupSpeciesEnglishNameFromSqlite(base, "ja") ||
      lookupOverrideFromSqlite(base, "ja");
    if (baseEnglish) {
      return `${englishPrefix}${baseEnglish}${englishSuffix}`;
    }
  }

  return undefined;
}

async function lookupOverride(localizedName: string, language?: CardLanguageCode): Promise<string | null> {
  const local = lookupOverrideFromSqlite(localizedName, language);
  if (local || !isDatabaseConfigured()) {
    return local;
  }

  const normalized = normalizeForSearch(localizedName);

  try {
    const [row] = await getDb()
      .select({ englishName: pokemonNamesDict.englishName })
      .from(pokemonNamesDict)
      .where(
        and(
          eq(pokemonNamesDict.kind, "override"),
          eq(pokemonNamesDict.localizedNormalized, normalized),
          language
            ? or(eq(pokemonNamesDict.appLanguage, language), sql`${pokemonNamesDict.appLanguage} is null`)
            : undefined,
        ),
      )
      .orderBy(
        language
          ? sql`case when ${pokemonNamesDict.appLanguage} = ${language} then 0 else 1 end`
          : sql`0`,
      )
      .limit(1);

    return row?.englishName ?? null;
  } catch {
    return lookupOverrideFromSqlite(localizedName, language);
  }
}

async function lookupSpeciesEnglishName(
  localizedName: string,
  language?: CardLanguageCode,
): Promise<string | null> {
  const local = lookupSpeciesEnglishNameFromSqlite(localizedName, language);
  if (local || !isDatabaseConfigured()) {
    return local;
  }

  const normalized = normalizeForSearch(localizedName);

  try {
    const [row] = await getDb()
      .select({ englishName: pokemonNamesDict.englishName })
      .from(pokemonNamesDict)
      .where(
        and(
          eq(pokemonNamesDict.kind, "species"),
          eq(pokemonNamesDict.localizedNormalized, normalized),
        ),
      )
      .orderBy(
        language
          ? sql`case when ${pokemonNamesDict.appLanguage} = ${language} then 0 else 1 end`
          : sql`1`,
        sql`case when ${pokemonNamesDict.pokeapiLanguage} = 'en' then 1 else 0 end`,
      )
      .limit(1);

    return row?.englishName ?? null;
  } catch {
    return lookupSpeciesEnglishNameFromSqlite(localizedName, language);
  }
}

/**
 * Resolve any localized Pokemon species (or override) name to its English equivalent.
 */
export async function resolvePokemonNameToEnglish(
  localizedName: string,
  language?: CardLanguageCode,
): Promise<string | null> {
  const trimmed = localizedName.trim();

  if (!trimmed) {
    return null;
  }

  const override = await lookupOverride(trimmed, language);

  if (override) {
    return override;
  }

  const { base, englishSuffix } = parseCardNameSuffix(trimmed);
  const baseOverride = await lookupOverride(base, language);

  if (baseOverride) {
    return `${baseOverride}${englishSuffix}`;
  }

  const directEnglish = await lookupSpeciesEnglishName(trimmed, language);

  if (directEnglish) {
    return directEnglish;
  }

  const baseEnglish = await lookupSpeciesEnglishName(base, language);

  if (baseEnglish) {
    return `${baseEnglish}${englishSuffix}`;
  }

  return null;
}

function sqliteAliasLanguageMatch(targetLanguage: CardLanguageCode): {
  appLanguages: CardLanguageCode[];
  pokeapiLanguages: string[];
} {
  if (targetLanguage === "zh-cn" || targetLanguage === "zh-tw") {
    return {
      appLanguages: ["zh-cn", "zh-tw"],
      pokeapiLanguages: ["zh-hans", "zh-hant", "zh-Hans", "zh-Hant"],
    };
  }

  if (targetLanguage === "ja") {
    return {
      appLanguages: ["ja"],
      pokeapiLanguages: ["ja", "ja-Hrkt", "ja-hrkt"],
    };
  }

  return {
    appLanguages: [targetLanguage],
    pokeapiLanguages: [targetLanguage],
  };
}

function findLocalizedPokemonNameAliasesFromSqlite(
  query: string,
  targetLanguage: CardLanguageCode,
): string[] {
  const db = getLocalNamesSqlite();
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
  const { appLanguages, pokeapiLanguages } = sqliteAliasLanguageMatch(targetLanguage);

  try {
    const speciesStmt = db.prepare(
      `SELECT species_id AS speciesId
       FROM pokemon_species
       WHERE english_name_normalized = ? OR english_name_normalized LIKE ?
       LIMIT 12`,
    );
    const appPlaceholders = appLanguages.map(() => "?").join(", ");
    const pokeapiPlaceholders = pokeapiLanguages.map(() => "?").join(", ");
    const namesStmt = db.prepare(
      `SELECT name
       FROM pokemon_species_names
       WHERE species_id = ?
         AND (
           app_language IN (${appPlaceholders})
           OR lower(pokeapi_language) IN (${pokeapiPlaceholders})
         )
       LIMIT 24`,
    );

    for (const term of terms) {
      const speciesRows = speciesStmt.all(term, `${term}%`) as Array<{ speciesId?: number }>;

      for (const species of speciesRows) {
        if (!species.speciesId) {
          continue;
        }

        const localizedRows = namesStmt.all(
          species.speciesId,
          ...appLanguages,
          ...pokeapiLanguages.map((code) => code.toLowerCase()),
        ) as Array<{
          name?: string;
        }>;

        for (const row of localizedRows) {
          if (row.name?.trim()) {
            aliases.add(row.name.trim());
          }
        }
      }
    }
  } catch {
    return [...aliases];
  }

  return [...aliases];
}

/**
 * Given an English species query term, return localized aliases for search expansion.
 */
export async function findLocalizedPokemonNameAliases(
  query: string,
  targetLanguage: CardLanguageCode,
): Promise<string[]> {
  const local = findLocalizedPokemonNameAliasesFromSqlite(query, targetLanguage);
  if (local.length || !isDatabaseConfigured()) {
    return local;
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

  try {
    for (const term of terms) {
      const speciesRows = await getDb()
        .select({
          speciesId: pokemonNamesDict.speciesId,
        })
        .from(pokemonNamesDict)
        .where(
          and(
            eq(pokemonNamesDict.kind, "species"),
            or(
              eq(pokemonNamesDict.englishNormalized, term),
              like(pokemonNamesDict.englishNormalized, `${term}%`),
            ),
          ),
        )
        .limit(12);

      for (const species of speciesRows) {
        if (!species.speciesId) {
          continue;
        }

        const localizedRows = await getDb()
          .select({ name: pokemonNamesDict.localizedName })
          .from(pokemonNamesDict)
          .where(
            and(
              eq(pokemonNamesDict.kind, "species"),
              eq(pokemonNamesDict.speciesId, species.speciesId),
              or(
                eq(pokemonNamesDict.appLanguage, targetLanguage),
                sql`${pokemonNamesDict.pokeapiLanguage} in ('ja', 'ja-Hrkt', 'ko', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'es', 'it')`,
              ),
            ),
          )
          .limit(24);

        for (const row of localizedRows) {
          aliases.add(row.name);
        }
      }
    }
  } catch {
    return findLocalizedPokemonNameAliasesFromSqlite(query, targetLanguage);
  }

  if (aliases.size === 0) {
    return findLocalizedPokemonNameAliasesFromSqlite(query, targetLanguage);
  }

  return [...aliases];
}

/**
 * Given a localized query (any script), resolve English search terms for cross-catalog lookup.
 */
export async function resolveLocalizedQueryToEnglishTerms(query: string): Promise<string[]> {
  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  const englishTerms = new Set<string>();
  const directEnglish = await resolvePokemonNameToEnglish(trimmed);

  if (directEnglish) {
    englishTerms.add(directEnglish);
  }

  const normalized = normalizeForSearch(trimmed);

  if (!isDatabaseConfigured()) {
    const db = getLocalNamesSqlite();
    if (!db) return [...englishTerms];

    try {
      const speciesRows = db
        .prepare(
          `SELECT DISTINCT s.english_name AS englishName
           FROM pokemon_species_names n
           JOIN pokemon_species s ON s.species_id = n.species_id
           WHERE n.name_normalized LIKE ?
           LIMIT 16`,
        )
        .all(`${normalized}%`) as Array<{ englishName: string }>;
      for (const row of speciesRows) englishTerms.add(row.englishName);

      const overrideRows = db
        .prepare(
          `SELECT english_name AS englishName
           FROM card_name_overrides
           WHERE localized_normalized LIKE ?
           LIMIT 8`,
        )
        .all(`${normalized}%`) as Array<{ englishName: string }>;
      for (const row of overrideRows) englishTerms.add(row.englishName);
    } catch {
      return [...englishTerms];
    }

    return [...englishTerms];
  }

  try {
    const prefixRows = await getDb()
      .selectDistinct({ englishName: pokemonNamesDict.englishName })
      .from(pokemonNamesDict)
      .where(
        and(
          eq(pokemonNamesDict.kind, "species"),
          like(pokemonNamesDict.localizedNormalized, `${normalized}%`),
        ),
      )
      .limit(16);

    for (const row of prefixRows) {
      englishTerms.add(row.englishName);
    }

    const overrideRows = await getDb()
      .select({ englishName: pokemonNamesDict.englishName })
      .from(pokemonNamesDict)
      .where(
        and(
          eq(pokemonNamesDict.kind, "override"),
          like(pokemonNamesDict.localizedNormalized, `${normalized}%`),
        ),
      )
      .limit(8);

    for (const row of overrideRows) {
      englishTerms.add(row.englishName);
    }
  } catch {
    return [...englishTerms];
  }

  return [...englishTerms];
}

function searchPokemonNamesFromSqlite(
  query: string,
  limit: number,
): PokemonNameSearchHit[] {
  const db = getLocalNamesSqlite();
  if (!db) return [];

  const normalized = normalizeForSearch(query);
  if (!normalized) return [];
  const likeTerm = `%${normalized}%`;
  const prefixTerm = `${normalized}%`;

  try {
    const rows = db
      .prepare(
        `SELECT
           n.name AS name,
           s.english_name AS englishName,
           coalesce(n.app_language, n.pokeapi_language, 'unknown') AS language,
           s.species_id AS speciesId
         FROM pokemon_species_names n
         JOIN pokemon_species s ON s.species_id = n.species_id
         WHERE n.name_normalized LIKE ?
            OR s.english_name_normalized LIKE ?
         ORDER BY
           CASE
             WHEN n.name_normalized = ? THEN 0
             WHEN s.english_name_normalized = ? THEN 1
             WHEN n.name_normalized LIKE ? THEN 2
             ELSE 3
           END,
           length(n.name)
         LIMIT ?`,
      )
      .all(
        likeTerm,
        likeTerm,
        normalized,
        normalized,
        prefixTerm,
        Math.max(4, limit * 4),
      ) as PokemonNameSearchHit[];

    const merged: PokemonNameSearchHit[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.language}:${row.name}:${row.englishName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= limit) break;
    }
    return merged;
  } catch {
    return [];
  }
}

/** Search the name index for autocomplete / debugging. */
export async function searchPokemonNames(
  query: string,
  limit = 20,
): Promise<PokemonNameSearchHit[]> {
  if (!query.trim()) {
    return [];
  }

  if (!isDatabaseConfigured()) {
    return searchPokemonNamesFromSqlite(query, limit);
  }

  const normalized = normalizeForSearch(query);
  const likeTerm = `%${normalized}%`;

  try {
    const rows = await getDb()
      .select({
        name: pokemonNamesDict.localizedName,
        englishName: pokemonNamesDict.englishName,
        language: sql<string>`coalesce(${pokemonNamesDict.appLanguage}, ${pokemonNamesDict.pokeapiLanguage}, 'unknown')`,
        speciesId: sql<number>`coalesce(${pokemonNamesDict.speciesId}, 0)`,
      })
      .from(pokemonNamesDict)
      .where(
        or(
          like(pokemonNamesDict.localizedNormalized, likeTerm),
          like(pokemonNamesDict.englishNormalized, likeTerm),
        ),
      )
      .orderBy(
        sql`case when ${pokemonNamesDict.localizedNormalized} = ${normalized} then 0 when ${pokemonNamesDict.localizedNormalized} like ${`${normalized}%`} then 1 else 2 end`,
        sql`length(${pokemonNamesDict.localizedName})`,
      )
      .limit(limit * 2);

    const merged: PokemonNameSearchHit[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const key = `${row.language}:${row.name}:${row.englishName}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(row);

      if (merged.length >= limit) {
        break;
      }
    }

    return merged.length ? merged : searchPokemonNamesFromSqlite(query, limit);
  } catch {
    return searchPokemonNamesFromSqlite(query, limit);
  }
}

export async function isPokemonNameDatabaseReady() {
  if (!isDatabaseConfigured()) {
    const db = getLocalNamesSqlite();
    if (!db) return false;
    try {
      const row = db.prepare(`SELECT COUNT(*) AS value FROM pokemon_species`).get() as {
        value?: number;
      };
      return (row?.value ?? 0) > 0;
    } catch {
      return false;
    }
  }

  try {
    const [row] = await getDb()
      .select({ value: count() })
      .from(pokemonNamesDict)
      .limit(1);
    return (row?.value ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function getPokemonNameDatabaseStats() {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const [[species], [names], [languages], [overrides]] = await Promise.all([
      getDb()
        .select({ value: count() })
        .from(pokemonNamesDict)
        .where(eq(pokemonNamesDict.kind, "species")),
      getDb().select({ value: count() }).from(pokemonNamesDict),
      getDb()
        .select({ value: sql<number>`count(distinct ${pokemonNamesDict.pokeapiLanguage})` })
        .from(pokemonNamesDict)
        .where(eq(pokemonNamesDict.kind, "species")),
      getDb()
        .select({ value: count() })
        .from(pokemonNamesDict)
        .where(eq(pokemonNamesDict.kind, "override")),
    ]);

    return {
      speciesCount: species?.value ?? 0,
      nameCount: names?.value ?? 0,
      languageCount: languages?.value ?? 0,
      overrideCount: overrides?.value ?? 0,
    };
  } catch {
    return null;
  }
}
