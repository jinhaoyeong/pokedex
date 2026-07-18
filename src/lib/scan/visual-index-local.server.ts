import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { VisualIndexHit } from "@/lib/scan/types";

/**
 * Local fallback for `/api/visual-search` when Supabase `card_visuals` is empty.
 * Reads `data/scan-visual-index.sqlite` (dHash + int8 CLIP embeddings) so scans
 * still match against the catalog in-process instead of falling through to the
 * multi-minute OCR + live-search path.
 */

const LOCAL_INDEX_PATH = path.join(process.cwd(), "data", "scan-visual-index.sqlite");

type SqliteDb = InstanceType<typeof Database>;

type HashRow = {
  id: string;
  name: string;
  setName: string | null;
  localId: string | null;
  lang: string;
  image: string | null;
  hash: string;
};

type EmbeddingRow = {
  id: string;
  embedding: Buffer;
};

type MemoryIndex = {
  hashes: HashRow[];
  /** L2-normalized float embeddings aligned with `embeddingIds`. */
  embeddingIds: string[];
  embeddings: Float32Array[];
  metaById: Map<string, HashRow>;
};

const globalForLocalIndex = globalThis as unknown as {
  __pokedexScanVisualSqlite?: SqliteDb | null;
  __pokedexScanVisualMemory?: MemoryIndex | null;
};

function getLocalDb(): SqliteDb | null {
  if (globalForLocalIndex.__pokedexScanVisualSqlite !== undefined) {
    return globalForLocalIndex.__pokedexScanVisualSqlite;
  }

  try {
    if (!fs.existsSync(LOCAL_INDEX_PATH)) {
      globalForLocalIndex.__pokedexScanVisualSqlite = null;
      return null;
    }

    globalForLocalIndex.__pokedexScanVisualSqlite = new Database(LOCAL_INDEX_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    return globalForLocalIndex.__pokedexScanVisualSqlite;
  } catch (error) {
    console.error("[visual-index-local] failed to open sqlite index", error);
    globalForLocalIndex.__pokedexScanVisualSqlite = null;
    return null;
  }
}

function dequantizeEmbedding(blob: Buffer): Float32Array | null {
  if (blob.length !== 512) {
    return null;
  }

  const bytes = new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  const vector = new Float32Array(512);
  let sum = 0;
  for (let i = 0; i < 512; i += 1) {
    const value = bytes[i] / 127;
    vector[i] = value;
    sum += value * value;
  }
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < 512; i += 1) {
    vector[i] /= norm;
  }
  return vector;
}

function loadMemoryIndex(): MemoryIndex | null {
  if (globalForLocalIndex.__pokedexScanVisualMemory !== undefined) {
    return globalForLocalIndex.__pokedexScanVisualMemory;
  }

  const db = getLocalDb();
  if (!db) {
    globalForLocalIndex.__pokedexScanVisualMemory = null;
    return null;
  }

  try {
    const hashes = db
      .prepare(
        `SELECT id, name, set_name AS setName, local_id AS localId, lang, image, hash
         FROM card_hashes`,
      )
      .all() as HashRow[];

    const embeddingRows = db
      .prepare(`SELECT id, embedding FROM card_embeddings`)
      .all() as EmbeddingRow[];

    const metaById = new Map(hashes.map((row) => [row.id, row]));
    const embeddingIds: string[] = [];
    const embeddings: Float32Array[] = [];

    for (const row of embeddingRows) {
      const vector = dequantizeEmbedding(row.embedding);
      if (!vector || !metaById.has(row.id)) {
        continue;
      }
      embeddingIds.push(row.id);
      embeddings.push(vector);
    }

    const memory: MemoryIndex = { hashes, embeddingIds, embeddings, metaById };
    globalForLocalIndex.__pokedexScanVisualMemory = memory;
    console.info(
      `[visual-index-local] loaded ${hashes.length} hashes / ${embeddings.length} embeddings from sqlite`,
    );
    return memory;
  } catch (error) {
    console.error("[visual-index-local] failed to load memory index", error);
    globalForLocalIndex.__pokedexScanVisualMemory = null;
    return null;
  }
}

function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function toHit(row: HashRow, score: number): VisualIndexHit {
  return {
    id: row.id,
    name: row.name,
    setName: row.setName ?? "",
    localId: row.localId ?? "",
    lang: row.lang || "en",
    image: row.image ?? "",
    score: Math.max(0, Math.min(1, score)),
  };
}

export function isLocalVisualIndexReady(): boolean {
  return (loadMemoryIndex()?.hashes.length ?? 0) > 0;
}

export function isLocalEmbeddingIndexReady(): boolean {
  return (loadMemoryIndex()?.embeddings.length ?? 0) > 0;
}

export function localVisualIndexSize(): number {
  return loadMemoryIndex()?.hashes.length ?? 0;
}

export function searchLocalByHash(
  hash: bigint,
  limit = 24,
  maxDistance = 32,
): VisualIndexHit[] {
  const memory = loadMemoryIndex();
  if (!memory) {
    return [];
  }

  const scored: Array<{ row: HashRow; distance: number }> = [];
  for (const row of memory.hashes) {
    let cardHash: bigint;
    try {
      cardHash = BigInt(row.hash);
    } catch {
      continue;
    }
    const distance = hammingDistance(hash, cardHash);
    if (distance <= maxDistance) {
      scored.push({ row, distance });
    }
  }

  scored.sort((left, right) => left.distance - right.distance);
  return scored.slice(0, limit).map(({ row, distance }) => toHit(row, 1 - distance / 64));
}

export function searchLocalByEmbedding(
  vector: number[] | Float32Array,
  limit = 24,
  minScore = 0.62,
): VisualIndexHit[] {
  const memory = loadMemoryIndex();
  if (!memory?.embeddings.length || vector.length !== 512) {
    return [];
  }

  const query = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  // Ensure query is normalized (client already does this; re-normalize for safety).
  let sum = 0;
  for (let i = 0; i < query.length; i += 1) {
    sum += query[i] * query[i];
  }
  const norm = Math.sqrt(sum) || 1;
  if (Math.abs(norm - 1) > 0.01) {
    for (let i = 0; i < query.length; i += 1) {
      query[i] /= norm;
    }
  }

  const scored: Array<{ id: string; score: number }> = [];
  for (let i = 0; i < memory.embeddings.length; i += 1) {
    const score = cosine(query, memory.embeddings[i]);
    if (score >= minScore) {
      scored.push({ id: memory.embeddingIds[i], score });
    }
  }

  scored.sort((left, right) => right.score - left.score);
  const hits: VisualIndexHit[] = [];
  for (const item of scored.slice(0, limit)) {
    const row = memory.metaById.get(item.id);
    if (row) {
      hits.push(toHit(row, item.score));
    }
  }
  return hits;
}
