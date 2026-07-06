import "server-only";

import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import { cardsCatalog } from "@/db/schema";
import { getDb, isDatabaseConfigured } from "@/db/client";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

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

  return {
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
  };
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

    return row ? rowToCard(row) : null;
  } catch {
    return null;
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

  const parsed = parseCatalogQuery(nameQuery);

  if (!parsed.text && !parsed.collectorVariants.length) {
    return [] as TcgCard[];
  }

  const setKeys = [
    setFilter.trim(),
    setFilter.trim().toUpperCase(),
    setFilter.trim().toLowerCase(),
  ];
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

    return rows.map(rowToCard);
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
  if (!isDatabaseConfigured() || !setFilter.trim()) {
    return { cards: [], totalCount: 0 };
  }

  const setKeys = [
    setFilter.trim(),
    setFilter.trim().toUpperCase(),
    setFilter.trim().toLowerCase(),
  ];
  const conditions = [
    or(inArray(cardsCatalog.setId, setKeys), inArray(cardsCatalog.setCode, setKeys)),
  ];

  if (language !== "all") {
    conditions.push(eq(cardsCatalog.languageCode, language));
  }

  const where = and(...conditions);
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

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

    return { cards: rows.map(rowToCard), totalCount: total?.value ?? rows.length };
  } catch {
    return { cards: [], totalCount: 0 };
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

    return rows.map(rowToCard);
  } catch {
    return [] as TcgCard[];
  }
}
