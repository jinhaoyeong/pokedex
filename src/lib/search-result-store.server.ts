import "server-only";

import { count, eq, gte } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { searchResponses } from "@/db/schema";

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

    return row.responseJson as T;
  } catch {
    return null;
  }
}

export async function writeSearchResult(
  key: string,
  value: unknown,
  parts: SearchResultParts,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  const now = new Date();

  try {
    await getDb()
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
      });
  } catch {
    // Persistent cache writes are best effort.
  }
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
