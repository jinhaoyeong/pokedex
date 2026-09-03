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

/**
 * A slow query is not an outage.
 *
 * The cooldown below exists so a genuinely unreachable database does not add a
 * connect timeout to every request. It was also being tripped by this
 * timeout — and those are different things. The client pool is one connection
 * on Vercel and three in dev, so a query issued while a page is mid-flight
 * queues behind that page's other reads and can lose a race the database
 * itself would win in 90ms. Treating that as "Supabase is down" took the
 * whole process off the database for a minute, which is how a card could have
 * a stored population census, ask for it, and still be told there was none.
 *
 * So the timeout is its own class of failure: this operation gives up, and
 * nothing else is punished for it. Connection and auth errors still trip the
 * cooldown, because those really do mean the next attempt is wasted.
 */
class CacheDbTimeout extends Error {
  constructor() {
    super("cache-db operation timed out");
    this.name = "CacheDbTimeout";
  }
}

function operationTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new CacheDbTimeout()), ms);
    timer.unref?.();
  });
}

export type CacheDbOptions = {
  /**
   * Override the default cap. Raise it ONLY for work that is already off a
   * response's critical path — a write in `after()`, a background refresh.
   *
   * It exists because the cap is not really about the database: Supabase
   * answers a single upsert in about 90ms, but the client pool is one
   * connection on Vercel and three in dev, so a write issued while a page is
   * mid-flight queues behind every read that page is making and loses the
   * race against a limit sized for reads. Population snapshots were being
   * fetched, parsed, and then silently dropped on exactly that.
   */
  timeoutMs?: number;
};

export async function withCacheDb<T>(
  runner: (db: Db) => Promise<T>,
  options: CacheDbOptions = {},
): Promise<T | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (unavailableAt && Date.now() - unavailableAt < DB_RETRY_MS) {
    return null;
  }

  unavailableAt = 0;

  try {
    return await Promise.race([
      runner(getDb()),
      operationTimeout(options.timeoutMs ?? OPERATION_TIMEOUT_MS),
    ]);
  } catch (error) {
    if (!(error instanceof CacheDbTimeout)) {
      unavailableAt = Date.now();
    }
    return null;
  }
}
