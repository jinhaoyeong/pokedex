import "server-only";

import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { cardCorrections, cardLearningCache, cardsCatalog, queryCardHits } from "@/db/schema";
import {
  appendLearningSource,
  computeTrustScore,
  deriveIdentityStatus,
  derivePriceStatus,
  isCacheStale,
  type FieldTrustStatus,
} from "@/lib/card-confidence";
import type { ParsedCardFeedback } from "@/lib/feedback-parser";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

type CollectorLookup = {
  number: string;
  printedTotal?: number;
};

export type CachedCardMeta = {
  slug: string;
  searchHits: number;
  detailViews: number;
  wrongPriceFlags: number;
  wrongCardFlags: number;
  trustScore: number;
  identityStatus: FieldTrustStatus;
  priceStatus: FieldTrustStatus;
  lastEnrichedAt: string | null;
  lastSearchedAt: string;
  needsRefresh: boolean;
};

type CachedCardRow = typeof cardLearningCache.$inferSelect;

function normalizeCollectorNumber(value: string) {
  return value.replace(/^0+(?=\d)/, "") || value;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchBlob(card: TcgCard) {
  return normalizeSearchText(
    [
      card.name,
      card.localizedName,
      card.englishName,
      card.setName,
      card.setLocalizedName,
      card.setEnglishName,
      card.setCode,
      card.collectorNumber,
      card.rarity,
      card.supertype,
      ...(card.types ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function rowToCard(row: CachedCardRow): TcgCard | null {
  const card = row.cardJson as TcgCard | null;
  return card?.slug ? card : null;
}

function catalogRowToCard(row: typeof cardsCatalog.$inferSelect): TcgCard | null {
  const card = row.cardJson as TcgCard | null;
  return card?.slug ? card : null;
}

function rowToMeta(row: CachedCardRow): CachedCardMeta {
  const identityStatus = (row.identityStatus ?? "estimated") as FieldTrustStatus;
  const priceStatus = (row.priceStatus ?? "estimated") as FieldTrustStatus;
  const lastEnrichedAt = row.enrichedAt?.toISOString() ?? null;
  const lastSearchedAt = row.lastSearchedAt.toISOString();
  const trustScore = Number(row.trustScore ?? 0.5);

  return {
    slug: row.slug,
    searchHits: row.searchHits ?? row.hitCount ?? 0,
    detailViews: row.detailViews ?? 0,
    wrongPriceFlags: row.wrongPriceFlags ?? 0,
    wrongCardFlags: row.wrongCardFlags ?? 0,
    trustScore,
    identityStatus,
    priceStatus,
    lastEnrichedAt,
    lastSearchedAt,
    needsRefresh:
      isCacheStale(lastEnrichedAt ?? lastSearchedAt) ||
      (row.wrongPriceFlags ?? 0) > 0 ||
      (row.wrongCardFlags ?? 0) > 0,
  };
}

function annotateCardWithMeta(card: TcgCard, meta: CachedCardMeta): TcgCard {
  const disputed = meta.wrongPriceFlags > 0 || meta.wrongCardFlags > 0;
  const priceStatus = disputed ? "disputed" : meta.priceStatus;

  return {
    ...card,
    sources: appendLearningSource(
      card.sources,
      meta.needsRefresh
        ? `Learned from ${meta.searchHits + meta.detailViews} prior lookups. Price data is stale and refreshing in the background.`
        : `Learned from ${meta.searchHits + meta.detailViews} prior lookups with trust score ${Math.round(meta.trustScore * 100)}%.`,
      priceStatus === "disputed" ? "disputed" : meta.needsRefresh ? "stale" : meta.identityStatus,
      meta.trustScore,
    ),
  };
}

function scoreCardForQuery(
  card: TcgCard,
  query: string,
  meta: CachedCardMeta,
  queryAffinity = 0,
) {
  const normalizedQuery = normalizeSearchText(query);
  const haystack = buildSearchBlob(card);
  let score = meta.trustScore * 100 + queryAffinity * 15;

  if (normalizedQuery && haystack.includes(normalizedQuery)) {
    score += 50;
  }

  for (const token of normalizedQuery.split(" ").filter(Boolean)) {
    if (haystack.includes(token)) {
      score += 10;
    }
  }

  score += Math.min(25, meta.searchHits * 2);
  score -= Math.min(30, meta.wrongPriceFlags * 6 + meta.wrongCardFlags * 12);
  return score;
}

function catalogValuesFromCard(card: TcgCard) {
  return {
    slug: card.slug,
    cardId: card.id,
    languageCode: card.language,
    setId: card.setId ?? card.setCode ?? "",
    setCode: card.setCode ?? card.setId ?? "",
    collectorNumber: card.collectorNumber ?? "",
    printedTotal: card.setPrintedTotal ?? card.setTotal ?? null,
    name: card.name ?? card.englishName ?? card.localizedName ?? card.slug,
    englishName: card.englishName ?? null,
    localizedName: card.localizedName ?? null,
    rarity: card.rarity ?? null,
    supertype: card.supertype ?? null,
    imageUrl: card.image ?? null,
    releaseYear: null,
    searchText: buildSearchBlob(card),
    marketPriceUsd: card.marketPriceUsd > 0 ? card.marketPriceUsd.toFixed(2) : null,
    cardJson: card,
    updatedAt: new Date(),
  };
}

async function recordQueryHit(query: string, slug: string) {
  const queryNormalized = normalizeSearchText(query);

  if (!queryNormalized || queryNormalized.length < 2 || !isDatabaseConfigured()) {
    return;
  }

  const now = new Date();

  await getDb()
    .insert(queryCardHits)
    .values({ queryNormalized, slug, hitCount: 1, lastHitAt: now })
    .onConflictDoUpdate({
      target: [queryCardHits.queryNormalized, queryCardHits.slug],
      set: {
        hitCount: sql`${queryCardHits.hitCount} + 1`,
        lastHitAt: now,
      },
    });
}

async function upsertCardRow(
  card: TcgCard,
  query: string,
  context: "search" | "detail" | "refresh",
) {
  const now = new Date();
  const cleanQuery = query.trim().slice(0, 256) || null;
  const searchBlob = buildSearchBlob(card);
  const identityStatus = deriveIdentityStatus(card);
  const priceStatus = derivePriceStatus(card, now.toISOString());
  const [existing] = await getDb()
    .select()
    .from(cardLearningCache)
    .where(eq(cardLearningCache.slug, card.slug))
    .limit(1);

  const searchHits = (existing?.searchHits ?? 0) + (context === "search" ? 1 : 0);
  const detailViews = (existing?.detailViews ?? 0) + (context === "detail" ? 1 : 0);
  const trustScore = computeTrustScore({
    searchHits,
    detailViews,
    wrongPriceFlags: existing?.wrongPriceFlags ?? 0,
    wrongCardFlags: existing?.wrongCardFlags ?? 0,
    identityStatus,
    priceStatus,
  }).toFixed(4);

  await getDb()
    .insert(cardLearningCache)
    .values({
      slug: card.slug,
      languageCode: card.language,
      collectorNumber: card.collectorNumber || null,
      printedTotal: card.setPrintedTotal ?? card.setTotal ?? null,
      cardJson: card,
      queryText: cleanQuery,
      searchBlob,
      hitCount: 1,
      lastSearchedAt: now,
      enrichedAt: now,
      identityStatus,
      priceStatus,
      trustScore,
      searchHits,
      detailViews,
      wrongPriceFlags: existing?.wrongPriceFlags ?? 0,
      wrongCardFlags: existing?.wrongCardFlags ?? 0,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cardLearningCache.slug,
      set: {
        cardJson: card,
        queryText: cleanQuery ?? existing?.queryText ?? null,
        searchBlob,
        hitCount: sql`${cardLearningCache.hitCount} + 1`,
        lastSearchedAt: now,
        enrichedAt: now,
        identityStatus,
        priceStatus,
        trustScore,
        searchHits,
        detailViews,
        wrongPriceFlags: existing?.wrongPriceFlags ?? 0,
        wrongCardFlags: existing?.wrongCardFlags ?? 0,
        updatedAt: now,
      },
    });

  await getDb()
    .insert(cardsCatalog)
    .values(catalogValuesFromCard(card))
    .onConflictDoUpdate({
      target: cardsCatalog.slug,
      set: catalogValuesFromCard(card),
    });

  if (cleanQuery && context === "search") {
    await recordQueryHit(cleanQuery, card.slug);
  }
}

export async function importSeedDataIfNeeded() {
  // Supabase seeding is handled by scripts/seed-supabase-catalog.mjs.
}

export async function lookupCachedCardBySlug(slug: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const [row] = await getDb()
      .select()
      .from(cardLearningCache)
      .where(eq(cardLearningCache.slug, slug))
      .limit(1);

    if (!row) {
      return null;
    }

    const card = rowToCard(row);
    if (!card) {
      return null;
    }

    const meta = rowToMeta(row);
    return { card: annotateCardWithMeta(card, meta), meta };
  } catch {
    return null;
  }
}

export async function lookupCachedCardsByCollectorCode(
  language: CardLanguageCode | "all",
  collectorCode: CollectorLookup,
): Promise<TcgCard[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const normalizedNumber = normalizeCollectorNumber(collectorCode.number);
  const numbers = [...new Set([normalizedNumber, normalizedNumber.padStart(3, "0"), collectorCode.number])];
  const conditions = [
    inArray(cardLearningCache.collectorNumber, numbers),
    collectorCode.printedTotal
      ? eq(cardLearningCache.printedTotal, collectorCode.printedTotal)
      : undefined,
  ].filter(Boolean);

  try {
    const rows = await getDb()
      .select()
      .from(cardLearningCache)
      .where(and(...conditions))
      .orderBy(desc(cardLearningCache.trustScore), desc(cardLearningCache.hitCount))
      .limit(24);
    const seen = new Set<string>();

    return rows
      .filter((row) => language === "all" || row.languageCode === language)
      .map((row) => {
        const card = rowToCard(row);
        return card ? annotateCardWithMeta(card, rowToMeta(row)) : null;
      })
      .filter((card): card is TcgCard => {
        if (!card || seen.has(card.slug)) {
          return false;
        }

        seen.add(card.slug);
        return true;
      });
  } catch {
    return [];
  }
}

export async function lookupCachedCardsByQuery(
  query: string,
  language: CardLanguageCode | "all",
  limit = 12,
): Promise<Array<{ card: TcgCard; score: number; meta: CachedCardMeta }>> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length < 2) {
    return [];
  }

  try {
    const affinityRows = await getDb()
      .select({
        slug: queryCardHits.slug,
        hitCount: queryCardHits.hitCount,
      })
      .from(queryCardHits)
      .where(eq(queryCardHits.queryNormalized, normalizedQuery))
      .orderBy(desc(queryCardHits.hitCount))
      .limit(limit * 3);
    const affinityBySlug = new Map(affinityRows.map((row) => [row.slug, row.hitCount]));

    const languageCondition =
      language === "all" ? undefined : eq(cardLearningCache.languageCode, language);
    const trigramRows = await getDb()
      .select()
      .from(cardLearningCache)
      .where(
        and(
          sql`${cardLearningCache.searchBlob} % ${normalizedQuery}`,
          languageCondition,
        ),
      )
      .orderBy(
        desc(sql<number>`similarity(coalesce(${cardLearningCache.searchBlob}, ''), ${normalizedQuery})`),
        desc(cardLearningCache.trustScore),
        desc(cardLearningCache.hitCount),
      )
      .limit(limit * 4);

    const uniqueSlugs = [
      ...new Set([...affinityRows.map((row) => row.slug), ...trigramRows.map((row) => row.slug)]),
    ].slice(0, limit * 4);

    if (!uniqueSlugs.length) {
      return [];
    }

    const rows = await getDb()
      .select()
      .from(cardLearningCache)
      .where(inArray(cardLearningCache.slug, uniqueSlugs));

    return rows
      .map((row) => {
        const card = rowToCard(row);
        if (!card || (language !== "all" && row.languageCode !== language)) {
          return null;
        }

        const meta = rowToMeta(row);
        const score = scoreCardForQuery(card, query, meta, affinityBySlug.get(row.slug) ?? 0);

        if (score < 40) {
          return null;
        }

        return {
          card: annotateCardWithMeta(card, meta),
          score,
          meta,
        };
      })
      .filter((item): item is { card: TcgCard; score: number; meta: CachedCardMeta } => Boolean(item))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function lookupCatalogCardsByFuzzyQuery(
  query: string,
  language: CardLanguageCode | "all",
  limit = 24,
): Promise<TcgCard[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length < 2) {
    return [];
  }

  try {
    const languageCondition =
      language === "all" ? undefined : eq(cardsCatalog.languageCode, language);
    const rows = await getDb()
      .select()
      .from(cardsCatalog)
      .where(
        and(
          ilike(cardsCatalog.searchText, `%${normalizedQuery}%`),
          languageCondition,
        ),
      )
      .orderBy(desc(cardsCatalog.marketPriceUsd), desc(cardsCatalog.updatedAt))
      .limit(limit);
    const seen = new Set<string>();

    return rows
      .map(catalogRowToCard)
      .filter((card): card is TcgCard => {
        if (!card || seen.has(card.slug)) {
          return false;
        }

        seen.add(card.slug);
        return true;
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const causeMessage =
      error && typeof error === "object" && "cause" in error && error.cause instanceof Error
        ? error.cause.message
        : "";
    const expected =
      message.toLowerCase().includes("circuitbreaker") ||
      causeMessage.toLowerCase().includes("circuitbreaker") ||
      causeMessage.toLowerCase().includes("too many failed attempts");

    if (expected) {
      console.warn(`[search] cards_catalog fuzzy fallback skipped: ${causeMessage || message}`);
    } else {
      console.error("cards_catalog fuzzy fallback failed", {
        query,
        language,
        error,
      });
    }
    return [];
  }
}

export async function persistCard(
  card: TcgCard,
  options: { query?: string; context?: "search" | "detail" | "refresh" } = {},
) {
  if (!card.slug?.trim() || !card.id?.trim() || !isDatabaseConfigured()) {
    return;
  }

  try {
    await upsertCardRow(card, options.query ?? "", options.context ?? "detail");
  } catch {
    return;
  }

  void import("./card-cache-sync.server").then(({ syncCardToRemoteCache }) =>
    syncCardToRemoteCache(card).catch(() => undefined),
  );
}

export async function persistSearchResultCards(cards: TcgCard[], query = "") {
  await Promise.all(cards.map((card) => persistCard(card, { query, context: "search" })));
}

export async function recordCardCorrection(input: {
  slug: string;
  field: "price" | "identity";
  issueType?: string;
  reportedValue?: string;
  note?: string;
  parsed?: ParsedCardFeedback;
}) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const now = new Date();
  const trustPenalty =
    input.parsed?.confidence === "high" ? 0.08 : input.parsed?.confidence === "medium" ? 0.06 : 0.04;

  try {
    await getDb()
      .insert(cardCorrections)
      .values({
        slug: input.slug,
        field: input.field,
        reportedValue: input.reportedValue ?? null,
        note: input.note ?? null,
        correctionType: input.issueType ?? input.parsed?.issueType ?? null,
        parsedJson: input.parsed ?? null,
        confidence: input.parsed?.confidence ?? null,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [
          cardCorrections.slug,
          cardCorrections.field,
          cardCorrections.reportedValue,
          cardCorrections.correctionType,
          cardCorrections.createdAt,
        ],
      });

    if (input.field === "price") {
      await getDb()
        .update(cardLearningCache)
        .set({
          wrongPriceFlags: sql`${cardLearningCache.wrongPriceFlags} + 1`,
          priceStatus: "disputed",
          trustScore: sql`greatest(0.0500, coalesce(${cardLearningCache.trustScore}, 0.5000) - ${trustPenalty})`,
          updatedAt: now,
        })
        .where(eq(cardLearningCache.slug, input.slug));
    } else {
      await getDb()
        .update(cardLearningCache)
        .set({
          wrongCardFlags: sql`${cardLearningCache.wrongCardFlags} + 1`,
          identityStatus: "disputed",
          trustScore: sql`greatest(0.0500, coalesce(${cardLearningCache.trustScore}, 0.5000) - ${trustPenalty})`,
          updatedAt: now,
        })
        .where(eq(cardLearningCache.slug, input.slug));
    }
  } catch {
    // User feedback is best effort; the UI should not fail if the cache is offline.
  }
}

export async function listCardCorrections(slug: string, limit = 20) {
  if (!isDatabaseConfigured()) {
    return [];
  }

  try {
    return await getDb()
      .select({
        id: cardCorrections.id,
        slug: cardCorrections.slug,
        field: cardCorrections.field,
        reported_value: cardCorrections.reportedValue,
        note: cardCorrections.note,
        created_at: cardCorrections.createdAt,
      })
      .from(cardCorrections)
      .where(eq(cardCorrections.slug, slug))
      .orderBy(desc(cardCorrections.createdAt))
      .limit(limit);
  } catch {
    return [];
  }
}

export async function listCardsNeedingRefresh(limit = 20) {
  if (!isDatabaseConfigured()) {
    return [] as string[];
  }

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await getDb()
      .select({ slug: cardLearningCache.slug })
      .from(cardLearningCache)
      .where(
        or(
          sql`${cardLearningCache.wrongPriceFlags} > 0`,
          sql`${cardLearningCache.wrongCardFlags} > 0`,
          isNull(cardLearningCache.enrichedAt),
          lt(cardLearningCache.enrichedAt, cutoff),
        ),
      )
      .orderBy(
        desc(sql<number>`${cardLearningCache.wrongPriceFlags} + ${cardLearningCache.wrongCardFlags}`),
        desc(cardLearningCache.hitCount),
      )
      .limit(limit);

    return rows.map((row) => row.slug);
  } catch {
    return [] as string[];
  }
}

export function shouldRefreshCachedCard(meta: CachedCardMeta | null | undefined) {
  return Boolean(meta?.needsRefresh);
}
