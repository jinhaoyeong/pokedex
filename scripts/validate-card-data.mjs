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
import {
  evaluateInternalAccuracy,
  evaluateQuantity,
  soldMedianForGrade,
} from "./lib/card-data-checks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPORT_PATH = path.join(ROOT, "data", "validate-card-data-report.json");

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

/**
 * Curated, high-liquidity cards whose population + sold data is reliable enough
 * to assert accuracy against. Each carries explicit minimums (quantity) and a
 * tcgdexCardId for the raw-price cross-check where available.
 */
const CARD_CASES = [
  {
    id: "base1-charizard",
    params: {
      setName: "Base",
      cardName: "Charizard",
      cardNumber: "4",
      setCode: "BS",
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
    id: "swsh4-charizard-vmax",
    params: {
      setName: "Vivid Voltage",
      cardName: "Charizard VMAX",
      cardNumber: "020",
      setCode: "SWSH4",
      language: "en",
      rarity: "Ultra Rare",
      rawMarketPriceUsd: "80",
    },
    tcgdexCardId: "swsh4-20",
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
    id: "sv2a-mew-ex-ja",
    params: {
      setName: "Pokemon Card 151",
      cardName: "Mew ex",
      cardNumber: "205",
      setCode: "SV2A",
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
  const graded = (payload.gradedPrices ?? []).filter((p) => Number(p.value) > 0).length;
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
async function pollUntilSettled(params) {
  let best = null;
  let bestScore = -1;
  let prevKey = null;
  let stable = 0;
  const trace = [];

  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
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

    if (attempt < POLL_ATTEMPTS) {
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

async function validateCard(testCase) {
  const { payload, trace } = await pollUntilSettled(testCase.params);

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

  const quantity = evaluateQuantity(testCase, payload, { requireSold: REQUIRE_SOLD });
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

async function main() {
  const startedAt = new Date().toISOString();
  const cases = CARD_FILTER
    ? CARD_CASES.filter(
        (c) => c.id.includes(CARD_FILTER) || c.params.cardName.toLowerCase().includes(CARD_FILTER),
      )
    : CARD_CASES;

  if (!cases.length) {
    console.error(`No card cases match filter "${CARD_FILTER}".`);
    process.exit(1);
  }

  console.log(
    `Validating ${cases.length} card(s) against ${BASE_URL} ` +
      `(poll up to ${POLL_ATTEMPTS}x every ${POLL_INTERVAL_MS}ms, settle streak ${SETTLE_STREAK})`,
  );

  const results = [];
  let failed = 0;
  let warned = 0;

  for (const testCase of cases) {
    const result = await validateCard(testCase).catch((error) => ({
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
    polling: { attempts: POLL_ATTEMPTS, intervalMs: POLL_INTERVAL_MS, settleStreak: SETTLE_STREAK },
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
