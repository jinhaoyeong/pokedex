#!/usr/bin/env node
/**
 * Builds data/pokemon-cards-index.sqlite with English + Japanese card identities (1998-2026).
 * Run: npm run db:seed:cards-index
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SETS_DB_PATH = path.join(ROOT, "data", "pokemon-sets.sqlite");
const OUT_DB_PATH = path.join(ROOT, "data", "pokemon-cards-index.sqlite");
const POKEMON_TCG_API_BASE = "https://api.pokemontcg.io/v2";
const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";
const MIN_YEAR = 1998;
const MAX_YEAR = 2026;
const SET_CONCURRENCY = 4;

function normalizeForSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSlug(languageCode, id) {
  return `${languageCode}--${id}`;
}

function yearFromReleaseDate(value) {
  const match = String(value ?? "").match(/^(\d{4})/);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PokePokedex/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  return response.json();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    DROP TABLE IF EXISTS cards_index;

    CREATE TABLE cards_index (
      slug TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      language_code TEXT NOT NULL,
      set_id TEXT NOT NULL,
      set_code TEXT NOT NULL,
      collector_number TEXT NOT NULL,
      printed_total INTEGER,
      name TEXT NOT NULL,
      english_name TEXT,
      localized_name TEXT,
      rarity TEXT,
      supertype TEXT,
      image_url TEXT,
      release_year INTEGER,
      search_text TEXT NOT NULL
    );

    CREATE INDEX idx_cards_index_search ON cards_index(search_text);
    CREATE INDEX idx_cards_index_collector
      ON cards_index(language_code, collector_number, printed_total);
    CREATE INDEX idx_cards_index_set ON cards_index(set_id, language_code);
  `);
}

async function fetchEnglishSetCards(setId) {
  const cards = [];
  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;

  while ((page - 1) * 250 < totalCount) {
    const payload = await fetchJson(
      `${POKEMON_TCG_API_BASE}/cards?q=set.id:${encodeURIComponent(setId)}&page=${page}&pageSize=250`,
    ).catch(() => null);

    if (!payload?.data?.length) {
      break;
    }

    totalCount = payload.totalCount ?? payload.data.length;
    cards.push(...payload.data);
    page += 1;

    if (payload.data.length < 250) {
      break;
    }
  }

  return cards;
}

async function fetchLocalizedSetCards(languageCode, setId) {
  const payload = await fetchJson(
    `${TCGDEX_API_BASE}/${languageCode}/sets/${encodeURIComponent(setId)}`,
  ).catch(() => null);

  return payload?.cards ?? [];
}

async function main() {
  if (!fs.existsSync(SETS_DB_PATH)) {
    console.error("Missing sets database. Run npm run db:seed:sets first.");
    process.exit(1);
  }

  const setsDb = new Database(SETS_DB_PATH, { readonly: true });
  const setRows = setsDb
    .prepare(
      `SELECT set_id, language_code, name, english_name, code, release_date, printed_total
       FROM tcg_sets
       WHERE language_code IN ('en', 'ja')
       ORDER BY release_date ASC`,
    )
    .all()
    .filter((row) => {
      const year = yearFromReleaseDate(row.release_date);
      return year == null || (year >= MIN_YEAR && year <= MAX_YEAR);
    });
  setsDb.close();

  fs.mkdirSync(path.dirname(OUT_DB_PATH), { recursive: true });
  if (fs.existsSync(OUT_DB_PATH)) {
    fs.unlinkSync(OUT_DB_PATH);
  }

  const db = new Database(OUT_DB_PATH);
  initSchema(db);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO cards_index (
      slug, card_id, language_code, set_id, set_code, collector_number, printed_total,
      name, english_name, localized_name, rarity, supertype, image_url, release_year, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(...row);
    }
  });

  let totalCards = 0;

  await mapWithConcurrency(setRows, SET_CONCURRENCY, async (setRow) => {
    try {
      if (setRow.language_code === "en") {
        const cards = await fetchEnglishSetCards(setRow.set_id);
        const rows = cards.map((card) => [
          buildSlug("en", card.id),
          card.id,
          "en",
          setRow.set_id,
          setRow.code,
          card.number ?? "",
          card.set?.printedTotal ?? setRow.printed_total,
          card.name ?? "Unknown",
          card.name ?? "Unknown",
          card.name ?? "Unknown",
          card.rarity ?? "",
          card.supertype ?? "Pokemon",
          card.images?.large ?? card.images?.small ?? "",
          yearFromReleaseDate(setRow.release_date),
          normalizeForSearch(
            [card.name, setRow.name, setRow.code, card.number, card.rarity]
              .filter(Boolean)
              .join(" "),
          ),
        ]);
        insertMany(rows);
        totalCards += rows.length;
        console.log(`  EN ${setRow.code}: ${rows.length} cards`);
        return;
      }

      const cards = await fetchLocalizedSetCards("ja", setRow.set_id);
      const rows = cards.map((card) => [
        buildSlug("ja", card.id),
        card.id,
        "ja",
        setRow.set_id,
        setRow.code,
        card.localId ?? "",
        setRow.printed_total,
        card.name ?? "Unknown",
        card.name ?? "Unknown",
        card.name ?? "Unknown",
        card.rarity ?? "",
        "Pokemon",
        card.image ?? "",
        yearFromReleaseDate(setRow.release_date),
        normalizeForSearch(
          [card.name, setRow.name, setRow.english_name, setRow.code, card.localId]
            .filter(Boolean)
            .join(" "),
        ),
      ]);
      insertMany(rows);
      totalCards += rows.length;
      console.log(`  JA ${setRow.code}: ${rows.length} cards`);
    } catch (error) {
      console.warn(`  Skipped ${setRow.language_code}/${setRow.code}:`, error.message);
    }
  });

  const officialJapaneseCards = [
    {
      cardId: "37382",
      slug: "ja--official-37382",
      setCode: "SM12",
      collectorNumber: "100",
      printedTotal: 95,
      localizedName: "アルセウス&ディアルガ&パルキアGX",
      englishName: "Arceus & Dialga & Palkia GX",
      rarity: "Super Rare",
      imageUrl:
        "https://www.pokemon-card.com/assets/images/card_images/large/SM12/037382_P_ARUSEUSUDEIARUGAPARUKIAGX.jpg",
    },
    {
      cardId: "41654",
      slug: "ja--official-41654",
      setCode: "S10P",
      collectorNumber: "071",
      printedTotal: 67,
      localizedName: "オリジンパルキアV",
      englishName: "Origin Forme Palkia V",
      rarity: "Super Rare",
      imageUrl:
        "https://www.pokemon-card.com/assets/images/card_images/large/S10P/041654_P_ORIJINPARUKIAV.jpg",
    },
  ];

  for (const card of officialJapaneseCards) {
    insert.run(
      card.slug,
      `official-${card.cardId}`,
      "ja",
      card.setCode,
      card.setCode,
      card.collectorNumber,
      card.printedTotal,
      `${card.localizedName} (${card.englishName})`,
      card.englishName,
      card.localizedName,
      card.rarity,
      "Pokemon",
      card.imageUrl,
      null,
      normalizeForSearch(
        [
          card.localizedName,
          card.englishName,
          card.setCode,
          card.collectorNumber,
          `${card.collectorNumber}/${card.printedTotal}`,
        ].join(" "),
      ),
    );
    totalCards += 1;
  }

  const unique = db.prepare("SELECT COUNT(*) AS c FROM cards_index").get().c;
  db.close();

  const sizeMb = (fs.statSync(OUT_DB_PATH).size / (1024 * 1024)).toFixed(1);
  console.log(`Done. ${unique} cards indexed (${sizeMb} MB) -> ${OUT_DB_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
