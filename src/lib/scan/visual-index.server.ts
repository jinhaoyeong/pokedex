import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { VisualIndexHit } from "@/lib/scan/types";

/**
 * Server-side visual index: a perceptual hash (dHash) per catalog card, built
 * by scripts/seed-scan-index.mjs. A scanned photo's hash is matched against the
 * whole index by Hamming distance so cards can be recognized from artwork
 * without relying on OCR. Loaded once and kept in memory (a few hundred KB).
 */

interface IndexEntry {
  id: string;
  name: string;
  setName: string;
  localId: string;
  lang: string;
  image: string;
  hash: bigint;
}

let entries: IndexEntry[] | null = null;
let unavailable = false;

function getDatabasePath() {
  return path.join(process.cwd(), "data", "scan-visual-index.sqlite");
}

interface HashRow {
  id: string;
  name: string;
  set_name: string | null;
  local_id: string | null;
  lang: string;
  image: string | null;
  hash: string;
}

function loadIndex(): IndexEntry[] | null {
  if (entries) {
    return entries;
  }
  if (unavailable) {
    return null;
  }

  const dbPath = getDatabasePath();
  if (!fs.existsSync(dbPath)) {
    unavailable = true;
    return null;
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        "SELECT id, name, set_name, local_id, lang, image, hash FROM card_hashes",
      )
      .all() as HashRow[];
    db.close();

    entries = rows.map((row) => ({
      id: row.id,
      name: row.name,
      setName: row.set_name ?? "",
      localId: row.local_id ?? "",
      lang: row.lang,
      image: row.image ?? "",
      hash: BigInt(row.hash),
    }));
    return entries;
  } catch {
    unavailable = true;
    return null;
  }
}

export function isVisualIndexReady(): boolean {
  return Boolean(loadIndex()?.length);
}

export function visualIndexSize(): number {
  return loadIndex()?.length ?? 0;
}

function popcount(value: bigint): number {
  let count = 0;
  let v = value;
  while (v > 0n) {
    v &= v - 1n;
    count += 1;
  }
  return count;
}

/**
 * Return the nearest cards to `hash` by Hamming distance. `maxDistance` filters
 * out weak matches (64-bit hash; ~12 bits ≈ noticeably different art).
 */
export function searchByHash(
  hash: bigint,
  limit = 24,
  maxDistance = 26,
): VisualIndexHit[] {
  const index = loadIndex();
  if (!index) {
    return [];
  }

  const scored: Array<{ entry: IndexEntry; distance: number }> = [];
  for (const entry of index) {
    const distance = popcount(hash ^ entry.hash);
    if (distance <= maxDistance) {
      scored.push({ entry, distance });
    }
  }

  scored.sort((a, b) => a.distance - b.distance);

  return scored.slice(0, limit).map(({ entry, distance }) => ({
    id: entry.id,
    name: entry.name,
    setName: entry.setName,
    localId: entry.localId,
    lang: entry.lang,
    image: entry.image,
    score: 1 - distance / 64,
  }));
}
