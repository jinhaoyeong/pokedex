import "server-only";

import { count, isNotNull, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { cardVisuals } from "@/db/schema";
import type { VisualIndexHit } from "@/lib/scan/types";
import {
  CLIP_MATCH_MIN_SCORE,
  DHASH_MATCH_MAX_DISTANCE,
} from "@/lib/scan/dhash-core";
import { mergeVisualHits } from "@/lib/scan/visual-hits";
import {
  ensureLocalVisualIndex,
  isLocalEmbeddingIndexReady,
  isLocalVisualIndexReady,
  localVisualIndexSize,
  searchLocalByEmbedding,
  searchLocalByHash,
  searchLocalByHashes,
  searchLocalByNames,
  type LocalNameSearchOptions,
} from "@/lib/scan/visual-index-local.server";
/**
 * Server-side visual index. Prefers Supabase `card_visuals` (pgvector) when
 * populated; otherwise falls back to the shipped `scan-visual-index.sqlite`
 * so scans still match instantly without the OCR/live-search path.
 *
 * The browser still computes OCR, dHash and CLIP embeddings locally — only the
 * tiny signature is sent here.
 */

const VISUAL_INDEX_DB_TIMEOUT_MS = 2_500;

const globalForRemoteProbe = globalThis as unknown as {
  __pokedexRemoteVisualSize?: number | null;
  __pokedexRemoteEmbeddingReady?: boolean | null;
};

async function withDatabaseFallback<T>(
  label: string,
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => {
          console.warn(
            `[visual-index] ${label} timed out after ${VISUAL_INDEX_DB_TIMEOUT_MS}ms — returning empty fallback.`,
          );
          resolve(fallback);
        }, VISUAL_INDEX_DB_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error(`[visual-index] ${label} failed — returning empty fallback.`, error);
    return fallback;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function hashBitsFromBigInt(hash: bigint) {
  return hash.toString(2).padStart(64, "0").slice(-64);
}

function vectorInput(vector: number[] | Float32Array) {
  return `[${Array.from(vector, (value) => Number(value).toFixed(6)).join(",")}]`;
}

function rowToHit(row: {
  id: string;
  name: string;
  setName: string | null;
  localId: string | null;
  lang: string;
  image: string | null;
  score: number;
}): VisualIndexHit {
  return {
    id: row.id,
    name: row.name,
    setName: row.setName ?? "",
    localId: row.localId ?? "",
    lang: row.lang,
    image: row.image ?? "",
    score: Math.max(0, Math.min(1, Number(row.score) || 0)),
  };
}

/** Keep the highest-scoring hit per card id, then trim to `limit`. */
function mergeHits(groups: VisualIndexHit[][], limit: number): VisualIndexHit[] {
  return mergeVisualHits(groups, limit);
}

async function remoteVisualIndexSize(): Promise<number> {
  if (!isDatabaseConfigured()) {
    return 0;
  }
  if (globalForRemoteProbe.__pokedexRemoteVisualSize != null) {
    return globalForRemoteProbe.__pokedexRemoteVisualSize;
  }

  const remoteSize = await withDatabaseFallback(
    "index-size probe",
    async () => {
      const [row] = await getDb().select({ value: count() }).from(cardVisuals);
      return row?.value ?? 0;
    },
    0,
  );
  globalForRemoteProbe.__pokedexRemoteVisualSize = remoteSize;
  return remoteSize;
}

export async function isVisualIndexReady(): Promise<boolean> {
  return (await visualIndexSize()) > 0;
}

export async function isEmbeddingIndexReady(): Promise<boolean> {
  if (isDatabaseConfigured()) {
    if (globalForRemoteProbe.__pokedexRemoteEmbeddingReady != null) {
      if (globalForRemoteProbe.__pokedexRemoteEmbeddingReady) {
        return true;
      }
    } else {
      const remoteReady = await withDatabaseFallback(
        "embedding-index probe",
        async () => {
          const [row] = await getDb()
            .select({ value: count() })
            .from(cardVisuals)
            .where(isNotNull(cardVisuals.embedding));

          return (row?.value ?? 0) > 0;
        },
        false,
      );
      globalForRemoteProbe.__pokedexRemoteEmbeddingReady = remoteReady;
      if (remoteReady) {
        return true;
      }
    }
  }

  await ensureLocalVisualIndex();
  return isLocalEmbeddingIndexReady();
}

export async function visualIndexSize(): Promise<number> {
  const remoteSize = await remoteVisualIndexSize();
  if (remoteSize > 0) {
    return remoteSize;
  }
  await ensureLocalVisualIndex();
  return localVisualIndexSize();
}

/** Resolve OCR card-name candidates against the shipped visual catalog metadata. */
export async function searchByNames(
  names: string[],
  collectorNumberOrOptions?: string | LocalNameSearchOptions,
  limit = 24,
): Promise<VisualIndexHit[]> {
  await ensureLocalVisualIndex();
  if (
    collectorNumberOrOptions &&
    typeof collectorNumberOrOptions === "object"
  ) {
    return searchLocalByNames(names, collectorNumberOrOptions);
  }
  return searchLocalByNames(names, {
    collectorNumber:
      typeof collectorNumberOrOptions === "string"
        ? collectorNumberOrOptions
        : undefined,
    limit,
  });
}

export type { LocalNameSearchOptions };

/**
 * Return the nearest cards to `hash` by Postgres bit-string Hamming distance. The
 * stored hash_bits column is bit(64), populated from the legacy dHash decimal.
 */
export async function searchByHash(
  hash: bigint,
  limit = 24,
  maxDistance = DHASH_MATCH_MAX_DISTANCE,
): Promise<VisualIndexHit[]> {
  return searchByHashes([hash], limit, maxDistance);
}

/** Match any of several query hashes and return the best hits. */
export async function searchByHashes(
  hashes: bigint[],
  limit = 24,
  maxDistance = DHASH_MATCH_MAX_DISTANCE,
): Promise<VisualIndexHit[]> {
  const queries = hashes.filter((hash) => hash !== 0n);
  if (!queries.length) {
    return [];
  }

  const groups: VisualIndexHit[][] = [];
  const remoteSize = await remoteVisualIndexSize();

  if (remoteSize > 0) {
    // Query remote with the strongest single hash first; multi-hash on Postgres
    // would need a UNION. Local handles the inset-crop variants.
    const primary = queries[0];
    const bits = hashBitsFromBigInt(primary);
    const distance = sql<number>`bit_count(${cardVisuals.hashBits} # ${bits}::bit(64))`;

    const remote = await withDatabaseFallback(
      "hash search",
      async () => {
        const rows = await getDb()
          .select({
            id: cardVisuals.cardId,
            name: cardVisuals.name,
            setName: cardVisuals.setName,
            localId: cardVisuals.localId,
            lang: cardVisuals.lang,
            image: cardVisuals.image,
            score: sql<number>`1 - (${distance} / 64.0)`,
          })
          .from(cardVisuals)
          .where(sql`${distance} <= ${maxDistance}`)
          .orderBy(distance)
          .limit(limit);

        return rows.map(rowToHit);
      },
      [] as VisualIndexHit[],
    );
    if (remote.length) {
      groups.push(remote);
    }
  }

  await ensureLocalVisualIndex();
  if (isLocalVisualIndexReady()) {
    groups.push(
      queries.length === 1
        ? searchLocalByHash(queries[0], limit, maxDistance)
        : searchLocalByHashes(queries, limit, maxDistance),
    );
  }

  return mergeHits(groups, limit);
}

/**
 * Match a normalized CLIP embedding against the catalog by cosine similarity.
 * pgvector's `<=>` operator returns cosine distance, so score = 1 - distance.
 */
export async function searchByEmbedding(
  vector: number[] | Float32Array,
  limit = 24,
  minScore = CLIP_MATCH_MIN_SCORE,
): Promise<VisualIndexHit[]> {
  if (vector.length !== 512) {
    return [];
  }

  const groups: VisualIndexHit[][] = [];
  const remoteSize = await remoteVisualIndexSize();

  if (remoteSize > 0) {
    const input = vectorInput(vector);
    const distance = sql<number>`${cardVisuals.embedding} <=> ${input}::vector`;
    const maxDistance = 1 - minScore;

    const remote = await withDatabaseFallback(
      "embedding search",
      async () => {
        const rows = await getDb()
          .select({
            id: cardVisuals.cardId,
            name: cardVisuals.name,
            setName: cardVisuals.setName,
            localId: cardVisuals.localId,
            lang: cardVisuals.lang,
            image: cardVisuals.image,
            score: sql<number>`1 - ${distance}`,
          })
          .from(cardVisuals)
          .where(sql`${cardVisuals.embedding} is not null and ${distance} <= ${maxDistance}`)
          .orderBy(distance)
          .limit(limit);

        return rows.map(rowToHit);
      },
      [] as VisualIndexHit[],
    );
    if (remote.length) {
      groups.push(remote);
    }
  }

  await ensureLocalVisualIndex();
  if (isLocalEmbeddingIndexReady()) {
    groups.push(searchLocalByEmbedding(vector, limit, minScore));
  }

  return mergeHits(groups, limit);
}
