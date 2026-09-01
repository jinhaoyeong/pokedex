import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import { cardsCatalog } from "@/db/schema";
import { getDb, isDatabaseConfigured } from "@/db/client";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import { isPokemonTcgPocketPrint, isPokemonTcgPocketSet } from "@/lib/pokemon-tcg/tcg-pocket";
import { withDerivedEnglishPrintImage } from "@/lib/pokemon-tcg/english-print-image";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";
import { applyCanonicalJapaneseIdentityToCard } from "@/lib/japanese-market-identity";
import { attachFinishMarketsToCard } from "@/lib/card-finish";
import { getLocalizedSetMarketProfile } from "@/lib/localized-set-market";
import { expandCatalogSetFilterKeys } from "@/lib/pokemon-tcg/text-and-collector-utils";

function physicalCatalogCard(card: TcgCard | null | undefined): TcgCard | null {
  if (!card || isPokemonTcgPocketPrint(card)) {
    return null;
  }

  return card;
}

function physicalCatalogCards(cards: TcgCard[]) {
  return cards.filter((card): card is TcgCard => Boolean(physicalCatalogCard(card)));
}

function isExcludedPokemonTcgPocketSetFilter(setFilter: string) {
  const value = setFilter.trim();
  return isPokemonTcgPocketSet({ id: value, code: value, name: value });
}

type CardIndexRow = typeof cardsCatalog.$inferSelect;

type ParsedCatalogQuery = {
  text: string;
  collectorNumber: string | null;
  collectorVariants: string[];
};

function normalizeCatalogText(value: string) {
  return value
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function collectorVariants(value: string) {
  const clean = value.trim();
  const withoutFraction = clean.split("/")[0]?.trim() ?? clean;
  const numericMatch = withoutFraction.match(/^([a-z]{0,4})(\d{1,4})$/i);

  if (!numericMatch) {
    return [withoutFraction].filter(Boolean);
  }

  const [, prefix = "", digits] = numericMatch;
  const unpadded = digits.replace(/^0+(?=\d)/, "") || digits;
  const variants = new Set<string>([
    withoutFraction,
    `${prefix}${unpadded}`,
    `${prefix}${unpadded.padStart(3, "0")}`,
    `${prefix}${unpadded.padStart(4, "0")}`,
  ]);

  return [...variants].filter(Boolean);
}

function parseCatalogQuery(value: string): ParsedCatalogQuery {
  const tokens = normalizeCatalogText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
  let collectorNumber: string | null = null;
  const textTokens: string[] = [];

  for (const token of tokens) {
    const fraction = token.match(/^([a-z]{0,4}\d{1,4})\/\d{1,4}$/i);
    const plainNumber = token.match(/^[a-z]{0,4}\d{1,4}$/i);

    if (!collectorNumber && (fraction || plainNumber)) {
      collectorNumber = (fraction?.[1] ?? token).toUpperCase();
      continue;
    }

    textTokens.push(token);
  }

  return {
    text: textTokens.join(" "),
    collectorNumber,
    collectorVariants: collectorNumber ? collectorVariants(collectorNumber) : [],
  };
}

function rowToCard(row: CardIndexRow): TcgCard {
  const language = row.languageCode as CardLanguageCode;
  const localizedName = row.localizedName ?? row.name;
  const englishName = row.englishName ?? row.name;

  return withDerivedEnglishPrintImage(
    attachFinishMarketsToCard(
    applyCanonicalJapaneseIdentityToCard({
    id: row.cardId,
    slug: row.slug,
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? LANGUAGE_LABELS.en,
    name:
      language !== "en" && localizedName
        ? `${localizedName} (${englishName})`
        : row.name,
    localizedName,
    englishName,
    collectorNumber: row.collectorNumber,
    rarity: row.rarity ?? "Unknown",
    supertype: row.supertype ?? "Pokemon",
    hp: "-",
    types: [],
    setId: row.setId,
    setCode: row.setCode,
    setName: row.setCode,
    setLocalizedName: row.setCode,
    setEnglishName: row.setCode,
    setPrintedTotal: row.printedTotal ?? undefined,
    setTotal: row.printedTotal ?? undefined,
    image: row.imageUrl ?? "/icon.svg",
    artist: "Unknown",
    imageStatus: row.imageUrl ? "derived" : "placeholder",
    marketPriceUsd: Number(row.marketPriceUsd ?? 0),
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Supabase cards catalog",
      fetchedAt: null,
      note: "Card identity loaded from the Supabase cards catalog while live pricing refreshes.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [],
    gradedPrices: [{ grade: "Ungraded", value: Number(row.marketPriceUsd ?? 0), populationCount: 0 }],
    recentSales: [],
    sources: [
      {
        source: "Supabase cards catalog",
        status: "verified",
        fetchedAt: new Date().toISOString(),
        confidence: 0.72,
        note: "Pre-seeded catalog identity from English/Japanese set data (1998-2026).",
      },
    ],
  }),
  ),
  );
}

export async function lookupCardInIndexBySlug(slug: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const [row] = await getDb()
      .select()
      .from(cardsCatalog)
      .where(eq(cardsCatalog.slug, slug))
      .limit(1);

    return physicalCatalogCard(row ? rowToCard(row) : null);
  } catch {
    return null;
  }
}

export async function lookupCardsInIndexByCardIds(
  inputs: Array<{ id: string; language?: CardLanguageCode | string }>,
) {
  const ids = [...new Set(inputs.map((input) => input.id.trim()).filter(Boolean))];
  if (!isDatabaseConfigured() || !ids.length) {
    return [] as TcgCard[];
  }

  const preferredLanguageById = new Map(
    inputs
      .filter((input) => input.id.trim() && input.language)
      .map((input) => [input.id.trim(), String(input.language).trim()]),
  );

  try {
    const rows = await getDb()
      .select()
      .from(cardsCatalog)
      .where(inArray(cardsCatalog.cardId, ids));

    const rowsById = new Map<string, CardIndexRow[]>();
    for (const row of rows) {
      const list = rowsById.get(row.cardId) ?? [];
      list.push(row);
      rowsById.set(row.cardId, list);
    }

    const cards: TcgCard[] = [];
    const seenSlugs = new Set<string>();
    for (const id of ids) {
      const candidates = rowsById.get(id) ?? [];
      const preferredLanguage = preferredLanguageById.get(id);
      const row =
        candidates.find((candidate) => candidate.languageCode === preferredLanguage) ??
        candidates[0];
      if (!row || seenSlugs.has(row.slug)) {
        continue;
      }
      seenSlugs.add(row.slug);
      cards.push(rowToCard(row));
    }

    return physicalCatalogCards(cards);
  } catch {
    return [] as TcgCard[];
  }
}

export async function lookupCardsInIndexByNameAndSet(
  nameQuery: string,
  setFilter: string,
  language: CardLanguageCode | "all" = "all",
  limit = 24,
) {
  if (!isDatabaseConfigured() || !nameQuery.trim() || !setFilter.trim()) {
    return [] as TcgCard[];
  }

  if (isExcludedPokemonTcgPocketSetFilter(setFilter)) {
    return [] as TcgCard[];
  }

  const parsed = parseCatalogQuery(nameQuery);

  if (!parsed.text && !parsed.collectorVariants.length) {
    return [] as TcgCard[];
  }

  const setKeys = expandCatalogSetFilterKeys(setFilter);
  const conditions = [
    or(inArray(cardsCatalog.setId, setKeys), inArray(cardsCatalog.setCode, setKeys)),
  ];

  if (parsed.text) {
    conditions.push(sql`${cardsCatalog.searchText} % ${parsed.text}`);
  }

  if (parsed.collectorVariants.length) {
    conditions.push(inArray(cardsCatalog.collectorNumber, parsed.collectorVariants));
  }

  if (language !== "all") {
    conditions.push(eq(cardsCatalog.languageCode, language));
  }

  const exactCollectorRank = parsed.collectorVariants.length
    ? sql<number>`case when ${sql.join(
        parsed.collectorVariants.map(
          (variant) => sql`${cardsCatalog.collectorNumber} = ${variant}`,
        ),
        sql` or `,
      )} then 1 else 0 end`
    : sql<number>`0`;

  try {
    const rows = await getDb()
      .select()
      .from(cardsCatalog)
      .where(and(...conditions))
      .orderBy(
        desc(
          sql<number>`greatest(
            ${exactCollectorRank},
            similarity(${cardsCatalog.searchText}, ${parsed.text}),
            similarity(${cardsCatalog.name}, ${parsed.text}),
            similarity(coalesce(${cardsCatalog.englishName}, ''), ${parsed.text}),
            similarity(coalesce(${cardsCatalog.localizedName}, ''), ${parsed.text})
          )`,
        ),
        desc(cardsCatalog.releaseYear),
      )
      .limit(limit);

    return physicalCatalogCards(rows.map(rowToCard));
  } catch {
    return [] as TcgCard[];
  }
}

/**
 * Set-only browse straight from the local catalog — the offline fallback for
 * a set page when the live upstream catalog is unreachable. Ordered by the
 * numeric part of the collector number so the set reads in printed order.
 */
export async function lookupCardsInIndexBySet(
  setFilter: string,
  language: CardLanguageCode | "all" = "all",
  limit = 50,
  page = 1,
): Promise<{ cards: TcgCard[]; totalCount: number }> {
  if (!setFilter.trim()) {
    return { cards: [], totalCount: 0 };
  }

  if (isExcludedPokemonTcgPocketSetFilter(setFilter)) {
    return { cards: [], totalCount: 0 };
  }

  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const local = lookupLocalCardsIndexBySet(setFilter, language, limit, safePage);
  if (local.cards.length) {
    return local;
  }

  if (!isDatabaseConfigured()) {
    return local;
  }

  const setKeys = expandCatalogSetFilterKeys(setFilter);
  if (!setKeys.length) {
    return { cards: [], totalCount: 0 };
  }

  const conditions = [
    or(inArray(cardsCatalog.setId, setKeys), inArray(cardsCatalog.setCode, setKeys)),
  ];

  if (language !== "all") {
    conditions.push(eq(cardsCatalog.languageCode, language));
  }

  const where = and(...conditions);

  try {
    const db = getDb();
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(cardsCatalog)
        .where(where)
        .orderBy(
          asc(
            sql`nullif(regexp_replace(${cardsCatalog.collectorNumber}, '[^0-9]', '', 'g'), '')::int`,
          ),
          asc(cardsCatalog.collectorNumber),
        )
        .limit(limit)
        .offset((safePage - 1) * limit),
      db.select({ value: count() }).from(cardsCatalog).where(where),
    ]);

    return { cards: physicalCatalogCards(rows.map(rowToCard)), totalCount: total?.value ?? rows.length };
  } catch {
    return local;
  }
}

export async function lookupCardsInIndexByCollector(
  language: CardLanguageCode | "all",
  collectorNumber: string,
  printedTotal?: number,
  limit = 12,
) {
  if (!isDatabaseConfigured()) {
    return [] as TcgCard[];
  }

  const normalized = collectorNumber.replace(/^0+(?=\d)/, "") || collectorNumber;
  const numbers = [normalized, normalized.padStart(3, "0"), collectorNumber];
  const conditions = [inArray(cardsCatalog.collectorNumber, [...new Set(numbers)])];

  if (language !== "all") {
    conditions.push(eq(cardsCatalog.languageCode, language));
  }

  if (typeof printedTotal === "number" && Number.isFinite(printedTotal)) {
    conditions.push(eq(cardsCatalog.printedTotal, printedTotal));
  }

  try {
    const rows = await getDb()
      .select()
      .from(cardsCatalog)
      .where(and(...conditions))
      .orderBy(desc(cardsCatalog.releaseYear))
      .limit(limit);

    return physicalCatalogCards(rows.map(rowToCard));
  } catch {
    return [] as TcgCard[];
  }
}

const LOCAL_CARDS_INDEX_SQLITE_PATH = path.join(process.cwd(), "data", "pokemon-cards-index.sqlite");

type SqliteCardsIndex = InstanceType<typeof Database>;

const globalForCardsIndexSqlite = globalThis as unknown as {
  __pokedexCardsIndexSqlite?: SqliteCardsIndex | null;
};

type LocalCardsIndexRow = {
  slug: string;
  card_id: string;
  language_code: string;
  set_id: string;
  set_code: string;
  collector_number: string;
  printed_total: number | null;
  name: string;
  english_name: string | null;
  localized_name: string | null;
  rarity: string | null;
  supertype: string | null;
  image_url: string | null;
  search_text: string;
};

function getLocalCardsIndexSqlite(): SqliteCardsIndex | null {
  if (globalForCardsIndexSqlite.__pokedexCardsIndexSqlite !== undefined) {
    return globalForCardsIndexSqlite.__pokedexCardsIndexSqlite;
  }

  try {
    if (!fs.existsSync(LOCAL_CARDS_INDEX_SQLITE_PATH)) {
      globalForCardsIndexSqlite.__pokedexCardsIndexSqlite = null;
      return null;
    }

    globalForCardsIndexSqlite.__pokedexCardsIndexSqlite = new Database(LOCAL_CARDS_INDEX_SQLITE_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    return globalForCardsIndexSqlite.__pokedexCardsIndexSqlite;
  } catch {
    globalForCardsIndexSqlite.__pokedexCardsIndexSqlite = null;
    return null;
  }
}

function localIndexRowToCard(row: LocalCardsIndexRow): TcgCard {
  const language = (row.language_code || "en") as CardLanguageCode;
  const localizedName = row.localized_name ?? row.name;
  const englishName = row.english_name ?? row.name;
  const setEnglishName =
    getLocalizedSetMarketProfile(row.set_code)?.englishName ??
    getLocalizedSetMarketProfile(row.set_id)?.englishName ??
    row.set_code;
  const image = row.image_url?.trim() || "/icon.svg";

  return withDerivedEnglishPrintImage(
    attachFinishMarketsToCard(
    applyCanonicalJapaneseIdentityToCard({
      id: row.card_id,
      slug: row.slug,
      language,
      languageLabel: LANGUAGE_LABELS[language] ?? LANGUAGE_LABELS.en,
      name:
        language !== "en" && localizedName && englishName && localizedName !== englishName
          ? `${localizedName} (${englishName})`
          : row.name,
      localizedName,
      englishName,
      collectorNumber: row.collector_number,
      rarity: row.rarity ?? "Unknown",
      supertype: row.supertype ?? "Pokemon",
      hp: "-",
      types: [],
      setId: row.set_id,
      setCode: row.set_code,
      setName: setEnglishName,
      setLocalizedName: row.set_code,
      setEnglishName,
      setPrintedTotal: row.printed_total ?? undefined,
      setTotal: row.printed_total ?? undefined,
      image,
      artist: "Unknown",
      imageStatus: image !== "/icon.svg" ? "derived" : "placeholder",
      marketPriceUsd: 0,
      psaPopulation: {
        status: "pending",
        totalCertified: null,
        grades: [],
        source: "Local cards index",
        fetchedAt: null,
        note: "Card identity loaded from the local cards index while live catalogs refresh.",
      },
      portfolioDefaultQuantity: 1,
      priceHistory: [],
      gradedPrices: [],
      recentSales: [],
      sources: [
        {
          source: "Local cards index",
          status: "verified",
          fetchedAt: new Date().toISOString(),
          confidence: 0.7,
          note: "Card identity loaded from the local cards index while live catalogs refresh.",
        },
      ],
    }),
  ),
  );
}

function lookupLocalCardsIndexByName(
  nameQuery: string,
  language: CardLanguageCode | "all",
  limit: number,
): TcgCard[] {
  const db = getLocalCardsIndexSqlite();
  if (!db) {
    return [];
  }

  const parsed = parseCatalogQuery(nameQuery);
  const needle = parsed.text || normalizeCatalogText(nameQuery);
  if (needle.length < 2) {
    return [];
  }

  try {
    const like = `%${needle}%`;
    const rows = (
      language === "all"
        ? db
            .prepare(
              `SELECT * FROM cards_index
               WHERE search_text LIKE ? OR ifnull(english_name, '') LIKE ? OR ifnull(localized_name, '') LIKE ? OR name LIKE ?
               LIMIT ?`,
            )
            .all(like, like, like, like, limit)
        : db
            .prepare(
              `SELECT * FROM cards_index
               WHERE language_code = ?
                 AND (search_text LIKE ? OR ifnull(english_name, '') LIKE ? OR ifnull(localized_name, '') LIKE ? OR name LIKE ?)
               LIMIT ?`,
            )
            .all(language, like, like, like, like, limit)
    ) as LocalCardsIndexRow[];

    return physicalCatalogCards(rows.map(localIndexRowToCard));
  } catch {
    return [];
  }
}

function lookupLocalCardsIndexBySet(
  setFilter: string,
  language: CardLanguageCode | "all",
  limit: number,
  page: number,
): { cards: TcgCard[]; totalCount: number } {
  const db = getLocalCardsIndexSqlite();
  if (!db) {
    return { cards: [], totalCount: 0 };
  }

  const keys = [...new Set(expandCatalogSetFilterKeys(setFilter).map((key) => key.toLowerCase()))];
  if (!keys.length) {
    return { cards: [], totalCount: 0 };
  }

  try {
    const placeholders = keys.map(() => "?").join(",");
    const languageClause = language === "all" ? "" : " AND language_code = ?";
    const whereSql = `(lower(set_id) IN (${placeholders}) OR lower(set_code) IN (${placeholders}))${languageClause}`;
    const params = language === "all" ? [...keys, ...keys] : [...keys, ...keys, language];
    const offset = (Math.max(1, page) - 1) * limit;
    const countRow = db
      .prepare(`SELECT COUNT(*) as value FROM cards_index WHERE ${whereSql}`)
      .get(...params) as { value: number } | undefined;
    const orderedRows = db
      .prepare(
        `SELECT * FROM cards_index
         WHERE ${whereSql}
         ORDER BY collector_number
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as LocalCardsIndexRow[];

    return {
      cards: physicalCatalogCards(orderedRows.map(localIndexRowToCard)),
      totalCount: countRow?.value ?? orderedRows.length,
    };
  } catch {
    return { cards: [], totalCount: 0 };
  }
}

export async function lookupCardsInIndexByName(
  nameQuery: string,
  language: CardLanguageCode | "all" = "all",
  limit = 24,
): Promise<TcgCard[]> {
  return lookupLocalCardsIndexByName(nameQuery, language, limit);
}
