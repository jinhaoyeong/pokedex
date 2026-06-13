#!/usr/bin/env node
/**
 * Validates card coverage and price accuracy for set browse / price sorting.
 *
 * Requires:
 *   - data/pokemon-sets.sqlite (npm run db:seed:sets)
 *   - Running app server (npm run dev) unless VALIDATE_BASE_URL points elsewhere
 *
 * Usage:
 *   npm run validate:sets:smoke
 *   npm run validate:sets
 *   VALIDATE_LANG=ja VALIDATE_MODE=smoke npm run validate:sets
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
const SET_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_SET_TIMEOUT_MS ?? "45000", 10);
const CROSSCHECK_TOP_N = Number.parseInt(process.env.VALIDATE_CROSSCHECK_TOP ?? "3", 10);
const CROSSCHECK_ENABLED = process.env.VALIDATE_CROSSCHECK !== "false";
const STRICT_MODE = process.env.VALIDATE_STRICT === "true";
const PRICE_TOLERANCE_RATIO = Number.parseFloat(process.env.VALIDATE_PRICE_TOLERANCE ?? "0.4");
const OUTPUT_PATH = process.env.VALIDATE_OUTPUT ?? DEFAULT_REPORT_PATH;

const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";
const EUR_TO_USD = 1.08;

const SMOKE_SETS = {
  en: [
    "me2pt5",
    "sv8pt5",
    "sv3pt5",
    "sv9",
    "sm12",
    "base1",
    "sv8",
    "celebrations",
    "swsh12",
    "sv6pt5",
  ],
  ja: ["SV11W", "S12A", "SV9", "SM12", "SV8a"],
};

const EN_SET_ID_ALIASES = {
  me2pt5: "me02.5",
  sv8pt5: "sv08.5",
  sv3pt5: "sv03.5",
  sv6pt5: "sv06.5",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    case "avg1":
      return positivePrice(cardmarket.avg1);
    case "averageSellPrice":
      return positivePrice(cardmarket.averageSellPrice ?? cardmarket.avg);
    case "lowPrice":
      return positivePrice(cardmarket.lowPrice ?? cardmarket.low);
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

function isLowConfidenceSearchMarketPrice(card) {
  if (isRarityDerivedMarketPrice(card)) {
    return true;
  }

  return (
    card.priceConsensus?.confidence === "low" &&
    (card.priceConsensus.confidenceScore ?? 1) < 0.4
  );
}

function isSuspiciouslyLowCatalogPrice(card) {
  const price = card.marketPriceUsd;

  if (!(price > 0)) {
    return false;
  }

  const rarity = (card.rarity ?? "").toLowerCase();
  const setName = (card.setName ?? "").toLowerCase();

  if (
    /star|secret rare|special illustration|illustration rare|hyper rare|rainbow|gold star/i.test(
      rarity,
    ) &&
    price < 250
  ) {
    return true;
  }

  if (/pop series|neo |ex delta|ex dragon|ex unseen/i.test(setName) && price < 120) {
    return true;
  }

  if (/rare holo/i.test(rarity) && /pop |neo |ex /i.test(setName) && price < 80) {
    return true;
  }

  return false;
}

function isSortMonotonic(cards, sort = "price-desc") {
  for (let index = 1; index < cards.length; index += 1) {
    const previous = cards[index - 1].marketPriceUsd;
    const current = cards[index].marketPriceUsd;

    if (sort === "price-desc") {
      const prev = previous > 0 ? previous : Number.POSITIVE_INFINITY;
      const next = current > 0 ? current : Number.POSITIVE_INFINITY;
      if (prev < next) {
        return {
          ok: false,
          at: index,
          previous: cards[index - 1],
          current: cards[index],
        };
      }
    }
  }

  return { ok: true };
}

function loadSets(language) {
  if (!fs.existsSync(SETS_DB_PATH)) {
    throw new Error(`Missing ${SETS_DB_PATH}. Run: npm run db:seed:sets`);
  }

  const db = new Database(SETS_DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `
      SELECT set_id, language_code, name, english_name, code, release_date, printed_total, total
      FROM tcg_sets
      WHERE (? = 'all' OR language_code = ?)
      ORDER BY release_date DESC
    `,
    )
    .all(language, language);

  db.close();
  return rows;
}

function loadIndexedCardCount(setId, languageCode) {
  if (!fs.existsSync(CARDS_INDEX_DB_PATH)) {
    return null;
  }

  const db = new Database(CARDS_INDEX_DB_PATH, { readonly: true });
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM cards_index
      WHERE set_id = ? AND language_code = ?
    `,
    )
    .get(setId, languageCode);

  db.close();
  return row?.count ?? null;
}

function selectSets(allSets) {
  if (MODE === "full") {
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

  if (selected.length) {
    return selected.slice(0, MAX_SETS);
  }

  return allSets.slice(0, Math.min(12, MAX_SETS));
}

async function fetchAllSetCards(setId, languageCode) {
  const cards = [];
  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;

  while ((page - 1) * PAGE_SIZE < totalCount) {
    const params = new URLSearchParams({
      set: setId,
      lang: languageCode,
      sort: "price-desc",
      page: String(page),
    });
    const payload = await fetchJson(`${BASE_URL}/api/live-search?${params.toString()}`, {
      timeoutMs: SET_TIMEOUT_MS,
    });

    totalCount = payload.totalCount ?? cards.length;
    const batch = (payload.results ?? []).map((result) => result.card);

    if (!batch.length) {
      break;
    }

    cards.push(...batch);
    page += 1;

    if (!payload.hasNextPage) {
      break;
    }
  }

  return {
    cards,
    totalCount: Number.isFinite(totalCount) ? totalCount : cards.length,
  };
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

      if (referencePrice > 0) {
        return {
          cardId: candidate,
          referencePrice,
          rarity: card.rarity ?? null,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function crossCheckTopCards(setId, languageCode, cards, topN) {
  if (!CROSSCHECK_ENABLED || !cards.length) {
    return [];
  }

  const topCards = cards
    .filter((card) => card.marketPriceUsd > 0 && !isRarityDerivedMarketPrice(card))
    .slice(0, topN);
  const checks = [];

  for (const card of topCards) {
    const reference = await fetchTcgdexReferenceCard(
      setId,
      languageCode,
      card.collectorNumber,
      card.id,
    );

    if (!reference) {
      checks.push({
        name: card.name,
        collectorNumber: card.collectorNumber,
        appPriceUsd: card.marketPriceUsd,
        status: "no_reference",
      });
      continue;
    }

    const deltaRatio =
      Math.abs(card.marketPriceUsd - reference.referencePrice) /
      Math.max(reference.referencePrice, 1);
    const withinTolerance = deltaRatio <= PRICE_TOLERANCE_RATIO;

    checks.push({
      name: card.name,
      collectorNumber: card.collectorNumber,
      appPriceUsd: card.marketPriceUsd,
      referencePriceUsd: reference.referencePrice,
      deltaRatio: Math.round(deltaRatio * 1000) / 1000,
      status: withinTolerance ? "ok" : "mismatch",
      rarity: reference.rarity,
    });
  }

  return checks;
}

function evaluateSetResult(setMeta, cards, totalCount, crossChecks) {
  const expectedTotal = setMeta.total ?? setMeta.printed_total ?? null;
  const indexedCount = loadIndexedCardCount(setMeta.set_id, setMeta.language_code);
  const expectedCount = indexedCount ?? expectedTotal;
  const uniqueIds = new Set(cards.map((card) => card.id));
  const pricedCards = cards.filter((card) => card.marketPriceUsd > 0);
  const lowConfidenceCards = cards.filter((card) => isLowConfidenceSearchMarketPrice(card));
  const suspiciousCards = cards.filter((card) => isSuspiciouslyLowCatalogPrice(card));
  const estimatedCards = cards.filter((card) => isRarityDerivedMarketPrice(card));
  const sortCheck = isSortMonotonic(cards, "price-desc");
  const crossCheckMismatches = crossChecks.filter((check) => check.status === "mismatch");

  const issues = [];
  const warnings = [];

  if (!cards.length) {
    issues.push("no_cards_returned");
  }

  if (uniqueIds.size !== cards.length) {
    issues.push("duplicate_card_ids");
  }

  if (!sortCheck.ok) {
    issues.push("price_sort_not_monotonic");
  }

  if (expectedCount !== null && totalCount < Math.min(expectedCount, 300) * 0.85) {
    issues.push("low_card_coverage");
  }

  const pricedPct = cards.length ? pricedCards.length / cards.length : 0;
  if (pricedPct < 0.5 && cards.length >= 10) {
    issues.push("low_price_coverage");
  }

  if (crossCheckMismatches.length > 0) {
    issues.push("reference_price_mismatch");
  }

  if (suspiciousCards.length > 0) {
    warnings.push("suspicious_low_premium_prices");
  }

  const estimatedPct = cards.length ? estimatedCards.length / cards.length : 0;
  if (estimatedPct >= 0.35) {
    warnings.push("high_estimated_price_ratio");
  }

  const lowConfidencePct = cards.length ? lowConfidenceCards.length / cards.length : 0;
  if (lowConfidencePct >= 0.35) {
    warnings.push("high_low_confidence_ratio");
  }

  const hardIssues = STRICT_MODE ? [...issues, ...warnings] : issues;

  return {
    setId: setMeta.set_id,
    language: setMeta.language_code,
    name: setMeta.name,
    releaseDate: setMeta.release_date,
    expectedCount,
    indexedCount,
    reportedTotalCount: totalCount,
    fetchedCardCount: cards.length,
    uniqueCardCount: uniqueIds.size,
    pricedCount: pricedCards.length,
    pricedPct: Math.round(pricedPct * 1000) / 10,
    estimatedCount: estimatedCards.length,
    estimatedPct: Math.round(estimatedPct * 1000) / 10,
    lowConfidenceCount: lowConfidenceCards.length,
    lowConfidencePct: Math.round(lowConfidencePct * 1000) / 10,
    suspiciousCount: suspiciousCards.length,
    suspiciousCards: suspiciousCards.slice(0, 8).map((card) => ({
      name: card.name,
      collectorNumber: card.collectorNumber,
      rarity: card.rarity,
      marketPriceUsd: card.marketPriceUsd,
    })),
    sortOk: sortCheck.ok,
    sortViolation: sortCheck.ok
      ? null
      : {
          at: sortCheck.at,
          previous: {
            name: sortCheck.previous.name,
            collectorNumber: sortCheck.previous.collectorNumber,
            marketPriceUsd: sortCheck.previous.marketPriceUsd,
          },
          current: {
            name: sortCheck.current.name,
            collectorNumber: sortCheck.current.collectorNumber,
            marketPriceUsd: sortCheck.current.marketPriceUsd,
          },
        },
    topCards: cards.slice(0, 5).map((card) => ({
      name: card.name,
      collectorNumber: card.collectorNumber,
      rarity: card.rarity,
      marketPriceUsd: card.marketPriceUsd,
      estimated: isRarityDerivedMarketPrice(card),
      suspicious: isSuspiciouslyLowCatalogPrice(card),
    })),
    crossChecks,
    issues: hardIssues,
    warnings,
    passed: hardIssues.length === 0,
  };
}

async function validateSet(setMeta) {
  const startedAt = Date.now();

  try {
    const { cards, totalCount } = await fetchAllSetCards(setMeta.set_id, setMeta.language_code);
    const crossChecks = await crossCheckTopCards(
      setMeta.set_id,
      setMeta.language_code,
      cards,
      CROSSCHECK_TOP_N,
    );
    const result = evaluateSetResult(setMeta, cards, totalCount, crossChecks);

    return {
      ...result,
      durationMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      setId: setMeta.set_id,
      language: setMeta.language_code,
      name: setMeta.name,
      passed: false,
      issues: ["request_failed"],
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

function printSummary(report) {
  const failed = report.sets.filter((set) => !set.passed);

  console.log("");
  console.log("Set price validation summary");
  console.log("==========================");
  console.log(`Mode: ${report.mode} | Language: ${report.language} | Base URL: ${report.baseUrl}`);
  console.log(`Sets tested: ${report.sets.length} | Passed: ${report.passedCount} | Failed: ${failed.length}`);
  if (report.warningCount > 0) {
    console.log(`Warnings: ${report.warningCount} set(s) with non-blocking issues`);
  }
  console.log(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  console.log(`Report: ${report.outputPath}`);
  console.log("");

  for (const set of report.sets) {
    const status = set.passed ? "PASS" : "FAIL";
    const priced = typeof set.pricedPct === "number" ? `${set.pricedPct}% priced` : "n/a";
    const cards =
      typeof set.fetchedCardCount === "number"
        ? `${set.fetchedCardCount}/${set.reportedTotalCount ?? "?"} cards`
        : "n/a";

    console.log(
      `[${status}] ${set.language}/${set.setId} ${set.name ?? ""} — ${cards}, ${priced}, ${set.durationMs ?? 0}ms`,
    );

    if (!set.passed) {
      const details = [...(set.issues ?? [])];
      if (set.error) {
        details.push(set.error);
      }
      if (set.sortViolation) {
        details.push(
          `sort break: ${set.sortViolation.previous.name} ($${set.sortViolation.previous.marketPriceUsd}) before ${set.sortViolation.current.name} ($${set.sortViolation.current.marketPriceUsd})`,
        );
      }
      for (const check of (set.crossChecks ?? []).filter((item) => item.status === "mismatch")) {
        details.push(
          `price mismatch ${check.name}: app $${check.appPriceUsd} vs ref $${check.referencePriceUsd}`,
        );
      }
      console.log(`       ${details.join(" | ")}`);
    } else if (set.warnings?.length) {
      console.log(`       warnings: ${set.warnings.join(", ")}`);
    }
  }

  if (failed.length) {
    console.log("");
    console.log(`${failed.length} set(s) failed validation.`);
  }
}

async function ensureServerReady() {
  try {
    await fetchJson(`${BASE_URL}/api/search-sets?lang=${encodeURIComponent(LANG)}`, {
      timeoutMs: 10_000,
    });
  } catch (error) {
    throw new Error(
      `App server not reachable at ${BASE_URL}. Start it with: npm run dev\n${error instanceof Error ? error.message : error}`,
    );
  }
}

async function main() {
  const startedAt = Date.now();
  await ensureServerReady();

  const allSets = loadSets(LANG);
  const sets = selectSets(allSets);

  if (!sets.length) {
    throw new Error(`No sets found for language=${LANG} mode=${MODE}`);
  }

  console.log(`Validating ${sets.length} set(s) [mode=${MODE}, lang=${LANG}] against ${BASE_URL}`);

  const results = await mapWithConcurrency(sets, SET_CONCURRENCY, async (setMeta, index) => {
    process.stdout.write(`[${index + 1}/${sets.length}] ${setMeta.language_code}/${setMeta.set_id} ... `);
    const result = await validateSet(setMeta);
    process.stdout.write(result.passed ? "PASS\n" : "FAIL\n");
    return result;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    language: LANG,
    baseUrl: BASE_URL,
    durationMs: Date.now() - startedAt,
    outputPath: OUTPUT_PATH,
    setCount: results.length,
    passedCount: results.filter((set) => set.passed).length,
    failedCount: results.filter((set) => !set.passed).length,
    warningCount: results.filter((set) => (set.warnings ?? []).length > 0).length,
    sets: results,
  };

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
