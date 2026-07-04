import "server-only";

/**
 * Tiny in-process TTL cache for fully-built API responses. Serves repeat
 * requests on a warm serverless instance in <15ms without re-running the
 * resolver pipeline. This sits in front of the slower file/disk caches and
 * behind the CDN edge cache (s-maxage), so all three layers stay consistent:
 * edge -> memory -> file cache -> live providers.
 */

type CacheEntry = { value: unknown; expiresAt: number };

const store = new Map<string, CacheEntry>();
const MAX_ENTRIES = 1_000;

export function readCachedResponse<T>(key: string): T | null {
  const entry = store.get(key);

  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  // Re-insert so eviction drops the least-recently-used key first.
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
}

export function writeCachedResponse(key: string, value: unknown, ttlMs: number) {
  if (ttlMs <= 0) {
    return;
  }

  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;

    if (oldest !== undefined) {
      store.delete(oldest);
    }
  }

  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
