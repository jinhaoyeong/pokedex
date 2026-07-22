import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type IdentityFixture = {
  fixture: string;
  coverage: string[];
  repositoryId: string;
  officialCardId: string | null;
  browseIndex: number | null;
  expectedJapaneseName: string | null;
  expectedPrintedCollectorNumber: string | null;
  expectedJapaneseSetCode: string;
  expectedPriceChartingProductOrNull: {
    productId: string;
    productUrl: string;
  } | null;
  evidence: string[];
};

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/japanese-market-identities.json", import.meta.url),
    "utf8",
  ),
) as IdentityFixture[];

test("Japanese market fixture matrix contains ten unique evidence-backed identities", () => {
  assert.equal(fixtures.length, 10);
  assert.equal(new Set(fixtures.map((fixture) => fixture.repositoryId)).size, 10);
  assert.ok(fixtures.every((fixture) => fixture.evidence.length > 0));

  const coverage = new Set(fixtures.flatMap((fixture) => fixture.coverage));
  for (const required of [
    "sun-and-moon",
    "sword-and-shield",
    "scarlet-and-violet",
    "recent-expansion",
    "standard-pokemon",
    "trainer",
    "secret-rare",
    "promotional",
    "zero-padded-number",
    "different-localized-set-name",
  ]) {
    assert.ok(coverage.has(required), `missing coverage: ${required}`);
  }
});

test("fixture expectations preserve unknowns and keep browse positions separate from printed numbers", () => {
  const unresolved = fixtures.find(
    (fixture) => fixture.repositoryId === "official-48523",
  );
  assert.equal(unresolved?.browseIndex, 1);
  assert.equal(unresolved?.expectedPrintedCollectorNumber, null);
  assert.equal(unresolved?.expectedPriceChartingProductOrNull, null);

  const knownMismatchPairs = fixtures
    .filter((fixture) => fixture.coverage.includes("browse-number-mismatch"))
    .map((fixture) => [
      fixture.browseIndex,
      fixture.expectedPrintedCollectorNumber,
    ]);
  assert.deepEqual(knownMismatchPairs, [
    [173, "230"],
    [183, "240"],
    [230, "185"],
  ]);
});
