#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SUPPLEMENTS_PATH = path.join(ROOT, "data", "official-japanese-set-supplements.json");
const OUTPUT_PATH = path.join(ROOT, "data", "official-japanese-browse-seed.json");

const POKEMON_CARD_JP_BASE_URL = "https://www.pokemon-card.com";
const HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

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
    { headers: HEADERS },
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
  const maxPage = firstPage.maxPage ?? 1;
  const pages = [firstPage];

  for (let page = 2; page <= maxPage; page += 1) {
    pages.push(await fetchBrowsePage(setCode, page));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const cardList = pages.flatMap((page) => page.cardList);
  const unique = cardList.filter(
    (item, index, items) => items.findIndex((candidate) => candidate.cardID === item.cardID) === index,
  );

  return {
    hitCnt: firstPage.hitCnt ?? unique.length,
    cardList: unique,
  };
}

async function main() {
  const supplements = JSON.parse(fs.readFileSync(SUPPLEMENTS_PATH, "utf8"));
  const sets = {};

  for (const entry of supplements.sets ?? []) {
    const browseCode = entry.officialBrowseCode?.trim() || entry.code?.trim();

    if (!browseCode) {
      continue;
    }

    console.log(`Fetching ${entry.id} (${browseCode})...`);
    const setData = await fetchAllCards(browseCode);
    sets[entry.id.trim().toUpperCase()] = setData;
    console.log(`  ${setData.cardList.length} cards`);
  }

  const output = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sets,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
