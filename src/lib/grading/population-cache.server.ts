import "server-only";

import { and, eq } from "drizzle-orm";

import { withCacheDb } from "@/db/safe-db";
import { apiPopulationCache } from "@/db/schema";

/**
 * Persistent grading/population cache (Supabase Postgres via Drizzle).
 *
 * Replaces the process-local market-result Map and the ephemeral
 * data/pokemon-psa-population.sqlite artifact so the 20-40s grading scrape is
 * paid once per card per TTL window — across every serverless instance.
 *
 * Smart TTL: rows carry `hasSignal`. Callers treat signal rows as fresh for
 * days (population moves slowly) and empty rows as short-lived negative cache
 * entries — a bot-walled scrape is not retried on every page view, but the
 * cache self-heals within hours.
 */

export const POPULATION_SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const POPULATION_EMPTY_TTL_MS = 2 * 60 * 60 * 1000;

export type PopulationCacheKind = "market_result" | "population_snapshot";

export type PopulationCacheEntry<T> = {
  payload: T;
  hasSignal: boolean;
  fetchedAt: string;
  ageMs: number;
};

/** TTL for an entry under the smart strategy: long when it has data, short when empty. */
export function populationCacheTtlMs(hasSignal: boolean): number {
  return hasSignal ? POPULATION_SUCCESS_TTL_MS : POPULATION_EMPTY_TTL_MS;
}

export function isPopulationCacheEntryFresh(entry: PopulationCacheEntry<unknown>): boolean {
  return entry.ageMs < populationCacheTtlMs(entry.hasSignal);
}

export async function readPopulationCacheEntry<T>(
  cacheKey: string,
  kind: PopulationCacheKind,
): Promise<PopulationCacheEntry<T> | null> {
  const clean = cacheKey.trim();

  if (!clean) {
    return null;
  }

  const rows = await withCacheDb((db) =>
    db
      .select()
      .from(apiPopulationCache)
      .where(and(eq(apiPopulationCache.cacheKey, clean), eq(apiPopulationCache.kind, kind)))
      .limit(1),
  );
  const row = rows?.[0];

  if (!row || row.gradingDataJson === null || row.gradingDataJson === undefined) {
    return null;
  }

  const fetchedAt = row.fetchedAt.toISOString();

  return {
    payload: row.gradingDataJson as T,
    hasSignal: row.hasSignal,
    fetchedAt,
    ageMs: Math.max(0, Date.now() - row.fetchedAt.getTime()),
  };
}

/** Upsert an entry. Best-effort: returns false when the database is unavailable. */
export async function writePopulationCacheEntry(
  cacheKey: string,
  kind: PopulationCacheKind,
  payload: unknown,
  options: {
    hasSignal: boolean;
    language?: string | null;
    setCode?: string | null;
    fetchedAt?: string | null;
  },
): Promise<boolean> {
  const clean = cacheKey.trim();

  if (!clean) {
    return false;
  }

  const now = new Date();
  const fetchedAtTs = Date.parse(options.fetchedAt ?? "");
  const values = {
    cacheKey: clean,
    kind,
    language: options.language ?? null,
    setCode: options.setCode ?? null,
    hasSignal: options.hasSignal,
    gradingDataJson: payload,
    fetchedAt: Number.isFinite(fetchedAtTs) ? new Date(fetchedAtTs) : now,
    updatedAt: now,
  };

  const written = await withCacheDb(async (db) => {
    await db
      .insert(apiPopulationCache)
      .values(values)
      .onConflictDoUpdate({
        target: apiPopulationCache.cacheKey,
        set: {
          kind: values.kind,
          language: values.language,
          setCode: values.setCode,
          hasSignal: values.hasSignal,
          gradingDataJson: values.gradingDataJson,
          fetchedAt: values.fetchedAt,
          updatedAt: values.updatedAt,
        },
      });

    return true;
  });

  return written === true;
}
