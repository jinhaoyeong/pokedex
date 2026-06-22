#!/usr/bin/env node
/**
 * Self-hosted graded-population pipeline — seed / refresh driver.
 *
 * Warms the local SQLite population store (data/pokemon-psa-population.sqlite)
 * by driving the app's own /api/psa endpoint for a batch of cards. The endpoint
 * scrapes once and writes the parsed snapshot through to the store, so future
 * runtime reads are local-first (zero network on the hot path).
 *
 * Realistic, polite operation: bounded concurrency, inter-batch delay, and it
 * SKIPS cards whose store row is still fresh — so re-runs are cheap and
 * resumable.
 *
 *   BASE_URL=http://localhost:3000 SEED_PSA_MAX=40 SEED_PSA_CONCURRENCY=3 \
 *     node scripts/seed-psa-population.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CONCURRENCY = Number(process.env.SEED_PSA_CONCURRENCY ?? 3);
const MAX = process.env.SEED_PSA_MAX ? Number(process.env.SEED_PSA_MAX) : Infinity;
const BATCH_DELAY_MS = Number(process.env.SEED_PSA_DELAY_MS ?? 400);
const FRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const STORE_PATH = path.join(process.cwd(), "data", "pokemon-psa-population.sqlite");
const SEED_PATH = path.join(process.cwd(), "data", "pokemon-cards-seed.json");

const CURATED = [
  { setName: "Base Set", cardName: "Charizard", cardNumber: "4", setTotal: 102, rarity: "Rare Holo" },
  { setName: "Base Set", cardName: "Blastoise", cardNumber: "2", setTotal: 102, rarity: "Rare Holo" },
  { setName: "Base Set", cardName: "Venusaur", cardNumber: "15", setTotal: 102, rarity: "Rare Holo" },
  { setName: "Jungle", cardName: "Wigglytuff", cardNumber: "16", setTotal: 64, rarity: "Rare Holo" },
  { setName: "Fossil", cardName: "Dragonite", cardNumber: "4", setTotal: 62, rarity: "Rare Holo" },
  { setName: "Evolving Skies", cardName: "Umbreon VMAX", cardNumber: "215", setTotal: 203, rarity: "Secret Rare" },
  { setName: "151", cardName: "Charizard ex", cardNumber: "199", setTotal: 165, rarity: "Special Illustration Rare" },
  { setName: "Surging Sparks", cardName: "Pikachu ex", cardNumber: "238", setTotal: 191, rarity: "Special Illustration Rare" },
];

function norm(value) {
  return (value ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function populationKey({ language, setCode, setName, cardName, cardNumber }) {
  return ["v1", norm(language || "en"), norm(setCode), norm(setName), norm(cardName), norm(cardNumber)].join("|");
}

function loadSeedCards() {
  if (!fs.existsSync(SEED_PATH)) {
    return [];
  }
  const data = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data.cards)
      ? data.cards
      : Object.values(data);
  return items
    .filter((c) => c && c.setName && c.name && (c.collectorNumber || c.number))
    .map((c) => ({
      setName: c.setName,
      cardName: c.englishName || c.name,
      cardNumber: String(c.collectorNumber ?? c.number),
      setTotal: c.setTotal ?? c.setPrintedTotal,
      rarity: c.rarity,
      setCode: c.setCode,
      language: c.language ?? "en",
    }));
}

function freshKeys() {
  if (!fs.existsSync(STORE_PATH)) {
    return new Set();
  }
  try {
    const db = new Database(STORE_PATH, { readonly: true, fileMustExist: true });
    const cutoff = new Date(Date.now() - FRESH_TTL_MS).toISOString();
    const rows = db
      .prepare(`SELECT key FROM psa_population WHERE fetched_at >= ? AND grade_count > 0`)
      .all(cutoff);
    db.close();
    return new Set(rows.map((r) => r.key));
  } catch {
    return new Set();
  }
}

async function warmCard(card) {
  const params = new URLSearchParams({
    setName: card.setName,
    cardName: card.cardName,
    cardNumber: card.cardNumber,
  });
  if (card.setTotal) params.set("setTotal", String(card.setTotal));
  if (card.rarity) params.set("rarity", card.rarity);

  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/psa?${params.toString()}`, {
      signal: AbortSignal.timeout(75_000),
    });
    const data = await res.json();
    const pop = data?.psaPopulation;
    const grades = pop?.grades?.length ?? 0;
    return {
      ok: res.ok,
      grades,
      total: pop?.totalCertified ?? null,
      ms: Date.now() - t0,
      status: pop?.status ?? "none",
    };
  } catch (error) {
    return { ok: false, grades: 0, total: null, ms: Date.now() - t0, error: String(error?.message ?? error) };
  }
}

async function run() {
  const skip = freshKeys();
  const seen = new Set();
  const all = [...CURATED, ...loadSeedCards()];
  const queue = [];

  for (const card of all) {
    const key = populationKey(card);
    if (seen.has(key) || skip.has(key)) {
      continue;
    }
    seen.add(key);
    queue.push(card);
    if (queue.length >= MAX) break;
  }

  console.log(
    `[seed-psa] ${all.length} candidates · ${skip.size} already fresh · ${queue.length} to warm · concurrency ${CONCURRENCY}`,
  );

  let done = 0;
  let withPop = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const index = cursor++;
      const card = queue[index];
      const r = await warmCard(card);
      done += 1;
      if (r.grades > 0) withPop += 1;
      const tag = r.grades > 0 ? `pop ${r.grades}g/${r.total ?? "?"}` : r.error ? `ERR ${r.error}` : "no pop";
      console.log(
        `[seed-psa] ${done}/${queue.length} ${card.setName} · ${card.cardName} #${card.cardNumber} → ${tag} (${r.ms}ms)`,
      );
      if (BATCH_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));

  console.log(`[seed-psa] done — warmed ${done}, with population ${withPop}`);
  if (fs.existsSync(STORE_PATH)) {
    const db = new Database(STORE_PATH, { readonly: true });
    const total = db.prepare(`SELECT COUNT(*) n FROM psa_population`).get().n;
    const graded = db.prepare(`SELECT COUNT(*) n FROM psa_population WHERE grade_count > 0`).get().n;
    db.close();
    console.log(`[seed-psa] store now holds ${total} rows (${graded} with population grades)`);
  }
}

run().catch((error) => {
  console.error("[seed-psa] fatal", error);
  process.exit(1);
});
