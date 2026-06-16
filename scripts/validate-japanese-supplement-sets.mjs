#!/usr/bin/env node
// Guardrail: every official-only Japanese supplement set (sets that live on
// pokemon-card.com but have no TCGdex records, e.g. M5/M2A/M4) MUST ship with
// bundled browse-seed cards. Production cannot reach pokemon-card.com reliably
// from serverless, so the bundled seed is the only guaranteed source of cards
// for these sets. If a supplement is added without seed data, the Dex shows
// "No cards found" for it in production -- this check fails the build before
// that can happen.
//
// Network-free and fast: it only reads the two committed JSON data files.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supplementsPath = path.join(root, "data", "official-japanese-set-supplements.json");
const seedPath = path.join(root, "data", "official-japanese-browse-seed.json");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`✗ Could not read/parse ${path.relative(root, file)}: ${error.message}`);
    process.exit(1);
  }
}

const supplements = readJson(supplementsPath);
const seed = readJson(seedPath);
const sets = Array.isArray(supplements?.sets) ? supplements.sets : [];
const seedSets = seed?.sets ?? {};

if (!sets.length) {
  console.error("✗ official-japanese-set-supplements.json has no sets.");
  process.exit(1);
}

// Case-insensitive lookup of a seed entry by any of a supplement's codes.
const seedKeyByUpper = new Map(Object.keys(seedSets).map((k) => [k.toUpperCase(), k]));
function findSeed(...codes) {
  for (const code of codes) {
    if (!code) continue;
    const key = seedKeyByUpper.get(String(code).trim().toUpperCase());
    if (key) return seedSets[key];
  }
  return null;
}

const failures = [];

for (const set of sets) {
  const label = `${set.id} (${set.englishName || set.localizedName || "?"})`;
  const entry = findSeed(set.officialBrowseCode, set.code, set.id);

  if (!entry) {
    failures.push(`${label}: no browse-seed entry. Run: npm run db:seed:official-jp-browse`);
    continue;
  }

  const cards = Array.isArray(entry.cardList) ? entry.cardList : [];
  if (cards.length === 0) {
    failures.push(`${label}: browse-seed entry has 0 cards.`);
    continue;
  }

  console.log(`✓ ${label}: ${cards.length} seeded cards`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} supplement set(s) missing browse-seed data:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\n✓ All ${sets.length} Japanese supplement set(s) have bundled browse-seed cards.`);
