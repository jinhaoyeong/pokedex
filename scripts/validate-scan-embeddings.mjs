#!/usr/bin/env node
/**
 * Validates the scan visual embedding index: for sampled catalog cards, embed
 * the official art with the same q4 CLIP model the browser uses and verify the
 * correct card ranks #1 with a strong cosine score.
 *
 * Run: npm run validate:scan-embeddings
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

const MIN_TOP1_SCORE = 0.85;
const SAMPLE_EVERY = Number.parseInt(process.env.SCAN_VAL_EVERY ?? "500", 10);
const MUST_PASS = [
  { id: "base1-4", label: "Base Set Charizard" },
  { id: "base1-58", label: "Base Set Pikachu" },
  { id: "sv03.5-199", label: "151 Charizard ex" },
];

env.allowLocalModels = false;

function l2Normalize(floatVec) {
  let sum = 0;
  for (const value of floatVec) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(floatVec.length);
  for (let i = 0; i < floatVec.length; i += 1) {
    out[i] = floatVec[i] / norm;
  }
  return out;
}

function loadIndex() {
  const db = new Database(DB_PATH, { readonly: true });
  const hashes = db
    .prepare(
      "SELECT id, name, set_name, local_id, lang, image FROM card_hashes",
    )
    .all();
  const embedRows = db
    .prepare("SELECT id, embedding FROM card_embeddings")
    .all();
  db.close();

  const embeddings = new Map();
  for (const row of embedRows) {
    embeddings.set(
      row.id,
      new Int8Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length),
    );
  }
  return { hashes, embeddings };
}

function searchByEmbedding(vector, index, embeddings, limit = 5) {
  const scored = [];
  for (const entry of index) {
    const stored = embeddings.get(entry.id);
    if (!stored || stored.length !== vector.length) continue;
    let dot = 0;
    for (let i = 0; i < vector.length; i += 1) {
      dot += vector[i] * stored[i];
    }
    scored.push({ entry, score: dot / 127 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

async function embedImage(processor, model, imageUrl) {
  const image = await RawImage.read(`${imageUrl}/low.webp`);
  const inputs = await processor(image);
  const output = await model(inputs);
  return l2Normalize(Float32Array.from(output.image_embeds.data));
}

async function run() {
  const { hashes, embeddings } = loadIndex();
  if (hashes.length !== embeddings.size) {
    throw new Error(
      `Index mismatch: ${hashes.length} hashes vs ${embeddings.size} embeddings`,
    );
  }
  console.log(`Index OK: ${hashes.length} cards with embeddings`);

  const byId = new Map(hashes.map((row) => [row.id, row]));
  for (const must of MUST_PASS) {
    if (!byId.has(must.id)) {
      throw new Error(`Required card missing from index: ${must.id}`);
    }
  }

  console.log("Loading q4 CLIP model…");
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
    dtype: "q4",
  });
  console.log("Model ready.");

  const sampleIds = hashes
    .filter((_, i) => i % SAMPLE_EVERY === 0)
    .map((row) => row.id);
  for (const must of MUST_PASS) {
    if (!sampleIds.includes(must.id)) sampleIds.unshift(must.id);
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const id of sampleIds) {
    const entry = byId.get(id);
    if (!entry?.image) continue;
    try {
      const vector = await embedImage(processor, model, entry.image);
      const hits = searchByEmbedding(vector, hashes, embeddings, 3);
      const top = hits[0];
      const ok =
        top?.entry.id === id && top.score >= MIN_TOP1_SCORE;
      if (ok) {
        passed += 1;
        if (MUST_PASS.some((m) => m.id === id)) {
          const label = MUST_PASS.find((m) => m.id === id)?.label ?? id;
          console.log(
            `  ✓ ${label} (${id}): rank #1 at ${(top.score * 100).toFixed(1)}%`,
          );
        }
      } else {
        failed += 1;
        failures.push({
          id,
          name: entry.name,
          topId: top?.entry.id,
          topName: top?.entry.name,
          topScore: top?.score ?? 0,
        });
      }
    } catch (error) {
      failed += 1;
      failures.push({ id, name: entry.name, error: String(error.message ?? error) });
    }
  }

  console.log(`\nSampled ${sampleIds.length} cards: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error("\nFailures:");
    for (const f of failures.slice(0, 10)) {
      if (f.error) {
        console.error(`  ${f.id} (${f.name}): ${f.error}`);
      } else {
        console.error(
          `  ${f.id} (${f.name}): got #1=${f.topId} (${f.topName}) @ ${(f.topScore * 100).toFixed(1)}%`,
        );
      }
    }
    process.exit(1);
  }

  console.log("\nvalidate:scan-embeddings PASSED");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
