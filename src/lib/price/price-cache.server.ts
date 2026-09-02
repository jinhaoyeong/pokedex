import "server-only";

import { inArray } from "drizzle-orm";

import { withCacheDb } from "@/db/safe-db";
import { apiPriceCache } from "@/db/schema";

import { isPricedResolvedPrice } from "./priced-payload";
import { sanitizeResolvedPrice } from "./sanity";
import type { ProviderPriceResult, ResolvedPrice } from "./types";

/**
 * Persistent price cache (Supabase Postgres via Drizzle). The request path
 * reads a card's price from HERE first so a page view never triggers an
 * external fetch (let alone a scrape burst). Misses are filled out-of-band by
 * the background warmer / per-view refresh queue.
 *
 * This replaces the old data/pokemon-prices-cache.sqlite artifact, which was
 * ephemeral on serverless hosts and therefore always empty in production.
 * Access stays best-effort: any database problem degrades to a cache miss /
 * dropped write so the runtime never breaks because of this store.
 */

type PriceCacheRow = typeof apiPriceCache.$inferSelect;

type MemoryPriceEntry = {
  resolved: ResolvedPrice;
  savedAt: number;
};

const globalRuntime = globalThis as typeof globalThis & {
  __pokedexPriceMemoryCache?: Map<string, MemoryPriceEntry>;
};
const memoryPriceCache =
  globalRuntime.__pokedexPriceMemoryCache ??
  (globalRuntime.__pokedexPriceMemoryCache = new Map());
const MEMORY_PRICE_TTL_MS = 24 * 60 * 60 * 1000;

function readMemoryPrice(slug: string, ttlMs?: number): ResolvedPrice | null {
  const entry = memoryPriceCache.get(slug.toLowerCase());
  if (!entry) {
    return null;
  }

  const ttl = ttlMs ?? MEMORY_PRICE_TTL_MS;
  if (Date.now() - entry.savedAt > ttl) {
    memoryPriceCache.delete(slug.toLowerCase());
    return null;
  }

  return { ...entry.resolved, slug: entry.resolved.slug };
}

function writeMemoryPrice(resolved: ResolvedPrice) {
  const slug = resolved.slug?.trim();
  if (!slug) {
    return;
  }

  memoryPriceCache.set(slug.toLowerCase(), {
    resolved: { ...resolved, slug },
    savedAt: Date.now(),
  });
}

function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value ?? "";
}

export function isPriceFresh(fetchedAt: string | null, ttlMs: number): boolean {
  if (!fetchedAt) {
    return false;
  }
  const ts = Date.parse(fetchedAt);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts < ttlMs;
}

function rowToResolvedPrice(row: PriceCacheRow): ResolvedPrice {
  const results = Array.isArray(row.resultsJson)
    ? (row.resultsJson as ProviderPriceResult[])
    : [];

  return sanitizeResolvedPrice({
    slug: row.cardSlug,
    ungradedUsd: Number(row.ungradedUsd ?? 0) || 0,
    confidenceScore: Number(row.confidenceScore ?? 0) || 0,
    primaryProvider: row.primaryProvider ?? "",
    results,
    fetchedAt: toIsoString(row.fetchedAt),
  });
}

function dedupeSlugs(slugs: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const slug of slugs) {
    const clean = slug.trim();

    if (!clean || seen.has(clean.toLowerCase())) {
      continue;
    }

    seen.add(clean.toLowerCase());
    cleaned.push(clean);
  }

  return cleaned;
}

/** Read a cached price for a slug. Pass `ttlMs` to reject stale rows. */
export async function readCachedPrice(
  slug: string,
  ttlMs?: number,
): Promise<ResolvedPrice | null> {
  return readCachedPriceBySlugs([slug], ttlMs, { requirePriced: false });
}

/**
 * One IN query for many slugs. Used by the Dex price-sort batch so a 24-card
 * page does not issue 24 round-trips.
 */
export async function readCachedPriceMap(
  slugs: string[],
  ttlMs?: number,
): Promise<Map<string, ResolvedPrice>> {
  const requirePriced = true;
  const cleaned = dedupeSlugs(slugs);
  const result = new Map<string, ResolvedPrice>();

  if (!cleaned.length) {
    return result;
  }

  const missing: string[] = [];

  for (const slug of cleaned) {
    const memoryHit = readMemoryPrice(slug, ttlMs);
    if (memoryHit && (!requirePriced || isPricedResolvedPrice(memoryHit))) {
      result.set(slug.toLowerCase(), { ...memoryHit, slug });
    } else {
      missing.push(slug);
    }
  }

  if (!missing.length) {
    return result;
  }

  const rows = await withCacheDb((db) =>
    db.select().from(apiPriceCache).where(inArray(apiPriceCache.cardSlug, missing)),
  );

  for (const row of rows ?? []) {
    if (typeof ttlMs === "number" && !isPriceFresh(toIsoString(row.fetchedAt), ttlMs)) {
      continue;
    }

    const resolved = rowToResolvedPrice(row);
    if (!isPricedResolvedPrice(resolved)) {
      continue;
    }

    writeMemoryPrice(resolved);
    result.set(row.cardSlug.toLowerCase(), resolved);
  }

  return result;
}

/**
 * Read the first cached, priced result among the given slugs (a Japanese card
 * can be cached under several identity aliases). One round-trip: all aliases
 * are fetched in a single IN query and the earliest alias in the caller's
 * preference order wins.
 */
export async function readCachedPriceBySlugs(
  slugs: string[],
  ttlMs?: number,
  options: { requirePriced?: boolean } = {},
): Promise<ResolvedPrice | null> {
  const requirePriced = options.requirePriced ?? true;
  const cleaned = dedupeSlugs(slugs);

  if (!cleaned.length) {
    return null;
  }

  for (const slug of cleaned) {
    const memoryHit = readMemoryPrice(slug, ttlMs);
    if (!memoryHit) {
      continue;
    }
    if (!requirePriced || isPricedResolvedPrice(memoryHit)) {
      return { ...memoryHit, slug };
    }
  }

  const rows = await withCacheDb((db) =>
    db.select().from(apiPriceCache).where(inArray(apiPriceCache.cardSlug, cleaned)),
  );

  if (!rows?.length) {
    return null;
  }

  const bySlug = new Map(rows.map((row) => [row.cardSlug.toLowerCase(), row]));

  for (const slug of cleaned) {
    const row = bySlug.get(slug.toLowerCase());

    if (!row) {
      continue;
    }

    if (typeof ttlMs === "number" && !isPriceFresh(toIsoString(row.fetchedAt), ttlMs)) {
      continue;
    }

    const resolved = rowToResolvedPrice(row);

    if (!requirePriced || isPricedResolvedPrice(resolved)) {
      return resolved;
    }
  }

  return null;
}

/** Upsert a resolved price. Best-effort: returns false when the database is unavailable. */
export async function writeCachedPrice(
  resolved: ResolvedPrice,
  identity: { language?: string; setCode?: string } = {},
): Promise<boolean> {
  writeMemoryPrice(resolved);

  const now = new Date();
  const fetchedAtTs = Date.parse(resolved.fetchedAt || "");
  const fetchedAt = Number.isFinite(fetchedAtTs) ? new Date(fetchedAtTs) : now;
  const values = {
    cardSlug: resolved.slug,
    language: identity.language ?? null,
    setCode: identity.setCode ?? null,
    ungradedUsd: resolved.ungradedUsd.toFixed(2),
    confidenceScore: resolved.confidenceScore.toFixed(4),
    primaryProvider: resolved.primaryProvider,
    resultsJson: resolved.results,
    fetchedAt,
    updatedAt: now,
  };

  const written = await withCacheDb(async (db) => {
    await db
      .insert(apiPriceCache)
      .values(values)
      .onConflictDoUpdate({
        target: apiPriceCache.cardSlug,
        set: {
          language: values.language,
          setCode: values.setCode,
          ungradedUsd: values.ungradedUsd,
          confidenceScore: values.confidenceScore,
          primaryProvider: values.primaryProvider,
          resultsJson: values.resultsJson,
          fetchedAt: values.fetchedAt,
          updatedAt: values.updatedAt,
        },
      });

    return true;
  });

  return written === true || Boolean(resolved.slug?.trim());
}
