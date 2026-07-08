import "server-only";

import { count, isNotNull, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { cardVisuals } from "@/db/schema";
import type { VisualIndexHit } from "@/lib/scan/types";

/**
 * Server-side visual index backed by Supabase Postgres.
 *
 * The browser still computes OCR, dHash and CLIP embeddings locally. This
 * module only matches those tiny signatures against card_visuals using
 * pgvector operators, so Vercel never loads a SQLite file or scans an in-memory
 * array.
 */

const VISUAL_INDEX_DB_TIMEOUT_MS = 3_500;

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

export async function isVisualIndexReady(): Promise<boolean> {
  return (await visualIndexSize()) > 0;
}

export async function isEmbeddingIndexReady(): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    return false;
  }

  return withDatabaseFallback(
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
}

export async function visualIndexSize(): Promise<number> {
  if (!isDatabaseConfigured()) {
    return 0;
  }

  return withDatabaseFallback(
    "index-size probe",
    async () => {
      const [row] = await getDb().select({ value: count() }).from(cardVisuals);
      return row?.value ?? 0;
    },
    0,
  );
}

/**
 * Return the nearest cards to `hash` by Postgres bit-string Hamming distance. The
 * stored hash_bits column is bit(64), populated from the legacy dHash decimal.
 */
export async function searchByHash(
  hash: bigint,
  limit = 24,
  maxDistance = 26,
): Promise<VisualIndexHit[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const bits = hashBitsFromBigInt(hash);
  const distance = sql<number>`bit_count(${cardVisuals.hashBits} # ${bits}::bit(64))`;

  return withDatabaseFallback(
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
}

/**
 * Match a normalized CLIP embedding against the catalog by cosine similarity.
 * pgvector's `<=>` operator returns cosine distance, so score = 1 - distance.
 */
export async function searchByEmbedding(
  vector: number[] | Float32Array,
  limit = 24,
  minScore = 0.62,
): Promise<VisualIndexHit[]> {
  if (!isDatabaseConfigured() || vector.length !== 512) {
    return [];
  }

  const input = vectorInput(vector);
  const distance = sql<number>`${cardVisuals.embedding} <=> ${input}::vector`;
  const maxDistance = 1 - minScore;

  return withDatabaseFallback(
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
}
