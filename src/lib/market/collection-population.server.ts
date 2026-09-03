import "server-only";

import { eq, inArray } from "drizzle-orm";

import { withCacheDb } from "@/db/safe-db";
import { binderCards, portfolioItems, users } from "@/db/schema";
import { aggregateCollectionPopulation } from "@/lib/market/collection-population";
import type { MarketSourceStatus, PsaPopulationSnapshot } from "@/types/pokemon";

const CACHE_TTL_MS = 30_000;
const READ_BUDGET_MS = 650;
const memo = new Map<string, { expiresAt: number; snapshot: PsaPopulationSnapshot | null }>();

function identifiers(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim().toLowerCase()).filter(Boolean) as string[])];
}

export async function lookupCollectionPopulation(
  values: Array<string | null | undefined>,
): Promise<PsaPopulationSnapshot | null> {
  const ids = identifiers(values);
  if (!ids.length) return null;
  const key = ids.sort().join("|");
  const cached = memo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const read = withCacheDb(async (db) => {
    const [portfolio, binder] = await Promise.all([
      db
        .select({
          contributorKey: users.clerkUserId,
          grade: portfolioItems.grade,
          quantity: portfolioItems.quantity,
        })
        .from(portfolioItems)
        .innerJoin(users, eq(portfolioItems.userId, users.id))
        .where(inArray(portfolioItems.cardSlug, ids))
        .limit(10_000),
      db
        .select({
          contributorKey: binderCards.clerkId,
          grade: binderCards.notes,
          quantity: binderCards.quantity,
        })
        .from(binderCards)
        .where(inArray(binderCards.cardId, ids))
        .limit(10_000),
    ]);
    return [...portfolio, ...binder];
  });
  const rows = await Promise.race([
    read,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), READ_BUDGET_MS);
      timer.unref?.();
    }),
  ]);
  const aggregate = aggregateCollectionPopulation(rows ?? []);
  const now = new Date().toISOString();
  const snapshot: PsaPopulationSnapshot | null = aggregate
    ? {
        status: "verified",
        totalCertified: aggregate.total,
        grades: aggregate.grades.map((row) => ({
          ...row,
          service: row.grade.split(" ")[0] as "PSA" | "CGC" | "BGS" | "SGC" | "TAG",
          confidence: aggregate.holderCount >= 5 ? "medium" : "low",
          confidenceScore: aggregate.holderCount >= 5 ? 0.62 : 0.38,
          evidenceType: "population",
          warning: "Self-reported PokePokedex holdings; not an official grading-company census.",
        })),
        source: "PokePokedex collection census",
        fetchedAt: now,
        note: `${aggregate.total} graded ${aggregate.total === 1 ? "copy" : "copies"} reported by ${aggregate.holderCount} ${aggregate.holderCount === 1 ? "collector" : "collectors"}.`,
        confidence: aggregate.holderCount >= 5 ? "medium" : "low",
        confidenceScore: aggregate.holderCount >= 5 ? 0.62 : 0.38,
        evidenceType: "population",
        warning: "This is a first-party collection census, not PSA/CGC/BGS total cards graded.",
        populationKind: "collection",
        holderCount: aggregate.holderCount,
      }
    : null;
  memo.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, snapshot });
  return snapshot;
}

export async function applyCollectionPopulation<T extends {
  psaPopulation?: PsaPopulationSnapshot | null;
  population?: PsaPopulationSnapshot | null;
  sourceStatus?: MarketSourceStatus[];
  evidenceSummary?: { sourceStatus?: MarketSourceStatus[]; [key: string]: unknown };
}>(slice: T, values: Array<string | null | undefined>): Promise<T> {
  const current = slice.psaPopulation;
  const hasOfficial = Boolean(
    current &&
      current.populationKind !== "collection" &&
      (current.grades.length > 0 || (current.totalCertified ?? 0) > 0),
  );
  if (hasOfficial) return slice;
  const snapshot = await lookupCollectionPopulation(values);
  if (!snapshot) return slice;
  const status: MarketSourceStatus = {
    source: "PokePokedex collection census",
    state: "ready",
    confidence: snapshot.confidence ?? "low",
    confidenceScore: snapshot.confidenceScore ?? 0.38,
    fetchedAt: snapshot.fetchedAt ?? new Date().toISOString(),
    sampleCount: snapshot.holderCount,
    note: snapshot.note,
    warning: snapshot.warning,
  };
  const sourceStatus = [
    ...(slice.sourceStatus ?? []).filter((item) => item.source !== status.source),
    status,
  ];
  return {
    ...slice,
    psaPopulation: snapshot,
    population: snapshot,
    sourceStatus,
    evidenceSummary: slice.evidenceSummary
      ? { ...slice.evidenceSummary, sourceStatus }
      : slice.evidenceSummary,
  };
}
