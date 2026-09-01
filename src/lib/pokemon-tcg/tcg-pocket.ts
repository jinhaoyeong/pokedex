/**
 * Pokémon TCG Pocket is a digital game. Dex search, set browse, card pages,
 * scan, and prices are for physical TCG prints only.
 *
 * TCGdex files Pocket under series `tcgp` with era ids A1 / B2a / P-A (and
 * later C/D/… years). Japanese physical SWSH `S2` / Mega `M1` / `me01` must
 * stay in the catalog.
 */

/** Current Pocket expansions plus compact promo ids. Future A–F era ids match the regex. */
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

const TCG_POCKET_RARITY_PATTERN =
  /^(?:one|two|three|four)\s+(?:diamond|star|shiny)$|^crown$|^one shiny$|^two shiny$/i;

export type PokemonTcgPocketPrintLike = {
  id?: string | null;
  slug?: string | null;
  setId?: string | null;
  setCode?: string | null;
  setName?: string | null;
  setEnglishName?: string | null;
  series?: string | null;
  rarity?: string | null;
  image?: string | null;
  text?: string | null;
};

function normalizePocketText(value: string) {
  return value
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function setIdFromCardId(cardId?: string | null) {
  const clean = (cardId ?? "").trim();
  if (!clean) {
    return "";
  }

  const catalogId = clean.includes("--") ? clean.slice(clean.indexOf("--") + 2) : clean;
  const separatorIndex = catalogId.lastIndexOf("-");
  return separatorIndex > 0 ? catalogId.slice(0, separatorIndex) : catalogId;
}

function looksLikePokemonTcgPocketSeries(value?: string | null) {
  const text = value ?? "";
  return /(?:^|[^a-z])tcgp(?:[^a-z]|$)/i.test(text) || /tcg\s*pocket/i.test(text);
}

export function isPokemonTcgPocketSetId(setId?: string | null) {
  const clean = (setId ?? "").trim();
  if (!clean) {
    return false;
  }

  return TCG_POCKET_SET_IDS.has(clean.toLowerCase()) || TCG_POCKET_SET_ID_PATTERN.test(clean);
}

export function isPokemonTcgPocketPrint(card: PokemonTcgPocketPrintLike) {
  if (
    looksLikePokemonTcgPocketSeries(card.series) ||
    looksLikePokemonTcgPocketSeries(card.slug) ||
    looksLikePokemonTcgPocketSeries(card.text)
  ) {
    return true;
  }

  if (
    /\/tcgp(?:\/|$)/i.test(card.image ?? "") ||
    /\/tcgp(?:\/|$)/i.test(card.slug ?? "") ||
    /\/tcgp(?:\/|$)/i.test(card.text ?? "")
  ) {
    return true;
  }

  if (/energy zone/i.test(card.text ?? "")) {
    return true;
  }

  if (
    isPokemonTcgPocketSetId(card.setId) ||
    isPokemonTcgPocketSetId(card.setCode) ||
    isPokemonTcgPocketSetId(setIdFromCardId(card.id)) ||
    isPokemonTcgPocketSetId(setIdFromCardId(card.slug))
  ) {
    return true;
  }

  const setNames = [card.setName, card.setEnglishName]
    .map((name) => normalizePocketText(name ?? ""))
    .filter(Boolean);
  if (setNames.some((name) => TCG_POCKET_SET_NAMES.has(name))) {
    return true;
  }

  return TCG_POCKET_RARITY_PATTERN.test((card.rarity ?? "").trim());
}

export function isPokemonTcgPocketSet(set: {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  englishName?: string | null;
  series?: string | null;
  logo?: string | null;
  image?: string | null;
}) {
  if (looksLikePokemonTcgPocketSeries(set.series) || looksLikePokemonTcgPocketSeries(set.id)) {
    return true;
  }

  if (/\/tcgp(?:\/|$)/i.test(set.logo ?? "") || /\/tcgp(?:\/|$)/i.test(set.image ?? "")) {
    return true;
  }

  if (isPokemonTcgPocketSetId(set.id) || isPokemonTcgPocketSetId(set.code)) {
    return true;
  }

  const names = [set.name, set.englishName]
    .map((name) => normalizePocketText(name ?? ""))
    .filter(Boolean);
  return names.some((name) => TCG_POCKET_SET_NAMES.has(name));
}

export function isPokemonTcgPocketTcgdexItem(item: unknown): boolean {
  const record = asRecord(item);
  if (!record) {
    return false;
  }

  const nestedSet = asRecord(record.set);
  const nestedSerie = asRecord(record.serie) ?? asRecord(nestedSet?.serie);
  const attackText = Array.isArray(record.attacks)
    ? record.attacks
        .map((attack) => {
          const row = asRecord(attack);
          return row ? `${asString(row.name)} ${asString(row.effect)}` : "";
        })
        .join(" ")
    : "";

  return isPokemonTcgPocketPrint({
    id: asString(record.id),
    setId: asString(nestedSet?.id) || asString(record.id),
    setCode: asString(nestedSet?.id),
    setName: asString(nestedSet?.name) || asString(record.name),
    setEnglishName: asString(nestedSet?.name),
    series:
      asString(nestedSerie?.id) ||
      asString(nestedSerie?.name) ||
      asString(record.serie) ||
      asString(record.id),
    rarity: asString(record.rarity),
    image: [record.image, record.logo, nestedSet?.logo, nestedSet?.symbol, record.symbol]
      .map(asString)
      .find(Boolean),
    text: attackText,
  });
}

export function isPokemonTcgPocketTcgdexUrl(url: string) {
  const value = url.trim();
  if (!value) {
    return false;
  }

  if (/\/tcgp(?:\/|$|\?)/i.test(value) || /\/series\/tcgp(?:\/|$|\?)/i.test(value)) {
    return true;
  }

  try {
    const path = new URL(value).pathname;
    const setMatch = path.match(/\/sets\/([^/]+)/i);
    if (setMatch && isPokemonTcgPocketSetId(decodeURIComponent(setMatch[1]))) {
      return true;
    }

    const cardMatch = path.match(/\/cards\/([^/]+)/i);
    if (
      cardMatch &&
      isPokemonTcgPocketPrint({
        id: decodeURIComponent(cardMatch[1]),
      })
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function stripPokemonTcgPocketFromTcgdexPayload<T>(data: T): T {
  if (Array.isArray(data)) {
    return data.filter((item) => !isPokemonTcgPocketTcgdexItem(item)) as T;
  }

  const record = asRecord(data);
  if (!record) {
    return data;
  }

  if (isPokemonTcgPocketTcgdexItem(record)) {
    throw new Error("Pokemon TCG Pocket is excluded from this catalog");
  }

  const next = { ...record };
  if (Array.isArray(next.sets)) {
    next.sets = next.sets.filter((item) => !isPokemonTcgPocketTcgdexItem(item));
  }
  if (Array.isArray(next.cards)) {
    next.cards = next.cards.filter((item) => !isPokemonTcgPocketTcgdexItem(item));
  }

  return next as T;
}

export function withoutPokemonTcgPocketPrints<T extends PokemonTcgPocketPrintLike>(items: T[]) {
  return items.filter((item) => !isPokemonTcgPocketPrint(item));
}
