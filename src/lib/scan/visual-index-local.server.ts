import "server-only";

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import Database from "better-sqlite3";

import {
  compareCollectorNumbers,
  languageAgreementScore,
  normalizeIdentityName,
  scoreEvidence,
  type ScriptHint,
} from "@/lib/scan/identity-evidence";
import type { VisualIndexHit } from "@/lib/scan/types";
import type { CardLanguageCode } from "@/types/pokemon";

/**
 * Local fallback for `/api/visual-search` when Supabase `card_visuals` is empty.
 * Reads `data/scan-visual-index.sqlite` (dHash + int8 CLIP embeddings) so scans
 * still match against the catalog in-process instead of falling through to the
 * multi-minute OCR + live-search path.
 */

const INDEX_FILENAME = "scan-visual-index.sqlite";
const HASH_FALLBACK_FILENAME = "scan-visual-hashes.json.gz";
/** Writable fallback when the deploy bundle omitted the traced sqlite file. */
const TMP_INDEX_PATH = path.join("/tmp", INDEX_FILENAME);
/**
 * Public raw URL for the shipped catalog index. Used only when the file is
 * missing from the serverless bundle (some Vercel projects omit large traced
 * assets even with outputFileTracingIncludes).
 */
const DEFAULT_INDEX_DOWNLOAD_URL =
  process.env.SCAN_VISUAL_INDEX_URL ??
  "https://raw.githubusercontent.com/jinhaoyeong/pokedex/redesign/premium-black/data/scan-visual-index.sqlite";

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

  if (fs.existsSync(TMP_INDEX_PATH)) {
    return TMP_INDEX_PATH;
  }

  return null;
}

function resolveHashFallbackPath(): string | null {
  const roots = [
    process.cwd(),
    path.join(process.cwd(), ".."),
    path.join(process.cwd(), ".next", "standalone"),
    "/var/task",
    path.join("/var/task", ".next", "standalone"),
  ];
  for (const root of roots) {
    for (const candidate of [
      path.join(root, "data", HASH_FALLBACK_FILENAME),
      path.join(root, HASH_FALLBACK_FILENAME),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const globalForIndexDownload = globalThis as unknown as {
  __pokedexScanVisualIndexDownload?: Promise<string | null>;
};

/**
 * Ensure the sqlite catalog is on disk. Downloads into `/tmp` when the deploy
 * omitted it so preview/stale hosts can still match scans.
 */
export async function ensureLocalVisualIndex(): Promise<boolean> {
  if (resolveLocalIndexPath()) {
    // Make sure a prior miss didn't stick a null DB handle.
    if (!globalForLocalIndex.__pokedexScanVisualSqlite) {
      reopenLocalDbAfterDownload();
    }
    return isLocalVisualIndexReady();
  }

  if (!globalForIndexDownload.__pokedexScanVisualIndexDownload) {
    globalForIndexDownload.__pokedexScanVisualIndexDownload = (async () => {
      const url = DEFAULT_INDEX_DOWNLOAD_URL;
      try {
        console.info(`[visual-index-local] downloading catalog index from ${url}`);
        const response = await fetch(url, {
          headers: { "User-Agent": "PokePokedex/1.0 (scan-visual-index)" },
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength < 1_000_000) {
          throw new Error(`downloaded index too small (${buffer.byteLength} bytes)`);
        }
        // Validate sqlite header before replacing any existing tmp file.
        if (buffer.subarray(0, 15).toString("utf8") !== "SQLite format 3") {
          throw new Error("downloaded file is not a sqlite database");
        }
        const partialPath = `${TMP_INDEX_PATH}.partial`;
        fs.writeFileSync(partialPath, buffer);
        fs.renameSync(partialPath, TMP_INDEX_PATH);
        console.info(
          `[visual-index-local] downloaded index to ${TMP_INDEX_PATH} (${buffer.byteLength} bytes)`,
        );
        return TMP_INDEX_PATH;
      } catch (error) {
        console.error("[visual-index-local] failed to download catalog index", error);
        return null;
      }
    })();
  }

  const downloaded = await globalForIndexDownload.__pokedexScanVisualIndexDownload;
  if (!downloaded) {
    return false;
  }
  reopenLocalDbAfterDownload();
  return isLocalVisualIndexReady();
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
  __pokedexScanVisualHashSource?: "sqlite" | "json-gzip" | null;
};

function openLocalDb(indexPath: string): SqliteDb | null {
  try {
    const db = new Database(indexPath, {
      readonly: true,
      fileMustExist: true,
    });
    globalForLocalIndex.__pokedexScanVisualSqlite = db;
    globalForLocalIndex.__pokedexScanVisualIndexPath = indexPath;
    console.info(`[visual-index-local] opened ${indexPath}`);
    return db;
  } catch (error) {
    console.error("[visual-index-local] failed to open sqlite index", error);
    globalForLocalIndex.__pokedexScanVisualSqlite = null;
    globalForLocalIndex.__pokedexScanVisualIndexPath = null;
    return null;
  }
}

function getLocalDb(): SqliteDb | null {
  if (globalForLocalIndex.__pokedexScanVisualSqlite !== undefined) {
    return globalForLocalIndex.__pokedexScanVisualSqlite;
  }

  const indexPath = resolveLocalIndexPath();
  globalForLocalIndex.__pokedexScanVisualIndexPath = indexPath;
  if (!indexPath) {
    console.warn(
      `[visual-index-local] ${INDEX_FILENAME} not found under cwd=${process.cwd()} vercel=${Boolean(process.env.VERCEL)}`,
    );
    // Leave unset so a later ensureLocalVisualIndex() download can open it.
    return null;
  }

  return openLocalDb(indexPath);
}

/** Open the DB after a successful download (clears the previous miss cache). */
function reopenLocalDbAfterDownload(): SqliteDb | null {
  if (globalForLocalIndex.__pokedexScanVisualSqlite) {
    return globalForLocalIndex.__pokedexScanVisualSqlite;
  }
  // Clear sticky misses from before the download finished.
  delete globalForLocalIndex.__pokedexScanVisualSqlite;
  delete globalForLocalIndex.__pokedexScanVisualHashMemory;
  delete globalForLocalIndex.__pokedexScanVisualEmbedMemory;
  const indexPath = resolveLocalIndexPath();
  if (!indexPath) {
    globalForLocalIndex.__pokedexScanVisualSqlite = null;
    return null;
  }
  return openLocalDb(indexPath);
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

  try {
    // Vercel's native sqlite artifact has intermittently existed at /var/task
    // but failed to load on cold starts. Prefer the tiny compressed hash
    // catalog there; sqlite remains available for neural embeddings.
    const preferJson =
      process.env.SCAN_VISUAL_INDEX_FORCE_JSON === "true" ||
      (Boolean(process.env.VERCEL) &&
        process.env.SCAN_VISUAL_INDEX_PREFER_JSON !== "false");
    const db = preferJson ? null : getLocalDb();
    let hashes: HashRow[] = [];
    let source: "sqlite" | "json-gzip" = "sqlite";

    if (db) {
      try {
        hashes = db
          .prepare(
            `SELECT id, name, set_name AS setName, local_id AS localId, lang, image, hash
             FROM card_hashes`,
          )
          .all() as HashRow[];
      } catch (error) {
        console.error(
          "[visual-index-local] sqlite hash query failed; trying compressed JSON fallback",
          error,
        );
      }
    }

    if (!hashes.length) {
      const fallbackPath = resolveHashFallbackPath();
      if (!fallbackPath) {
        throw new Error(`${HASH_FALLBACK_FILENAME} not found`);
      }
      const decoded = zlib.gunzipSync(fs.readFileSync(fallbackPath)).toString("utf8");
      const parsed = JSON.parse(decoded) as unknown;
      if (!Array.isArray(parsed) || parsed.length < 20_000) {
        throw new Error("compressed visual hash fallback is invalid or incomplete");
      }
      hashes = parsed as HashRow[];
      const sentinel = hashes.find(
        (row) => row.id === "swsh7-215" && row.name === "Umbreon VMAX",
      );
      if (!sentinel) {
        throw new Error("compressed visual hash fallback failed sentinel validation");
      }
      source = "json-gzip";
    }

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
    globalForLocalIndex.__pokedexScanVisualHashSource = source;
    console.info(`[visual-index-local] loaded ${hashes.length} hashes from ${source}`);
    return memory;
  } catch (error) {
    console.error("[visual-index-local] failed to load hash index", error);
    globalForLocalIndex.__pokedexScanVisualHashMemory = null;
    globalForLocalIndex.__pokedexScanVisualHashSource = null;
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

export type LocalNameSearchOptions = {
  collectorNumber?: string;
  languageHints?: CardLanguageCode[];
  scriptHint?: ScriptHint;
  limit?: number;
};

/**
 * Resolve OCR card-name candidates against the visual catalog.
 *
 * Returns exact-name hits scored by collector-number structure, language/script
 * agreement, and OCR candidate rank. A high score here means "strong name hit",
 * not a proven card identity — callers must still require number + language (or
 * strong visual agreement) before treating a row as a resolved identity.
 */
export function searchLocalByNames(
  names: string[],
  collectorNumberOrOptions?: string | LocalNameSearchOptions,
  limitArg = 24,
): VisualIndexHit[] {
  const memory = loadHashMemory();
  if (!memory) return [];

  const options: LocalNameSearchOptions =
    typeof collectorNumberOrOptions === "string" || collectorNumberOrOptions == null
      ? {
          collectorNumber: collectorNumberOrOptions,
          limit: limitArg,
        }
      : collectorNumberOrOptions;
  const limit = options.limit ?? limitArg;

  const normalizedNames = Array.from(
    new Set(names.map(normalizeIdentityName).filter((name) => name.length >= 2)),
  ).slice(0, 24);
  if (!normalizedNames.length) return [];

  const rankByName = new Map(normalizedNames.map((name, index) => [name, index]));
  const languageHints = options.languageHints ?? [];
  const scriptHint = options.scriptHint ?? "unknown";

  const exactNameHits: Array<{
    row: HashRow;
    rank: number;
    collectorScore: number;
    languageScore: number;
    identityScore: number;
    nameAndNumber: boolean;
    resolvedIdentity: boolean;
  }> = [];

  for (const row of memory.hashes) {
    const rank = rankByName.get(normalizeIdentityName(row.name));
    if (rank == null) continue;

    const collector = compareCollectorNumbers(
      options.collectorNumber,
      row.localId ?? undefined,
    );
    const languageScore = languageAgreementScore(row.lang, languageHints, scriptHint);
    const nameScore = 1;
    const evidence = scoreEvidence({
      nameScore,
      collectorScore: collector.score,
      languageScore,
      // Catalog-only lookup has no visual yet; keep neutral so number/language decide.
      visualScore: 0.55,
      clipScore: 0.55,
      geometryQuality: 0.5,
    });

    exactNameHits.push({
      row,
      rank,
      collectorScore: collector.score,
      languageScore,
      identityScore: evidence.finalScore,
      nameAndNumber: evidence.flags.nameAndNumber,
      resolvedIdentity: evidence.flags.resolvedIdentity,
    });
  }

  // Prefer collector-number agreement before OCR name order when a number exists.
  return exactNameHits
    .sort(
      (left, right) =>
        Number(right.resolvedIdentity) - Number(left.resolvedIdentity) ||
        Number(right.nameAndNumber) - Number(left.nameAndNumber) ||
        right.collectorScore - left.collectorScore ||
        right.languageScore - left.languageScore ||
        left.rank - right.rank ||
        right.identityScore - left.identityScore,
    )
    .slice(0, limit)
    .map((hit) => {
      // Exact-name-only stays below resolved-identity thresholds used by the client.
      const base = hit.resolvedIdentity
        ? 0.94
        : hit.nameAndNumber
          ? 0.9
          : 0.82;
      const score = Math.max(
        0.72,
        Math.min(
          0.99,
          base +
            hit.collectorScore * 0.04 +
            hit.languageScore * 0.03 -
            hit.rank * 0.002,
        ),
      );
      return toHit(hit.row, score);
    });
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

export function localVisualIndexSource(): "sqlite" | "json-gzip" | null {
  loadHashMemory();
  return globalForLocalIndex.__pokedexScanVisualHashSource ?? null;
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
