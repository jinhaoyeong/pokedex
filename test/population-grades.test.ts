import assert from "node:assert/strict";
import test from "node:test";

import { aggregatePopulationGrades, getFilteredPopulationTotal } from "../src/lib/population-grade-filter";
import { resolvePopulationCountForGrade } from "../src/lib/psa-population";
import type { PsaPopulationSnapshot } from "../src/types/pokemon";

const cgcOnlyCensus: PsaPopulationSnapshot = {
  status: "verified",
  totalCertified: 101,
  grades: [
    { grade: "CGC 10", count: 65, service: "CGC", confidence: "medium", confidenceScore: 0.68, evidenceType: "population" },
    { grade: "CGC 9", count: 14, service: "CGC", confidence: "medium", confidenceScore: 0.68, evidenceType: "population" },
    { grade: "CGC 8", count: 15, service: "CGC", confidence: "medium", confidenceScore: 0.68, evidenceType: "population" },
  ],
  source: "PriceCharting public population report",
  fetchedAt: "2026-08-18T00:00:00.000Z",
  note: "CGC grade counts were parsed from PriceCharting's embedded population report.",
  service: "CGC",
  warning: "PriceCharting published a CGC-only census for this print (zero PSA submissions). PSA 8/9/10 values are prices, not a PSA population table.",
};

test("CGC-only census does not fill PSA 10 population counts", () => {
  assert.equal(resolvePopulationCountForGrade(cgcOnlyCensus, "CGC 10"), 65);
  assert.equal(resolvePopulationCountForGrade(cgcOnlyCensus, "PSA 10"), 0);
  assert.equal(resolvePopulationCountForGrade(cgcOnlyCensus, "PSA 9"), 0);
});

test("combined PSA+CGC set-index rows still apply to PSA grades", () => {
  const combined: PsaPopulationSnapshot = {
    ...cgcOnlyCensus,
    grades: [{ grade: "PSA+CGC 10", count: 80, confidence: "medium", confidenceScore: 0.52, evidenceType: "population" }],
    service: undefined,
    warning: "Set-index population combines PSA and CGC for grades 6-10.",
  };

  assert.equal(resolvePopulationCountForGrade(combined, "PSA 10"), 80);
});

test("CGC-only census does not reuse the 101 total on the PSA filter", () => {
  assert.equal(getFilteredPopulationTotal(cgcOnlyCensus.grades, "all", 101), 94);
  assert.equal(getFilteredPopulationTotal(cgcOnlyCensus.grades, "cgc", 101), 94);
  assert.equal(getFilteredPopulationTotal(cgcOnlyCensus.grades, "psa", 101), null);
  assert.deepEqual(
    aggregatePopulationGrades(cgcOnlyCensus.grades, "psa"),
    [],
  );
  assert.equal(aggregatePopulationGrades(cgcOnlyCensus.grades, "all")[0]?.grade, "CGC 10");
});
