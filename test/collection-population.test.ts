import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCollectionPopulation,
  normalizeCollectionGrade,
} from "../src/lib/market/collection-population";

test("collection population accepts real grader labels and rejects raw/unknown labels", () => {
  assert.equal(normalizeCollectionGrade("psa 10"), "PSA 10");
  assert.equal(normalizeCollectionGrade("CGC 10 pristine"), "CGC 10 Pristine");
  assert.equal(normalizeCollectionGrade("Ungraded"), null);
  assert.equal(normalizeCollectionGrade("Estimate 10"), null);
});

test("collection population deduplicates the same holder across vault storage paths", () => {
  const result = aggregateCollectionPopulation([
    { contributorKey: "user-1", grade: "PSA 10", quantity: 2 },
    { contributorKey: "user-1", grade: "PSA 10", quantity: 2 },
    { contributorKey: "user-2", grade: "PSA 10", quantity: 1 },
    { contributorKey: "user-2", grade: "PSA 9", quantity: 3 },
    { contributorKey: "user-3", grade: "Ungraded", quantity: 99 },
  ]);
  assert.deepEqual(result, {
    total: 6,
    holderCount: 2,
    grades: [
      { grade: "PSA 10", count: 3 },
      { grade: "PSA 9", count: 3 },
    ],
  });
});

test("collection population returns no census when there are no graded holdings", () => {
  assert.equal(
    aggregateCollectionPopulation([
      { contributorKey: "user-1", grade: "Ungraded", quantity: 4 },
      { contributorKey: "user-2", grade: "Custom 10", quantity: 1 },
    ]),
    null,
  );
});
