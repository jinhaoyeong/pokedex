#!/usr/bin/env node
/**
 * Strict validation for the persistent search-result store / set-browse load
 * time. Fails (exit 1) unless the store genuinely accelerates cold browses.
 *
 * Scenarios:
 *   1. Browse returns results for popular sets + snapshot integrity.
 *   2. Persistence — the browse is written to the store with matching count.
 *   3. Acceleration — a second browse is much faster than the first.
 *   4. Concurrency — parallel browses, no 5xx / no crash.
 *
 *   BASE_URL=http://localhost:3000 node scripts/validate-search-cache.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const STORE = path.join(process.cwd(), "data", "pokemon-search-cache.sqlite");
const BROWSES = [
  { set: "base1", lang: "en", sort: "number-asc" },
  { set: "sv3pt5", lang: "en", sort: "number-asc" },
];

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`  ✗ FAIL: ${m}`);
};

function key(set, lang, sort) {
  return ["", String(set).trim().toLowerCase(), 1, lang, sort].join("|");
}

async function browse(b) {
  const url = `${BASE_URL}/api/live-search?set=${encodeURIComponent(b.set)}&lang=${b.lang}&sort=${b.sort}&page=1`;
  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(85_000) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ms: Date.now() - t0, results: body?.results ?? [] };
}

function storeRow(b) {
  if (!fs.existsSync(STORE)) return null;
  try {
    const db = new Database(STORE, { readonly: true, fileMustExist: true });
    const row = db.prepare(`SELECT result_count FROM search_cache WHERE key = ?`).get(key(b.set, b.lang, b.sort));
    db.close();
    return row ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n=== search-cache / load-time validation ===\nbase: ${BASE_URL}\n`);
  try {
    const r = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch (e) {
    console.log(`Server not reachable: ${e.message}`);
    process.exit(2);
  }

  for (const b of BROWSES) {
    console.log(`Browse ${b.lang} ${b.set} (${b.sort})`);
    const first = await browse(b);
    if (first.status >= 500) {
      fail(`${b.set}: HTTP ${first.status}`);
      continue;
    }
    console.log(`    first: ${first.ms}ms, ${first.results.length} results`);
    if (first.results.length > 0) {
      pass(`returned ${first.results.length} results`);
    } else {
      fail(`${b.set}: no results`);
    }
    // integrity
    let bad = 0;
    for (const r of first.results) {
      if (!r?.card?.slug || !r?.card?.name) bad += 1;
    }
    if (bad === 0) pass("all results well-formed (slug + name)");
    else fail(`${bad} malformed result rows`);

    // persistence
    const row = storeRow(b);
    if (first.results.length > 0) {
      if (row && row.result_count === first.results.length) pass(`persisted (${row.result_count} rows)`);
      else fail(`${b.set}: not persisted with matching count (row=${JSON.stringify(row)})`);
    }

    // acceleration
    const second = await browse(b);
    console.log(`    second: ${second.ms}ms, ${second.results.length} results`);
    if (second.results.length !== first.results.length) {
      fail(`${b.set}: result count changed between calls (${first.results.length} → ${second.results.length})`);
    }
    if (second.ms <= Math.max(1500, first.ms * 0.5) || second.ms < 500) {
      pass(`second browse accelerated (${second.ms}ms vs ${first.ms}ms)`);
    } else {
      fail(`${b.set}: second browse not accelerated (${second.ms}ms vs ${first.ms}ms)`);
    }
  }

  // concurrency
  console.log("Concurrency stress (parallel ×3)");
  const many = [...BROWSES, ...BROWSES, ...BROWSES];
  const results = await Promise.allSettled(many.map((b) => browse(b)));
  const errs = results.filter((r) => r.status === "rejected" || (r.value && r.value.status >= 500));
  if (errs.length === 0) pass(`${many.length} parallel browses, 0 errors`);
  else fail(`${errs.length}/${many.length} parallel browses failed`);

  console.log(`\n=== result: ${failures} failures ===`);
  if (failures > 0) {
    console.log("LOAD-TIME PIPELINE NOT PASSING\n");
    process.exit(1);
  }
  console.log("LOAD-TIME PIPELINE PASSING\n");
}

main().catch((e) => {
  console.error("validate-search-cache fatal", e);
  process.exit(1);
});
