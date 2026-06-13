/**
 * Shared multi-source market accuracy checks for validation scripts.
 */

const EUR_TO_USD = 1.08;

export const DEFAULT_RAW_TOLERANCE = Number.parseFloat(
  process.env.VALIDATE_RAW_TOLERANCE ?? "0.35",
);
export const DEFAULT_GRADED_TOLERANCE = Number.parseFloat(
  process.env.VALIDATE_GRADED_TOLERANCE ?? "0.45",
);
export const DEFAULT_POPULATION_TOLERANCE = Number.parseFloat(
  process.env.VALIDATE_POPULATION_TOLERANCE ?? "0.3",
);

export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);

  if (!sorted.length) {
    return null;
  }

  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function priceDeltaRatio(reference, actual) {
  if (!reference || !actual) {
    return null;
  }

  return Math.abs(reference - actual) / Math.max(reference, 1);
}

export function withinTolerance(reference, actual, tolerance) {
  const ratio = priceDeltaRatio(reference, actual);
  return ratio == null ? false : ratio <= tolerance;
}

export function getTcgdexReferencePrice(card) {
  const tcg = card.pricing?.tcgplayer;
  const cm = card.pricing?.cardmarket;

  const tcgUsd =
    typeof tcg?.holofoil?.marketPrice === "number"
      ? tcg.holofoil.marketPrice
      : typeof tcg?.normal?.marketPrice === "number"
        ? tcg.normal.marketPrice
        : typeof tcg?.reverseHolofoil?.marketPrice === "number"
          ? tcg.reverseHolofoil.marketPrice
          : null;

  const cmEur =
    typeof cm?.avg === "number"
      ? cm.avg
      : typeof cm?.trend === "number"
        ? cm.trend
        : typeof cm?.["avg-holo"] === "number"
          ? cm["avg-holo"]
          : null;

  const cmUsd = cmEur != null ? cmEur * EUR_TO_USD : null;

  if (tcgUsd != null && cmUsd != null) {
    const robust = median([tcgUsd, cmUsd]);
    const outliers = [tcgUsd, cmUsd].filter(
      (value) => Math.abs(value - robust) / Math.max(robust, 1) > 2.5,
    );

    if (outliers.length === 1) {
      return outliers[0] === tcgUsd ? cmUsd : tcgUsd;
    }

    return robust;
  }

  return tcgUsd ?? cmUsd;
}

export function extractGuideSnapshots(marketEvidence, gradePattern = /./) {
  return (marketEvidence ?? []).filter(
    (entry) =>
      entry.evidenceType === "guide_snapshot" &&
      typeof entry.priceUsd === "number" &&
      entry.priceUsd > 0 &&
      gradePattern.test(String(entry.grade ?? "")),
  );
}

export function extractPopulationEvidence(marketEvidence) {
  return (marketEvidence ?? []).filter((entry) => entry.evidenceType === "population");
}

export function extractSoldEvidence(marketEvidence, gradePattern = /./) {
  return (marketEvidence ?? []).filter(
    (entry) =>
      entry.evidenceType === "sold_comp" &&
      typeof entry.priceUsd === "number" &&
      entry.priceUsd > 0 &&
      gradePattern.test(String(entry.grade ?? "")),
  );
}

export function compareGradedPriceToGuides(appValue, marketEvidence, gradeLabel) {
  const gradePattern = new RegExp(gradeLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const soldPrices = extractSoldEvidence(marketEvidence, gradePattern).map((entry) => entry.priceUsd);

  if (soldPrices.length >= 3 && appValue != null) {
    const soldMedian = median(soldPrices);
    const soldRatio = priceDeltaRatio(soldMedian, appValue);

    if (soldRatio != null && soldRatio <= DEFAULT_GRADED_TOLERANCE) {
      return {
        status: "ok",
        reference: soldMedian,
        appValue,
        ratio: Math.round(soldRatio * 1000) / 1000,
        referenceSource: "sold_comps",
        guides: soldPrices,
      };
    }
  }

  const guides = extractGuideSnapshots(marketEvidence, gradePattern).map((entry) => entry.priceUsd);

  if (!guides.length || appValue == null) {
    return { status: "no_reference", guides, appValue };
  }

  const reference = median(guides);
  const ratio = priceDeltaRatio(reference, appValue);

  if (ratio != null && ratio <= DEFAULT_GRADED_TOLERANCE) {
    return {
      status: "ok",
      reference,
      appValue,
      ratio: Math.round(ratio * 1000) / 1000,
      referenceSource: "guide_snapshots",
      guides,
    };
  }

  if (soldPrices.length >= 2) {
    const soldMedian = median(soldPrices);
    const soldRatio = priceDeltaRatio(soldMedian, appValue);

    if (soldRatio != null && soldRatio <= DEFAULT_GRADED_TOLERANCE) {
      return {
        status: "ok_with_stale_guide",
        reference: soldMedian,
        appValue,
        ratio: Math.round(soldRatio * 1000) / 1000,
        referenceSource: "sold_comps",
        guides,
        guideMedian: reference,
      };
    }
  }

  return {
    status: "mismatch",
    reference,
    appValue,
    ratio: ratio == null ? null : Math.round(ratio * 1000) / 1000,
    referenceSource: "guide_snapshots",
    guides,
  };
}

export function compareRawPrice(appValue, tcgReference) {
  if (!appValue || !tcgReference) {
    return { status: "no_reference", appValue, tcgReference };
  }

  const ratio = priceDeltaRatio(tcgReference, appValue);
  const undervalued = appValue < tcgReference * (1 - DEFAULT_RAW_TOLERANCE);
  const overvalued = appValue > tcgReference * (1 + DEFAULT_RAW_TOLERANCE * 1.5);

  return {
    status: !undervalued && !overvalued ? "ok" : undervalued ? "undervalued" : "overvalued",
    appValue,
    tcgReference,
    ratio: ratio == null ? null : Math.round(ratio * 1000) / 1000,
  };
}

export function evaluateMarketAccuracy({
  card,
  gradingPayload,
  tcgReferencePrice,
  minPriceForGrading = 25,
  minPriceForSales = 50,
}) {
  const failures = [];
  const warnings = [];
  const checks = {};

  const marketPrice = card.marketPriceUsd ?? 0;
  const gradedPrices = gradingPayload?.gradedPrices ?? [];
  const population = gradingPayload?.psaPopulation ?? {};
  const recentSales = gradingPayload?.recentSales ?? [];
  const marketEvidence = gradingPayload?.marketEvidence ?? [];

  const ungraded = gradedPrices.find((price) => price.grade === "Ungraded");
  const psa10 = gradedPrices.find((price) => String(price.grade).includes("PSA 10"));

  checks.rawVsTcgdex = compareRawPrice(ungraded?.value ?? marketPrice, tcgReferencePrice);

  if (checks.rawVsTcgdex.status === "undervalued") {
    failures.push(
      `raw price $${checks.rawVsTcgdex.appValue} is >${Math.round(DEFAULT_RAW_TOLERANCE * 100)}% below TCGdex $${checks.rawVsTcgdex.tcgReference}`,
    );
  } else if (checks.rawVsTcgdex.status === "overvalued") {
    warnings.push(
      `raw price $${checks.rawVsTcgdex.appValue} is materially above TCGdex $${checks.rawVsTcgdex.tcgReference}`,
    );
  }

  if (marketPrice >= minPriceForGrading) {
    if (!psa10?.value) {
      failures.push("missing PSA 10 graded price");
    } else {
      checks.psa10VsGuides = compareGradedPriceToGuides(psa10.value, marketEvidence, "PSA 10");

      if (checks.psa10VsGuides.status === "mismatch") {
        failures.push(
          `PSA 10 $${psa10.value} diverges from reference median $${checks.psa10VsGuides.reference} (${checks.psa10VsGuides.ratio} ratio)`,
        );
      } else if (checks.psa10VsGuides.status === "ok_with_stale_guide") {
        warnings.push(
          `PSA 10 sold comps ($${checks.psa10VsGuides.reference}) are above stale guide median $${checks.psa10VsGuides.guideMedian}`,
        );
      }
    }

    const popGrades = population.grades?.length ?? 0;

    if (marketPrice >= minPriceForSales && popGrades < 3 && population.status === "pending") {
      failures.push(`population still pending (${popGrades} grades)`);
    } else if (marketPrice >= minPriceForSales && popGrades === 0) {
      warnings.push("no population grade breakdown");
    }

    const guideCount = extractGuideSnapshots(marketEvidence).length;
    const soldEvidence = extractSoldEvidence(marketEvidence);
    const hasSales = recentSales.length > 0 || soldEvidence.length > 0;

    if (marketPrice >= minPriceForSales && guideCount === 0 && !hasSales) {
      failures.push("no guide snapshots or sold comps in market evidence");
    }

    if (psa10?.value && ungraded?.value && psa10.value < ungraded.value * 0.85) {
      failures.push(
        `PSA 10 ($${psa10.value}) is below ungraded ($${ungraded.value}) — likely wrong card match`,
      );
    }

    if (hasSales) {
      const latestSale = recentSales[0] ?? soldEvidence[0];
      const saleGrade = String(latestSale?.grade ?? latestSale?.condition ?? "Ungraded");
      const salePrice = latestSale?.price ?? latestSale?.priceUsd;
      const anchor =
        saleGrade.includes("PSA 10")
          ? psa10?.value
          : saleGrade === "Ungraded"
            ? ungraded?.value
            : null;

      if (anchor && salePrice && priceDeltaRatio(anchor, salePrice) > 0.65) {
        warnings.push(
          `latest ${saleGrade} sale $${salePrice} diverges from displayed $${anchor}`,
        );
      }
    }
  }

  const guideSources = new Set(
    extractGuideSnapshots(marketEvidence, /PSA 10/i).map((entry) => entry.source),
  );

  if (guideSources.size >= 2) {
    const guidePrices = extractGuideSnapshots(marketEvidence, /PSA 10/i).map((entry) => entry.priceUsd);
    const low = Math.min(...guidePrices);
    const high = Math.max(...guidePrices);

    if (high / Math.max(low, 1) > 1 + DEFAULT_GRADED_TOLERANCE) {
      warnings.push(
        `PSA 10 guides disagree across sources (${guideSources.size} sources, ${Math.round((high / low - 1) * 100)}% spread)`,
      );
    }
  }

  return {
    failures,
    warnings,
    checks,
    status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
  };
}
