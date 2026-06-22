#!/usr/bin/env node
/**
 * Pre-warm the persistent search-result store for the most-visited set browses,
 * so first real visits (and cold serverless instances) are instant instead of
 * paying tens of seconds for a live gather.
 *
 * Drives /api/live-search for the most recent EN + JP sets (default
 * number-sorted browse, page 1). Bounded concurrency, polite delay, skip-fresh.
 *
 *   BASE_URL=http://localhost:3000 SEED_SEARCH_EN=24 SEED_SEARCH_JA=12 \
 *     SEED_SEARCH_CONCURRENCY=2 node scripts/seed-search-cache.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const EN_COUNT = Number(process.env.SEED_SEARCH_EN ?? 24);
const JA_COUNT = Number(process.env.SEED_SEARCH_JA ?? 12);
const CONCURRENCY = Number(process.env.SEED_SEARCH_CONCURRENCY ?? 2);
const DELAY_MS = Number(process.env.SEED_SEARCH_DELAY_MS ?? 300);
const SORTS = (process.env.SEED_SEARCH_SORTS ?? "number-asc").split(",");
const FRESH_TTL_MS = 6 * 60 * 60 * 1000;
const STORE = path.join(process.cwd(), "data", "pokemon-search-cache.sqlite");
const ALWAYS_INCLUDE = ["base1"];

function key(query, setFilter, page, language, sort) {
  return [String(query).trim().toLowerCase(), String(setFilter ?? "").trim().toLowerCase(), page, language, sort].join("|");
}

async function getSets(lang) {
  try {
    const res = await fetch(`${BASE_URL}/api/search-sets?lang=${lang}`, { signal: AbortSignal.timeout(30_000) });
    const data = await res.json();
    return Array.isArray(data.sets) ? data.sets : [];
  } catch {
    return [];
  }
}

function freshKeys() {
  if (!fs.existsSync(STORE)) return new Set();
  try {
    const db = new Database(STORE, { readonly: true, fileMustExist: true });
    const cutoff = new Date(Date.now() - FRESH_TTL_MS).toISOString();
    const rows = db.prepare(`SELECT key FROM search_cache WHERE fetched_at >= ? AND result_count > 0`).all(cutoff);
    db.close();
    return new Set(rows.map((r) => r.key));
  } catch {
    return new Set();
  }
}

function topSets(sets, n) {
  return [...sets]
    .sort((a, b) => String(b.releaseDate ?? "").localeCompare(String(a.releaseDate ?? "")))
    .slice(0, n);
}

async function warm(setId, lang, sort) {
  const url = `${BASE_URL}/api/live-search?set=${encodeURIComponent(setId)}&lang=${lang}&sort=${sort}&page=1`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(85_000) });
    const data = await res.json();
    return { n: data?.results?.length ?? 0, ms: Date.now() - t0, ok: res.ok };
  } catch (e) {
    return { n: 0, ms: Date.now() - t0, ok: false, error: String(e?.message ?? e) };
  }
}

async function run() {
  const [en, ja] = await Promise.all([getSets("en"), getSets("ja")]);
  console.log(`[seed-search] catalog: ${en.length} EN sets, ${ja.length} JA sets`);

  const skip = freshKeys();
  const jobs = [];
  const pushJobs = (sets, lang) => {
    for (const s of sets) {
      for (const sort of SORTS) {
        const k = key("", s.id, 1, lang, sort);
        if (!skip.has(k)) jobs.push({ setId: s.id, lang, sort, name: s.name });
      }
    }
  };
  const enPick = [...new Set([...ALWAYS_INCLUDE, ...topSets(en, EN_COUNT).map((s) => s.id)])]
    .map((id) => en.find((s) => s.id === id) ?? { id, name: id });
  pushJobs(enPick, "en");
  pushJobs(topSets(ja, JA_COUNT), "ja");

  console.log(`[seed-search] ${jobs.length} browses to warm (${skip.size} already fresh) · concurrency ${CONCURRENCY}`);

  let done = 0;
  let withResults = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const r = await warm(job.setId, job.lang, job.sort);
      done += 1;
      if (r.n > 0) withResults += 1;
      console.log(
        `[seed-search] ${done}/${jobs.length} ${job.lang} ${job.setId} (${job.name}) ${job.sort} → ${r.n} results (${r.ms}ms)${r.error ? " ERR " + r.error : ""}`,
      );
      if (DELAY_MS) await new Promise((res) => setTimeout(res, DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length || 1) }, worker));

  console.log(`[seed-search] done — warmed ${done}, with results ${withResults}`);
  if (fs.existsSync(STORE)) {
    const db = new Database(STORE, { readonly: true });
    const rows = db.prepare(`SELECT COUNT(*) n FROM search_cache`).get().n;
    db.close();
    console.log(`[seed-search] store now holds ${rows} browses`);
  }
}

run().catch((e) => {
  console.error("[seed-search] fatal", e);
  process.exit(1);
});
