import "server-only";

import { count, eq, gte } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { searchResponses } from "@/db/schema";
import {
  continueAfterResponse,
  readRuntimeCache,
  SHARED_SEARCH_TTL_SECONDS,
  writeRuntimeCache,
} from "@/lib/shared-search-cache.server";

type RuntimeSearchEnvelope<T> = {
  storedAt: number;
  value: T;
};

function runtimeSearchKey(key: string) {
  return `search:${key}`;
}

/**
 * Persistent search-result store.
 *
 * This used to be a local SQLite cold-start accelerator. Stage 3 stores the
 * same completed responses in Supabase so warmed searches survive serverless
 * instances and production deploys.
 */

export type SearchResultParts = {
  query: string;
  setFilter?: string;
  page: number;
  language: string;
  sort: string;
  resultCount: number;
};

export async function readSearchResult<T>(key: string, ttlMs: number): Promise<T | null> {
  const runtime = await readRuntimeCache<RuntimeSearchEnvelope<T>>(runtimeSearchKey(key));
  if (runtime?.value && Date.now() - runtime.storedAt < ttlMs) {
    return runtime.value;
  }

  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const [row] = await getDb()
      .select({
        responseJson: searchResponses.responseJson,
        fetchedAt: searchResponses.fetchedAt,
      })
      .from(searchResponses)
      .where(eq(searchResponses.key, key))
      .limit(1);

    if (!row) {
      return null;
    }

    if (Date.now() - row.fetchedAt.getTime() >= ttlMs) {
      return null;
    }

    const value = row.responseJson as T;
    continueAfterResponse(
      writeRuntimeCache(
        runtimeSearchKey(key),
        { storedAt: row.fetchedAt.getTime(), value },
        SHARED_SEARCH_TTL_SECONDS,
      ),
    );
    return value;
  } catch {
    return null;
  }
}

export async function writeSearchResult(
  key: string,
  value: unknown,
  parts: SearchResultParts,
): Promise<void> {
  const now = new Date();
  await writeRuntimeCache(
    runtimeSearchKey(key),
    { storedAt: now.getTime(), value },
    SHARED_SEARCH_TTL_SECONDS,
  );

  if (!isDatabaseConfigured()) {
    return;
  }

  continueAfterResponse(
    getDb()
      .insert(searchResponses)
      .values({
        key,
        query: parts.query ?? "",
        setFilter: parts.setFilter ?? "",
        page: parts.page ?? 1,
        language: parts.language ?? "all",
        sort: parts.sort ?? "relevance",
        responseJson: value,
        resultCount: parts.resultCount ?? 0,
        fetchedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: searchResponses.key,
        set: {
          query: parts.query ?? "",
          setFilter: parts.setFilter ?? "",
          page: parts.page ?? 1,
          language: parts.language ?? "all",
          sort: parts.sort ?? "relevance",
          responseJson: value,
          resultCount: parts.resultCount ?? 0,
          fetchedAt: now,
          updatedAt: now,
        },
      })
      .then(() => undefined)
      .catch(() => undefined),
  );
}

export async function searchCacheStats(): Promise<{ rows: number; freshRows: number } | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const [[rowCount], [freshCount]] = await Promise.all([
      getDb().select({ value: count() }).from(searchResponses),
      getDb()
        .select({ value: count() })
        .from(searchResponses)
        .where(gte(searchResponses.fetchedAt, cutoff)),
    ]);

    return { rows: rowCount?.value ?? 0, freshRows: freshCount?.value ?? 0 };
  } catch {
    return null;
  }
}
