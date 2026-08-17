import "server-only";

import { getDb, isDatabaseConfigured } from "./client";

/**
 * Best-effort database access for cache-style tables. The caches must never
 * break the runtime: when DATABASE_URL is unset, or Supabase errors, callers
 * get `null` (a cache miss / dropped write) and the resolver pipeline carries
 * on against the live providers. After a failure the database is skipped for
 * a cooldown so a hard outage doesn't add per-request connection timeouts.
 */

type Db = ReturnType<typeof getDb>;

const DB_RETRY_MS = 60_000;
// A cache read that hasn't answered in this window is treated as a miss. This
// hard-caps how much latency an unreachable/overloaded database can add to a
// hot path (search overlay, card detail) regardless of driver timeouts.
const OPERATION_TIMEOUT_MS = 2_500;

let unavailableAt = 0;

function operationTimeout(): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("cache-db operation timed out")),
      OPERATION_TIMEOUT_MS,
    );
    timer.unref?.();
  });
}

export async function withCacheDb<T>(runner: (db: Db) => Promise<T>): Promise<T | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (unavailableAt && Date.now() - unavailableAt < DB_RETRY_MS) {
    return null;
  }

  unavailableAt = 0;

  try {
    return await Promise.race([runner(getDb()), operationTimeout()]);
  } catch {
    unavailableAt = Date.now();
    return null;
  }
}
