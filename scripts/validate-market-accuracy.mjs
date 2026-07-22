#!/usr/bin/env node
/**
 * Multi-source market accuracy validation for cards from 2015–2026.
 *
 * Compares app prices, graded tiers, sold comps, and PSA population against
 * TCGdex catalog references and cross-checks guide snapshots inside marketEvidence.
 *
 * Requires running app server unless VALIDATE_BASE_URL is set.
 *
 * Usage:
 *   npm run validate:market
 *   VALIDATE_YEAR_MIN=2018 VALIDATE_YEAR_MAX=2024 npm run validate:market
 *   VALIDATE_LANG=ja VALIDATE_SAMPLES_PER_SET=2 npm run validate:market
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import {
  DEFAULT_GRADED_TOLERANCE,
  DEFAULT_RAW_TOLERANCE,
  evaluateMarketAccuracy,
  getTcgdexReferencePrice,
} from "./lib/market-accuracy-checks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SETS_DB_PATH = path.join(ROOT, "data", "pokemon-sets.sqlite");
const JAPANESE_FIXTURES_PATH = path.join(
  ROOT,
  "test",
  "fixtures",
  "japanese-market-identities.json",
);
const DEFAULT_REPORT_PATH = path.join(ROOT, "data", "validate-market-accuracy-report.json");

const BASE_URL = (process.env.VALIDATE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUTPUT_PATH = process.env.VALIDATE_OUTPUT ?? DEFAULT_REPORT_PATH;
const LANG = process.env.VALIDATE_LANG ?? "en";
const YEAR_MIN = Number.parseInt(process.env.VALIDATE_YEAR_MIN ?? "2015", 10);
const YEAR_MAX = Number.parseInt(process.env.VALIDATE_YEAR_MAX ?? "2026", 10);
const SAMPLES_PER_SET = Number.parseInt(process.env.VALIDATE_SAMPLES_PER_SET ?? "2", 10);
const MAX_SETS = Number.parseInt(process.env.VALIDATE_MAX_SETS ?? "12", 10);
const GRADING_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_GRADING_TIMEOUT_MS ?? "120000", 10);
const PRICE_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_PRICE_TIMEOUT_MS ?? "60000", 10);
const SET_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_SET_TIMEOUT_MS ?? "90000", 10);
const GRADING_MODE = process.env.VALIDATE_GRADING_MODE === "core" ? "core" : "full";
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.VALIDATE_CONCURRENCY ?? "2", 10));
const MIN_PRICE_USD = Number.parseFloat(process.env.VALIDATE_MIN_PRICE_USD ?? "15");

const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";

const ERA_SETS = {
  en: [
    "xy11",
    "sm1",
    "sm5",
    "sm10",
    "swsh4",
    "swsh8",
    "swsh12",
    "sv3pt5",
    "sv8",
    "sv10",
    "me2pt5",
  ],
  ja: ["SM12", "S12A", "SV2A", "SV8A", "SV9", "M2A"],
};

function buildGradingParams(card) {
  const params = new URLSearchParams({
    setName: card.setName,
    cardName: card.name,
    cardNumber: card.collectorNumber,
    rawMarketPriceUsd: String(card.marketPriceUsd ?? 0),
    language: card.language ?? LANG,
    mode: GRADING_MODE,
  });

  if (card.setCode) {
    params.set("setCode", card.setCode);
  }
  if (card.rarity && card.rarity !== "Unknown") {
    params.set("rarity", card.rarity);
  }
  if (card.setPrintedTotal ?? card.setTotal) {
    params.set("setTotal", String(card.setPrintedTotal ?? card.setTotal));
  }
  if (card.englishName?.trim()) {
    params.set("englishCardName", card.englishName.trim());
  }
  if (card.officialCardId) {
    params.set("officialCardId", card.officialCardId);
  }
  if (Number.isInteger(card.browseIndex)) {
    params.set("browseIndex", String(card.browseIndex));
  }
  if (card.marketIdentity?.priceChartingProductId) {
    params.set("priceChartingProductId", card.marketIdentity.priceChartingProductId);
  }
  if (card.marketIdentity?.priceChartingProductUrl) {
    params.set("priceChartingProductUrl", card.marketIdentity.priceChartingProductUrl);
  }
  if (card.marketIdentity?.priceChartingSetSlug) {
    params.set("priceChartingSetSlug", card.marketIdentity.priceChartingSetSlug);
  }

  return params;
}

function buildPriceParams(card) {
  const params = new URLSearchParams({
    slug: card.slug,
    name: card.name,
    language: card.language ?? LANG,
  });

  if (card.id) params.set("cardId", card.id);
  if (card.officialCardId) params.set("officialCardId", card.officialCardId);
  if (Number.isInteger(card.browseIndex)) params.set("browseIndex", String(card.browseIndex));
  if (card.setCode) params.set("setCode", card.setCode);
  if (card.setName) params.set("setName", card.setName);
  if (card.setEnglishName) params.set("setEnglishName", card.setEnglishName);
  if (card.collectorNumber) params.set("number", card.collectorNumber);
  if (card.englishName) params.set("englishName", card.englishName);
  if (card.rarity) params.set("rarity", card.rarity);
  return params;
}

async function fetchJson(url, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PokePokedex-MarketAccuracy/1.0)",
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

function loadSets() {
  if (!fs.existsSync(SETS_DB_PATH)) {
    throw new Error(`Missing ${SETS_DB_PATH}. Run npm run db:seed:sets`);
  }

  const db = new Database(SETS_DB_PATH, { readonly: true });
  const preferred = ERA_SETS[LANG] ?? ERA_SETS.en;

  const rows = db
    .prepare(
      `SELECT set_id, language_code, name, release_date
       FROM tcg_sets
       WHERE language_code = ?
       ORDER BY release_date DESC`,
    )
    .all(LANG);

  const byId = new Map(rows.map((row) => [row.set_id.toLowerCase(), row]));
  const selected = [];

  for (const setId of preferred) {
    const row = byId.get(setId.toLowerCase());

    if (!row) {
      continue;
    }

    const year = Number.parseInt(String(row.release_date ?? "").slice(0, 4), 10);

    if (Number.isFinite(year) && (year < YEAR_MIN || year > YEAR_MAX)) {
      continue;
    }

    selected.push(row);

    if (selected.length >= MAX_SETS) {
      break;
    }
  }

  if (!selected.length) {
    for (const row of rows) {
      const year = Number.parseInt(String(row.release_date ?? "").slice(0, 4), 10);

      if (Number.isFinite(year) && year >= YEAR_MIN && year <= YEAR_MAX) {
        selected.push(row);

        if (selected.length >= MAX_SETS) {
          break;
        }
      }
    }
  }

  db.close();
  return selected;
}

async function fetchSetCards(setId) {
  const url = new URL("/api/live-search", BASE_URL);
  url.searchParams.set("set", setId);
  url.searchParams.set("lang", LANG);
  url.searchParams.set("sort", "price-desc");
  url.searchParams.set("page", "1");

  const payload = await fetchJson(url, SET_TIMEOUT_MS);
  const cards = (payload.results ?? [])
    .map((entry) => entry.card)
    .filter(
      (card) =>
        card &&
        ((card.marketPriceUsd ?? 0) >= MIN_PRICE_USD ||
          (LANG === "ja" && Boolean(card.officialCardId))),
    );

  const picks = [
    cards[0],
    cards[Math.floor(cards.length / 2)],
    cards[cards.length - 1],
  ].filter(Boolean);

  const selected = [...new Map(picks.map((card) => [card.id, card])).values()].slice(
    0,
    SAMPLES_PER_SET,
  );

  if (selected.length || LANG !== "ja" || !fs.existsSync(JAPANESE_FIXTURES_PATH)) {
    return selected;
  }

  // A browse row may correctly have no price/collector number before identity
  // hydration. Keep the live validator meaningful by falling back to the same
  // evidence-backed official-ID fixtures used by deterministic tests, while
  // intentionally leaving collectorNumber blank so `/api/price` must hydrate it.
  const fixtureCards = JSON.parse(fs.readFileSync(JAPANESE_FIXTURES_PATH, "utf8"))
    .filter(
      (fixture) =>
        fixture.officialCardId &&
        String(fixture.expectedJapaneseSetCode ?? "").toLowerCase() ===
          setId.toLowerCase(),
    )
    .map((fixture) => ({
      id: `official-${fixture.officialCardId}`,
      slug: `ja--official-${fixture.officialCardId}`,
      officialCardId: fixture.officialCardId,
      browseIndex: fixture.browseIndex,
      language: "ja",
      name:
        fixture.expectedJapaneseName ??
        fixture.expectedEnglishMarketName ??
        fixture.fixture,
      englishName: fixture.expectedEnglishMarketName ?? undefined,
      collectorNumber: "",
      setCode: fixture.expectedJapaneseSetCode,
      setName:
        fixture.expectedJapaneseSetName ??
        fixture.expectedEnglishSetName ??
        fixture.expectedJapaneseSetCode,
      setEnglishName: fixture.expectedEnglishSetName ?? undefined,
      setPrintedTotal: fixture.expectedCollectorNumberTotal ?? undefined,
      rarity: "Unknown",
      marketPriceUsd: 0,
    }));

  return fixtureCards.slice(0, SAMPLES_PER_SET);
}

async function fetchTcgdexReference(setId, collectorNumber, cardId) {
  const apiLanguage = LANG === "ja" ? "ja" : "en";
  const candidates = [
    cardId,
    `${setId.toLowerCase()}-${collectorNumber}`,
    `${setId}-${collectorNumber}`,
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      const card = await fetchJson(
        `${TCGDEX_API_BASE}/${apiLanguage}/cards/${encodeURIComponent(candidate)}`,
        8_000,
      );
      const referencePrice = getTcgdexReferencePrice(card);

      if (referencePrice) {
        return { cardId: candidate, referencePrice };
      }
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

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function validateCard(setMeta, card) {
  const priceUrl = `${BASE_URL}/api/price?${buildPriceParams(card).toString()}`;
  const pricePayload = await fetchJson(priceUrl, PRICE_TIMEOUT_MS);
  const canonicalIdentity = pricePayload.marketIdentity ?? card.marketIdentity ?? null;
  const resolvedRawPrice =
    pricePayload.ungradedUsd ??
    pricePayload.marketPrice ??
    pricePayload.prices?.market ??
    card.marketPriceUsd ??
    0;
  const resolvedCard = {
    ...card,
    officialCardId: canonicalIdentity?.officialCardId ?? card.officialCardId,
    browseIndex: canonicalIdentity?.browseIndex ?? card.browseIndex,
    collectorNumber:
      canonicalIdentity?.printedCollectorNumber ?? card.collectorNumber ?? "",
    englishName: canonicalIdentity?.englishMarketName ?? card.englishName,
    setCode: canonicalIdentity?.japaneseSetCode ?? card.setCode,
    setName: canonicalIdentity?.japaneseSetName ?? card.setName,
    setEnglishName: canonicalIdentity?.englishSetName ?? card.setEnglishName,
    setPrintedTotal:
      canonicalIdentity?.collectorNumberTotal ?? card.setPrintedTotal ?? card.setTotal,
    marketIdentity: canonicalIdentity ?? card.marketIdentity,
    marketPriceUsd: resolvedRawPrice,
  };
  const gradingParams = buildGradingParams(resolvedCard);
  const gradingUrl = `${BASE_URL}/api/grading-market?${gradingParams.toString()}`;

  const [gradingPayload, tcgReference] = await Promise.all([
    fetchJson(gradingUrl, GRADING_TIMEOUT_MS),
    fetchTcgdexReference(setMeta.set_id, resolvedCard.collectorNumber, resolvedCard.id),
  ]);

  const evaluation = evaluateMarketAccuracy({
    card: resolvedCard,
    gradingPayload,
    tcgReferencePrice: tcgReference?.referencePrice ?? null,
  });

  return {
    setId: setMeta.set_id,
    setName: setMeta.name,
    cardId: resolvedCard.id,
    cardName: resolvedCard.name,
    officialCardId: resolvedCard.officialCardId ?? null,
    browseIndex: resolvedCard.browseIndex ?? null,
    collectorNumber: resolvedCard.collectorNumber,
    identityStatus: canonicalIdentity?.identityStatus ?? pricePayload.identityStatus ?? null,
    priceStatus: pricePayload.status ?? null,
    priceProvider: pricePayload.primaryProvider ?? null,
    priceChartingProductId: canonicalIdentity?.priceChartingProductId ?? null,
    marketPriceUsd: resolvedCard.marketPriceUsd,
    tcgReferencePrice: tcgReference?.referencePrice ?? null,
    populationGrades: gradingPayload.psaPopulation?.grades?.length ?? 0,
    gradedPriceCount: gradingPayload.gradedPrices?.length ?? 0,
    recentSalesCount: gradingPayload.recentSales?.length ?? 0,
    evidenceCount: gradingPayload.marketEvidence?.length ?? 0,
    ...evaluation,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const sets = loadSets();
  const jobs = [];

  for (const setMeta of sets) {
    const cards = await fetchSetCards(setMeta.set_id);

    for (const card of cards) {
      jobs.push({ setMeta, card });
    }
  }

  console.log(
    `Validating ${jobs.length} cards across ${sets.length} ${LANG} sets (${YEAR_MIN}-${YEAR_MAX})`,
  );
  console.log(
    `Tolerances: raw ${Math.round(DEFAULT_RAW_TOLERANCE * 100)}%, graded ${Math.round(DEFAULT_GRADED_TOLERANCE * 100)}%`,
  );

  const results = await mapWithConcurrency(jobs, CONCURRENCY, ({ setMeta, card }) =>
    validateCard(setMeta, card).catch((error) => ({
      setId: setMeta.set_id,
      cardId: card.id,
      cardName: card.name,
      collectorNumber: card.collectorNumber ?? null,
      status: "error",
      failures: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: {},
    })),
  );

  let failed = 0;
  let warned = 0;

  for (const result of results) {
    const marker =
      result.status === "pass" ? "PASS" : result.status === "warn" ? "WARN" : "FAIL";
    console.log(
      `${marker} ${result.setId} ${result.cardName} (#${result.collectorNumber})` +
        (result.failures?.length ? ` — ${result.failures[0]}` : ""),
    );

    if (result.status === "fail" || result.status === "error") {
      failed += 1;
    } else if (result.status === "warn") {
      warned += 1;
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    lang: LANG,
    yearRange: [YEAR_MIN, YEAR_MAX],
    setsTested: sets.map((set) => set.set_id),
    total: results.length,
    failed,
    warned,
    passed: results.length - failed - warned,
    tolerances: {
      raw: DEFAULT_RAW_TOLERANCE,
      graded: DEFAULT_GRADED_TOLERANCE,
    },
    results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nMarket accuracy: ${report.passed}/${report.total} passed, ${warned} warnings, ${failed} failed`);
  console.log(`Report: ${OUTPUT_PATH}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
