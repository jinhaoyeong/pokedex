#!/usr/bin/env node
/**
 * Export data/pokemon-sets.sqlite into data/pokemon-sets-seed.json for deploy fallbacks.
 * Run: node scripts/export-pokemon-sets-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "pokemon-sets.sqlite");
const OUT_PATH = path.join(ROOT, "data", "pokemon-sets-seed.json");

const LANGUAGE_LABELS = {
  en: "English",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  "pt-br": "Portuguese (Brazil)",
  "pt-pt": "Portuguese (Portugal)",
  de: "German",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  "zh-tw": "Chinese Traditional",
  id: "Indonesian",
  th: "Thai",
  "zh-cn": "Chinese Simplified",
};

function rowToSet(row) {
  const language = row.language_code;

  return {
    id: row.set_id,
    name: row.name,
    localizedName: language === "en" ? undefined : row.name.split(" (")[0],
    englishName: row.english_name ?? undefined,
    code: row.code,
    series: row.series ?? LANGUAGE_LABELS[language] ?? language,
    releaseDate: row.release_date ?? "",
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? language,
    printedTotal: row.printed_total ?? undefined,
    total: row.total ?? undefined,
    searchText: row.search_text ?? "",
  };
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Missing ${DB_PATH}. Run npm run db:seed:sets first.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT set_id, language_code, name, english_name, code, series, release_date,
              printed_total, total, search_text
       FROM tcg_sets
       ORDER BY release_date DESC, name ASC`,
    )
    .all();
  db.close();

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sets: rows.map(rowToSet),
  };

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`, "utf8");

  const sizeKb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  Sets: ${payload.sets.length}`);
  console.log(`  File size: ${sizeKb} KB`);
}

main();
