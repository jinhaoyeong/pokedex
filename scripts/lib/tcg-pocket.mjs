/**
 * Pokémon TCG Pocket is a digital game. Seed scripts skip the whole series,
 * not just individual cards that already leaked into a search.
 */

const TCG_POCKET_SET_IDS = new Set([
  "p-a",
  "pa",
  "a1",
  "a1a",
  "a2",
  "a2a",
  "a2b",
  "a3",
  "a3a",
  "a3b",
  "a4",
  "a4a",
  "b1",
  "b1a",
  "b2",
  "b2a",
]);

const TCG_POCKET_SET_ID_PATTERN = /^(?:p-[a-z]|p[a-z]|[a-f]\d{1,2}[a-z]?)$/i;

const TCG_POCKET_SET_NAMES = new Set([
  "genetic apex",
  "mythical island",
  "space-time smackdown",
  "triumphant light",
  "shining revelry",
  "celestial guardians",
  "extradimensional crisis",
  "eevee grove",
  "wisdom of sea and sky",
  "secluded springs",
  "mega rising",
  "crimson blaze",
  "fantastical parade",
  "paldean wonders",
  "promos-a",
  "promos a",
  "promo a",
]);

function normalizePocketText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isPokemonTcgPocketSetId(setId) {
  const clean = String(setId ?? "").trim();
  if (!clean) {
    return false;
  }

  return TCG_POCKET_SET_IDS.has(clean.toLowerCase()) || TCG_POCKET_SET_ID_PATTERN.test(clean);
}

export function isPokemonTcgPocketSet(set = {}) {
  if (/(?:^|[^a-z])tcgp(?:[^a-z]|$)/i.test(set.series ?? "") || /tcg\s*pocket/i.test(set.series ?? "")) {
    return true;
  }

  if (/\/tcgp(?:\/|$)/i.test(set.logo ?? "") || /\/tcgp(?:\/|$)/i.test(set.image ?? "")) {
    return true;
  }

  if (isPokemonTcgPocketSetId(set.id) || isPokemonTcgPocketSetId(set.code) || isPokemonTcgPocketSetId(set.set_id)) {
    return true;
  }

  return [set.name, set.englishName, set.english_name]
    .map((name) => normalizePocketText(name ?? ""))
    .filter(Boolean)
    .some((name) => TCG_POCKET_SET_NAMES.has(name));
}
