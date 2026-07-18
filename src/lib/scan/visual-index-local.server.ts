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

const INDEX_FILENAME = "scan-visual-index.sqlite";

function resolveLocalIndexPath(): string | null {
  const roots = new Set<string>([
    process.cwd(),
    path.join(process.cwd(), ".."),
    path.join(process.cwd(), ".next", "standalone"),
    path.join(process.cwd(), ".next", "server"),
  ]);

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    roots.add("/var/task");
    roots.add(path.join("/var/task", ".next", "standalone"));
    roots.add(path.join("/var/task", "data"));
  }

  // Walk up from cwd in case the serverless entry runs from a nested folder.
  let walk = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    roots.add(walk);
    const parent = path.dirname(walk);
    if (parent === walk) break;
    walk = parent;
  }

  for (const root of roots) {
    const candidates = [
      path.join(root, "data", INDEX_FILENAME),
      path.join(root, INDEX_FILENAME),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

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

type HashMemory = {
  hashes: HashRow[];
  metaById: Map<string, HashRow>;
  /** Pre-parsed BigInt hashes aligned with `hashes`. */
  parsedHashes: bigint[];
};

type EmbeddingMemory = {
  embeddingIds: string[];
  embeddings: Float32Array[];
};

const globalForLocalIndex = globalThis as unknown as {
  __pokedexScanVisualSqlite?: SqliteDb | null;
  __pokedexScanVisualHashMemory?: HashMemory | null;
  __pokedexScanVisualEmbedMemory?: EmbeddingMemory | null;
  __pokedexScanVisualIndexPath?: string | null;
};

function getLocalDb(): SqliteDb | null {
  if (globalForLocalIndex.__pokedexScanVisualSqlite !== undefined) {
    return globalForLocalIndex.__pokedexScanVisualSqlite;
  }

  try {
    const indexPath = resolveLocalIndexPath();
    globalForLocalIndex.__pokedexScanVisualIndexPath = indexPath;
    if (!indexPath) {
      console.warn(
        `[visual-index-local] ${INDEX_FILENAME} not found under cwd=${process.cwd()} vercel=${Boolean(process.env.VERCEL)}`,
      );
      globalForLocalIndex.__pokedexScanVisualSqlite = null;
      return null;
    }

    globalForLocalIndex.__pokedexScanVisualSqlite = new Database(indexPath, {
      readonly: true,
      fileMustExist: true,
    });
    console.info(`[visual-index-local] opened ${indexPath}`);
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

function loadHashMemory(): HashMemory | null {
  if (globalForLocalIndex.__pokedexScanVisualHashMemory !== undefined) {
    return globalForLocalIndex.__pokedexScanVisualHashMemory;
  }

  const db = getLocalDb();
  if (!db) {
    globalForLocalIndex.__pokedexScanVisualHashMemory = null;
    return null;
  }

  try {
    const hashes = db
      .prepare(
        `SELECT id, name, set_name AS setName, local_id AS localId, lang, image, hash
         FROM card_hashes`,
      )
      .all() as HashRow[];

    const metaById = new Map(hashes.map((row) => [row.id, row]));
    const parsedHashes: bigint[] = new Array(hashes.length);
    for (let i = 0; i < hashes.length; i += 1) {
      try {
        parsedHashes[i] = BigInt(hashes[i].hash);
      } catch {
        parsedHashes[i] = 0n;
      }
    }

    const memory: HashMemory = { hashes, metaById, parsedHashes };
    globalForLocalIndex.__pokedexScanVisualHashMemory = memory;
    console.info(`[visual-index-local] loaded ${hashes.length} hashes from sqlite`);
    return memory;
  } catch (error) {
    console.error("[visual-index-local] failed to load hash index", error);
    globalForLocalIndex.__pokedexScanVisualHashMemory = null;
    return null;
  }
}

function loadEmbeddingMemory(): EmbeddingMemory | null {
  if (globalForLocalIndex.__pokedexScanVisualEmbedMemory !== undefined) {
    return globalForLocalIndex.__pokedexScanVisualEmbedMemory;
  }

  const db = getLocalDb();
  const hashMemory = loadHashMemory();
  if (!db || !hashMemory) {
    globalForLocalIndex.__pokedexScanVisualEmbedMemory = null;
    return null;
  }

  try {
    const embeddingRows = db
      .prepare(`SELECT id, embedding FROM card_embeddings`)
      .all() as EmbeddingRow[];

    const embeddingIds: string[] = [];
    const embeddings: Float32Array[] = [];

    for (const row of embeddingRows) {
      const vector = dequantizeEmbedding(row.embedding);
      if (!vector || !hashMemory.metaById.has(row.id)) {
        continue;
      }
      embeddingIds.push(row.id);
      embeddings.push(vector);
    }

    const memory: EmbeddingMemory = { embeddingIds, embeddings };
    globalForLocalIndex.__pokedexScanVisualEmbedMemory = memory;
    console.info(`[visual-index-local] loaded ${embeddings.length} embeddings from sqlite`);
    return memory;
  } catch (error) {
    console.error("[visual-index-local] failed to load embedding index", error);
    globalForLocalIndex.__pokedexScanVisualEmbedMemory = null;
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
  return (loadHashMemory()?.hashes.length ?? 0) > 0;
}

export function isLocalEmbeddingIndexReady(): boolean {
  return (loadEmbeddingMemory()?.embeddings.length ?? 0) > 0;
}

export function localVisualIndexSize(): number {
  return loadHashMemory()?.hashes.length ?? 0;
}

export function localVisualIndexPath(): string | null {
  if (globalForLocalIndex.__pokedexScanVisualIndexPath !== undefined) {
    return globalForLocalIndex.__pokedexScanVisualIndexPath;
  }
  getLocalDb();
  return globalForLocalIndex.__pokedexScanVisualIndexPath ?? null;
}

export function searchLocalByHash(
  hash: bigint,
  limit = 24,
  maxDistance = 32,
): VisualIndexHit[] {
  return searchLocalByHashes([hash], limit, maxDistance);
}

/**
 * Match any of several query hashes (full frame + inset crops) and keep the
 * best Hamming distance per catalog card.
 */
export function searchLocalByHashes(
  hashes: bigint[],
  limit = 24,
  maxDistance = 32,
): VisualIndexHit[] {
  const memory = loadHashMemory();
  if (!memory) {
    return [];
  }

  const queries = hashes.filter((hash) => hash !== 0n);
  if (!queries.length) {
    return [];
  }

  const bestDistance = new Map<number, number>();
  for (let i = 0; i < memory.parsedHashes.length; i += 1) {
    const cardHash = memory.parsedHashes[i];
    if (cardHash === 0n) continue;
    let distance = 64;
    for (const query of queries) {
      const next = hammingDistance(query, cardHash);
      if (next < distance) distance = next;
      if (distance === 0) break;
    }
    if (distance <= maxDistance) {
      bestDistance.set(i, distance);
    }
  }

  return [...bestDistance.entries()]
    .sort((left, right) => left[1] - right[1])
    .slice(0, limit)
    .map(([index, distance]) => toHit(memory.hashes[index], 1 - distance / 64));
}

export function searchLocalByEmbedding(
  vector: number[] | Float32Array,
  limit = 24,
  minScore = 0.62,
): VisualIndexHit[] {
  const hashMemory = loadHashMemory();
  const embedMemory = loadEmbeddingMemory();
  if (!hashMemory || !embedMemory?.embeddings.length || vector.length !== 512) {
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
  for (let i = 0; i < embedMemory.embeddings.length; i += 1) {
    const score = cosine(query, embedMemory.embeddings[i]);
    if (score >= minScore) {
      scored.push({ id: embedMemory.embeddingIds[i], score });
    }
  }

  scored.sort((left, right) => right.score - left.score);
  const hits: VisualIndexHit[] = [];
  for (const item of scored.slice(0, limit)) {
    const row = hashMemory.metaById.get(item.id);
    if (row) {
      hits.push(toHit(row, item.score));
    }
  }
  return hits;
}
