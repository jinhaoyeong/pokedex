import "server-only";

import { and, count, eq, like, or, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { pokemonNamesDict } from "@/db/schema";
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

async function lookupOverride(localizedName: string, language?: CardLanguageCode): Promise<string | null> {
  if (!isDatabaseConfigured()) {
    return null;
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
    return null;
  }
}

async function lookupSpeciesEnglishName(
  localizedName: string,
  language?: CardLanguageCode,
): Promise<string | null> {
  if (!isDatabaseConfigured()) {
    return null;
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
    return null;
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

/**
 * Given an English species query term, return localized aliases for search expansion.
 */
export async function findLocalizedPokemonNameAliases(
  query: string,
  targetLanguage: CardLanguageCode,
): Promise<string[]> {
  if (!isDatabaseConfigured()) {
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
    return [];
  }

  return [...aliases];
}

/**
 * Given a localized query (any script), resolve English search terms for cross-catalog lookup.
 */
export async function resolveLocalizedQueryToEnglishTerms(query: string): Promise<string[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

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

/** Search the name index for autocomplete / debugging. */
export async function searchPokemonNames(
  query: string,
  limit = 20,
): Promise<PokemonNameSearchHit[]> {
  if (!isDatabaseConfigured() || !query.trim()) {
    return [];
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

    return merged;
  } catch {
    return [];
  }
}

export async function isPokemonNameDatabaseReady() {
  if (!isDatabaseConfigured()) {
    return false;
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
