import "server-only";

import {
  readPopulationCacheEntry,
  writePopulationCacheEntry,
} from "@/lib/grading/population-cache.server";
import type { GradedPrice, PsaPopulationSnapshot } from "@/types/pokemon";

/**
 * Self-hosted graded-population store (Supabase Postgres).
 *
 * Population data changes slowly, but scraping it live (PriceCharting pop
 * pages) is slow and rate-limit-prone. This module persists parsed population
 * snapshots so the runtime can serve them with zero scraping on the hot path,
 * and only falls back to a live fetch on a cold miss / stale row.
 *
 * This replaces the old data/pokemon-psa-population.sqlite artifact, which was
 * ephemeral on serverless hosts. Access is best-effort via the shared cache-db
 * seam: database problems degrade to a miss / dropped write, never a crash.
 */

export type StoredPopulationPayload = {
  snapshot: PsaPopulationSnapshot;
  gradedPrices: Array<[string, GradedPrice]>;
  sourceKind: "item" | "set_index";
  matchScore?: number;
};

export type StoredPopulation = StoredPopulationPayload & {
  fetchedAt: string;
  ageMs: number;
};

export type PopulationIdentity = {
  setName: string;
  cardName: string;
  cardNumber: string;
  setCode?: string;
  language?: string;
  officialCardId?: string;
  priceChartingProductId?: string;
  identityVersion?: number;
};

/** Stable identity key — independent of price context so it's reused widely. */
export function buildPopulationKey(identity: PopulationIdentity): string {
  const norm = (value: string | undefined) =>
    (value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  return [
    "v3-native-japanese-attribution",
    norm(identity.language || "en"),
    norm(identity.setCode),
    norm(identity.setName),
    norm(identity.cardName),
    norm(identity.cardNumber),
    norm(identity.officialCardId),
    norm(identity.priceChartingProductId),
    typeof identity.identityVersion === "number"
      ? String(Math.max(1, Math.trunc(identity.identityVersion)))
      : "",
  ].join("|");
}

export function isPopulationFresh(fetchedAt: string | null, ttlMs: number): boolean {
  if (!fetchedAt) {
    return false;
  }
  const ts = Date.parse(fetchedAt);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts < ttlMs;
}

export async function readStoredPopulation(key: string): Promise<StoredPopulation | null> {
  const entry = await readPopulationCacheEntry<StoredPopulationPayload>(
    key,
    "population_snapshot",
  );

  if (!entry?.payload?.snapshot) {
    return null;
  }

  return {
    snapshot: entry.payload.snapshot,
    gradedPrices: Array.isArray(entry.payload.gradedPrices) ? entry.payload.gradedPrices : [],
    sourceKind: entry.payload.sourceKind === "set_index" ? "set_index" : "item",
    matchScore: typeof entry.payload.matchScore === "number" ? entry.payload.matchScore : undefined,
    fetchedAt: entry.fetchedAt,
    ageMs: entry.ageMs,
  };
}

/** Upsert a snapshot. Best-effort: a failed write is dropped, never thrown. */
export async function writeStoredPopulation(
  key: string,
  identity: PopulationIdentity,
  payload: StoredPopulationPayload,
): Promise<void> {
  const snapshot = payload.snapshot;
  const hasSignal =
    (snapshot.grades?.length ?? 0) > 0 || typeof snapshot.totalCertified === "number";

  await writePopulationCacheEntry(
    key,
    "population_snapshot",
    {
      snapshot,
      gradedPrices: payload.gradedPrices ?? [],
      sourceKind: payload.sourceKind ?? "item",
      matchScore: typeof payload.matchScore === "number" ? payload.matchScore : undefined,
    },
    {
      hasSignal,
      language: identity.language ?? "en",
      setCode: identity.setCode ?? null,
      fetchedAt: snapshot.fetchedAt ?? null,
    },
  );
}
