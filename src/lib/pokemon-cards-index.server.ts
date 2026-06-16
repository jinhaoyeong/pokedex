import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { LANGUAGE_LABELS } from "@/lib/search-constants";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

type CardIndexRow = {
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
  release_year: number | null;
  search_text: string;
};

let readDatabase: Database.Database | null = null;

function getDatabasePath() {
  return path.join(process.cwd(), "data", "pokemon-cards-index.sqlite");
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

function rowToCard(row: CardIndexRow): TcgCard {
  const language = row.language_code as CardLanguageCode;
  const localizedName = row.localized_name ?? row.name;
  const englishName = row.english_name ?? row.name;

  return {
    id: row.card_id,
    slug: row.slug,
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? LANGUAGE_LABELS.en,
    name:
      language !== "en" && localizedName
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
    setName: row.set_code,
    setLocalizedName: row.set_code,
    setEnglishName: row.set_code,
    setPrintedTotal: row.printed_total ?? undefined,
    setTotal: row.printed_total ?? undefined,
    image: row.image_url ?? "/icon.svg",
    artist: "Unknown",
    imageStatus: row.image_url ? "derived" : "placeholder",
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Local cards index",
      fetchedAt: null,
      note: "Card identity loaded from the local EN/JP cards index while live pricing refreshes.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [],
    gradedPrices: [{ grade: "Ungraded", value: 0, populationCount: 0 }],
    recentSales: [],
    sources: [
      {
        source: "Local cards index",
        status: "verified",
        fetchedAt: new Date().toISOString(),
        confidence: 0.72,
        note: "Pre-seeded catalog identity from English/Japanese set data (1998-2026).",
      },
    ],
  };
}

export function lookupCardInIndexBySlug(slug: string) {
  const db = getReadDatabase();

  if (!db) {
    return null;
  }

  try {
    const row = db
      .prepare(`SELECT * FROM cards_index WHERE slug = ?`)
      .get(slug) as CardIndexRow | undefined;

    return row ? rowToCard(row) : null;
  } catch {
    return null;
  }
}

export function lookupCardsInIndexByNameAndSet(
  nameQuery: string,
  setFilter: string,
  language: CardLanguageCode | "all" = "all",
  limit = 24,
) {
  const db = getReadDatabase();

  if (!db || !nameQuery.trim() || !setFilter.trim()) {
    return [] as TcgCard[];
  }

  const terms = nameQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!terms.length) {
    return [] as TcgCard[];
  }

  const setKeys = [
    setFilter.trim(),
    setFilter.trim().toUpperCase(),
    setFilter.trim().toLowerCase(),
  ];
  const languageClause = language === "all" ? "" : "AND language_code = ?";
  const params: Array<string | number> = [...setKeys, ...setKeys, ...terms.map((term) => `%${term}%`)];

  if (language !== "all") {
    params.push(language);
  }

  params.push(limit);

  const sql = `SELECT * FROM cards_index
    WHERE (set_id IN (?, ?, ?) OR set_code IN (?, ?, ?))
    ${languageClause}
    AND (${terms.map(() => "search_text LIKE ?").join(" AND ")})
    ORDER BY release_year DESC
    LIMIT ?`;

  try {
    const rows = db.prepare(sql).all(...params) as CardIndexRow[];
    return rows.map(rowToCard);
  } catch {
    return [] as TcgCard[];
  }
}

export function lookupCardsInIndexByCollector(
  language: CardLanguageCode | "all",
  collectorNumber: string,
  printedTotal?: number,
  limit = 12,
) {
  const db = getReadDatabase();

  if (!db) {
    return [] as TcgCard[];
  }

  const normalized = collectorNumber.replace(/^0+(?=\d)/, "") || collectorNumber;
  const languageClause = language === "all" ? "" : "AND language_code = ?";
  const params: Array<string | number> = [normalized, normalized.padStart(3, "0"), collectorNumber];

  if (language !== "all") {
    params.push(language);
  }

  let sql = `SELECT * FROM cards_index
    WHERE (collector_number = ? OR collector_number = ? OR collector_number = ?)
    ${languageClause}`;

  if (typeof printedTotal === "number" && Number.isFinite(printedTotal)) {
    sql += " AND printed_total = ?";
    params.push(printedTotal);
  }

  sql += " ORDER BY release_year DESC LIMIT ?";
  params.push(limit);

  try {
    const rows = db.prepare(sql).all(...params) as CardIndexRow[];
    return rows.map(rowToCard);
  } catch {
    return [] as TcgCard[];
  }
}

export function getCardsIndexStats() {
  const db = getReadDatabase();

  if (!db) {
    return null;
  }

  try {
    const total = db.prepare(`SELECT COUNT(*) AS count FROM cards_index`).get() as { count: number };
    const byLanguage = db
      .prepare(
        `SELECT language_code, COUNT(*) AS count
         FROM cards_index
         GROUP BY language_code`,
      )
      .all() as Array<{ language_code: string; count: number }>;

    return {
      total: total.count,
      byLanguage: Object.fromEntries(byLanguage.map((row) => [row.language_code, row.count])),
    };
  } catch {
    return null;
  }
}
