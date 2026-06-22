#!/usr/bin/env node
/**
 * Strict validation harness for the self-hosted graded-population pipeline.
 *
 * Exercises realistic scenarios against a running server and FAILS (exit 1) when
 * the pipeline is not behaving — it does not accept "it returned something" as
 * success. Scenarios:
 *   1. Cold fetch population for popular EN cards (require a minimum hit rate).
 *   2. Snapshot integrity (counts are sane integers, totals consistent, gem rate
 *      in range, confidence in [0,1], no NaN).
 *   3. Persistence — every card that returned population has a store row.
 *   4. Store-serve — a second fetch returns the SAME fetchedAt as the stored row
 *      (population not re-scraped). Strict when MARKET_DATA_CACHE=false.
 *   5. Concurrency stress — many parallel requests, no 5xx / no crash.
 *   6. Caching effect — warm population path is not slower than cold.
 *
 *   BASE_URL=http://localhost:3000 node scripts/validate-psa-population.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import Database from "better-sqlite3";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const STORE_PATH = path.join(process.cwd(), "data", "pokemon-psa-population.sqlite");
const CACHE_DISABLED = process.env.MARKET_DATA_CACHE === "false";
const MIN_POP_HIT_RATE = Number(process.env.VALIDATE_MIN_POP_RATE ?? 0.6);

// Popular, high-population EN cards that should reliably resolve a census.
const CARDS = [
  { setName: "Base Set", cardName: "Charizard", cardNumber: "4", setTotal: 102, rarity: "Rare Holo", expectPop: true },
  { setName: "Base Set", cardName: "Blastoise", cardNumber: "2", setTotal: 102, rarity: "Rare Holo", expectPop: true },
  { setName: "Jungle", cardName: "Wigglytuff", cardNumber: "16", setTotal: 64, rarity: "Rare Holo", expectPop: true },
  { setName: "Evolving Skies", cardName: "Umbreon VMAX", cardNumber: "215", setTotal: 203, rarity: "Secret Rare", expectPop: true },
  { setName: "151", cardName: "Charizard ex", cardNumber: "199", setTotal: 165, rarity: "Special Illustration Rare", expectPop: true },
];

let hardFailures = 0;
let softWarnings = 0;
const log = (...a) => console.log(...a);
const pass = (m) => log(`  ✓ ${m}`);
const fail = (m) => {
  hardFailures += 1;
  log(`  ✗ FAIL: ${m}`);
};
const warn = (m) => {
  softWarnings += 1;
  log(`  ! warn: ${m}`);
};

function norm(v) {
  return (v ?? "").toString().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}
function populationKey({ language, setCode, setName, cardName, cardNumber }) {
  return ["v1", norm(language || "en"), norm(setCode), norm(setName), norm(cardName), norm(cardNumber)].join("|");
}

async function fetchPsa(card) {
  const params = new URLSearchParams({
    setName: card.setName,
    cardName: card.cardName,
    cardNumber: card.cardNumber,
  });
  if (card.setTotal) params.set("setTotal", String(card.setTotal));
  if (card.rarity) params.set("rarity", card.rarity);
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/psa?${params.toString()}`, {
    signal: AbortSignal.timeout(80_000),
  });
  const ms = Date.now() - t0;
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ms, body };
}

function checkIntegrity(card, pop) {
  const label = `${card.cardName} #${card.cardNumber}`;
  if (!pop) return;

  // totalCertified sane
  if (pop.totalCertified != null) {
    if (!Number.isFinite(pop.totalCertified) || pop.totalCertified < 0) {
      fail(`${label}: totalCertified not a sane number (${pop.totalCertified})`);
    }
  }
  let gradeSum = 0;
  for (const g of pop.grades ?? []) {
    if (typeof g.count !== "number" || !Number.isFinite(g.count) || g.count < 0 || g.count % 1 !== 0) {
      fail(`${label}: grade ${g.grade} has invalid count ${g.count}`);
    }
    if (!g.grade || typeof g.grade !== "string") {
      fail(`${label}: grade row missing label`);
    }
    if (g.confidenceScore != null && (g.confidenceScore < 0 || g.confidenceScore > 1)) {
      fail(`${label}: grade ${g.grade} confidenceScore out of [0,1] (${g.confidenceScore})`);
    }
    gradeSum += g.count || 0;
  }
  // Sum of grade counts must not wildly exceed the reported total certified.
  if (pop.totalCertified && gradeSum > pop.totalCertified * 1.5 + 5) {
    fail(`${label}: grade counts sum ${gradeSum} >> totalCertified ${pop.totalCertified}`);
  }
  if ((pop.grades?.length ?? 0) > 0 && pop.status === "verified" && !pop.totalCertified && gradeSum === 0) {
    warn(`${label}: verified population but no totals/counts`);
  }
  if (pop.confidenceScore != null && (pop.confidenceScore < 0 || pop.confidenceScore > 1)) {
    fail(`${label}: snapshot confidenceScore out of [0,1] (${pop.confidenceScore})`);
  }
}

function readStoreRow(card) {
  if (!fs.existsSync(STORE_PATH)) return null;
  try {
    const db = new Database(STORE_PATH, { readonly: true, fileMustExist: true });
    const row = db
      .prepare(`SELECT snapshot_json, grade_count, fetched_at FROM psa_population WHERE key = ?`)
      .get(populationKey(card));
    db.close();
    return row ?? null;
  } catch {
    return null;
  }
}

async function main() {
  log(`\n=== PSA population pipeline validation ===`);
  log(`base: ${BASE_URL} · in-memory cache: ${CACHE_DISABLED ? "DISABLED (store-strict)" : "enabled"}\n`);

  // health
  try {
    const r = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch (e) {
    log(`Server not reachable at ${BASE_URL}: ${e.message}`);
    process.exit(2);
  }

  // ---- Scenario 1+2: cold fetch + integrity ----
  log("Scenario 1/2 — cold fetch + snapshot integrity");
  const cold = new Map();
  let popHits = 0;
  let expected = 0;
  for (const card of CARDS) {
    const { status, ms, body } = await fetchPsa(card);
    if (status >= 500) {
      fail(`${card.cardName}: HTTP ${status}`);
      continue;
    }
    const pop = body?.psaPopulation ?? null;
    cold.set(card, { ms, pop });
    const grades = pop?.grades?.length ?? 0;
    if (card.expectPop) {
      expected += 1;
      if (grades > 0 && pop.totalCertified > 0) popHits += 1;
    }
    checkIntegrity(card, pop);
    log(`    ${card.cardName} #${card.cardNumber}: ${grades}g / total ${pop?.totalCertified ?? "—"} (${ms}ms)`);
  }
  const hitRate = expected ? popHits / expected : 1;
  if (hitRate >= MIN_POP_HIT_RATE) {
    pass(`population hit rate ${(hitRate * 100).toFixed(0)}% (>= ${(MIN_POP_HIT_RATE * 100).toFixed(0)}% required)`);
  } else {
    fail(`population hit rate ${(hitRate * 100).toFixed(0)}% below required ${(MIN_POP_HIT_RATE * 100).toFixed(0)}%`);
  }

  // ---- Scenario 3: persistence ----
  log("Scenario 3 — persistence to local store");
  let persisted = 0;
  let persistExpected = 0;
  for (const [card, { pop }] of cold) {
    if (!pop || (pop.grades?.length ?? 0) === 0) continue;
    persistExpected += 1;
    const row = readStoreRow(card);
    if (row && row.grade_count > 0) {
      persisted += 1;
    } else {
      fail(`${card.cardName}: population returned but not persisted to store`);
    }
  }
  if (persistExpected && persisted === persistExpected) {
    pass(`all ${persisted} populated cards persisted to store`);
  } else if (!persistExpected) {
    warn("no populated cards to persist (sources may be degraded)");
  }

  // ---- Scenario 4: store-serve (no re-scrape) ----
  log("Scenario 4 — second fetch served from store (no re-scrape)");
  let stableServe = 0;
  let serveExpected = 0;
  const warm = new Map();
  for (const [card, { pop }] of cold) {
    if (!pop || (pop.grades?.length ?? 0) === 0) continue;
    serveExpected += 1;
    const { ms, body } = await fetchPsa(card);
    const pop2 = body?.psaPopulation ?? null;
    warm.set(card, ms);
    const row = readStoreRow(card);
    const storeFetchedAt = row ? JSON.parse(row.snapshot_json).fetchedAt : null;
    if (pop2 && pop2.fetchedAt && pop2.fetchedAt === storeFetchedAt) {
      stableServe += 1;
    } else if (pop2 && pop2.fetchedAt === pop.fetchedAt) {
      // fetchedAt stable across calls — caching effective even if store/in-memory
      stableServe += 1;
    } else {
      (CACHE_DISABLED ? fail : warn)(
        `${card.cardName}: population fetchedAt changed between calls (store not serving)`,
      );
    }
  }
  if (serveExpected && stableServe === serveExpected) {
    pass(`all ${stableServe} cards served stable population (no re-scrape)`);
  }

  // ---- Scenario 5: concurrency stress ----
  log("Scenario 5 — concurrency stress (parallel ×2)");
  const stress = [...CARDS, ...CARDS];
  const results = await Promise.allSettled(stress.map((c) => fetchPsa(c)));
  const errors = results.filter((r) => r.status === "rejected" || (r.value && r.value.status >= 500));
  if (errors.length === 0) {
    pass(`${stress.length} parallel requests, 0 server errors`);
  } else {
    fail(`${errors.length}/${stress.length} parallel requests failed (5xx/throw)`);
  }

  // ---- Scenario 6: caching effect ----
  log("Scenario 6 — warm population path not slower than cold");
  const coldTimes = [...cold.values()].map((v) => v.ms).filter(Boolean);
  const warmTimes = [...warm.values()].filter(Boolean);
  if (coldTimes.length && warmTimes.length) {
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const mc = med(coldTimes);
    const mw = med(warmTimes);
    log(`    median cold ${mc}ms · median warm ${mw}ms`);
    if (mw <= mc * 1.15) pass(`warm not slower than cold (${mw}ms <= ${mc}ms)`);
    else warn(`warm slower than cold (${mw}ms > ${mc}ms) — external sources may be flaky this run`);
  }

  log(`\n=== result: ${hardFailures} failures, ${softWarnings} warnings ===`);
  if (hardFailures > 0) {
    log("PIPELINE NOT PASSING\n");
    process.exit(1);
  }
  log("PIPELINE PASSING\n");
}

main().catch((error) => {
  console.error("validate-psa-population fatal", error);
  process.exit(1);
});
