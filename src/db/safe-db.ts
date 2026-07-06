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

let unavailableAt = 0;

export async function withCacheDb<T>(runner: (db: Db) => Promise<T>): Promise<T | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (unavailableAt && Date.now() - unavailableAt < DB_RETRY_MS) {
    return null;
  }

  unavailableAt = 0;

  try {
    return await runner(getDb());
  } catch {
    unavailableAt = Date.now();
    return null;
  }
}
