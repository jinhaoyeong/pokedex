import "server-only";

import { getCache, waitUntil } from "@vercel/functions";

import { setBrowseHitKey } from "@/lib/warm-search-plan";

const HITS_KEY = "dex:set-browse-hits";
const HITS_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SHARED_SEARCH_TTL_SECONDS = 60 * 60;

const localStore = new Map<string, { value: unknown; expiresAt: number }>();

function getRuntimeCache() {
  try {
    return getCache({ namespace: "pokedex-dex" });
  } catch {
    return null;
  }
}

export function continueAfterResponse(work: Promise<unknown>) {
  void work.catch(() => undefined);

  try {
    waitUntil(work);
  } catch {
    // Local Node and tests keep the fire-and-forget promise above.
  }
}

export async function readRuntimeCache<T>(key: string): Promise<T | null> {
  try {
    const cache = getRuntimeCache();
    const value = cache ? await cache.get(key) : null;
    if (value !== undefined && value !== null) {
      return value as T;
    }
  } catch {
    // Runtime Cache only exists on Vercel; fall through to process memory.
  }

  const local = localStore.get(key);
  if (!local || local.expiresAt <= Date.now()) {
    if (local) {
      localStore.delete(key);
    }
    return null;
  }

  return local.value as T;
}

export async function writeRuntimeCache(
  key: string,
  value: unknown,
  ttlSeconds = SHARED_SEARCH_TTL_SECONDS,
) {
  localStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  try {
    const cache = getRuntimeCache();
    if (!cache) {
      return;
    }

    await cache.set(key, value, {
      ttl: ttlSeconds,
      tags: ["dex-search"],
      name: "dex-search",
    });
  } catch {
    // Best effort: memory fallback still holds this instance.
  }
}

export async function recordSetBrowseHit(
  setFilter: string | undefined,
  language: string,
  sort: string,
) {
  const setId = setFilter?.trim().toLowerCase();
  if (!setId) {
    return;
  }

  const hitKey = setBrowseHitKey(setId, language, sort);
  const hits = (await readRuntimeCache<Record<string, number>>(HITS_KEY)) ?? {};
  hits[hitKey] = (hits[hitKey] ?? 0) + 1;
  await writeRuntimeCache(HITS_KEY, hits, HITS_TTL_SECONDS);
}

export async function readSetBrowseHits(): Promise<Record<string, number>> {
  return (await readRuntimeCache<Record<string, number>>(HITS_KEY)) ?? {};
}
