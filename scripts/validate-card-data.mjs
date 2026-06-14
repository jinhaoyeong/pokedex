#!/usr/bin/env node
/**
 * End-to-end accuracy + quantity validation for the card detail data:
 * raw prices, graded tier prices, PSA population, and "last sold" comps.
 *
 * Why this exists: population grids and sold comps are scraped live and load
 * progressively, so a single request often returns partial data. A naive test
 * that only checks "did a field appear" passes on half-loaded payloads. This
 * script POLLS each card until the data settles, then asserts both QUANTITY
 * (enough graded tiers / population grades / sold comps) and ACCURACY (grade
 * monotonicity, PSA 10 >= raw, population/price agreement, sold-comp sanity,
 * and cross-checks against TCGdex + sold-comp medians).
 *
 * Requires a running app server unless VALIDATE_BASE_URL points elsewhere.
 *
 * Usage:
 *   npm run validate:card-data
 *   VALIDATE_BASE_URL=https://your-preview.vercel.app npm run validate:card-data
 *   VALIDATE_CARD_FILTER=charizard npm run validate:card-data
 *   VALIDATE_POLL_ATTEMPTS=8 VALIDATE_POLL_INTERVAL_MS=4000 npm run validate:card-data
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareGradedPriceToGuides,
  compareRawPrice,
  getTcgdexReferencePrice,
} from "./lib/market-accuracy-checks.mjs";
import Database from "better-sqlite3";

import {
  evaluateInternalAccuracy,
  evaluateQuantity,
  gradeRank,
  soldMedianForGrade,
} from "./lib/card-data-checks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPORT_PATH = path.join(ROOT, "data", "validate-card-data-report.json");
const SETS_DB_PATH = path.join(ROOT, "data", "pokemon-sets.sqlite");

const BASE_URL = (process.env.VALIDATE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUTPUT_PATH = process.env.VALIDATE_OUTPUT ?? DEFAULT_REPORT_PATH;
const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";

// Polling controls — sold comps and population can take 20-40s to fully load.
const POLL_ATTEMPTS = Math.max(1, Number.parseInt(process.env.VALIDATE_POLL_ATTEMPTS ?? "6", 10));
const POLL_INTERVAL_MS = Math.max(
  500,
  Number.parseInt(process.env.VALIDATE_POLL_INTERVAL_MS ?? "5000", 10),
);
const SETTLE_STREAK = Math.max(1, Number.parseInt(process.env.VALIDATE_SETTLE_STREAK ?? "2", 10));
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.VALIDATE_REQUEST_TIMEOUT_MS ?? "60000", 10);
const CARD_FILTER = (process.env.VALIDATE_CARD_FILTER ?? "").toLowerCase().trim();
// Sold-listing comps depend on a public source that some environments cannot
// reach. Default to rigorous (missing last-sold data fails); set to "false" to
// downgrade a sold-comp shortfall to a warning.
const REQUIRE_SOLD = (process.env.VALIDATE_REQUIRE_SOLD ?? "true").toLowerCase() !== "false";

// Sweep mode: instead of the curated card list, walk every set in the local
// sets DB and sample cards from each so coverage spans the whole catalog rather
// than a handful of hand-picked cards. Quantity floors are intentionally light
// (we have no per-card expectations across thousands of cards); the value is the
// breadth of ACCURACY checks (grade monotonicity, PSA 10 >= raw, sold-comp
// sanity) plus surfacing cards that load no graded data at all.
const SWEEP = (process.env.VALIDATE_SWEEP ?? "false").toLowerCase() === "true";
const SWEEP_LANG = process.env.VALIDATE_SWEEP_LANG ?? "en";
const SWEEP_SAMPLES_PER_SET = Math.max(
  1,
  Number.parseInt(process.env.VALIDATE_SWEEP_SAMPLES ?? "3", 10),
);
// 0 = every set; otherwise cap the number of sets walked (newest first).
const SWEEP_MAX_SETS = Math.max(0, Number.parseInt(process.env.VALIDATE_SWEEP_MAX_SETS ?? "0", 10));
const SWEEP_MIN_PRICE = Number.parseFloat(process.env.VALIDATE_SWEEP_MIN_PRICE ?? "20");
// Sweep polls less aggressively than the curated run to keep the catalog-wide
// pass tractable; override with the standard POLL_* envs if needed.
const SWEEP_POLL_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.VALIDATE_SWEEP_POLL_ATTEMPTS ?? "2", 10),
);

/**
 * Curated, high-liquidity cards whose population + sold data is reliable enough
 * to assert accuracy against. Each carries explicit minimums (quantity) and a
 * tcgdexCardId for the raw-price cross-check where available.
 */
const CARD_CASES = [
  {
    id: "base1-charizard",
    params: {
      setName: "Base Set",
      cardName: "Charizard",
      cardNumber: "4",
      setCode: "BS",
      setTotal: "102",
      language: "en",
      rarity: "Holo Rare",
      rawMarketPriceUsd: "350",
    },
    tcgdexCardId: "base1-4",
    minGradedPrices: 3,
    minPopulationGrades: 4,
    minRecentSales: 2,
    minMarketEvidence: 3,
    saleBandRatio: 0.7,
  },
  {
    id: "swsh4-charizard",
    params: {
      setName: "Vivid Voltage",
      cardName: "Charizard",
      cardNumber: "25",
      setCode: "SWSH4",
      setTotal: "185",
      language: "en",
      rarity: "Rare",
      rawMarketPriceUsd: "80",
    },
    tcgdexCardId: "swsh4-25",
    minGradedPrices: 2,
    minPopulationGrades: 3,
    minRecentSales: 2,
    minMarketEvidence: 3,
    saleBandRatio: 0.7,
  },
  {
    id: "sv3pt5-charizard-ex",
    params: {
      setName: "151",
      cardName: "Charizard ex",
      cardNumber: "199",
      setCode: "SV3PT5",
      setTotal: "165",
      language: "en",
      rarity: "Special Illustration Rare",
      rawMarketPriceUsd: "120",
    },
    tcgdexCardId: "sv03.5-199",
    minGradedPrices: 2,
    minPopulationGrades: 3,
    minRecentSales: 2,
    minMarketEvidence: 3,
    saleBandRatio: 0.7,
  },
  {
    id: "cel25c-charizard",
    params: {
      setName: "Celebrations: Classic Collection",
      cardName: "Charizard",
      cardNumber: "4",
      setCode: "CEL25C",
      setTotal: "25",
      language: "en",
      rarity: "Classic Collection",
      rawMarketPriceUsd: "208",
    },
    tcgdexCardId: "cel25c-4",
    minGradedPrices: 2,
    minPopulationGrades: 2,
    minRecentSales: 1,
    minMarketEvidence: 2,
    saleBandRatio: 0.75,
  },
  {
    id: "me02.5-grimmsnarl-ex",
    params: {
      setName: "Ascended Heroes",
      cardName: "Marnie's Grimmsnarl ex",
      cardNumber: "287",
      setCode: "ME2PT5",
      setTotal: "217",
      language: "en",
      rarity: "Special Illustration Rare",
      rawMarketPriceUsd: "85",
    },
    tcgdexCardId: "me02.5-287",
    minGradedPrices: 2,
    minPopulationGrades: 3,
    minRecentSales: 1,
    minMarketEvidence: 3,
    saleBandRatio: 0.7,
  },
  {
    id: "sv2a-mew-ex-ja",
    params: {
      setName: "Pokemon Card 151",
      cardName: "Mew ex",
      cardNumber: "205",
      setCode: "SV2A",
      setTotal: "165",
      language: "ja",
      englishCardName: "Mew ex",
      rawMarketPriceUsd: "398",
    },
    tcgdexCardId: "sv2a-205",
    minGradedPrices: 2,
    minPopulationGrades: 3,
    minRecentSales: 1,
    minMarketEvidence: 4,
    saleBandRatio: 0.75,
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PokePokedex-CardDataValidator/1.0)",
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

function buildGradingUrl(params) {
  const url = new URL("/api/grading-market", BASE_URL);
  const search = new URLSearchParams(params);
  search.set("mode", "full");
  // Cache-buster so each poll hits the live enrichment rather than the CDN copy.
  search.set("_", String(Date.now()));
  url.search = search.toString();
  return url;
}

function payloadSignature(payload) {
  const graded = (payload.gradedPrices ?? []).filter(
    (price) => Number(price.value) > 0 && (gradeRank(price.grade) ?? 0) > 0,
  ).length;
  const pop = (payload.psaPopulation?.grades ?? []).length;
  const sales = (payload.recentSales ?? []).length;
  const evidence = (payload.marketEvidence ?? []).length;
  const status = payload.psaPopulation?.status ?? "none";
  return { graded, pop, sales, evidence, status };
}

function signatureScore(sig) {
  return sig.graded + sig.pop + sig.sales + sig.evidence + (sig.status === "verified" ? 1 : 0);
}

/**
 * Poll the grading endpoint until the data settles: keep the richest payload
 * seen, and stop once the signature is unchanged for SETTLE_STREAK polls (with
 * population no longer pending and at least one graded tier present), or we run
 * out of attempts.
 */
async function pollUntilSettled(params, maxAttempts = POLL_ATTEMPTS) {
  let best = null;
  let bestScore = -1;
  let prevKey = null;
  let stable = 0;
  const trace = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let payload;
    try {
      payload = await fetchJson(buildGradingUrl(params));
    } catch (error) {
      trace.push({ attempt, error: error instanceof Error ? error.message : String(error) });
      if (attempt < POLL_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS);
      }
      continue;
    }

    const sig = payloadSignature(payload);
    const score = signatureScore(sig);
    trace.push({ attempt, ...sig });

    if (score > bestScore) {
      bestScore = score;
      best = payload;
    }

    const key = `${sig.status}|${sig.graded}|${sig.pop}|${sig.sales}|${sig.evidence}`;
    stable = key === prevKey ? stable + 1 : 0;
    prevKey = key;

    const settled =
      stable + 1 >= SETTLE_STREAK && sig.graded > 0 && sig.status !== "pending";

    if (settled) {
      break;
    }

    if (attempt < maxAttempts) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  return { payload: best, trace };
}

async function fetchTcgdexReference(testCase) {
  if (!testCase.tcgdexCardId) {
    return null;
  }

  const apiLanguage = testCase.params.language === "ja" ? "ja" : "en";

  try {
    const card = await fetchJson(
      `${TCGDEX_API_BASE}/${apiLanguage}/cards/${encodeURIComponent(testCase.tcgdexCardId)}`,
      8_000,
    );
    return getTcgdexReferencePrice(card);
  } catch {
    return null;
  }
}

function evaluateExternalAccuracy(testCase, payload, tcgReference) {
  const failures = [];
  const warnings = [];
  const checks = {};

  const gradedPrices = payload.gradedPrices ?? [];
  const ungraded = gradedPrices.find((price) => price.grade === "Ungraded");
  const psa10 = gradedPrices.find((price) => /PSA 10/i.test(String(price.grade)));
  const rawValue = ungraded?.value ?? Number(testCase.params.rawMarketPriceUsd ?? 0);

  // Raw price vs TCGdex catalog reference. TCGdex frequently lacks real pricing
  // for VMAX/special-art and most Japanese prints, returning a near-zero
  // cardmarket figure that would otherwise trigger a bogus "overvalued"
  // warning. Treat an implausibly-low reference (< $5 against a card we picked
  // precisely because it is valuable) as "no reference" rather than signal.
  const usableReference = tcgReference != null && tcgReference >= 5 ? tcgReference : null;
  checks.rawVsTcgdex = compareRawPrice(rawValue, usableReference);
  if (usableReference == null && tcgReference != null) {
    checks.rawVsTcgdex.note = `ignored implausible TCGdex reference $${tcgReference}`;
  }
  if (checks.rawVsTcgdex.status === "undervalued") {
    failures.push(
      `raw $${checks.rawVsTcgdex.appValue} is far below TCGdex $${checks.rawVsTcgdex.tcgReference}`,
    );
  } else if (checks.rawVsTcgdex.status === "overvalued") {
    warnings.push(
      `raw $${checks.rawVsTcgdex.appValue} is materially above TCGdex $${checks.rawVsTcgdex.tcgReference}`,
    );
  }

  // PSA 10 displayed value vs sold-comp / guide median.
  if (psa10?.value) {
    checks.psa10VsComps = compareGradedPriceToGuides(
      psa10.value,
      payload.marketEvidence,
      "PSA 10",
    );

    if (checks.psa10VsComps.status === "mismatch") {
      failures.push(
        `PSA 10 $${psa10.value} diverges from reference median $${checks.psa10VsComps.reference} (${checks.psa10VsComps.ratio})`,
      );
    } else if (checks.psa10VsComps.status === "ok_with_stale_guide") {
      warnings.push(
        `PSA 10 sold comps ($${checks.psa10VsComps.reference}) above stale guide median $${checks.psa10VsComps.guideMedian}`,
      );
    }

    // Direct cross-check against the sold comps that actually loaded.
    const soldMedian = soldMedianForGrade(payload, /PSA 10/i);
    if (soldMedian) {
      checks.psa10SoldMedian = soldMedian;
      const ratio = Math.abs(soldMedian - psa10.value) / Math.max(soldMedian, 1);
      if (ratio > 0.6) {
        warnings.push(
          `PSA 10 $${psa10.value} is ${Math.round(ratio * 100)}% off the loaded sold-comp median $${Math.round(soldMedian)}`,
        );
      }
    }
  }

  return { failures, warnings, checks };
}

async function validateCard(
  testCase,
  { maxAttempts = POLL_ATTEMPTS, requireSold = REQUIRE_SOLD, requireGraded = true } = {},
) {
  const { payload, trace } = await pollUntilSettled(testCase.params, maxAttempts);

  if (!payload) {
    return {
      id: testCase.id,
      status: "error",
      failures: ["grading-market endpoint returned no payload across all poll attempts"],
      warnings: [],
      trace,
    };
  }

  const tcgReference = await fetchTcgdexReference(testCase);

  const quantity = evaluateQuantity(testCase, payload, { requireSold, requireGraded });
  const internal = evaluateInternalAccuracy(testCase, payload);
  const external = evaluateExternalAccuracy(testCase, payload, tcgReference);

  const failures = [...quantity.failures, ...internal.failures, ...external.failures];
  const warnings = [...quantity.warnings, ...internal.warnings, ...external.warnings];

  return {
    id: testCase.id,
    language: testCase.params.language,
    cardName: testCase.params.cardName,
    status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
    failures,
    warnings,
    counts: quantity.counts,
    tcgReference,
    rankedGrades: internal.rankedGrades,
    externalChecks: external.checks,
    polls: trace.length,
    trace,
  };
}

function loadSweepSets() {
  if (!fs.existsSync(SETS_DB_PATH)) {
    throw new Error(`Missing ${SETS_DB_PATH}. Run: npm run db:seed:sets`);
  }

  const db = new Database(SETS_DB_PATH, { readonly: true });
  const rows =
    SWEEP_LANG === "all"
      ? db
          .prepare(
            `SELECT set_id, language_code, name FROM tcg_sets ORDER BY release_date DESC, name ASC`,
          )
          .all()
      : db
          .prepare(
            `SELECT set_id, language_code, name FROM tcg_sets WHERE language_code = ? ORDER BY release_date DESC, name ASC`,
          )
          .all(SWEEP_LANG);
  db.close();

  return SWEEP_MAX_SETS > 0 ? rows.slice(0, SWEEP_MAX_SETS) : rows;
}

async function fetchSweepSampleCards(setId, language) {
  const url = new URL("/api/live-search", BASE_URL);
  url.searchParams.set("set", setId);
  url.searchParams.set("lang", language);
  url.searchParams.set("sort", "price-desc");
  url.searchParams.set("page", "1");

  const payload = await fetchJson(url, REQUEST_TIMEOUT_MS).catch(() => null);
  const cards = (payload?.results ?? [])
    .map((entry) => entry.card)
    .filter((card) => card && (card.marketPriceUsd ?? 0) >= SWEEP_MIN_PRICE);

  if (!cards.length) {
    return [];
  }

  // Spread the sample across the price distribution (top / middle / bottom)
  // instead of only the most valuable card, then dedupe.
  const picks = [cards[0], cards[Math.floor(cards.length / 2)], cards[cards.length - 1]].filter(
    Boolean,
  );
  return [...new Map(picks.map((card) => [card.id, card])).values()].slice(0, SWEEP_SAMPLES_PER_SET);
}

function sweepCaseFromCard(card) {
  const language = card.language ?? SWEEP_LANG;
  const params = {
    setName: card.setName,
    cardName: card.localizedName ?? card.name,
    cardNumber: card.collectorNumber,
    rawMarketPriceUsd: String(card.marketPriceUsd ?? 0),
    language,
  };

  if (card.setCode) params.setCode = card.setCode;
  if (card.rarity && card.rarity !== "Unknown") params.rarity = card.rarity;
  if (card.setPrintedTotal ?? card.setTotal) {
    params.setTotal = String(card.setPrintedTotal ?? card.setTotal);
  }
  if (card.englishName?.trim()) params.englishCardName = card.englishName.trim();

  return {
    id: `${card.setCode || card.setId || "set"}-${card.collectorNumber}`,
    params,
    tcgdexCardId: card.id,
    // Light quantity floors for catalog-wide breadth; the accuracy checks
    // (monotonicity, PSA 10 >= raw, sold sanity) carry the weight here.
    minGradedPrices: 1,
    minPopulationGrades: 0,
    minRecentSales: 0,
    minMarketEvidence: 1,
    saleBandRatio: 0.8,
  };
}

async function buildSweepCases() {
  const sets = loadSweepSets();
  console.log(
    `Sweep: ${sets.length} ${SWEEP_LANG} set(s), up to ${SWEEP_SAMPLES_PER_SET} card(s) each ` +
      `(>= $${SWEEP_MIN_PRICE}). Collecting samples...`,
  );

  const cases = [];
  for (const set of sets) {
    const cards = await fetchSweepSampleCards(set.set_id, set.language_code ?? SWEEP_LANG).catch(
      () => [],
    );
    for (const card of cards) {
      cases.push(sweepCaseFromCard(card));
    }
  }

  return cases;
}

async function main() {
  const startedAt = new Date().toISOString();
  const sweepMode = SWEEP;

  let cases;
  if (sweepMode) {
    cases = await buildSweepCases();
    if (!cases.length) {
      console.error("Sweep found no priced cards to validate (check the server and sets DB).");
      process.exit(1);
    }
  } else {
    cases = CARD_FILTER
      ? CARD_CASES.filter(
          (c) => c.id.includes(CARD_FILTER) || c.params.cardName.toLowerCase().includes(CARD_FILTER),
        )
      : CARD_CASES;

    if (!cases.length) {
      console.error(`No card cases match filter "${CARD_FILTER}".`);
      process.exit(1);
    }
  }

  const pollAttempts = sweepMode ? SWEEP_POLL_ATTEMPTS : POLL_ATTEMPTS;
  // In sweep mode the per-set price-sort already implies sold sources were
  // attempted; missing comps across thousands of cards shouldn't hard-fail the
  // whole pass, so sold shortfalls warn regardless of REQUIRE_SOLD.
  const requireSold = sweepMode ? false : REQUIRE_SOLD;

  console.log(
    `Validating ${cases.length} card(s) against ${BASE_URL} ` +
      `(${sweepMode ? "sweep" : "curated"} mode, poll up to ${pollAttempts}x every ${POLL_INTERVAL_MS}ms)`,
  );

  const results = [];
  let failed = 0;
  let warned = 0;

  for (const testCase of cases) {
    const result = await validateCard(testCase, {
      maxAttempts: pollAttempts,
      requireSold,
      // Breadth mode tolerates missing graded data (too-new cards); accuracy
      // checks still catch genuine mismatches like PSA 10 below raw.
      requireGraded: !sweepMode,
    }).catch((error) => ({
      id: testCase.id,
      status: "error",
      failures: [error instanceof Error ? error.message : String(error)],
      warnings: [],
    }));

    results.push(result);

    if (result.status === "fail" || result.status === "error") {
      failed += 1;
    } else if (result.status === "warn") {
      warned += 1;
    }

    const marker =
      result.status === "pass"
        ? "PASS"
        : result.status === "warn"
          ? "WARN"
          : result.status === "error"
            ? "ERR "
            : "FAIL";
    const counts = result.counts
      ? ` [graded=${result.counts.gradedPrices}, pop=${result.counts.populationGrades}, sold=${result.counts.recentSales}, evidence=${result.counts.marketEvidence}, popStatus=${result.counts.populationStatus}]`
      : "";

    console.log(`${marker} ${result.id}${counts} (${result.polls ?? 0} polls)`);

    for (const failure of result.failures ?? []) {
      console.log(`      ✗ ${failure}`);
    }
    if (result.status === "warn") {
      for (const warning of result.warnings ?? []) {
        console.log(`      ! ${warning}`);
      }
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    mode: sweepMode ? "sweep" : "curated",
    sweep: sweepMode
      ? { lang: SWEEP_LANG, samplesPerSet: SWEEP_SAMPLES_PER_SET, maxSets: SWEEP_MAX_SETS, minPrice: SWEEP_MIN_PRICE }
      : undefined,
    polling: { attempts: pollAttempts, intervalMs: POLL_INTERVAL_MS, settleStreak: SETTLE_STREAK },
    total: results.length,
    passed: results.length - failed - warned,
    warned,
    failed,
    results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `\nCard data: ${report.passed}/${report.total} passed, ${warned} warnings, ${failed} failed`,
  );
  console.log(`Report: ${OUTPUT_PATH}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
