#!/usr/bin/env node
/**
 * Seeds data/pokemon-names.sqlite from PokeAPI species names (all languages).
 * Run: npm run db:seed
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "pokemon-names.sqlite");
const POKEAPI_BASE = "https://pokeapi.co/api/v2";
const SPECIES_CONCURRENCY = 24;

/** PokeAPI language.name → app CardLanguageCode (when applicable). */
const POKEAPI_TO_APP_LANGUAGE = {
  en: "en",
  ja: "ja",
  "ja-Hrkt": "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  it: "it",
  pt: "pt",
  "pt-BR": "pt-br",
  "pt-PT": "pt-pt",
  nl: "nl",
  pl: "pl",
  ru: "ru",
  id: "id",
  th: "th",
  "zh-Hans": "zh-cn",
  "zh-Hant": "zh-tw",
  "zh-hans": "zh-cn",
  "zh-hant": "zh-tw",
};

/** Trainer / energy / special card names not covered by species data. */
const CARD_NAME_OVERRIDES = [
  { localized_name: "なみのりピカチュウV", language_code: "ja", english_name: "Surfing Pikachu V" },
  { localized_name: "なみのりピカチュウVMAX", language_code: "ja", english_name: "Surfing Pikachu VMAX" },
  { localized_name: "そらをとぶピカチュウV", language_code: "ja", english_name: "Flying Pikachu V" },
  { localized_name: "そらをとぶピカチュウVMAX", language_code: "ja", english_name: "Flying Pikachu VMAX" },
  { localized_name: "ピカチュウV-UNION", language_code: "ja", english_name: "Pikachu V-UNION" },
  { localized_name: "オリジンパルキアV", language_code: "ja", english_name: "Origin Forme Palkia V" },
  { localized_name: "オリジンパルキアVSTAR", language_code: "ja", english_name: "Origin Forme Palkia VSTAR" },
  { localized_name: "博士の研究", language_code: "ja", english_name: "Professor's Research" },
  { localized_name: "基本草エネルギー", language_code: "ja", english_name: "Grass Energy [Holo]" },
  { localized_name: "基本炎エネルギー", language_code: "ja", english_name: "Fire Energy [Holo]" },
  { localized_name: "基本水エネルギー", language_code: "ja", english_name: "Water Energy [Holo]" },
  { localized_name: "基本雷エネルギー", language_code: "ja", english_name: "Lightning Energy [Holo]" },
  { localized_name: "基本超エネルギー", language_code: "ja", english_name: "Psychic Energy [Holo]" },
  { localized_name: "基本闘エネルギー", language_code: "ja", english_name: "Fighting Energy [Holo]" },
  { localized_name: "基本悪エネルギー", language_code: "ja", english_name: "Darkness Energy [Holo]" },
  { localized_name: "基本鋼エネルギー", language_code: "ja", english_name: "Metal Energy [Holo]" },
  { localized_name: "ボスの指令", language_code: "ja", english_name: "Boss's Orders" },
  { localized_name: "エネルギー転送", language_code: "ja", english_name: "Energy Switch" },
  { localized_name: "ふしぎなアメ", language_code: "ja", english_name: "Rare Candy" },
  { localized_name: "ポケモンいれかえ", language_code: "ja", english_name: "Switch" },
  { localized_name: "ポケモンキャッチャー", language_code: "ja", english_name: "Pokemon Catcher" },
  { localized_name: "ハイパーボール", language_code: "ja", english_name: "Ultra Ball" },
  { localized_name: "ネストボール", language_code: "ja", english_name: "Nest Ball" },
  { localized_name: "スーパーボール", language_code: "ja", english_name: "Great Ball" },
  { localized_name: "モンスターボール", language_code: "ja", english_name: "Poke Ball" },
];

function normalizeForSearch(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`PokeAPI ${response.status}: ${url}`);
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

    DROP TABLE IF EXISTS card_name_overrides;
    DROP TABLE IF EXISTS pokemon_species_names;
    DROP TABLE IF EXISTS pokemon_species;

    CREATE TABLE pokemon_species (
      species_id INTEGER PRIMARY KEY,
      english_name TEXT NOT NULL,
      english_name_normalized TEXT NOT NULL
    );

    CREATE TABLE pokemon_species_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      species_id INTEGER NOT NULL,
      pokeapi_language TEXT NOT NULL,
      app_language TEXT,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      FOREIGN KEY (species_id) REFERENCES pokemon_species(species_id),
      UNIQUE(species_id, pokeapi_language, name)
    );

    CREATE TABLE card_name_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      localized_name TEXT NOT NULL,
      language_code TEXT NOT NULL,
      english_name TEXT NOT NULL,
      localized_normalized TEXT NOT NULL,
      english_normalized TEXT NOT NULL,
      UNIQUE(localized_name, language_code)
    );

    CREATE INDEX idx_species_names_name_norm ON pokemon_species_names(name_normalized);
    CREATE INDEX idx_species_names_app_lang ON pokemon_species_names(app_language, name_normalized);
    CREATE INDEX idx_species_english_norm ON pokemon_species(english_name_normalized);
    CREATE INDEX idx_overrides_localized ON card_name_overrides(language_code, localized_normalized);
  `);
}

async function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  initSchema(db);

  const insertSpecies = db.prepare(`
    INSERT INTO pokemon_species (species_id, english_name, english_name_normalized)
    VALUES (?, ?, ?)
  `);
  const insertName = db.prepare(`
    INSERT OR IGNORE INTO pokemon_species_names
      (species_id, pokeapi_language, app_language, name, name_normalized)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertOverride = db.prepare(`
    INSERT INTO card_name_overrides
      (localized_name, language_code, english_name, localized_normalized, english_normalized)
    VALUES (?, ?, ?, ?, ?)
  `);

  console.log("Fetching species list from PokeAPI...");
  const list = await fetchJson(`${POKEAPI_BASE}/pokemon-species?limit=2000`);
  const speciesUrls = list.results.map((item) => item.url);

  console.log(`Fetching ${speciesUrls.length} species name records...`);
  let nameRowCount = 0;

  await mapWithConcurrency(speciesUrls, SPECIES_CONCURRENCY, async (url) => {
    const species = await fetchJson(url);
    const englishName =
      species.names.find((entry) => entry.language.name === "en")?.name ??
      species.name.replace(/-/g, " ");

    insertSpecies.run(species.id, englishName, normalizeForSearch(englishName));

    for (const entry of species.names) {
      const appLanguage = POKEAPI_TO_APP_LANGUAGE[entry.language.name] ?? null;
      const result = insertName.run(
        species.id,
        entry.language.name,
        appLanguage,
        entry.name,
        normalizeForSearch(entry.name),
      );

      if (result.changes > 0) {
        nameRowCount += 1;
      }
    }
  });

  for (const override of CARD_NAME_OVERRIDES) {
    insertOverride.run(
      override.localized_name,
      override.language_code,
      override.english_name,
      normalizeForSearch(override.localized_name),
      normalizeForSearch(override.english_name),
    );
  }

  const speciesCount = db.prepare("SELECT COUNT(*) AS c FROM pokemon_species").get().c;
  const overrideCount = db.prepare("SELECT COUNT(*) AS c FROM card_name_overrides").get().c;
  const languageCount = db
    .prepare("SELECT COUNT(DISTINCT pokeapi_language) AS c FROM pokemon_species_names")
    .get().c;

  db.close();

  const sizeKb = Math.round(fs.statSync(DB_PATH).size / 1024);
  console.log(`Done. Wrote ${DB_PATH}`);
  console.log(`  Species: ${speciesCount}`);
  console.log(`  Name rows: ${nameRowCount}`);
  console.log(`  PokeAPI languages: ${languageCount}`);
  console.log(`  Card overrides: ${overrideCount}`);
  console.log(`  File size: ${sizeKb} KB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
