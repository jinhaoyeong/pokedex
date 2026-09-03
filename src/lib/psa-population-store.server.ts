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
  finish?: string;
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
    "v4-finish-separated-population",
    norm(identity.language || "en"),
    norm(identity.setCode),
    norm(identity.setName),
    norm(identity.cardName),
    norm(identity.cardNumber),
    norm(identity.officialCardId),
    norm(identity.priceChartingProductId),
    norm(identity.finish),
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

/**
 * A census write is off the response's critical path — it happens in after(),
 * or behind a resolver that has already answered — so it can wait longer than
 * the read cap allows. It has to: the pool is one connection on Vercel, and a
 * write issued while a page is mid-flight queues behind that page's reads.
 */
const POPULATION_WRITE_TIMEOUT_MS = 8_000;

/**
 * Upsert a snapshot. Best-effort: a failed write is dropped, never thrown.
 *
 * Written twice, under the caller's key AND under the same key with the set
 * code removed. Set codes are the one part of a card's identity this app does
 * not agree with itself about — the catalog calls Evolving Skies SWSH7 while
 * the row already in the store calls it evs — so a census filed under one
 * spelling was invisible to every reader holding the other. The set-code-free
 * key is the spelling every reader can reach: readers already try it as a
 * fallback candidate, and set NAME is still in the key, so nothing collides
 * that would not have collided anyway.
 */
export async function writeStoredPopulation(
  key: string,
  identity: PopulationIdentity,
  payload: StoredPopulationPayload,
): Promise<boolean> {
  const snapshot = payload.snapshot;
  const hasSignal =
    (snapshot.grades?.length ?? 0) > 0 || typeof snapshot.totalCertified === "number";
  const body = {
    snapshot,
    gradedPrices: payload.gradedPrices ?? [],
    sourceKind: payload.sourceKind ?? "item",
    matchScore: typeof payload.matchScore === "number" ? payload.matchScore : undefined,
  };
  const shared = {
    hasSignal,
    language: identity.language ?? "en",
    fetchedAt: snapshot.fetchedAt ?? null,
    timeoutMs: POPULATION_WRITE_TIMEOUT_MS,
  };

  const portableKey = identity.setCode
    ? buildPopulationKey({ ...identity, setCode: undefined })
    : null;

  const wrote = await writePopulationCacheEntry(key, "population_snapshot", body, {
    ...shared,
    setCode: identity.setCode ?? null,
  });

  if (portableKey && portableKey !== key) {
    await writePopulationCacheEntry(portableKey, "population_snapshot", body, {
      ...shared,
      setCode: null,
    });
  }

  return wrote;
}
