import "server-only";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { cardsCatalog } from "@/db/schema";
import { getDb, isDatabaseConfigured } from "@/db/client";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

type CardIndexRow = typeof cardsCatalog.$inferSelect;

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

  const normalizedQuery = nameQuery
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
  const setKeys = [
    setFilter.trim(),
    setFilter.trim().toUpperCase(),
    setFilter.trim().toLowerCase(),
  ];
  const conditions = [
    or(inArray(cardsCatalog.setId, setKeys), inArray(cardsCatalog.setCode, setKeys)),
    sql`${cardsCatalog.searchText} % ${normalizedQuery}`,
  ];

  if (language !== "all") {
    conditions.push(eq(cardsCatalog.languageCode, language));
  }

  try {
    const rows = await getDb()
      .select()
      .from(cardsCatalog)
      .where(and(...conditions))
      .orderBy(
        desc(
          sql<number>`greatest(
            similarity(${cardsCatalog.searchText}, ${normalizedQuery}),
            similarity(${cardsCatalog.name}, ${normalizedQuery}),
            similarity(coalesce(${cardsCatalog.englishName}, ''), ${normalizedQuery}),
            similarity(coalesce(${cardsCatalog.localizedName}, ''), ${normalizedQuery})
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
