/**
 * Shared accuracy + quantity checks for the full card-data validator.
 *
 * These helpers go beyond "is the field present" — they verify that graded
 * tiers are internally consistent (monotonic, PSA 10 >= raw), that population
 * counts line up between the graded-price tiles and the population grid, and
 * that the "last sold" comps are real, recent, and priced in a believable band
 * relative to the grade they claim to represent.
 */

import { median, priceDeltaRatio } from "./market-accuracy-checks.mjs";

/**
 * Rough monetary rank for a grade label so we can assert that higher grades are
 * not cheaper than lower grades. Returns null for labels we cannot rank.
 */
export function gradeRank(label) {
  const text = String(label ?? "").trim();

  if (!text) {
    return null;
  }

  if (/^ungraded$/i.test(text) || /\braw\b/i.test(text)) {
    return 0;
  }

  // Capture the numeric grade, e.g. "PSA 9", "BGS 9.5", "CGC 10", "PSA 10 (Gem Mint)".
  const match = text.match(/(\d+(?:\.\d+)?)/);

  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[1]);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  // Ungraded sits below every numeric grade; numeric grades scale 1..10.
  // Black-label / pristine perfect tens edge slightly above a plain PSA 10.
  const pristineBonus = /black label|pristine|perfect/i.test(text) ? 0.4 : 0;

  return numeric + pristineBonus;
}

function parseSaleDate(value) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * Quantity checks: confirm we actually loaded enough of each data class, and
 * that every entry carries the supporting fields the UI renders.
 */
export function evaluateQuantity(testCase, payload, { requireSold = true } = {}) {
  const failures = [];
  const warnings = [];

  const gradedPrices = payload.gradedPrices ?? [];
  const population = payload.psaPopulation ?? {};
  const populationGrades = population.grades ?? [];
  const recentSales = payload.recentSales ?? [];
  const marketEvidence = payload.marketEvidence ?? [];

  const ungraded = gradedPrices.find(
    (price) => gradeRank(price.grade) === 0 && Number(price.value) > 0,
  );
  const positiveGraded = gradedPrices.filter(
    (price) => gradeRank(price.grade) > 0 && Number(price.value) > 0,
  );

  // Raw / ungraded price.
  if (!ungraded || !(Number(ungraded.value) > 0)) {
    failures.push("missing positive ungraded (raw) price");
  }

  // Graded tiers.
  if (positiveGraded.length < testCase.minGradedPrices) {
    failures.push(
      `expected >= ${testCase.minGradedPrices} graded tiers with a price, got ${positiveGraded.length}`,
    );
  }

  for (const price of positiveGraded) {
    if (price.populationCount == null) {
      warnings.push(`graded tier ${price.grade} has no populationCount`);
    }
  }

  // Population grid.
  if (populationGrades.length < testCase.minPopulationGrades) {
    failures.push(
      `expected >= ${testCase.minPopulationGrades} population grades, got ${populationGrades.length} (status=${population.status ?? "unknown"})`,
    );
  }

  if (population.status === "pending") {
    warnings.push("population status is still pending");
  }

  const zeroCountGrades = populationGrades.filter((grade) => !(Number(grade.count) > 0));
  if (populationGrades.length && zeroCountGrades.length === populationGrades.length) {
    failures.push("population grid present but every grade count is zero");
  }

  // Last-sold comps. These scrape public sold-listing sources that can be slow
  // or unavailable for a given card; when requireSold is false (e.g. an
  // environment without sold-listing access) a shortfall is downgraded to a
  // warning instead of a hard failure.
  if (typeof testCase.minRecentSales === "number") {
    const soldEvidence = marketEvidence.filter((entry) => entry.evidenceType === "sold_comp");
    const soldTotal = recentSales.length + soldEvidence.length;

    if (soldTotal < testCase.minRecentSales) {
      const soldSource = (payload.sourceStatus ?? []).find((source) =>
        /sold/i.test(String(source.source ?? "")),
      );
      const sourceNote = soldSource ? ` [source "${soldSource.source}": ${soldSource.state}]` : "";
      const message = `expected >= ${testCase.minRecentSales} sold comps (last sold), got ${soldTotal} (recentSales=${recentSales.length}, evidence=${soldEvidence.length})${sourceNote}`;

      if (requireSold) {
        failures.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  if (typeof testCase.minMarketEvidence === "number" && marketEvidence.length < testCase.minMarketEvidence) {
    failures.push(
      `expected >= ${testCase.minMarketEvidence} market evidence entries, got ${marketEvidence.length}`,
    );
  }

  return {
    failures,
    warnings,
    counts: {
      gradedPrices: positiveGraded.length,
      populationGrades: populationGrades.length,
      recentSales: recentSales.length,
      marketEvidence: marketEvidence.length,
      populationStatus: population.status ?? null,
    },
  };
}

/**
 * Accuracy checks that are internal to the payload (do not need an external
 * reference): grade monotonicity, PSA 10 >= raw, population/price agreement,
 * and sold-comp sanity (dates real + not in the future, prices in-band).
 */
export function evaluateInternalAccuracy(testCase, payload, now = Date.now()) {
  const failures = [];
  const warnings = [];

  const gradedPrices = (payload.gradedPrices ?? []).filter((price) => Number(price.value) > 0);
  const population = payload.psaPopulation ?? {};
  const populationGrades = population.grades ?? [];
  const recentSales = payload.recentSales ?? [];

  const ranked = gradedPrices
    .map((price) => ({ ...price, rank: gradeRank(price.grade), value: Number(price.value) }))
    .filter((price) => price.rank != null)
    .sort((a, b) => a.rank - b.rank);

  // Monotonicity: a higher grade should not be materially cheaper than a lower
  // grade. Low grades (PSA 1-4) have tiny populations and erratic, illiquid
  // pricing — a PSA 1 routinely sells above a PSA 2 — so inversions there are
  // only a warning. We hard-fail inversions among the liquid grades (PSA 5+),
  // where pricing should be reliably ordered.
  const LIQUID_GRADE_RANK = 5;
  for (let i = 1; i < ranked.length; i += 1) {
    const lower = ranked[i - 1];
    const higher = ranked[i];

    if (higher.value < lower.value * 0.88) {
      const message = `grade ordering broken: ${higher.grade} ($${higher.value}) < ${lower.grade} ($${lower.value})`;

      if (lower.rank >= LIQUID_GRADE_RANK && higher.rank >= LIQUID_GRADE_RANK) {
        failures.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  const ungraded = ranked.find((price) => price.rank === 0);
  const psa10 = ranked.find((price) => /PSA 10/i.test(String(price.grade)));

  if (ungraded && psa10 && psa10.value < ungraded.value) {
    failures.push(
      `PSA 10 ($${psa10.value}) priced below ungraded ($${ungraded.value}) — likely wrong match`,
    );
  }

  // Population / price agreement: where a graded tile reports a populationCount
  // and the grid has the matching grade, they should be in the same ballpark.
  const popByRank = new Map();
  for (const grade of populationGrades) {
    const rank = gradeRank(grade.grade);
    if (rank != null && Number(grade.count) >= 0) {
      popByRank.set(rank, Number(grade.count));
    }
  }

  for (const price of ranked) {
    if (price.rank === 0 || price.populationCount == null) {
      continue;
    }

    const gridCount = popByRank.get(price.rank);
    if (gridCount == null || gridCount === 0 || price.populationCount === 0) {
      continue;
    }

    const ratio = Math.max(price.populationCount, gridCount) / Math.max(Math.min(price.populationCount, gridCount), 1);
    if (ratio > 3) {
      warnings.push(
        `population mismatch for ${price.grade}: tile=${price.populationCount} vs grid=${gridCount}`,
      );
    }
  }

  // Sold-comp sanity: dates must parse, not be in the future, and prices should
  // sit in a believable band relative to the matching graded tier.
  const valueByGradeText = new Map(
    ranked.map((price) => [String(price.grade).toLowerCase(), price.value]),
  );

  for (const sale of recentSales) {
    const saleDate = parseSaleDate(sale.date);

    if (!saleDate) {
      warnings.push(`sold comp has unparseable date "${sale.date}"`);
    } else if (saleDate.getTime() > now + 24 * 60 * 60 * 1000) {
      failures.push(`sold comp dated in the future: ${sale.date}`);
    }

    const price = Number(sale.price);
    if (!(price > 0)) {
      warnings.push(`sold comp "${sale.title ?? sale.condition ?? "?"}" has no positive price`);
      continue;
    }

    const condition = String(sale.condition ?? "").toLowerCase();
    const anchor =
      valueByGradeText.get(condition) ??
      (gradeRank(condition) === 0 ? ungraded?.value : undefined);

    if (anchor && priceDeltaRatio(anchor, price) > testCase.saleBandRatio) {
      warnings.push(
        `sold ${sale.condition} $${price} diverges >${Math.round(testCase.saleBandRatio * 100)}% from displayed $${anchor}`,
      );
    }
  }

  return {
    failures,
    warnings,
    rankedGrades: ranked.map((price) => ({ grade: price.grade, value: price.value })),
  };
}

/**
 * Convenience: median sold price for a grade pattern, used to cross-check the
 * displayed graded tier against the actual comps that loaded.
 */
export function soldMedianForGrade(payload, gradePattern) {
  const sales = (payload.recentSales ?? [])
    .filter((sale) => gradePattern.test(String(sale.condition ?? "")))
    .map((sale) => Number(sale.price))
    .filter((price) => price > 0);

  const evidence = (payload.marketEvidence ?? [])
    .filter(
      (entry) =>
        entry.evidenceType === "sold_comp" && gradePattern.test(String(entry.grade ?? "")),
    )
    .map((entry) => Number(entry.priceUsd))
    .filter((price) => price > 0);

  return median([...sales, ...evidence]);
}
