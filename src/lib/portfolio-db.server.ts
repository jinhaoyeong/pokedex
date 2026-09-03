import { desc, eq, inArray, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { withAccountDbRetry } from "@/db/account-access.server";
import { getDb, isDatabaseConfigured } from "@/db/client";
import {
  portfolioItems,
  portfolioTransactions,
  priceSnapshots,
  users,
} from "@/db/schema";
import {
  isUsableMarketPriceUsd,
  normalizeMarketGrade,
} from "@/lib/market/pokedex-market-guide";
import { recordPokedexMarketObservation } from "@/lib/market/pokedex-market-guide.server";

/**
 * Server-side portfolio persistence (Supabase Postgres via Drizzle).
 *
 * Totals are computed dynamically on every read from the transaction ledger
 * and the latest price snapshots — nothing aggregated is ever stored.
 */

export type DbUser = typeof users.$inferSelect;

export type AddCardInput = {
  slug: string;
  name?: string;
  setName?: string;
  setCode?: string;
  collectorNumber?: string;
  language?: string;
  rarity?: string;
  releaseDate?: string;
  finish?: string;
  grade?: string;
  quantity?: number;
  pricePaidUsd?: number;
  marketPriceUsd?: number;
  imageUrl?: string;
};

export type PortfolioOverviewItem = {
  id: string;
  cardSlug: string;
  cardName: string | null;
  setName: string | null;
  grade: string;
  quantity: number;
  imageUrl: string | null;
  costBasisUsd: number;
  latestPriceUsd: number | null;
  marketValueUsd: number | null;
};

export type PortfolioOverview = {
  items: PortfolioOverviewItem[];
  totals: {
    totalQuantity: number;
    costBasisUsd: number;
    marketValueUsd: number;
    pricedQuantity: number;
    unrealizedGainUsd: number;
  };
};

export function isPortfolioBackendConfigured() {
  return (
    isDatabaseConfigured() &&
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY)
  );
}

function toMoney(value: number) {
  return value.toFixed(2);
}

function parseMoney(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/** Resolve the signed-in Clerk user to a row in our users table, creating it on first use. */
export async function ensureDbUser(): Promise<DbUser | null> {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return null;
  }

  return withAccountDbRetry(() => ensureDbUserOnce(clerkUserId));
}

async function ensureDbUserOnce(clerkUserId: string): Promise<DbUser | null> {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const profile = await currentUser().catch(() => null);

  const email =
    profile?.primaryEmailAddress?.emailAddress ??
    profile?.emailAddresses?.[0]?.emailAddress ??
    null;
  const displayName = profile?.fullName ?? profile?.username ?? null;

  const [created] = await db
    .insert(users)
    .values({
      clerkUserId,
      email,
      displayName,
    })
    .onConflictDoNothing({
      target: users.clerkUserId,
    })
    .returning();

  if (created) {
    return created;
  }

  const [updated] = await db
    .update(users)
    .set({
      email: sql`coalesce(${email}, ${users.email})`,
      displayName: sql`coalesce(${displayName}, ${users.displayName})`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.clerkUserId, clerkUserId))
    .returning();

  return updated ?? null;
}

/**
 * Add a card (by slug) to the user's portfolio: upserts the holding, records
 * a buy transaction, and optionally captures a price snapshot for history.
 */
export async function addCardToPortfolio(user: DbUser, input: AddCardInput) {
  const slug = input.slug.trim().toLowerCase();

  if (!slug) {
    throw new Error("A card slug is required.");
  }

  const quantity = input.quantity ?? 1;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
    throw new Error("Quantity must be a whole number of at least 1.");
  }

  for (const [label, value] of [
    ["Price paid", input.pricePaidUsd],
    ["Market price", input.marketPriceUsd],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${label} must be zero or a positive number.`);
    }
  }

  const grade = input.grade?.trim() || "Ungraded";
  const db = getDb();

  const [item] = await db
    .insert(portfolioItems)
    .values({
      userId: user.id,
      cardSlug: slug,
      cardName: input.name?.trim() || null,
      setName: input.setName?.trim() || null,
      language: input.language?.trim() || null,
      grade,
      quantity,
      imageUrl: input.imageUrl?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [portfolioItems.userId, portfolioItems.cardSlug, portfolioItems.grade],
      set: {
        quantity: sql`${portfolioItems.quantity} + ${quantity}`,
        cardName: sql`coalesce(excluded.card_name, ${portfolioItems.cardName})`,
        setName: sql`coalesce(excluded.set_name, ${portfolioItems.setName})`,
        imageUrl: sql`coalesce(excluded.image_url, ${portfolioItems.imageUrl})`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  await db.insert(portfolioTransactions).values({
    userId: user.id,
    portfolioItemId: item.id,
    type: "buy",
    quantity,
    pricePerUnitUsd:
      input.pricePaidUsd !== undefined ? toMoney(input.pricePaidUsd) : null,
  });

  if (input.marketPriceUsd !== undefined && input.marketPriceUsd > 0) {
    await db.insert(priceSnapshots).values({
      cardSlug: slug,
      grade,
      priceUsd: toMoney(input.marketPriceUsd),
      source: "user-capture",
    });
  }

  if (isUsableMarketPriceUsd(input.pricePaidUsd)) {
    await recordPokedexMarketObservation({
      slug,
      grade: normalizeMarketGrade(grade),
      priceUsd: input.pricePaidUsd,
      kind: "paid",
      contributorKey: `clerk:${user.clerkUserId}`,
      language: input.language,
      name: input.name,
      setCode: input.setCode,
      collectorNumber: input.collectorNumber,
      rarity: input.rarity,
      releaseDate: input.releaseDate,
      finish: input.finish,
      source: "pokedex-vault-paid",
    }).catch(() => false);
  }

  return item;
}

/** Compute the user's holdings with dynamic totals (never stored). */
export async function getPortfolioOverview(user: DbUser): Promise<PortfolioOverview> {
  return withAccountDbRetry(() => getPortfolioOverviewOnce(user));
}

async function getPortfolioOverviewOnce(user: DbUser): Promise<PortfolioOverview> {
  const db = getDb();

  const items = await db
    .select()
    .from(portfolioItems)
    .where(eq(portfolioItems.userId, user.id))
    .orderBy(desc(portfolioItems.updatedAt));

  // Net invested per holding from the transaction ledger (buys minus sells).
  const costRows = await db
    .select({
      portfolioItemId: portfolioTransactions.portfolioItemId,
      netCost: sql<string>`coalesce(sum(
        case
          when ${portfolioTransactions.type} = 'sell'
            then -(${portfolioTransactions.quantity} * coalesce(${portfolioTransactions.pricePerUnitUsd}, 0))
          else ${portfolioTransactions.quantity} * coalesce(${portfolioTransactions.pricePerUnitUsd}, 0)
        end
      ), 0)`,
    })
    .from(portfolioTransactions)
    .where(eq(portfolioTransactions.userId, user.id))
    .groupBy(portfolioTransactions.portfolioItemId);

  const costByItem = new Map(
    costRows.map((row) => [row.portfolioItemId, parseMoney(row.netCost) ?? 0]),
  );

  const slugs = [...new Set(items.map((item) => item.cardSlug))];

  const latestSnapshots =
    slugs.length > 0
      ? await db
          .selectDistinctOn([priceSnapshots.cardSlug, priceSnapshots.grade], {
            cardSlug: priceSnapshots.cardSlug,
            grade: priceSnapshots.grade,
            priceUsd: priceSnapshots.priceUsd,
          })
          .from(priceSnapshots)
          .where(inArray(priceSnapshots.cardSlug, slugs))
          .orderBy(
            priceSnapshots.cardSlug,
            priceSnapshots.grade,
            desc(priceSnapshots.capturedAt),
          )
      : [];

  const priceByKey = new Map(
    latestSnapshots.map((snapshot) => [
      `${snapshot.cardSlug}::${snapshot.grade}`,
      parseMoney(snapshot.priceUsd),
    ]),
  );

  const overviewItems: PortfolioOverviewItem[] = items.map((item) => {
    const latestPriceUsd =
      priceByKey.get(`${item.cardSlug}::${item.grade}`) ??
      priceByKey.get(`${item.cardSlug}::Ungraded`) ??
      null;

    return {
      id: item.id,
      cardSlug: item.cardSlug,
      cardName: item.cardName,
      setName: item.setName,
      grade: item.grade,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      costBasisUsd: costByItem.get(item.id) ?? 0,
      latestPriceUsd,
      marketValueUsd:
        latestPriceUsd === null ? null : latestPriceUsd * item.quantity,
    };
  });

  const totals = overviewItems.reduce(
    (acc, item) => {
      acc.totalQuantity += item.quantity;
      acc.costBasisUsd += item.costBasisUsd;

      if (item.marketValueUsd !== null) {
        acc.marketValueUsd += item.marketValueUsd;
        acc.pricedQuantity += item.quantity;
      }

      return acc;
    },
    {
      totalQuantity: 0,
      costBasisUsd: 0,
      marketValueUsd: 0,
      pricedQuantity: 0,
      unrealizedGainUsd: 0,
    },
  );

  totals.unrealizedGainUsd = totals.marketValueUsd - totals.costBasisUsd;

  return { items: overviewItems, totals };
}
