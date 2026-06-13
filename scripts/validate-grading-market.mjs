#!/usr/bin/env node
/**
 * Smoke tests for grading market enrichment (population, graded prices, sold comps).
 *
 * Requires running app server unless VALIDATE_BASE_URL is set.
 *
 * Usage:
 *   npm run validate:grading
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateMarketAccuracy } from "./lib/market-accuracy-checks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPORT_PATH = path.join(ROOT, "data", "validate-grading-market-report.json");

const BASE_URL = (process.env.VALIDATE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUTPUT_PATH = process.env.VALIDATE_OUTPUT ?? DEFAULT_REPORT_PATH;

const GRADING_CASES = [
  {
    id: "celebrations-classic-charizard",
    params: {
      setName: "Celebrations: Classic Collection",
      cardName: "Charizard",
      cardNumber: "4",
      setCode: "CEL25C",
      language: "en",
      rarity: "Classic Collection",
      rawMarketPriceUsd: "208",
    },
    minPopulationGrades: 1,
    minGradedPrices: 2,
  },
  {
    id: "celebrations-holo-charizard",
    params: {
      setName: "Celebrations",
      cardName: "Charizard",
      cardNumber: "4",
      setCode: "CEL25C",
      language: "en",
      rarity: "Holo Rare",
      rawMarketPriceUsd: "50",
    },
    minPopulationGrades: 5,
    minGradedPrices: 3,
  },
  {
    id: "celebrations-umbreon",
    params: {
      setName: "Celebrations",
      cardName: "Umbreon",
      cardNumber: "17",
      setCode: "CEL25C",
      language: "en",
      rarity: "Holo Rare",
      rawMarketPriceUsd: "350",
    },
    minPopulationGrades: 3,
    minGradedPrices: 3,
  },
  {
    id: "tg16-zeraora",
    params: {
      setName: "Silver Tempest",
      cardName: "Zeraora V",
      cardNumber: "TG16",
      setCode: "SWSH12TG",
      language: "en",
      rarity: "Ultra Rare",
      rawMarketPriceUsd: "5",
    },
    minPopulationGrades: 1,
    minGradedPrices: 2,
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
    minPopulationGrades: 3,
    minGradedPrices: 3,
    minMarketEvidence: 4,
  },
  {
    id: "xy11-charizard-ex",
    params: {
      setName: "Steam Siege",
      cardName: "M Charizard EX",
      cardNumber: "12",
      setCode: "XY11",
      language: "en",
      rarity: "Ultra Rare",
      rawMarketPriceUsd: "80",
    },
    minPopulationGrades: 5,
    minGradedPrices: 3,
  },
];

async function fetchGradingMarket(params, mode = "full") {
  const url = new URL("/api/grading-market", BASE_URL);
  const search = new URLSearchParams(params);
  search.set("mode", mode);
  search.set("_", String(Date.now()));
  url.search = search.toString();

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PokePokedex-GradingValidator/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

function evaluateCase(testCase, payload) {
  const failures = [];
  const warnings = [];
  const population = payload.psaPopulation ?? {};
  const grades = population.grades ?? [];
  const gradedPrices = payload.gradedPrices ?? [];
  const recentSales = payload.recentSales ?? [];
  const marketEvidence = payload.marketEvidence ?? [];

  if (grades.length < testCase.minPopulationGrades) {
    failures.push(
      `expected at least ${testCase.minPopulationGrades} population grades, got ${grades.length} (status=${population.status ?? "unknown"})`,
    );
  }

  if (gradedPrices.length < testCase.minGradedPrices) {
    failures.push(
      `expected at least ${testCase.minGradedPrices} graded prices, got ${gradedPrices.length}`,
    );
  }

  if (
    typeof testCase.minMarketEvidence === "number" &&
    marketEvidence.length < testCase.minMarketEvidence
  ) {
    failures.push(
      `expected at least ${testCase.minMarketEvidence} market evidence entries, got ${marketEvidence.length}`,
    );
  }

  if (population.status === "pending" && grades.length === 0) {
    failures.push("population still pending with zero grades");
  }

  const accuracy = evaluateMarketAccuracy({
    card: {
      marketPriceUsd: Number(testCase.params.rawMarketPriceUsd ?? 0),
      name: testCase.params.cardName,
      collectorNumber: testCase.params.cardNumber,
    },
    gradingPayload: payload,
    tcgReferencePrice: null,
    minPriceForGrading: Number(testCase.params.rawMarketPriceUsd ?? 0) >= 25 ? 25 : 9999,
    minPriceForSales: 50,
  });

  for (const warning of accuracy.warnings) {
    warnings.push(warning);
  }

  for (const failure of accuracy.failures) {
    if (!failure.includes("TCGdex")) {
      failures.push(failure);
    }
  }

  return {
    failures,
    warnings,
    populationStatus: population.status ?? null,
    populationGrades: grades.length,
    gradedPrices: gradedPrices.length,
    recentSales: recentSales.length,
    marketEvidence: marketEvidence.length,
    accuracyChecks: accuracy.checks,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  let failed = 0;

  for (const testCase of GRADING_CASES) {
    try {
      const payload = await fetchGradingMarket(testCase.params, "full");
      const evaluation = evaluateCase(testCase, payload);
      const status = evaluation.failures.length ? "fail" : "pass";

      if (evaluation.failures.length) {
        failed += 1;
      }

      results.push({
        id: testCase.id,
        status,
        ...evaluation,
      });

      const warnSuffix =
        evaluation.warnings?.length && status === "pass"
          ? ` [${evaluation.warnings.length} warnings]`
          : "";

      console.log(
        `${status === "pass" ? "PASS" : "FAIL"} ${testCase.id} (pop=${evaluation.populationGrades}, prices=${evaluation.gradedPrices}, sales=${evaluation.recentSales}, evidence=${evaluation.marketEvidence})${warnSuffix}`,
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: testCase.id,
        status: "error",
        failures: [message],
      });
      console.log(`ERROR ${testCase.id}: ${message}`);
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    total: GRADING_CASES.length,
    failed,
    passed: GRADING_CASES.length - failed,
    results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nGrading validation: ${report.passed}/${report.total} passed`);
  console.log(`Report: ${OUTPUT_PATH}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
