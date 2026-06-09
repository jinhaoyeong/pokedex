import type {
  GradedPrice,
  PortfolioItem,
  PriceConsensus,
  TcgCard,
} from "@/types/pokemon";

const MARKET_REFRESH_MS = 30 * 60 * 1000;

export function positivePrice(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function normalizeGradeLabel(grade: string) {
  return grade.trim().replace(/\s+/g, " ").toLowerCase();
}

function getGradeFamily(grade: string) {
  if (grade === "Ungraded") {
    return "Ungraded";
  }

  if (grade.startsWith("PSA")) return "PSA";
  if (grade.startsWith("BGS") || grade.startsWith("BECKETT")) return "BGS";
  if (grade.startsWith("CGC")) return "CGC";
  if (grade.startsWith("TAG")) return "TAG";
  if (grade.startsWith("SGC")) return "SGC";
  return "Other";
}

export function resolveBinderGradeMarket(
  grade: string,
  gradedPrices: GradedPrice[] | undefined,
  priceConsensus?: PriceConsensus,
) {
  const prices = gradedPrices ?? [];

  if (grade === "Ungraded") {
    const ungraded = prices.find((price) => price.grade === "Ungraded" && price.value > 0);

    if (ungraded) {
      return {
        value: ungraded.value,
        source: ungraded.source,
        matchedGrade: ungraded.grade,
      };
    }

    const consensus = positivePrice(priceConsensus?.finalEstimateUsd);

    if (consensus) {
      return {
        value: consensus,
        source: priceConsensus?.methodology,
        matchedGrade: "Ungraded",
      };
    }

    return {};
  }

  const normalizedTarget = normalizeGradeLabel(grade);
  const exact = prices.find(
    (price) => normalizeGradeLabel(price.grade) === normalizedTarget && price.value > 0,
  );

  if (exact) {
    return {
      value: exact.value,
      source: exact.source,
      matchedGrade: exact.grade,
    };
  }

  const compactTarget = normalizedTarget.replace(/\s+/g, "");
  const compactMatch = prices.find((price) => {
    if (price.value <= 0) {
      return false;
    }

    return normalizeGradeLabel(price.grade).replace(/\s+/g, "") === compactTarget;
  });

  if (compactMatch) {
    return {
      value: compactMatch.value,
      source: compactMatch.source,
      matchedGrade: compactMatch.grade,
    };
  }

  const family = getGradeFamily(grade);
  const familyPrices = prices
    .filter((price) => getGradeFamily(price.grade) === family && price.value > 0)
    .sort((left, right) => right.value - left.value);

  if (familyPrices.length) {
    const best = familyPrices[0];
    return {
      value: best.value,
      source: best.source,
      matchedGrade: best.grade,
    };
  }

  return {};
}

export function buildBinderMarketSearchParams(item: PortfolioItem, localCard?: TcgCard) {
  const lookupSetName =
    item.setEnglishName?.trim() || localCard?.setEnglishName?.trim() || item.setName;
  const localizedEnglishName = item.englishName?.trim() || localCard?.englishName?.trim();
  const language = item.language ?? localCard?.language;
  const lookupCardName =
    language && language !== "en" && localizedEnglishName ? localizedEnglishName : item.name;

  const params = new URLSearchParams({
    setName: lookupSetName,
    cardName: lookupCardName,
    cardNumber: item.collectorNumber,
    mode: "core",
  });

  const rawMarket =
    positivePrice(item.marketValueUsd) ??
    positivePrice(localCard?.gradedPrices.find((price) => price.grade === item.grade)?.value) ??
    positivePrice(localCard?.marketPriceUsd);

  if (rawMarket) {
    params.set("rawMarketPriceUsd", rawMarket.toString());
  }

  const setTotal =
    item.setPrintedTotal ?? localCard?.setPrintedTotal ?? localCard?.setTotal;

  if (typeof setTotal === "number" && setTotal > 0) {
    params.set("setTotal", setTotal.toString());
  }

  const rarity = item.rarity ?? localCard?.rarity;

  if (rarity && rarity !== "Unknown") {
    params.set("rarity", rarity);
  }

  const setCode = item.setCode ?? localCard?.setCode;

  if (setCode) {
    params.set("setCode", setCode);
  }

  if (language) {
    params.set("language", language);
  }

  if (localizedEnglishName) {
    params.set("englishCardName", localizedEnglishName);
  }

  return params;
}

export function shouldRefreshBinderMarket(item: PortfolioItem) {
  const storedValue = positivePrice(item.marketValueUsd);

  if (!storedValue) {
    return true;
  }

  if (!item.marketValueUpdatedAt) {
    return true;
  }

  const updatedAtMs = Date.parse(item.marketValueUpdatedAt);

  if (Number.isNaN(updatedAtMs)) {
    return true;
  }

  return Date.now() - updatedAtMs > MARKET_REFRESH_MS;
}

export function hasTrackedCost(costBasisUsd: number) {
  return typeof costBasisUsd === "number" && Number.isFinite(costBasisUsd) && costBasisUsd > 0;
}
