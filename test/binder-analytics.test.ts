import assert from "node:assert/strict";
import test from "node:test";

import {
  type BinderAnalyticsItem,
  computeBinderPulse,
  computeCollectorRank,
  computeDiversification,
  pickHighlights,
  portfolioDayMovePercent,
  pricedCurveChangePercent,
  skipLeadingEmptyHistory,
  sparklineGeometry,
  sparklineTrendDirection,
  unrealizedPnl,
} from "../src/lib/binder-analytics";
import { bootstrapPortfolioValueHistory } from "../src/lib/portfolio-value-history";

function holding(overrides: Partial<BinderAnalyticsItem> = {}): BinderAnalyticsItem {
  return {
    cardId: "arceus-dialga-palkia-gx-221",
    slug: "arceus-dialga-palkia-gx-221",
    name: "Arceus & Dialga & Palkia-GX",
    image: "https://example.test/card.png",
    grade: "Ungraded",
    rarity: "Tracked card",
    setName: "Cosmic Eclipse",
    quantity: 1,
    currentValueUsd: 433.41,
    totalCurrentUsd: 433.41,
    costBasisUsd: 486.91,
    totalCostUsd: 486.91,
    gainLossUsd: -53.5,
    gainLossPercent: -10.987246123,
    dayChangeUsd: 0,
    dayChangePercent: 0,
    hasTrackedCost: true,
    ...overrides,
  };
}

test("unrealized P/L matches market minus cost and rounds to the binder readout", () => {
  const pnl = unrealizedPnl(433.41, 486.91);

  assert.equal(Number(pnl.gainLossUsd.toFixed(2)), -53.5);
  assert.equal(pnl.gainLossPercent?.toFixed(1), "-11.0");
  assert.equal(unrealizedPnl(433.41, 0).gainLossPercent, null);
});

test("a $0 empty-binder baseline is not +100% collection-trend growth", () => {
  const seeded = bootstrapPortfolioValueHistory([
    {
      addedAt: "2026-09-01T12:00:00.000Z",
      quantity: 1,
      currentValueUsd: 433.41,
    },
  ]);
  const values = seeded.map((point) => point.valueUsd);

  assert.equal(values[0], 0);
  assert.ok(values.some((value) => value > 0));
  assert.equal(pricedCurveChangePercent(values), 0);
  assert.equal(sparklineGeometry(values, 100, 38).changePercent, 0);
  assert.equal(sparklineTrendDirection(sparklineGeometry(values, 100, 38).changePercent), "flat");

  const priced = skipLeadingEmptyHistory(
    seeded.map((point) => ({ date: point.date, value: point.valueUsd })),
  );
  assert.equal(priced[0]?.value, 433.41);
  assert.equal(pricedCurveChangePercent(priced), 0);
});

test("pulse Trend and sparkline percent stay in lockstep after the empty baseline", () => {
  const items = [holding()];
  const history = [
    { date: "2026-08-31", value: 0 },
    { date: "2026-09-01", value: 433.41 },
    { date: "2026-09-01", value: 433.41 },
  ];
  const trendPoints = skipLeadingEmptyHistory(history);
  const spark = sparklineGeometry(
    trendPoints.map((point) => point.value),
    100,
    38,
  );
  const stats = computeDiversification(items, 433.41);
  const pulse = computeBinderPulse(items, stats, 433.41, trendPoints);

  assert.equal(spark.changePercent, 0);
  assert.equal(pulse.metrics.find((metric) => metric.label === "Trend")?.value, "+0.0%");
  assert.equal(pulse.metrics.find((metric) => metric.label === "Tracked ROI")?.value, "-11.0%");
  assert.equal(pulse.score, 50);
});

test("an actual market move on the curve reports real percent, not a zero-day spike", () => {
  const history = [
    { date: "2026-08-30", value: 0 },
    { date: "2026-08-31", value: 400 },
    { date: "2026-09-01", value: 433.41 },
  ];
  const priced = skipLeadingEmptyHistory(history);
  const percent = pricedCurveChangePercent(priced);

  assert.equal(priced[0]?.value, 400);
  assert.equal(percent.toFixed(1), "8.4");
  assert.equal(sparklineTrendDirection(percent), "up");
  assert.equal(
    sparklineTrendDirection(pricedCurveChangePercent([500, 433.41])),
    "down",
  );
});

test("opening the book is not a same-day rally", () => {
  assert.equal(portfolioDayMovePercent(433.41, 433.41), 0);
  assert.equal(portfolioDayMovePercent(433.41, 0), 0);
  assert.equal(portfolioDayMovePercent(433.41, -4.33).toFixed(1), "-1.0");
});

test("one-card down binder still has a crown jewel and a real loser, never a fake winner", () => {
  const card = holding();
  const highlights = pickHighlights([card]);

  assert.equal(highlights.crownJewel, card);
  assert.equal(highlights.biggestWinner, null);
  assert.equal(highlights.biggestLoser, card);
  assert.equal(highlights.topMover, null);
});

test("Ace Trainer progress for $433.41 is 24% of the way to Gym Leader", () => {
  const rank = computeCollectorRank(433.41);

  assert.equal(rank.title, "Ace Trainer");
  assert.equal(rank.nextTitle, "Gym Leader");
  assert.equal(Math.round(rank.progress * 100), 24);
});

test("a single holding has diversity 0 and 100% allocation to that card", () => {
  const stats = computeDiversification([holding()], 433.41);

  assert.equal(stats.diversityScore, 0);
  assert.equal(stats.topHoldingShare, 1);
  assert.equal(stats.uniqueCards, 1);
  assert.equal(stats.uniqueSets, 1);
  assert.equal(stats.pricedShare, 1);
  assert.equal(stats.costCoverageShare, 1);
});
