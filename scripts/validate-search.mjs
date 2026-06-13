#!/usr/bin/env node
/**
 * Smoke tests for card search queries (collector codes, set nicknames, name+set).
 *
 * Requires running app server (npm run dev) unless VALIDATE_BASE_URL is set.
 *
 * Usage:
 *   npm run validate:search
 *   VALIDATE_BASE_URL=https://example.com npm run validate:search
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPORT_PATH = path.join(ROOT, "data", "validate-search-report.json");

const BASE_URL = (process.env.VALIDATE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUTPUT_PATH = process.env.VALIDATE_OUTPUT ?? DEFAULT_REPORT_PATH;
const LANG = process.env.VALIDATE_LANG ?? "en";

const SEARCH_CASES = [
  {
    id: "standalone-tg16",
    query: "tg16",
    lang: "en",
    minResults: 1,
    expectSetCode: /TG/i,
  },
  {
    id: "standalone-tg30",
    query: "tg30",
    lang: "en",
    minResults: 1,
    expectSetCode: /TG/i,
  },
  {
    id: "collector-slash",
    query: "003/025",
    lang: "en",
    minResults: 1,
  },
  {
    id: "celebrations-blastoise",
    query: "blastoise 25th anniversary",
    lang: "en",
    minResults: 1,
    expectName: /blastoise/i,
    expectSetCode: /CEL25/i,
  },
  {
    id: "celebrations-shorthand",
    query: "blastoise 25th",
    lang: "en",
    minResults: 1,
    expectName: /blastoise/i,
    expectSetCode: /CEL25/i,
  },
  {
    id: "celebrations-umbreon",
    query: "umbreon celebrations",
    lang: "en",
    minResults: 1,
    expectName: /umbreon/i,
  },
  {
    id: "pokemon-151-mew",
    query: "mew 151",
    lang: "en",
    minResults: 1,
    expectName: /mew/i,
  },
  {
    id: "set-code-charizard-sv2a",
    query: "charizard sv2a",
    lang: "en",
    minResults: 1,
    expectName: /charizard/i,
  },
  {
    id: "name-set-lugia",
    query: "lugia silver tempest",
    lang: "en",
    minResults: 1,
    expectName: /lugia/i,
    expectSetCode: /SWSH12/i,
  },
  {
    id: "trainer-gallery-suffix",
    query: "flareon tg",
    lang: "en",
    minResults: 1,
    expectName: /flareon/i,
    expectSetCode: /TG/i,
  },
  {
    id: "name-collector-pikachu-tg16",
    query: "pikachu tg16",
    lang: "en",
    minResults: 0,
    maxResults: 5,
  },
  {
    id: "all-lang-tg16",
    query: "tg16",
    lang: "all",
    minResults: 5,
  },
];

async function fetchSearch(query, lang) {
  const url = new URL("/api/live-search", BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", lang);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PokePokedex-SearchValidator/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

function evaluateCase(testCase, payload) {
  const results = payload.results ?? [];
  const failures = [];

  if (results.length < testCase.minResults) {
    failures.push(`expected at least ${testCase.minResults} results, got ${results.length}`);
  }

  if (typeof testCase.maxResults === "number" && results.length > testCase.maxResults) {
    failures.push(`expected at most ${testCase.maxResults} results, got ${results.length}`);
  }

  if (testCase.expectNotice && !testCase.expectNotice.test(payload.notice ?? "")) {
    failures.push(`notice did not match ${testCase.expectNotice}: ${payload.notice ?? "(none)"}`);
  }

  const top = results[0]?.card;

  if (testCase.expectName && top && !testCase.expectName.test(top.name ?? "")) {
    failures.push(`top result name "${top.name}" did not match ${testCase.expectName}`);
  }

  if (testCase.expectSetCode && top && !testCase.expectSetCode.test(top.setCode ?? "")) {
    failures.push(`top result set "${top.setCode}" did not match ${testCase.expectSetCode}`);
  }

  return failures;
}

async function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  let failed = 0;

  for (const testCase of SEARCH_CASES) {
    const lang = testCase.lang ?? LANG;

    try {
      const payload = await fetchSearch(testCase.query, lang);
      const failures = evaluateCase(testCase, payload);
      const status = failures.length ? "fail" : "pass";

      if (failures.length) {
        failed += 1;
      }

      results.push({
        id: testCase.id,
        query: testCase.query,
        lang,
        status,
        resultCount: payload.results?.length ?? 0,
        notice: payload.notice ?? null,
        topResult: payload.results?.[0]?.card
          ? {
              name: payload.results[0].card.name,
              setCode: payload.results[0].card.setCode,
            }
          : null,
        failures,
      });

      const marker = status === "pass" ? "PASS" : "FAIL";
      console.log(`${marker} ${testCase.id} (${testCase.query})`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: testCase.id,
        query: testCase.query,
        lang,
        status: "error",
        failures: [message],
      });
      console.log(`ERROR ${testCase.id} (${testCase.query}): ${message}`);
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    total: SEARCH_CASES.length,
    failed,
    passed: SEARCH_CASES.length - failed,
    results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nSearch validation: ${report.passed}/${report.total} passed`);
  console.log(`Report: ${OUTPUT_PATH}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
