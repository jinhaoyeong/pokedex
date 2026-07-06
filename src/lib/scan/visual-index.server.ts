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

  try {
    const [row] = await getDb()
      .select({ value: count() })
      .from(cardVisuals)
      .where(isNotNull(cardVisuals.embedding));

    return (row?.value ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function visualIndexSize(): Promise<number> {
  if (!isDatabaseConfigured()) {
    return 0;
  }

  try {
    const [row] = await getDb().select({ value: count() }).from(cardVisuals);
    return row?.value ?? 0;
  } catch {
    return 0;
  }
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

  try {
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
  } catch {
    return [];
  }
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

  try {
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
  } catch {
    return [];
  }
}
