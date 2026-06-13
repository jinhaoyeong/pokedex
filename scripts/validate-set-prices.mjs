#!/usr/bin/env node
/**
 * Rigorous set validation: completeness, sort correctness, card data, and pricing.
 *
 * Requires:
 *   - data/pokemon-sets.sqlite (npm run db:seed:sets)
 *   - optional data/pokemon-cards-index.sqlite (npm run db:seed:cards-index)
 *   - running app server (npm run dev) unless VALIDATE_BASE_URL is set
 *
 * Usage:
 *   npm run validate:sets:smoke
 *   npm run validate:sets:full
 *   npm run validate:sets:exhaustive
 *   VALIDATE_LANG=ja npm run validate:sets:smoke
 *   VALIDATE_LANG=all VALIDATE_MODE=exhaustive npm run validate:sets
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SETS_DB_PATH = path.join(ROOT, "data", "pokemon-sets.sqlite");
const CARDS_INDEX_DB_PATH = path.join(ROOT, "data", "pokemon-cards-index.sqlite");
const DEFAULT_REPORT_PATH = path.join(ROOT, "data", "validate-set-prices-report.json");

const BASE_URL = (process.env.VALIDATE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MODE = (process.env.VALIDATE_MODE ?? "smoke").toLowerCase();
const LANG = process.env.VALIDATE_LANG ?? "en";
const SET_CONCURRENCY = Math.max(1, Number.parseInt(process.env.VALIDATE_SET_CONCURRENCY ?? "1", 10));
const MAX_SETS = Number.parseInt(process.env.VALIDATE_MAX_SETS ?? "0", 10) || Number.POSITIVE_INFINITY;
const PAGE_SIZE = 50;
const SET_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_SET_TIMEOUT_MS ?? "120000", 10);
const MAX_SORTABLE_CARDS = 300;
const CROSSCHECK_TOP_N = Number.parseInt(process.env.VALIDATE_CROSSCHECK_TOP ?? "10", 10);
const CROSSCHECK_PREMIUM_ALL = process.env.VALIDATE_CROSSCHECK_PREMIUM_ALL !== "false";
const CROSSCHECK_CONCURRENCY = Number.parseInt(process.env.VALIDATE_CROSSCHECK_CONCURRENCY ?? "6", 10);
const STRICT_MODE = process.env.VALIDATE_STRICT === "true";
const PRICE_TOLERANCE_RATIO = Number.parseFloat(process.env.VALIDATE_PRICE_TOLERANCE ?? "0.35");
const COMPLETENESS_TOLERANCE = Number.parseFloat(process.env.VALIDATE_COMPLETENESS_TOLERANCE ?? "0.98");
const OUTPUT_PATH = process.env.VALIDATE_OUTPUT ?? DEFAULT_REPORT_PATH;
const SORT_MODES_TO_TEST = (process.env.VALIDATE_SORT_MODES ?? "price-desc,price-asc")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const INCLUDE_NUMBER_SORT = process.env.VALIDATE_INCLUDE_NUMBER_SORT === "true";
const MAX_PREMIUM_CROSSCHECKS = Number.parseInt(process.env.VALIDATE_MAX_PREMIUM_CROSSCHECKS ?? "20", 10);
const DETAIL_SAMPLE_SIZE = Number.parseInt(process.env.VALIDATE_DETAIL_SAMPLES ?? "3", 10);
const DETAIL_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_DETAIL_TIMEOUT_MS ?? "90000", 10);
const VALIDATE_CARD_DETAIL = process.env.VALIDATE_CARD_DETAIL !== "false";
const VALIDATE_GRADING_MARKET =
  process.env.VALIDATE_GRADING_MARKET !== "false" &&
  (process.env.VALIDATE_GRADING_MARKET === "true" || MODE === "exhaustive" || MODE === "full");
const GRADING_SAMPLE_SIZE = Number.parseInt(process.env.VALIDATE_GRADING_SAMPLES ?? "4", 10);
const GRADING_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_GRADING_TIMEOUT_MS ?? "120000", 10);
const GRADING_MIN_PRICE_USD = Number.parseFloat(process.env.VALIDATE_GRADING_MIN_PRICE_USD ?? "5");
const GRADING_HIGH_VALUE_USD = Number.parseFloat(process.env.VALIDATE_GRADING_HIGH_VALUE_USD ?? "50");
const VALIDATE_GRADING_FULL = process.env.VALIDATE_GRADING_FULL !== "false";
const GRADING_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.VALIDATE_GRADING_CONCURRENCY ?? "2", 10),
);
const INCREMENTAL_REPORT = process.env.VALIDATE_INCREMENTAL_REPORT !== "false";
const SET_CODE_ONLY_PATTERN = /^[A-Z]{1,4}[0-9]{0,3}[A-Z]?$/;

const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";
const EUR_TO_USD = 1.08;

const SORT_MODES = ["price-desc", "price-asc", "number-asc", "number-desc"];

// Number sorts are still API-paginated for English sets (not locally sorted). Treat as advisory.
const ADVISORY_SORT_MODES = new Set(["number-asc", "number-desc"]);

const SMOKE_SETS = {
  en: ["me2pt5", "sv8pt5", "sv3pt5", "sv9", "sm12", "base1", "sv8", "swsh12", "sv6pt5"],
  ja: ["SV11W", "S12A", "SV9", "SM12", "SV8a"],
};

const EN_SET_ID_ALIASES = {
  me2pt5: "me02.5",
  sv8pt5: "sv08.5",
  sv3pt5: "sv03.5",
  sv6pt5: "sv06.5",
};

const PREMIUM_RARITY_PATTERN =
  /special illustration|illustration rare|hyper rare|secret rare|art rare|ultra rare|double rare|triple rare|rainbow|gold star/i;

function buildTcgdexSetIdCandidate(setId) {
  const normalized = setId.trim().toLowerCase();
  if (EN_SET_ID_ALIASES[normalized]) {
    return EN_SET_ID_ALIASES[normalized];
  }

  const pt5Match = normalized.match(/^([a-z]+)(\d+)pt5$/);
  if (!pt5Match) {
    return normalized;
  }

  const [, prefix, number] = pt5Match;
  return `${prefix}${number.padStart(2, "0")}.5`;
}

function normalizeCollectorNumber(value) {
  return String(value ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "")
    .toUpperCase();
}

function collectorMatchKeys(value) {
  const normalized = normalizeCollectorNumber(value);
  const numeric = normalized.replace(/[A-Z]+$/, "");
  return [...new Set([normalized, numeric].filter(Boolean))];
}

function collectorNumberSortValue(value) {
  const match = String(value ?? "").trim().match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PokePokedex-Validator/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function positivePrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function tcgdxTcgplayerBuckets(tcgplayer) {
  if (!tcgplayer) {
    return [];
  }

  return Object.entries(tcgplayer)
    .filter(
      ([key, value]) =>
        typeof value === "object" &&
        value !== null &&
        key !== "unit" &&
        key !== "updated",
    )
    .map(([, value]) => value);
}

function tcgdxTcgplayerPrice(bucket, field) {
  if (field === "market") {
    return positivePrice(bucket.marketPrice ?? bucket.market);
  }

  if (field === "low") {
    return positivePrice(bucket.lowPrice ?? bucket.low);
  }

  return positivePrice(bucket.midPrice ?? bucket.mid);
}

function tcgdxCardmarketPrice(cardmarket, field) {
  if (!cardmarket) {
    return null;
  }

  switch (field) {
    case "trend":
      return positivePrice(cardmarket.trend ?? cardmarket.trendPrice);
    case "avg7":
      return positivePrice(cardmarket.avg7);
    case "avg30":
      return positivePrice(cardmarket.avg30);
    default:
      return null;
  }
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustPrice(values) {
  const valid = values.filter((value) => positivePrice(value) !== null);
  if (!valid.length) {
    return 0;
  }

  if (valid.length === 1) {
    return valid[0];
  }

  const baseline = median(valid);
  const filtered = valid.filter((value) => value >= baseline / 3 && value <= baseline * 3);
  return median(filtered.length ? filtered : valid);
}

function getTcgdexReferencePrice(card) {
  const tcgplayerBuckets = tcgdxTcgplayerBuckets(card.pricing?.tcgplayer);
  const tcgMarketPrices = tcgplayerBuckets
    .map((bucket) => tcgdxTcgplayerPrice(bucket, "market"))
    .filter((price) => typeof price === "number" && price > 0);
  const cardmarket = card.pricing?.cardmarket;
  const robustCatalogPrice = robustPrice([
    ...tcgplayerBuckets.flatMap((bucket) => [
      tcgdxTcgplayerPrice(bucket, "market"),
      tcgdxTcgplayerPrice(bucket, "mid"),
      tcgdxTcgplayerPrice(bucket, "low"),
    ]),
    tcgdxCardmarketPrice(cardmarket, "trend") !== null
      ? tcgdxCardmarketPrice(cardmarket, "trend") * EUR_TO_USD
      : null,
    tcgdxCardmarketPrice(cardmarket, "avg7") !== null
      ? tcgdxCardmarketPrice(cardmarket, "avg7") * EUR_TO_USD
      : null,
    tcgdxCardmarketPrice(cardmarket, "avg30") !== null
      ? tcgdxCardmarketPrice(cardmarket, "avg30") * EUR_TO_USD
      : null,
  ]);

  for (const marketPrice of tcgMarketPrices) {
    if (
      robustCatalogPrice === 0 ||
      (marketPrice >= robustCatalogPrice / 3 && marketPrice <= robustCatalogPrice * 3)
    ) {
      return marketPrice;
    }
  }

  return robustCatalogPrice;
}

function isRarityDerivedMarketPrice(card) {
  const ungraded = card.gradedPrices?.find((price) => price.grade === "Ungraded");

  if (ungraded?.source?.toLowerCase().includes("rarity")) {
    return true;
  }

  if (ungraded?.source === "Early market estimate") {
    return true;
  }

  if (card.priceConsensus?.sources?.some((source) => source.source === "Rarity estimate")) {
    return true;
  }

  if (card.priceConsensus?.sources?.some((source) => source.source === "Early market estimate")) {
    return true;
  }

  return (card.sources ?? []).some(
    (source) =>
      source.source === "Localized search group estimate" ||
      source.source === "Early market estimate",
  );
}

function isCatalogBackedPrice(card) {
  return card.marketPriceUsd > 0 && !isRarityDerivedMarketPrice(card);
}

function currentSearchPrice(card) {
  return card.marketPriceUsd > 0 ? card.marketPriceUsd : 0;
}

function currentSearchPriceForAscending(card) {
  return card.marketPriceUsd > 0 ? card.marketPriceUsd : Number.POSITIVE_INFINITY;
}

function compareCardName(left, right) {
  return left.name.localeCompare(right.name);
}

function sortCardsLocally(cards, sort) {
  const next = cards.slice();

  next.sort((left, right) => {
    switch (sort) {
      case "price-desc":
        return currentSearchPrice(right) - currentSearchPrice(left) || compareCardName(left, right);
      case "price-asc":
        return (
          currentSearchPriceForAscending(left) - currentSearchPriceForAscending(right) ||
          compareCardName(left, right)
        );
      case "number-desc":
        return (
          collectorNumberSortValue(right.collectorNumber) -
            collectorNumberSortValue(left.collectorNumber) || compareCardName(left, right)
        );
      case "number-asc":
        return (
          collectorNumberSortValue(left.collectorNumber) -
            collectorNumberSortValue(right.collectorNumber) || compareCardName(left, right)
        );
      default:
        return 0;
    }
  });

  return next;
}

function makeTestResult() {
  return { passed: true, failures: [] };
}

function fail(test, code, message, details = null) {
  test.passed = false;
  test.failures.push({ code, message, details });
}

function loadSets(language) {
  if (!fs.existsSync(SETS_DB_PATH)) {
    throw new Error(`Missing ${SETS_DB_PATH}. Run: npm run db:seed:sets`);
  }

  const db = new Database(SETS_DB_PATH, { readonly: true });

  if (language === "all") {
    const rows = db
      .prepare(
        `
        SELECT set_id, language_code, name, english_name, code, release_date, printed_total, total
        FROM tcg_sets
        ORDER BY release_date DESC
      `,
      )
      .all();
    db.close();
    return rows;
  }

  const languages = language
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (languages.length > 1) {
    const placeholders = languages.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
        SELECT set_id, language_code, name, english_name, code, release_date, printed_total, total
        FROM tcg_sets
        WHERE language_code IN (${placeholders})
        ORDER BY release_date DESC
      `,
      )
      .all(...languages);
    db.close();
    return rows;
  }

  const rows = db
    .prepare(
      `
      SELECT set_id, language_code, name, english_name, code, release_date, printed_total, total
      FROM tcg_sets
      WHERE language_code = ?
      ORDER BY release_date DESC
    `,
    )
    .all(languages[0]);
  db.close();
  return rows;
}

function loadCardsIndexReference(setId, languageCode) {
  if (!fs.existsSync(CARDS_INDEX_DB_PATH)) {
    return [];
  }

  const db = new Database(CARDS_INDEX_DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `
      SELECT card_id, collector_number, name, english_name, localized_name, rarity, printed_total
      FROM cards_index
      WHERE set_id = ? AND language_code = ?
      ORDER BY collector_number
    `,
    )
    .all(setId, languageCode);
  db.close();

  return rows.map((row) => ({
    source: "cards_index",
    cardId: row.card_id,
    collectorNumber: row.collector_number,
    normalizedNumber: normalizeCollectorNumber(row.collector_number),
    name: row.name,
    englishName: row.english_name,
    rarity: row.rarity,
    printedTotal: row.printed_total,
  }));
}

async function loadTcgdexSetReference(setId, languageCode) {
  const tcgdxSetId = buildTcgdexSetIdCandidate(setId);
  const apiLanguage = languageCode === "ja" ? "ja" : "en";
  const candidates = [...new Set([tcgdxSetId, setId, setId.toUpperCase(), setId.toLowerCase()])];

  for (const candidate of candidates) {
    try {
      const set = await fetchJson(
        `${TCGDEX_API_BASE}/${apiLanguage}/sets/${encodeURIComponent(candidate)}`,
        { timeoutMs: 12_000 },
      );

      if (!Array.isArray(set.cards) || !set.cards.length) {
        continue;
      }

      return {
        source: "tcgdex",
        setId: set.id,
        name: set.name,
        officialTotal: set.cardCount?.official ?? null,
        total: set.cardCount?.total ?? set.cards.length,
        cards: set.cards.map((brief) => ({
          source: "tcgdex",
          cardId: brief.id,
          collectorNumber: brief.localId,
          normalizedNumber: normalizeCollectorNumber(brief.localId),
          name: brief.name,
        })),
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function buildReferenceCatalog(setMeta) {
  const tcgdx = await loadTcgdexSetReference(setMeta.set_id, setMeta.language_code);
  const indexRows = loadCardsIndexReference(setMeta.set_id, setMeta.language_code);

  const byNumber = new Map();

  for (const row of indexRows) {
    for (const key of collectorMatchKeys(row.collectorNumber)) {
      byNumber.set(key, row);
    }
  }

  for (const row of tcgdx?.cards ?? []) {
    for (const key of collectorMatchKeys(row.collectorNumber)) {
      byNumber.set(key, {
        ...row,
        source: "tcgdex",
      });
    }
  }

  const expectedTotal =
    tcgdx?.total ??
    setMeta.total ??
    (indexRows.length ? indexRows.length : setMeta.printed_total) ??
    null;

  return {
    tcgdx,
    indexCount: indexRows.length,
    expectedTotal,
    cards: [...byNumber.values()],
    byNumber,
  };
}

function selectSets(allSets) {
  if (MODE === "exhaustive" || MODE === "full") {
    return allSets.slice(0, MAX_SETS);
  }

  if (MODE === "recent") {
    const currentYear = new Date().getUTCFullYear();
    return allSets
      .filter((set) => {
        const year = Number.parseInt(String(set.release_date).slice(0, 4), 10);
        return Number.isFinite(year) && year >= currentYear - 2;
      })
      .slice(0, MAX_SETS);
  }

  const smokeIds = new Set(
    (SMOKE_SETS[LANG] ?? SMOKE_SETS.en).map((setId) => setId.toLowerCase()),
  );
  const selected = allSets.filter((set) => smokeIds.has(set.set_id.toLowerCase()));
  return (selected.length ? selected : allSets.slice(0, 12)).slice(0, MAX_SETS);
}

async function fetchAllSetCards(setId, languageCode, sort) {
  const cards = [];
  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;
  let hasNextPage = true;

  while ((page - 1) * PAGE_SIZE < totalCount && hasNextPage) {
    const params = new URLSearchParams({
      set: setId,
      lang: languageCode,
      sort,
      page: String(page),
    });
    const payload = await fetchJson(`${BASE_URL}/api/live-search?${params.toString()}`, {
      timeoutMs: SET_TIMEOUT_MS,
    });

    totalCount = payload.totalCount ?? cards.length;
    hasNextPage = Boolean(payload.hasNextPage);
    const batch = (payload.results ?? []).map((result) => result.card);

    if (!batch.length) {
      break;
    }

    cards.push(...batch);
    page += 1;
  }

  return {
    cards,
    totalCount: Number.isFinite(totalCount) ? totalCount : cards.length,
    pageCount: page - 1,
  };
}

function validateCompleteness(setMeta, appCards, totalCount, reference) {
  const test = makeTestResult();
  const uniqueIds = new Set(appCards.map((card) => card.id));
  const appByNumber = new Map();
  for (const card of appCards) {
    for (const key of collectorMatchKeys(card.collectorNumber)) {
      appByNumber.set(key, card);
    }
  }

  const expectedTotal = reference.expectedTotal ?? setMeta.total ?? setMeta.printed_total;
  const sortableExpected =
    expectedTotal !== null ? Math.min(expectedTotal, MAX_SORTABLE_CARDS) : null;

  if (!appCards.length) {
    fail(test, "no_cards_returned", "App returned zero cards for this set");
    return test;
  }

  if (uniqueIds.size !== appCards.length) {
    fail(test, "duplicate_card_ids", "Duplicate card IDs found in set results", {
      duplicates: appCards.length - uniqueIds.size,
    });
  }

  if (appCards.length !== totalCount) {
    fail(test, "pagination_incomplete", "Fetched card count does not match reported totalCount", {
      fetched: appCards.length,
      reportedTotalCount: totalCount,
    });
  }

  if (sortableExpected !== null) {
    const minimum = Math.floor(sortableExpected * COMPLETENESS_TOLERANCE);
    if (appCards.length < minimum) {
      fail(test, "incomplete_set_coverage", "Returned fewer cards than expected for this set", {
        fetched: appCards.length,
        expected: sortableExpected,
        expectedTotal,
        minimumRequired: minimum,
      });
    }
  }

  if (reference.cards.length) {
    const allowedMissing =
      expectedTotal !== null && expectedTotal > MAX_SORTABLE_CARDS
        ? expectedTotal - MAX_SORTABLE_CARDS
        : 0;
    const missing = reference.cards
      .filter((row) =>
        !collectorMatchKeys(row.collectorNumber).some((key) => appByNumber.has(key)),
      )
      .map((row) => ({
        collectorNumber: row.collectorNumber,
        name: row.name,
        source: row.source,
      }));

    if (missing.length > allowedMissing) {
      fail(test, "missing_reference_cards", "Reference catalog cards are missing from app results", {
        missingCount: missing.length,
        allowedMissing,
        examples: missing.slice(0, 12),
      });
    }

    const secretReferenceNumbers = reference.cards
      .filter((row) => {
        const numeric = collectorNumberSortValue(row.collectorNumber);
        const printedTotal = setMeta.printed_total ?? reference.tcgdx?.officialTotal ?? 0;
        return printedTotal > 0 && numeric > printedTotal;
      })
      .map((row) => row.normalizedNumber);
    const missingSecrets = secretReferenceNumbers.filter(
      (number) => !collectorMatchKeys(number).some((key) => appByNumber.has(key)),
    );

    if (missingSecrets.length) {
      fail(test, "missing_secret_slot_cards", "Secret-slot cards are missing from app results", {
        missingCount: missingSecrets.length,
        examples: missingSecrets.slice(0, 8),
      });
    }
  }

  return test;
}

function validateCardData(setMeta, appCards, reference) {
  const test = makeTestResult();
  const requiredFields = ["id", "name", "collectorNumber", "setCode", "slug", "rarity"];
  const invalidCards = [];
  const nameMismatches = [];

  for (const card of appCards) {
    const missingFields = requiredFields.filter((field) => !String(card[field] ?? "").trim());

    if (missingFields.length) {
      invalidCards.push({
        id: card.id,
        collectorNumber: card.collectorNumber,
        missingFields,
      });
      continue;
    }

    if (setMeta.language_code === "en" && card.rarity === "Localized release") {
      invalidCards.push({
        id: card.id,
        collectorNumber: card.collectorNumber,
        missingFields: ["valid_rarity"],
      });
    }

    const ref = reference.byNumber.get(normalizeCollectorNumber(card.collectorNumber));
    const refByNumeric = reference.byNumber.get(
      normalizeCollectorNumber(card.collectorNumber).replace(/[A-Z]+$/, ""),
    );
    const referenceRow = ref ?? refByNumeric;
    if (referenceRow?.name) {
      const appName = normalizeName(card.name);
      const refName = normalizeName(referenceRow.name);
      const refEnglishName = normalizeName(referenceRow.englishName ?? "");

      if (
        appName !== refName &&
        refEnglishName &&
        appName !== refEnglishName &&
        !appName.includes(refName) &&
        !refName.includes(appName)
      ) {
        nameMismatches.push({
          collectorNumber: card.collectorNumber,
          appName: card.name,
          referenceName: ref.name,
        });
      }
    }
  }

  if (invalidCards.length) {
    fail(test, "invalid_card_fields", "Cards are missing required identity fields", {
      count: invalidCards.length,
      examples: invalidCards.slice(0, 8),
    });
  }

  if (nameMismatches.length) {
    fail(test, "card_name_mismatch", "Card names do not match the reference catalog", {
      count: nameMismatches.length,
      examples: nameMismatches.slice(0, 8),
    });
  }

  return test;
}

function validateSortMode(appCards, sort) {
  const test = makeTestResult();

  if (!appCards.length) {
    fail(test, "no_cards_for_sort", `No cards available to validate ${sort}`);
    return test;
  }

  for (let index = 1; index < appCards.length; index += 1) {
    const left = appCards[index - 1];
    const right = appCards[index];

    if (sort === "price-desc") {
      const leftPrice = currentSearchPrice(left);
      const rightPrice = currentSearchPrice(right);
      if (leftPrice < rightPrice) {
        fail(test, "sort_not_monotonic", "Price-desc sort is out of order", {
          at: index,
          previous: {
            name: left.name,
            collectorNumber: left.collectorNumber,
            marketPriceUsd: left.marketPriceUsd,
          },
          current: {
            name: right.name,
            collectorNumber: right.collectorNumber,
            marketPriceUsd: right.marketPriceUsd,
          },
        });
        break;
      }
    }

    if (sort === "price-asc") {
      const leftPrice = currentSearchPriceForAscending(left);
      const rightPrice = currentSearchPriceForAscending(right);
      if (leftPrice > rightPrice) {
        fail(test, "sort_not_monotonic", "Price-asc sort is out of order", {
          at: index,
          previous: {
            name: left.name,
            collectorNumber: left.collectorNumber,
            marketPriceUsd: left.marketPriceUsd,
          },
          current: {
            name: right.name,
            collectorNumber: right.collectorNumber,
            marketPriceUsd: right.marketPriceUsd,
          },
        });
        break;
      }
    }

    if (sort === "number-asc" || sort === "number-desc") {
      const leftNumber = collectorNumberSortValue(left.collectorNumber);
      const rightNumber = collectorNumberSortValue(right.collectorNumber);
      const outOfOrder =
        sort === "number-asc" ? leftNumber > rightNumber : leftNumber < rightNumber;

      if (outOfOrder) {
        fail(test, "sort_not_monotonic", `${sort} sort is out of order`, {
          at: index,
          previous: {
            name: left.name,
            collectorNumber: left.collectorNumber,
          },
          current: {
            name: right.name,
            collectorNumber: right.collectorNumber,
          },
        });
        break;
      }
    }
  }

  const expectedOrder = sortCardsLocally(appCards, sort).map((card) => card.id);
  const actualOrder = appCards.map((card) => card.id);
  const firstMismatch = actualOrder.findIndex((id, index) => id !== expectedOrder[index]);

  if (firstMismatch >= 0) {
    fail(test, "sort_order_mismatch", "API sort order does not match locally recomputed order", {
      at: firstMismatch,
      expected: expectedOrder.slice(Math.max(0, firstMismatch - 1), firstMismatch + 3),
      actual: actualOrder.slice(Math.max(0, firstMismatch - 1), firstMismatch + 3),
    });
  }

  if (sort === "price-desc") {
    const catalogCards = appCards.filter((card) => isCatalogBackedPrice(card));
    const maxCatalogPrice = catalogCards.reduce(
      (max, card) => Math.max(max, card.marketPriceUsd),
      0,
    );
    const topPrice = currentSearchPrice(appCards[0]);
    const topIsCatalog = isCatalogBackedPrice(appCards[0]);

    if (maxCatalogPrice > 0 && topPrice < maxCatalogPrice * 0.95) {
      fail(test, "top_price_incorrect", "Top sorted card is not the highest catalog-backed price", {
        topCard: {
          name: appCards[0].name,
          collectorNumber: appCards[0].collectorNumber,
          marketPriceUsd: appCards[0].marketPriceUsd,
          estimated: isRarityDerivedMarketPrice(appCards[0]),
        },
        maxCatalogPrice,
      });
    }

    const premiumCards = appCards.filter((card) => PREMIUM_RARITY_PATTERN.test(card.rarity ?? ""));
    const maxPremiumPrice = premiumCards.reduce(
      (max, card) => Math.max(max, card.marketPriceUsd),
      0,
    );
    const topTenMax = appCards
      .slice(0, 10)
      .reduce((max, card) => Math.max(max, card.marketPriceUsd), 0);

    if (maxPremiumPrice > 0 && topTenMax < maxPremiumPrice * 0.9) {
      const buried = premiumCards
        .filter((card) => card.marketPriceUsd >= maxPremiumPrice * 0.9)
        .map((card) => ({
          name: card.name,
          collectorNumber: card.collectorNumber,
          rarity: card.rarity,
          marketPriceUsd: card.marketPriceUsd,
          index: appCards.findIndex((entry) => entry.id === card.id),
        }))
        .slice(0, 5);

      fail(
        test,
        "premium_cards_buried",
        "High-value premium cards are ranked below lower-priced cards",
        {
          maxPremiumPrice,
          topTenMax,
          examples: buried,
        },
      );
    }

    const topIsCommon =
      /common|uncommon/i.test(appCards[0].rarity ?? "") &&
      !PREMIUM_RARITY_PATTERN.test(appCards[0].rarity ?? "");
    if (topIsCommon && maxPremiumPrice > topPrice * 2) {
      fail(test, "common_card_ranked_first", "A common/uncommon card is ranked above premium cards", {
        topCard: {
          name: appCards[0].name,
          collectorNumber: appCards[0].collectorNumber,
          rarity: appCards[0].rarity,
          marketPriceUsd: appCards[0].marketPriceUsd,
        },
        maxPremiumPrice,
      });
    }

    if (!topIsCatalog && catalogCards.length >= 5) {
      fail(test, "estimated_card_ranked_first", "Top card uses an estimated price despite catalog-backed cards existing", {
        topCard: {
          name: appCards[0].name,
          collectorNumber: appCards[0].collectorNumber,
          marketPriceUsd: appCards[0].marketPriceUsd,
        },
      });
    }
  }

  return test;
}

async function fetchTcgdexReferenceCard(setId, languageCode, collectorNumber, cardId) {
  const tcgdxSetId = buildTcgdexSetIdCandidate(setId);
  const apiLanguage = languageCode === "ja" ? "ja" : "en";
  const candidates = [
    cardId,
    `${tcgdxSetId}-${collectorNumber}`,
    `${tcgdxSetId}-${String(collectorNumber).padStart(3, "0")}`,
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      const card = await fetchJson(
        `${TCGDEX_API_BASE}/${apiLanguage}/cards/${encodeURIComponent(candidate)}`,
        { timeoutMs: 8_000 },
      );
      const referencePrice = getTcgdexReferencePrice(card);

      return {
        cardId: candidate,
        referencePrice,
        rarity: card.rarity ?? null,
        name: card.name ?? null,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

async function validatePricing(setMeta, appCards) {
  const test = makeTestResult();
  const pricedCards = appCards.filter((card) => card.marketPriceUsd > 0);
  const estimatedCards = appCards.filter((card) => isRarityDerivedMarketPrice(card));
  const pricedPct = appCards.length ? pricedCards.length / appCards.length : 0;

  if (appCards.length >= 10 && pricedPct < 0.5) {
    fail(test, "low_price_coverage", "Fewer than 50% of cards have a usable price", {
      pricedPct: Math.round(pricedPct * 1000) / 10,
      pricedCount: pricedCards.length,
      total: appCards.length,
    });
  }

  const candidates = [];
  const seen = new Set();

  for (const card of appCards.filter((entry) => isCatalogBackedPrice(entry)).slice(0, CROSSCHECK_TOP_N)) {
    const key = card.id;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(card);
    }
  }

  if (CROSSCHECK_PREMIUM_ALL) {
    let premiumAdded = 0;
    for (const card of appCards.filter((entry) => PREMIUM_RARITY_PATTERN.test(entry.rarity ?? ""))) {
      if (premiumAdded >= MAX_PREMIUM_CROSSCHECKS) {
        break;
      }

      if (!seen.has(card.id) && isCatalogBackedPrice(card)) {
        seen.add(card.id);
        candidates.push(card);
        premiumAdded += 1;
      }
    }
  }

  const crossChecks = await mapWithConcurrency(
    candidates,
    CROSSCHECK_CONCURRENCY,
    async (card) => {
      const reference = await fetchTcgdexReferenceCard(
        setMeta.set_id,
        setMeta.language_code,
        card.collectorNumber,
        card.id,
      );

      if (!reference?.referencePrice) {
        return {
          name: card.name,
          collectorNumber: card.collectorNumber,
          appPriceUsd: card.marketPriceUsd,
          status: "no_reference",
        };
      }

      const deltaRatio =
        (reference.referencePrice - card.marketPriceUsd) / Math.max(reference.referencePrice, 1);
      const undervalued = deltaRatio > PRICE_TOLERANCE_RATIO;

      return {
        name: card.name,
        collectorNumber: card.collectorNumber,
        appPriceUsd: card.marketPriceUsd,
        referencePriceUsd: reference.referencePrice,
        deltaRatio: Math.round(Math.abs(deltaRatio) * 1000) / 1000,
        status: !undervalued
          ? "ok"
          : reference.referencePrice > card.marketPriceUsd * 1.5
            ? "undervalued"
            : "ok",
        rarity: reference.rarity,
      };
    },
  );

  const mismatches = crossChecks.filter((check) => check.status === "undervalued");
  if (mismatches.length) {
    fail(
      test,
      "reference_price_undervalued",
      "Catalog-backed app prices are materially below TCGdex reference (sort risk)",
      {
        count: mismatches.length,
        tolerance: PRICE_TOLERANCE_RATIO,
        examples: mismatches.slice(0, 8),
      },
    );
  }

  const overpriced = crossChecks.filter(
    (check) =>
      check.status === "ok" &&
      check.referencePriceUsd > 0 &&
      check.appPriceUsd > check.referencePriceUsd * (1 + PRICE_TOLERANCE_RATIO * 2),
  );
  if (overpriced.length) {
    test.warnings = test.warnings ?? [];
    test.warnings.push({
      section: "pricing",
      code: "reference_price_higher_than_catalog",
      message: "App price is much higher than TCGdex reference on some cards",
      details: { count: overpriced.length, examples: overpriced.slice(0, 5) },
    });
  }

  const topEstimatedInTopTen = appCards
    .slice(0, 10)
    .filter((card) => isRarityDerivedMarketPrice(card)).length;
  const catalogCount = appCards.filter((card) => isCatalogBackedPrice(card)).length;

  if (catalogCount >= 10 && topEstimatedInTopTen >= 5) {
    fail(test, "estimated_prices_dominate_top", "Too many estimated prices appear in the top 10", {
      topEstimatedInTopTen,
      catalogCount,
    });
  }

  return {
    ...test,
    pricedPct: Math.round(pricedPct * 1000) / 10,
    estimatedCount: estimatedCards.length,
    crossChecks,
  };
}

function pickDetailSamples(searchCards) {
  if (!searchCards.length) {
    return [];
  }

  const picks = [
    searchCards[0],
    searchCards[Math.min(4, searchCards.length - 1)],
    searchCards[Math.floor(searchCards.length / 2)],
    ...searchCards.filter((card) => PREMIUM_RARITY_PATTERN.test(card.rarity ?? "")).slice(0, 2),
    ...searchCards.filter((card) => card.marketPriceUsd > 0).slice(-1),
  ].filter(Boolean);

  return [...new Map(picks.map((card) => [card.slug, card])).values()].slice(0, DETAIL_SAMPLE_SIZE);
}

function buildPokemonTcgSlugFromTcgdex(slug) {
  if (!slug.includes("me02.5")) {
    return null;
  }

  return slug.replace("me02.5", "me2pt5");
}

async function validateCardDetails(setMeta, searchCards) {
  const test = makeTestResult();
  const checks = [];

  if (!VALIDATE_CARD_DETAIL) {
    return { ...test, checks };
  }

  const samples = pickDetailSamples(searchCards);

  for (const searchCard of samples) {
    const slug = searchCard.slug;
    let payload;

    try {
      payload = await fetchJson(`${BASE_URL}/api/cards/${encodeURIComponent(slug)}`, {
        timeoutMs: DETAIL_TIMEOUT_MS,
      });
    } catch (error) {
      fail(test, "detail_request_failed", `Card detail request failed for ${slug}`, {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const detail = payload.card;
    const check = {
      slug,
      searchPriceUsd: searchCard.marketPriceUsd,
      detailPriceUsd: detail?.marketPriceUsd ?? 0,
      source: payload.source ?? "unknown",
      status: "ok",
      issues: [],
    };

    if (!detail) {
      check.status = "fail";
      check.issues.push("detail_not_found");
      fail(test, "detail_not_found", `Card detail missing for ${slug}`, { slug });
      checks.push(check);
      continue;
    }

    if (
      normalizeCollectorNumber(detail.collectorNumber) !==
      normalizeCollectorNumber(searchCard.collectorNumber)
    ) {
      check.status = "fail";
      check.issues.push("collector_number_mismatch");
      fail(test, "detail_collector_mismatch", "Detail collector number does not match search", {
        slug,
        search: searchCard.collectorNumber,
        detail: detail.collectorNumber,
      });
    }

    const searchName = normalizeName(searchCard.name);
    const detailName = normalizeName(detail.name);

    if (searchName !== detailName && !detailName.includes(searchName) && !searchName.includes(detailName)) {
      check.status = "fail";
      check.issues.push("name_mismatch");
      fail(test, "detail_name_mismatch", "Detail card name does not match search", {
        slug,
        search: searchCard.name,
        detail: detail.name,
      });
    }

    if (
      searchCard.rarity &&
      detail.rarity === "Localized release" &&
      searchCard.rarity !== "Localized release"
    ) {
      check.status = "fail";
      check.issues.push("detail_rarity_placeholder");
      fail(test, "detail_rarity_placeholder", "Detail page fell back to placeholder rarity", {
        slug,
        searchRarity: searchCard.rarity,
        detailRarity: detail.rarity,
      });
    }

    if (searchCard.marketPriceUsd > 1 && !(detail.marketPriceUsd > 0)) {
      check.status = "fail";
      check.issues.push("detail_price_missing");
      fail(test, "detail_price_missing", "Search had a price but card detail returned none", {
        slug,
        searchPriceUsd: searchCard.marketPriceUsd,
        detailPriceUsd: detail.marketPriceUsd,
        source: payload.source,
      });
    } else if (
      searchCard.marketPriceUsd > 1 &&
      detail.marketPriceUsd < searchCard.marketPriceUsd * (1 - PRICE_TOLERANCE_RATIO)
    ) {
      check.status = "fail";
      check.issues.push("detail_price_too_low");
      fail(test, "detail_price_too_low", "Card detail price is materially below search price", {
        slug,
        searchPriceUsd: searchCard.marketPriceUsd,
        detailPriceUsd: detail.marketPriceUsd,
        source: payload.source,
      });
    }

    if ((searchCard.attacks?.length ?? 0) > 0 && (detail.attacks?.length ?? 0) === 0) {
      check.status = "fail";
      check.issues.push("detail_missing_attacks");
      fail(test, "detail_missing_attacks", "Search card had attacks but detail page did not", {
        slug,
        searchAttacks: searchCard.attacks.length,
      });
    }

    const pokemonSlug = buildPokemonTcgSlugFromTcgdex(slug);
    if (pokemonSlug && pokemonSlug !== slug) {
      try {
        const aliasPayload = await fetchJson(
          `${BASE_URL}/api/cards/${encodeURIComponent(pokemonSlug)}`,
          { timeoutMs: DETAIL_TIMEOUT_MS },
        );
        const aliasCard = aliasPayload.card;

        if (!aliasCard) {
          check.status = "fail";
          check.issues.push("alias_detail_not_found");
          fail(test, "detail_alias_not_found", "Pokemon TCG API slug detail did not resolve", {
            tcgdxSlug: slug,
            pokemonSlug,
          });
        } else if (searchCard.marketPriceUsd > 1 && !(aliasCard.marketPriceUsd > 0)) {
          check.status = "fail";
          check.issues.push("alias_detail_price_missing");
          fail(test, "detail_alias_price_missing", "Pokemon TCG slug detail is missing search price", {
            tcgdxSlug: slug,
            pokemonSlug,
            searchPriceUsd: searchCard.marketPriceUsd,
            aliasPriceUsd: aliasCard.marketPriceUsd,
          });
        }
      } catch (error) {
        check.status = "fail";
        check.issues.push("alias_detail_request_failed");
        fail(test, "detail_alias_request_failed", "Failed to load Pokemon TCG slug detail", {
          pokemonSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    checks.push(check);
  }

  return { ...test, checks };
}

function resolveGradingMarketLookupSetName(card) {
  const candidate = card.setEnglishName?.trim() || card.setName?.trim() || "";

  if (
    candidate &&
    card.setCode &&
    (candidate.toUpperCase() === card.setCode.trim().toUpperCase() ||
      SET_CODE_ONLY_PATTERN.test(candidate))
  ) {
    return card.setEnglishName?.trim() || card.setName?.trim() || card.setCode.trim() || "Unknown set";
  }

  return candidate || card.setCode?.trim() || "Unknown set";
}

function resolveGradingMarketLookupCardName(card) {
  if (card.language !== "en" && card.englishName?.trim()) {
    return card.englishName.trim();
  }

  const bilingualMatch = card.name.match(/\(([^)]+)\)\s*$/);
  if (bilingualMatch?.[1]?.trim()) {
    return bilingualMatch[1].trim();
  }

  return card.name.trim();
}

function buildGradingMarketParams(card, mode) {
  const params = new URLSearchParams({
    setName: resolveGradingMarketLookupSetName(card),
    cardName: resolveGradingMarketLookupCardName(card),
    cardNumber: card.collectorNumber,
    rawMarketPriceUsd: String(card.marketPriceUsd ?? 0),
  });
  const setTotal = card.setPrintedTotal ?? card.setTotal;

  if (typeof setTotal === "number" && setTotal > 0) {
    params.set("setTotal", String(setTotal));
  }
  if (card.rarity && card.rarity !== "Unknown") {
    params.set("rarity", card.rarity);
  }
  if (card.setCode) {
    params.set("setCode", card.setCode);
  }
  if (card.language) {
    params.set("language", card.language);
  }
  if (card.englishName?.trim()) {
    params.set("englishCardName", card.englishName.trim());
  }
  if (mode === "core") {
    params.set("mode", "core");
  }

  return params;
}

function pickGradingSamples(searchCards) {
  if (!searchCards.length) {
    return [];
  }

  const priced = searchCards.filter((card) => card.marketPriceUsd > 0);
  const premium = searchCards.filter((card) => PREMIUM_RARITY_PATTERN.test(card.rarity ?? ""));
  const picks = [
    searchCards[0],
    premium.find((card) => card.marketPriceUsd > 0) ?? premium[0],
    priced[Math.floor(priced.length / 2)],
    priced[priced.length - 1],
    searchCards[Math.min(2, searchCards.length - 1)],
  ].filter(Boolean);

  return [...new Map(picks.map((card) => [card.id, card])).values()].slice(0, GRADING_SAMPLE_SIZE);
}

function hasGradedPriceTiers(gradedPrices) {
  return gradedPrices.some(
    (price) =>
      price.grade !== "Ungraded" &&
      typeof price.value === "number" &&
      price.value > 0 &&
      /PSA|CGC|BGS|SGC/i.test(String(price.grade)),
  );
}

function hasPopulationGrades(psaPopulation) {
  return Array.isArray(psaPopulation?.grades) && psaPopulation.grades.length > 0;
}

function hasRecentSales(recentSales) {
  return Array.isArray(recentSales) && recentSales.length > 0;
}

function validateGradingMarketShape(payload) {
  const issues = [];

  if (!payload || typeof payload !== "object") {
    return ["invalid_payload"];
  }

  if (!Array.isArray(payload.gradedPrices)) {
    issues.push("missing_graded_prices_array");
  } else {
    for (const price of payload.gradedPrices) {
      if (!price?.grade || typeof price.value !== "number") {
        issues.push("invalid_graded_price_entry");
        break;
      }
    }
  }

  if (payload.psaPopulation !== null && typeof payload.psaPopulation !== "object") {
    issues.push("invalid_psa_population");
  }

  if (!Array.isArray(payload.recentSales)) {
    issues.push("missing_recent_sales_array");
  } else {
    for (const sale of payload.recentSales) {
      if (!sale?.date || typeof sale.price !== "number") {
        issues.push("invalid_recent_sale_entry");
        break;
      }
    }
  }

  return issues;
}

async function fetchGradingMarket(card, mode) {
  const params = buildGradingMarketParams(card, mode);
  return fetchJson(`${BASE_URL}/api/grading-market?${params.toString()}`, {
    timeoutMs: GRADING_TIMEOUT_MS,
  });
}

async function runGradingMarketCheck(card, mode) {
  const check = {
    mode,
    name: card.name,
    collectorNumber: card.collectorNumber,
    marketPriceUsd: card.marketPriceUsd,
    language: card.language,
    status: "ok",
    issues: [],
    gradedPriceCount: 0,
    populationGradeCount: 0,
    recentSalesCount: 0,
    ungradedValue: null,
    psa10Value: null,
    lastSoldAt: null,
    lastSoldPrice: null,
  };

  let payload;

  try {
    payload = await fetchGradingMarket(card, mode);
  } catch (error) {
    check.status = "fail";
    check.issues.push("request_failed");
    check.error = error instanceof Error ? error.message : String(error);
    return { check, payload: null, hardFail: true, advisory: false };
  }

  const shapeIssues = validateGradingMarketShape(payload);
  if (shapeIssues.length) {
    check.status = "fail";
    check.issues.push(...shapeIssues);
    return { check, payload, hardFail: true, advisory: false };
  }

  const gradedPrices = payload.gradedPrices ?? [];
  const psaPopulation = payload.psaPopulation;
  const recentSales = payload.recentSales ?? [];

  check.gradedPriceCount = gradedPrices.length;
  check.populationGradeCount = psaPopulation?.grades?.length ?? 0;
  check.recentSalesCount = recentSales.length;
  check.ungradedValue = gradedPrices.find((price) => price.grade === "Ungraded")?.value ?? null;
  check.psa10Value = gradedPrices.find((price) => String(price.grade).includes("PSA 10"))?.value ?? null;

  if (recentSales.length) {
    const latest = recentSales[0];
    check.lastSoldAt = latest.date ?? null;
    check.lastSoldPrice = latest.price ?? null;
  }

  const lastSoldGrade = gradedPrices.find((price) => price.lastSoldAt);
  if (lastSoldGrade?.lastSoldAt) {
    check.lastSoldAt = check.lastSoldAt ?? lastSoldGrade.lastSoldAt;
  }

  const marketPrice = card.marketPriceUsd ?? 0;
  const ungraded = gradedPrices.find((price) => price.grade === "Ungraded");
  const hasUngradedValue = typeof ungraded?.value === "number" && ungraded.value > 0;
  const hasConsensus =
    typeof payload.priceConsensus?.finalEstimateUsd === "number" &&
    payload.priceConsensus.finalEstimateUsd > 0;

  if (marketPrice >= GRADING_MIN_PRICE_USD && !hasUngradedValue && !hasConsensus) {
    check.status = "fail";
    check.issues.push("missing_headline_price");
  }

  if (mode === "full" && marketPrice >= GRADING_HIGH_VALUE_USD) {
    const enriched =
      hasGradedPriceTiers(gradedPrices) ||
      hasPopulationGrades(psaPopulation) ||
      hasRecentSales(recentSales);

    if (!enriched) {
      check.status = "fail";
      check.issues.push("high_value_missing_market_enrichment");
    }
  }

  if (
    mode === "full" &&
    marketPrice >= GRADING_HIGH_VALUE_USD &&
    card.language === "en" &&
    !hasRecentSales(recentSales) &&
    !hasGradedPriceTiers(gradedPrices)
  ) {
    check.issues.push("no_sold_comps_or_graded_tiers");
    if (check.status === "ok") {
      check.status = "warn";
    }
  }

  const hardFail = check.status === "fail";
  const advisory = check.status === "warn";

  return { check, payload, hardFail, advisory };
}

async function validateGradingMarket(setMeta, searchCards) {
  const test = makeTestResult();
  const checks = [];

  if (!VALIDATE_GRADING_MARKET) {
    return { ...test, checks, skipped: true };
  }

  const samples = pickGradingSamples(searchCards);
  const modes = VALIDATE_GRADING_FULL ? ["core", "full"] : ["core"];
  const jobs = [];

  for (const card of samples) {
    for (const mode of modes) {
      jobs.push({ card, mode });
    }
  }

  const results = await mapWithConcurrency(jobs, GRADING_CONCURRENCY, async ({ card, mode }) =>
    runGradingMarketCheck(card, mode),
  );

  for (const result of results) {
    checks.push(result.check);

    if (result.hardFail) {
      fail(
        test,
        result.check.issues[0] ?? "grading_market_failed",
        `Grading market ${result.check.mode} failed for ${result.check.name} (#${result.check.collectorNumber})`,
        {
          mode: result.check.mode,
          issues: result.check.issues,
          error: result.check.error ?? null,
          marketPriceUsd: result.check.marketPriceUsd,
        },
      );
    } else if (result.advisory) {
      test.warnings = test.warnings ?? [];
      test.warnings.push({
        section: "gradingMarket",
        code: result.check.issues[0] ?? "grading_market_advisory",
        message: `Grading market ${result.check.mode} returned thin data for ${result.check.name}`,
        details: {
          collectorNumber: result.check.collectorNumber,
          issues: result.check.issues,
          marketPriceUsd: result.check.marketPriceUsd,
        },
      });
    }
  }

  return {
    ...test,
    checks,
    sampleCount: samples.length,
    modesTested: modes,
  };
}

function summarizeTests(tests) {
  const sections = Object.entries(tests);
  const failures = sections.flatMap(([name, test]) =>
    (test.failures ?? []).map((failure) => ({ section: name, ...failure })),
  );
  const warnings = sections.flatMap(([name, test]) =>
    (test.warnings ?? []).map((warning) => ({
      section: name,
      code: warning.code ?? "advisory",
      message: warning.message ?? String(warning),
      details: warning.details ?? null,
      advisory: true,
    })),
  );

  return {
    passed: failures.length === 0,
    failureCount: failures.length,
    warningCount: warnings.length,
    failures,
    warnings,
  };
}

function classifySortFailure(sort, failure) {
  if (ADVISORY_SORT_MODES.has(sort) && !INCLUDE_NUMBER_SORT) {
    return null;
  }

  if (ADVISORY_SORT_MODES.has(sort) && !STRICT_MODE) {
    return { ...failure, advisory: true };
  }

  return failure;
}

function applySortTest(tests, name, sort, cards) {
  const result = validateSortMode(cards, sort);
  const hardFailures = [];
  const advisories = [];

  for (const failure of result.failures) {
    const classified = classifySortFailure(sort, failure);
    if (!classified) {
      continue;
    }

    if (classified.advisory) {
      advisories.push({ ...classified, section: name });
    } else {
      hardFailures.push({ ...classified, section: name });
    }
  }

  tests[name] = {
    passed: hardFailures.length === 0,
    failures: hardFailures,
    warnings: advisories,
  };
}

async function validateSet(setMeta) {
  const startedAt = Date.now();

  try {
    const reference = await buildReferenceCatalog(setMeta);
    const sortPayloads = new Map();

    for (const sort of SORT_MODES_TO_TEST) {
      sortPayloads.set(sort, await fetchAllSetCards(setMeta.set_id, setMeta.language_code, sort));
    }

    if (INCLUDE_NUMBER_SORT) {
      for (const sort of ["number-asc", "number-desc"]) {
        if (!sortPayloads.has(sort)) {
          sortPayloads.set(
            sort,
            await fetchAllSetCards(setMeta.set_id, setMeta.language_code, sort),
          );
        }
      }
    }

    const priceDesc = sortPayloads.get("price-desc") ?? sortPayloads.values().next().value;

    const tests = {
      completeness: validateCompleteness(
        setMeta,
        priceDesc.cards,
        priceDesc.totalCount,
        reference,
      ),
      cardData: validateCardData(setMeta, priceDesc.cards, reference),
      pricing: await validatePricing(setMeta, priceDesc.cards),
      cardDetail: await validateCardDetails(setMeta, priceDesc.cards),
      gradingMarket: await validateGradingMarket(setMeta, priceDesc.cards),
    };

    if (sortPayloads.has("price-desc")) {
      applySortTest(tests, "sortPriceDesc", "price-desc", sortPayloads.get("price-desc").cards);
    }

    if (sortPayloads.has("price-asc")) {
      applySortTest(tests, "sortPriceAsc", "price-asc", sortPayloads.get("price-asc").cards);
    }

    if (INCLUDE_NUMBER_SORT && sortPayloads.has("number-asc")) {
      applySortTest(tests, "sortNumberAsc", "number-asc", sortPayloads.get("number-asc").cards);
    }

    if (INCLUDE_NUMBER_SORT && sortPayloads.has("number-desc")) {
      applySortTest(tests, "sortNumberDesc", "number-desc", sortPayloads.get("number-desc").cards);
    }

    const summary = summarizeTests(tests);
    const hardFailures = STRICT_MODE
      ? summary.failures
      : summary.failures.filter((failure) => failure.code !== "card_name_mismatch");

    const advisories = [
      ...Object.values(tests).flatMap((test) =>
        (test.warnings ?? []).map((warning) => ({
          section: warning.section ?? "general",
          code: warning.code,
          message: warning.message,
          details: warning.details ?? null,
          advisory: true,
        })),
      ),
    ];

    return {
      setId: setMeta.set_id,
      language: setMeta.language_code,
      name: setMeta.name,
      reference: {
        source: reference.tcgdx ? "tcgdex" : reference.cards.length ? "cards_index" : "set_db",
        expectedTotal: reference.expectedTotal,
        referenceCardCount: reference.cards.length,
        indexCount: reference.indexCount,
      },
      reportedTotalCount: priceDesc.totalCount,
      fetchedCardCount: priceDesc.cards.length,
      tests,
      failures: hardFailures,
      warnings: advisories,
      passed: hardFailures.length === 0,
      durationMs: Date.now() - startedAt,
      topCards: priceDesc.cards.slice(0, 5).map((card) => ({
        name: card.name,
        collectorNumber: card.collectorNumber,
        rarity: card.rarity,
        marketPriceUsd: card.marketPriceUsd,
        estimated: isRarityDerivedMarketPrice(card),
      })),
      error: null,
    };
  } catch (error) {
    return {
      setId: setMeta.set_id,
      language: setMeta.language_code,
      name: setMeta.name,
      passed: false,
      failures: [
        {
          section: "runtime",
          code: "request_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function printSummary(report) {
  const failed = report.sets.filter((set) => !set.passed);

  console.log("");
  console.log("Set validation summary");
  console.log("======================");
  console.log(`Mode: ${report.mode} | Language: ${report.language} | Base URL: ${report.baseUrl}`);
  if (report.gradingMarketEnabled) {
    console.log(
      `Grading market: enabled (${report.gradingModesTested?.join(", ") ?? "core,full"}, ${report.gradingSampleSize ?? GRADING_SAMPLE_SIZE} samples/set)`,
    );
  }
  console.log(`Sets tested: ${report.sets.length} | Passed: ${report.passedCount} | Failed: ${failed.length}`);
  console.log(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  console.log(`Report: ${report.outputPath}`);
  console.log("");

  for (const set of report.sets) {
    const status = set.passed ? "PASS" : "FAIL";
    const cards =
      typeof set.fetchedCardCount === "number"
        ? `${set.fetchedCardCount}/${set.reportedTotalCount ?? "?"} cards`
        : "n/a";

    console.log(
      `[${status}] ${set.language}/${set.setId} ${set.name ?? ""} — ${cards}, ${set.durationMs ?? 0}ms`,
    );

    if (set.tests) {
      for (const [section, test] of Object.entries(set.tests)) {
        const label = test.passed ? "ok" : "FAIL";
        const warnCount = test.warnings?.length ?? 0;
        console.log(`       ${section}: ${label}${warnCount ? ` (${warnCount} advisory)` : ""}`);
      }
    }

    if (set.warnings?.length) {
      for (const warning of set.warnings.slice(0, 3)) {
        console.log(`       ~ ${warning.section}/${warning.code}: ${warning.message}`);
      }
    }

    if (!set.passed) {
      for (const failure of set.failures ?? []) {
        console.log(
          `       ! ${failure.section ?? "test"}/${failure.code}: ${failure.message}`,
        );
        if (failure.details?.examples) {
          console.log(`         examples: ${JSON.stringify(failure.details.examples)}`);
        } else if (failure.details) {
          console.log(`         details: ${JSON.stringify(failure.details)}`);
        }
      }
      if (set.error) {
        console.log(`       ! runtime: ${set.error}`);
      }
    }
  }

  if (failed.length) {
    console.log("");
    console.log(`${failed.length} set(s) failed validation.`);
  }
}

async function ensureServerReady() {
  const probeLang = LANG === "all" ? "en" : LANG.split(",")[0]?.trim() || "en";

  try {
    await fetchJson(`${BASE_URL}/api/search-sets?lang=${encodeURIComponent(probeLang)}`, {
      timeoutMs: 10_000,
    });
  } catch (error) {
    throw new Error(
      `App server not reachable at ${BASE_URL}. Start it with: npm run dev\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeIncrementalReport(report) {
  if (!INCREMENTAL_REPORT) {
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const startedAt = Date.now();
  await ensureServerReady();

  const allSets = loadSets(LANG === "all" ? "all" : LANG);
  const sets = selectSets(allSets);

  if (!sets.length) {
    throw new Error(`No sets found for language=${LANG} mode=${MODE}`);
  }

  const languageSummary = [...new Set(sets.map((set) => set.language_code))].sort();

  console.log(
    `Validating ${sets.length} set(s) [mode=${MODE}, lang=${LANG}, languages=${languageSummary.join(",")}] against ${BASE_URL}`,
  );
  if (VALIDATE_GRADING_MARKET) {
    console.log(
      `Grading market checks: ${VALIDATE_GRADING_FULL ? "core+full" : "core"} | samples/set=${GRADING_SAMPLE_SIZE}`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    language: LANG,
    languagesTested: languageSummary,
    baseUrl: BASE_URL,
    durationMs: 0,
    outputPath: OUTPUT_PATH,
    gradingMarketEnabled: VALIDATE_GRADING_MARKET,
    gradingModesTested: VALIDATE_GRADING_FULL ? ["core", "full"] : ["core"],
    gradingSampleSize: GRADING_SAMPLE_SIZE,
    setCount: sets.length,
    passedCount: 0,
    failedCount: 0,
    sets: [],
  };

  const results = [];

  for (let index = 0; index < sets.length; index += 1) {
    const setMeta = sets[index];
    process.stdout.write(
      `[${index + 1}/${sets.length}] ${setMeta.language_code}/${setMeta.set_id} ... `,
    );
    const result = await validateSet(setMeta);
    results.push(result);
    process.stdout.write(result.passed ? "PASS\n" : "FAIL\n");

    report.sets = results;
    report.passedCount = results.filter((set) => set.passed).length;
    report.failedCount = results.filter((set) => !set.passed).length;
    report.durationMs = Date.now() - startedAt;
    writeIncrementalReport(report);
  }

  report.durationMs = Date.now() - startedAt;
  report.setCount = results.length;
  report.passedCount = results.filter((set) => set.passed).length;
  report.failedCount = results.filter((set) => !set.passed).length;
  report.sets = results;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  printSummary(report);

  if (report.failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
