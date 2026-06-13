#!/usr/bin/env node
/**
 * Seeds data/pokemon-sets.sqlite from Pokemon TCG API (EN) and TCGdex (all languages).
 * Run: npm run db:seed:sets
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "pokemon-sets.sqlite");
const OFFICIAL_JA_SUPPLEMENTS_PATH = path.join(
  ROOT,
  "data",
  "official-japanese-set-supplements.json",
);
const POKEMON_TCG_API_BASE = "https://api.pokemontcg.io/v2";
const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";

const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "pt-br", label: "Portuguese (Brazil)" },
  { code: "pt-pt", label: "Portuguese (Portugal)" },
  { code: "de", label: "German" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-tw", label: "Chinese Traditional" },
  { code: "id", label: "Indonesian" },
  { code: "th", label: "Thai" },
  { code: "zh-cn", label: "Chinese Simplified" },
];

function normalizeForSearch(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSetCode(setId) {
  return setId.trim().toUpperCase();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PokePokedex/1.0; +https://github.com/pokepokedex)",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  return response.json();
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    DROP TABLE IF EXISTS tcg_sets;

    CREATE TABLE tcg_sets (
      set_id TEXT NOT NULL,
      language_code TEXT NOT NULL,
      name TEXT NOT NULL,
      english_name TEXT,
      code TEXT NOT NULL,
      series TEXT,
      release_date TEXT NOT NULL DEFAULT '',
      printed_total INTEGER,
      total INTEGER,
      search_text TEXT NOT NULL,
      PRIMARY KEY (set_id, language_code)
    );

    CREATE INDEX idx_tcg_sets_search ON tcg_sets(search_text);
    CREATE INDEX idx_tcg_sets_lang_release ON tcg_sets(language_code, release_date DESC);
    CREATE INDEX idx_tcg_sets_code ON tcg_sets(code);
    CREATE INDEX idx_tcg_sets_id ON tcg_sets(set_id);
  `);
}

async function fetchEnglishSets() {
  const payload = await fetchJson(`${POKEMON_TCG_API_BASE}/sets`);
  return payload.data ?? [];
}

async function fetchTcgdexSets(languageCode) {
  return fetchJson(`${TCGDEX_API_BASE}/${languageCode}/sets`).catch(() => []);
}

async function fetchTcgdexEnglishSetNames() {
  const sets = await fetchTcgdexSets("en");
  return new Map(sets.map((set) => [set.id, set.name]));
}

function buildSearchText({ name, englishName, code, series, setId }) {
  return normalizeForSearch(
    [name, englishName, code, series, setId].filter(Boolean).join(" "),
  );
}

function loadOfficialJapaneseSetSupplements() {
  if (!fs.existsSync(OFFICIAL_JA_SUPPLEMENTS_PATH)) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(OFFICIAL_JA_SUPPLEMENTS_PATH, "utf8"));
    return Array.isArray(payload.sets) ? payload.sets : [];
  } catch {
    return [];
  }
}

function insertOfficialJapaneseSupplements(insertSet) {
  const supplements = loadOfficialJapaneseSetSupplements();
  let inserted = 0;

  for (const entry of supplements) {
    const localizedName = String(entry.localizedName ?? "").trim();
    const englishName = String(entry.englishName ?? "").trim();
    const id = String(entry.id ?? entry.code ?? "").trim();
    const code = normalizeSetCode(String(entry.code ?? entry.id ?? ""));

    if (!id || !localizedName) {
      continue;
    }

    const displayName =
      englishName && englishName !== localizedName
        ? `${localizedName} (${englishName})`
        : localizedName;

    insertSet.run(
      id,
      "ja",
      displayName,
      englishName || null,
      code,
      "Japanese",
      entry.releaseDate ?? "",
      entry.printedTotal ?? null,
      entry.total ?? entry.printedTotal ?? null,
      buildSearchText({
        name: displayName,
        englishName,
        code,
        series: "Japanese",
        setId: id,
      }),
    );
    inserted += 1;
  }

  return inserted;
}

async function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  console.log("Fetching English sets from Pokemon TCG API...");
  const englishApiSets = await fetchEnglishSets();

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  initSchema(db);

  const insertSet = db.prepare(`
    INSERT OR REPLACE INTO tcg_sets (
      set_id,
      language_code,
      name,
      english_name,
      code,
      series,
      release_date,
      printed_total,
      total,
      search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let rowCount = 0;

  for (const set of englishApiSets) {
    insertSet.run(
      set.id,
      "en",
      set.name,
      set.name,
      normalizeSetCode(set.id),
      set.series ?? "",
      set.releaseDate ?? "",
      set.printedTotal ?? null,
      set.total ?? null,
      buildSearchText({
        name: set.name,
        englishName: set.name,
        code: normalizeSetCode(set.id),
        series: set.series,
        setId: set.id,
      }),
    );
    rowCount += 1;
  }

  console.log(`  English API sets: ${englishApiSets.length}`);

  const englishTcgdexNames = await fetchTcgdexEnglishSetNames();
  console.log(`Fetching TCGdex sets for ${SUPPORTED_LANGUAGES.length} languages...`);

  for (const { code, label } of SUPPORTED_LANGUAGES) {
    const sets = await fetchTcgdexSets(code);
    const isEnglish = code === "en";

    for (const set of sets) {
      const englishName = isEnglish
        ? set.name
        : (englishTcgdexNames.get(set.id) ?? null);
      const displayName =
        !isEnglish && englishName && englishName !== set.name
          ? `${set.name} (${englishName})`
          : set.name;

      insertSet.run(
        set.id,
        code,
        displayName,
        englishName,
        normalizeSetCode(set.id),
        label,
        set.releaseDate ?? "",
        set.cardCount?.official ?? null,
        set.cardCount?.total ?? null,
        buildSearchText({
          name: displayName,
          englishName,
          code: normalizeSetCode(set.id),
          series: label,
          setId: set.id,
        }),
      );
      rowCount += 1;
    }

    console.log(`  ${label}: ${sets.length} sets`);
  }

  const supplementCount = insertOfficialJapaneseSupplements(insertSet);
  rowCount += supplementCount;
  console.log(`  Official JP supplements: ${supplementCount} sets`);

  const uniqueSets = db.prepare("SELECT COUNT(DISTINCT set_id) AS c FROM tcg_sets").get().c;
  const languageCount = db
    .prepare("SELECT COUNT(DISTINCT language_code) AS c FROM tcg_sets")
    .get().c;

  const seedRows = db
    .prepare(
      `SELECT set_id, language_code, name, english_name, code, series, release_date,
              printed_total, total, search_text
       FROM tcg_sets
       ORDER BY release_date DESC, name ASC`,
    )
    .all();

  db.close();

  const seedPath = path.join(ROOT, "data", "pokemon-sets-seed.json");
  const seedPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sets: seedRows.map((row) => {
      const language = row.language_code;

      return {
        id: row.set_id,
        name: row.name,
        localizedName: language === "en" ? undefined : row.name.split(" (")[0],
        englishName: row.english_name ?? undefined,
        code: row.code,
        series: row.series ?? language,
        releaseDate: row.release_date ?? "",
        language,
        languageLabel: labelForLanguage(language),
        printedTotal: row.printed_total ?? undefined,
        total: row.total ?? undefined,
        searchText: row.search_text ?? "",
      };
    }),
  };

  fs.writeFileSync(seedPath, `${JSON.stringify(seedPayload)}\n`, "utf8");

  const sizeKb = Math.round(fs.statSync(DB_PATH).size / 1024);
  const seedKb = Math.round(fs.statSync(seedPath).size / 1024);
  console.log(`Done. Wrote ${DB_PATH}`);
  console.log(`  Total rows: ${rowCount}`);
  console.log(`  Unique set IDs: ${uniqueSets}`);
  console.log(`  Languages: ${languageCount}`);
  console.log(`  File size: ${sizeKb} KB`);
  console.log(`Wrote ${seedPath} (${seedKb} KB, ${seedPayload.sets.length} sets)`);
}

function labelForLanguage(code) {
  return SUPPORTED_LANGUAGES.find((item) => item.code === code)?.label ?? code;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
