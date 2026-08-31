#!/usr/bin/env node
/**
 * Builds data/scan-visual-index.sqlite — a perceptual-hash (dHash) per card so
 * the scanner can match a photo against the whole catalog without relying on
 * OCR. Source is TCGdex (api.tcgdex.net), whose card art lives on
 * assets.tcgdex.net.
 *
 * Resumable: re-running skips cards already hashed, so the full catalog can be
 * built across several runs (locally or in CI).
 *
 * Run: npm run db:seed:scan-index
 * Env:
 *   SCAN_INDEX_LANGS=en,ja   languages to index (default: en)
 *   SCAN_INDEX_MAX_SETS=40   cap sets per language (default: all)
 *   SCAN_INDEX_CONCURRENCY=6 image download concurrency
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DB_PATH = path.join(ROOT, "data", "scan-visual-index.sqlite");
const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";

const LANGS = (process.env.SCAN_INDEX_LANGS ?? "en")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_SETS = process.env.SCAN_INDEX_MAX_SETS
  ? Number.parseInt(process.env.SCAN_INDEX_MAX_SETS, 10)
  : Infinity;
const CONCURRENCY = Number.parseInt(process.env.SCAN_INDEX_CONCURRENCY ?? "6", 10);

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PokePokedex/1.0)" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

/**
 * Compute a 64-bit difference hash from an image buffer. Mirrors the
 * client-side dHash (src/lib/scan/phash.ts): 9x8 grayscale via Rec.601 luma,
 * one bit per left>right neighbor comparison.
 */
async function computeDHash(imageBuffer) {
  // Catalog hashes are a direct 9×8 resize (sharp Lanczos). The live scanner
  // also sends a 72×64 fingerprint that is box-filtered to 9×8 — keep both
  // query hashes on the client so either packing can match this catalog.
  const raw = await sharp(imageBuffer)
    .removeAlpha()
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer();

  const gray = new Array(HASH_WIDTH * HASH_HEIGHT);
  for (let i = 0; i < HASH_WIDTH * HASH_HEIGHT; i += 1) {
    const r = raw[i * 3];
    const g = raw[i * 3 + 1];
    const b = raw[i * 3 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  let hash = 0n;
  let bit = 0n;
  for (let row = 0; row < HASH_HEIGHT; row += 1) {
    for (let col = 0; col < HASH_WIDTH - 1; col += 1) {
      const left = gray[row * HASH_WIDTH + col];
      const right = gray[row * HASH_WIDTH + col + 1];
      if (left > right) {
        hash |= 1n << bit;
      }
      bit += 1n;
    }
  }
  return hash.toString();
}

function openDatabase() {
  fs.mkdirSync(path.dirname(OUT_DB_PATH), { recursive: true });
  const db = new Database(OUT_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_hashes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      set_id TEXT,
      set_name TEXT,
      local_id TEXT,
      lang TEXT NOT NULL,
      image TEXT,
      hash TEXT NOT NULL
    );
  `);
  return db;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await mapper(items[current], current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

async function run() {
  const db = openDatabase();
  const existing = new Set(
    db.prepare("SELECT id FROM card_hashes").all().map((row) => row.id),
  );
  const insert = db.prepare(`
    INSERT OR REPLACE INTO card_hashes
      (id, name, set_id, set_name, local_id, lang, image, hash)
    VALUES (@id, @name, @set_id, @set_name, @local_id, @lang, @image, @hash)
  `);

  let hashed = 0;
  let skipped = 0;
  let failed = 0;

  for (const lang of LANGS) {
    let sets = (await fetchJson(`${TCGDEX_API_BASE}/${lang}/sets`)).filter(
      (set) => set?.id,
    );
    // TCGdex lists sets oldest-first; reverse so modern (most-scanned) sets
    // are indexed soonest.
    sets.reverse();
    if (Number.isFinite(MAX_SETS)) {
      sets = sets.slice(0, MAX_SETS);
    }

    console.log(`[${lang}] ${sets.length} sets to scan`);

    for (const setBrief of sets) {
      let setDetail;
      try {
        setDetail = await fetchJson(
          `${TCGDEX_API_BASE}/${lang}/sets/${encodeURIComponent(setBrief.id)}`,
        );
      } catch (error) {
        console.warn(`  ! set ${setBrief.id} failed: ${error.message}`);
        continue;
      }
      const cards = (setDetail.cards ?? []).filter(
        (card) => card?.id && card?.image && !existing.has(card.id),
      );
      if (!cards.length) {
        continue;
      }

      await mapWithConcurrency(cards, CONCURRENCY, async (card) => {
        const imageUrl = `${card.image}/low.webp`;
        try {
          const response = await fetch(imageUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; PokePokedex/1.0)" },
          });
          if (!response.ok) {
            failed += 1;
            return;
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          const hash = await computeDHash(buffer);
          insert.run({
            id: card.id,
            name: card.name ?? "",
            set_id: setBrief.id,
            set_name: setDetail.name ?? setBrief.name ?? "",
            local_id: String(card.localId ?? ""),
            lang,
            image: card.image,
            hash,
          });
          existing.add(card.id);
          hashed += 1;
          if (hashed % 200 === 0) {
            console.log(`  …hashed ${hashed} (set ${setBrief.id})`);
          }
        } catch {
          failed += 1;
        }
      });

      console.log(`  [${lang}] ${setBrief.id} done — total hashed ${hashed}`);
    }
  }

  const total = db.prepare("SELECT COUNT(*) AS c FROM card_hashes").get().c;
  db.close();
  console.log(
    `Done. hashed=${hashed} skipped=${skipped} failed=${failed} total_in_index=${total}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
