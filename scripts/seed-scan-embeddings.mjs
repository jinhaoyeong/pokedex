#!/usr/bin/env node
/**
 * Computes CLIP image embeddings for every card already in
 * data/scan-visual-index.sqlite and stores them (int8-quantized) in a
 * card_embeddings table. Embeddings recognize cards by *what the art depicts*,
 * so they are far more robust to holo foil / lighting than perceptual hashing.
 *
 * Uses the SAME model the browser scanner uses (Xenova/clip-vit-base-patch32,
 * q8) so photo and catalog embeddings live in the same space.
 *
 * Resumable: re-running embeds only cards without an embedding yet.
 *
 * Run: npm run db:seed:scan-embeddings
 * Env:
 *   SCAN_EMB_MAX=500   cap number of cards to embed this run (default: all)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import {
  env,
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from "@huggingface/transformers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "scan-visual-index.sqlite");
const MODEL_ID = "Xenova/clip-vit-base-patch32";
const MAX = process.env.SCAN_EMB_MAX
  ? Number.parseInt(process.env.SCAN_EMB_MAX, 10)
  : Infinity;

env.allowLocalModels = false;

async function withRetry(fn, attempts = 4, label = "op") {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error(`${label} failed: ${lastError?.message ?? lastError}`);
}

function quantize(floatVec) {
  // L2-normalize then scale to int8 so cosine ≈ dot of stored bytes.
  let sum = 0;
  for (const value of floatVec) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  const out = new Int8Array(floatVec.length);
  for (let i = 0; i < floatVec.length; i += 1) {
    const scaled = Math.round((floatVec[i] / norm) * 127);
    out[i] = Math.max(-127, Math.min(127, scaled));
  }
  return out;
}

async function run() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_embeddings (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    );
  `);

  const todo = db
    .prepare(
      `SELECT h.id AS id, h.image AS image
       FROM card_hashes h
       LEFT JOIN card_embeddings e ON e.id = h.id
       WHERE e.id IS NULL AND h.image IS NOT NULL
       ORDER BY h.rowid`,
    )
    .all();

  const total = todo.length;
  console.log(`${total} cards need embeddings (cap ${MAX})`);
  if (!total) {
    db.close();
    return;
  }

  console.log("Loading CLIP model…");
  const processor = await withRetry(
    () => AutoProcessor.from_pretrained(MODEL_ID),
    4,
    "processor",
  );
  const model = await withRetry(
    () => CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: "q8" }),
    6,
    "model",
  );
  console.log("Model ready.");

  const insert = db.prepare(
    "INSERT OR REPLACE INTO card_embeddings (id, embedding) VALUES (?, ?)",
  );

  let done = 0;
  let failed = 0;
  const limit = Math.min(total, MAX);

  for (let i = 0; i < limit; i += 1) {
    const card = todo[i];
    try {
      const image = await withRetry(
        () => RawImage.read(`${card.image}/low.webp`),
        3,
        "image",
      );
      const inputs = await processor(image);
      const output = await model(inputs);
      const vec = Float32Array.from(output.image_embeds.data);
      const quantized = quantize(vec);
      insert.run(card.id, Buffer.from(quantized.buffer));
      done += 1;
    } catch (error) {
      failed += 1;
      if (failed <= 10) {
        console.warn(`  ! ${card.id}: ${String(error.message).slice(0, 80)}`);
      }
    }
    if (done % 100 === 0 && done > 0) {
      console.log(`  …embedded ${done}/${limit} (failed ${failed})`);
    }
  }

  const count = db.prepare("SELECT COUNT(*) AS c FROM card_embeddings").get().c;
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  console.log(`Done. embedded_this_run=${done} failed=${failed} total_embeddings=${count}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
