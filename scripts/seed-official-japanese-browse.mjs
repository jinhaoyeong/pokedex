#!/usr/bin/env node
//
// Builds data/official-japanese-browse-seed.json — bundled card lists for
// Japanese sets harvested from pokemon-card.com. Production serverless cannot
// reach pokemon-card.com reliably, and TCGdex is missing card records for many
// Japanese sets, so this seed is the guaranteed source of cards for Japanese
// set browsing.
//
// It seeds two groups, keyed (uppercased) so the runtime's set-code candidates
// resolve them:
//   1. Official-only supplement sets (data/official-japanese-set-supplements.json)
//      — keyed by set id, fetched via each set's officialBrowseCode. These are
//      guarded by validate-japanese-supplement-sets.mjs.
//   2. Every Japanese set in the local set database (data/pokemon-sets.sqlite),
//      fetched via its set code. Only sets pokemon-card.com actually returns
//      cards for are kept.
//
// Run: npm run db:seed:official-jp-browse
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SUPPLEMENTS_PATH = path.join(ROOT, "data", "official-japanese-set-supplements.json");
const SETS_DB_PATH = path.join(ROOT, "data", "pokemon-sets.sqlite");
const OUTPUT_PATH = path.join(ROOT, "data", "official-japanese-browse-seed.json");

const POKEMON_CARD_JP_BASE_URL = "https://www.pokemon-card.com";
const HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const SET_CONCURRENCY = 6;

async function fetchBrowsePage(setCode, page) {
  const params = new URLSearchParams({
    keyword: "",
    regulation_sidebar_form: "all",
    pg: setCode,
    illust: "",
    sm_and_keyword: "true",
    page: String(page),
  });

  const response = await fetch(
    `${POKEMON_CARD_JP_BASE_URL}/card-search/resultAPI.php?${params.toString()}`,
    { headers: HEADERS, signal: AbortSignal.timeout(20_000) },
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${setCode} page ${page}`);
  }

  const payload = await response.json();

  if (payload.result !== 1 || !Array.isArray(payload.cardList)) {
    throw new Error(`Invalid payload for ${setCode} page ${page}`);
  }

  return payload;
}

async function fetchAllCards(setCode) {
  const firstPage = await fetchBrowsePage(setCode, 1);

  if (!firstPage.cardList.length) {
    return null;
  }

  const maxPage = firstPage.maxPage ?? 1;
  const pages = [firstPage];

  for (let page = 2; page <= maxPage; page += 1) {
    pages.push(await fetchBrowsePage(setCode, page));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const cardList = pages.flatMap((page) => page.cardList);
  const unique = cardList.filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.cardID === item.cardID) === index,
  );

  return { hitCnt: firstPage.hitCnt ?? unique.length, cardList: unique };
}

function readJapaneseSetCodes() {
  if (!fs.existsSync(SETS_DB_PATH)) {
    console.warn(`! ${SETS_DB_PATH} not found; seeding supplement sets only.`);
    return [];
  }
  const db = new Database(SETS_DB_PATH, { readonly: true });
  const rows = db
    .prepare("SELECT DISTINCT code FROM tcg_sets WHERE language_code = 'ja' AND code IS NOT NULL")
    .all();
  db.close();
  return rows.map((row) => String(row.code).trim()).filter(Boolean);
}

async function mapWithConcurrency(items, concurrency, worker) {
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function main() {
  const supplements = JSON.parse(fs.readFileSync(SUPPLEMENTS_PATH, "utf8"));
  const sets = {};

  // Build the full work list: supplements (keyed by id, fetched via browse code)
  // plus every Japanese set code from the local database.
  const jobs = new Map(); // key -> pg code to fetch
  for (const entry of supplements.sets ?? []) {
    const browseCode = entry.officialBrowseCode?.trim() || entry.code?.trim();
    if (browseCode && entry.id?.trim()) {
      jobs.set(entry.id.trim().toUpperCase(), browseCode);
    }
  }
  for (const code of readJapaneseSetCodes()) {
    const key = code.toUpperCase();
    if (!jobs.has(key)) {
      jobs.set(key, code);
    }
  }

  const entries = [...jobs.entries()];
  console.log(`Harvesting ${entries.length} Japanese sets from pokemon-card.com…`);

  let withCards = 0;
  let totalCards = 0;
  await mapWithConcurrency(entries, SET_CONCURRENCY, async ([key, pg]) => {
    try {
      const setData = await fetchAllCards(pg);
      if (setData?.cardList.length) {
        sets[key] = setData;
        withCards += 1;
        totalCards += setData.cardList.length;
        console.log(`  ✓ ${key} (${pg}): ${setData.cardList.length} cards`);
      }
    } catch (error) {
      console.warn(`  ! ${key} (${pg}) failed: ${error.message}`);
    }
  });

  // Guardrail: every supplement set must end up with cards.
  for (const entry of supplements.sets ?? []) {
    const key = entry.id?.trim().toUpperCase();
    if (key && !sets[key]?.cardList?.length) {
      throw new Error(`Supplement set ${key} produced no seed cards; aborting to avoid regression.`);
    }
  }

  const output = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sets,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output)}\n`);
  console.log(
    `Wrote ${OUTPUT_PATH}: ${withCards}/${entries.length} sets, ${totalCards} cards.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
