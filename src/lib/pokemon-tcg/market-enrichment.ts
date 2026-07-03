import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { fetchPublicPageText } from "@/lib/public-page-fetch";
import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import type { PublicUngradedPriceFallback } from "@/lib/pokemon-tcg/api-types";
import {
  escapeRegex,
  normalizeWhitespace,
} from "@/lib/pokemon-tcg/text-and-collector-utils";
import type {
  CardLanguageCode,
  LiveSearchResponse,
  SearchResult,
  SearchSortOption,
  TcgCard,
} from "@/types/pokemon";

const GRADED_KEYWORDS = /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|GRADED|SLAB|BLACK LABEL|PRISTINE|GEM MINT)\b/i;
const PUBLIC_SOLD_COMP_REVALIDATE_SECONDS = 21600;
const MAGERY_QUERY_BATCH_SIZE = 2;
const IMPORT_MARKET_LABELS: Partial<Record<CardLanguageCode, string>> = {
  ja: "Japanese",
  ko: "Korean",
  "zh-cn": "Chinese",
  "zh-tw": "Chinese",
  fr: "French",
  de: "German",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
  "pt-br": "Portuguese",
  "pt-pt": "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  id: "Indonesian",
  th: "Thai",
};

function parseUsd(value: string) {
  return Number.parseFloat(value.replace(/[^0-9.]/g, ""));
}

function buildPublicUngradedPriceQueries(card: TcgCard) {
  const rarityBit =
    card.rarity && card.rarity !== "Unknown" ? ` ${card.rarity}` : "";
  const lookupName =
    card.language !== "en" && card.englishName?.trim()
      ? card.englishName.trim()
      : card.name;
  const lookupSetName =
    card.language !== "en" && card.setEnglishName?.trim()
      ? card.setEnglishName.trim()
      : card.setName;
  const printedTotal =
    typeof card.setPrintedTotal === "number" && card.setPrintedTotal > 0
      ? card.setPrintedTotal
      : typeof card.setTotal === "number" && card.setTotal > 0
        ? card.setTotal
        : null;
  const collectorCode = printedTotal
    ? `${card.collectorNumber}/${String(printedTotal).padStart(3, "0")}`
    : `#${card.collectorNumber}`;

  const importLabel = IMPORT_MARKET_LABELS[card.language];
  const regionalQueries = importLabel
    ? [
        `Pokemon ${importLabel} ${lookupName} ${card.setCode} ${collectorCode} ${lookupSetName}${rarityBit}`,
        `Pokemon ${importLabel} ${card.setCode} ${collectorCode}`,
        `Pokemon ${importLabel} ${lookupName} ${collectorCode}`,
        `Pokemon ${importLabel} ${lookupName} ${collectorCode} ${lookupSetName}`,
      ]
    : [];

  return [
    ...regionalQueries,
    `Pokemon ${lookupName} ${collectorCode} ${lookupSetName}${rarityBit}`,
    `Pokemon ${lookupName} ${card.setCode} ${collectorCode}`,
    `Pokemon ${lookupName} ${collectorCode}`,
    `Pokemon ${lookupSetName} ${card.collectorNumber} ${lookupName}`,
  ].filter((query, index, queries) => query.trim() && queries.indexOf(query) === index);
}

function classifyListingTitleMatch(title: string, card: TcgCard): "strict" | "loose" | "none" {
  const num = card.collectorNumber.trim();
  if (!num) {
    return "none";
  }

  const numBare = num.replace(/^0+(?=\d)/, "") || "0";
  const printed =
    typeof card.setPrintedTotal === "number" && card.setPrintedTotal > 0
      ? card.setPrintedTotal
      : typeof card.setTotal === "number" && card.setTotal > 0
        ? card.setTotal
        : null;

  const t = title.replace(/\s+/g, " ");

  if (printed !== null) {
    const strictRe = new RegExp(
      `\\b0*${escapeRegex(numBare)}\\s*/\\s*0*${escapeRegex(String(printed))}\\b`,
      "i",
    );
    if (strictRe.test(t)) {
      return "strict";
    }
    return "none";
  }

  const looseRe = new RegExp(
    `\\b0*${escapeRegex(numBare)}\\s*/\\s*\\d{2,4}\\b`,
    "i",
  );
  return looseRe.test(t) ? "loose" : "none";
}

async function fetchMageryUngradedPriceForQuery(
  query: string,
  card: TcgCard,
): Promise<PublicUngradedPriceFallback | null> {
  let html: string;

  try {
    html = await fetchPublicPageText(
      `https://magery.com/w?q=${encodeURIComponent(query)}`,
      PUBLIC_SOLD_COMP_REVALIDATE_SECONDS,
    );
  } catch {
    return null;
  }

  const saleRegex =
    /data-item-id="[^"]+"[\s\S]*?<div class="card-title"[^>]*><a href="[^"]+">([\s\S]*?)<\/a><\/div>[\s\S]*?<span class="card-status status-sold">Sold<\/span>[\s\S]*?<div class="card-price sold">\$([^<]+)<\/div>/g;

  const strictPrices: number[] = [];
  const loosePrices: number[] = [];

  for (const match of html.matchAll(saleRegex)) {
    const title = normalizeWhitespace(match[1]);

    if (GRADED_KEYWORDS.test(title)) {
      continue;
    }

    const tier = classifyListingTitleMatch(title, card);
    if (tier === "none") {
      continue;
    }

    const price = parseUsd(match[2]);

    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }

    if (tier === "strict") {
      strictPrices.push(price);
    } else {
      loosePrices.push(price);
    }
  }

  const pool =
    strictPrices.length > 0
      ? strictPrices
      : loosePrices.length >= 2
        ? loosePrices
        : [];

  if (!pool.length) {
    return null;
  }

  const sorted = [...pool].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const priceUsd =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    priceUsd,
    sampleCount: pool.length,
    matchTier: strictPrices.length > 0 ? "strict" : "loose",
    query,
  };
}

function pickBestPublicUngradedFallback(pool: PublicUngradedPriceFallback[]) {
  return [...pool].sort((left, right) => {
    const sampleDelta = (right.sampleCount ?? 0) - (left.sampleCount ?? 0);
    if (sampleDelta !== 0) {
      return sampleDelta;
    }

    return right.priceUsd - left.priceUsd;
  })[0];
}

export async function fetchPublicUngradedPriceFallback(
  card: TcgCard,
): Promise<PublicUngradedPriceFallback | null> {
  const queries = buildPublicUngradedPriceQueries(card);
  const strictOutcomes: PublicUngradedPriceFallback[] = [];
  const looseOutcomes: PublicUngradedPriceFallback[] = [];

  for (let index = 0; index < queries.length; index += MAGERY_QUERY_BATCH_SIZE) {
    const batch = queries.slice(index, index + MAGERY_QUERY_BATCH_SIZE);
    const outcomes = await Promise.all(
      batch.map((query) => fetchMageryUngradedPriceForQuery(query, card)),
    );

    for (const outcome of outcomes) {
      if (!outcome) {
        continue;
      }

      if (outcome.matchTier === "strict") {
        strictOutcomes.push(outcome);
      } else {
        looseOutcomes.push(outcome);
      }
    }

    const multiSampleStrict = strictOutcomes.filter((outcome) => (outcome.sampleCount ?? 0) >= 2);
    if (multiSampleStrict.length) {
      return pickBestPublicUngradedFallback(multiSampleStrict);
    }
  }

  if (strictOutcomes.length) {
    const bestStrict = pickBestPublicUngradedFallback(strictOutcomes);
    const bestLoose = looseOutcomes.length ? pickBestPublicUngradedFallback(looseOutcomes) : null;

    if (
      bestLoose &&
      (bestLoose.sampleCount ?? 0) >= 2 &&
      bestStrict.priceUsd < bestLoose.priceUsd * 0.45
    ) {
      return bestLoose;
    }

    return bestStrict;
  }

  return looseOutcomes.length ? pickBestPublicUngradedFallback(looseOutcomes) : null;
}

export function isRarityDerivedMarketPrice(card: TcgCard) {
  const ungraded = card.gradedPrices.find((price) => price.grade === "Ungraded");

  if (ungraded?.source?.toLowerCase().includes("rarity")) {
    return true;
  }

  if (ungraded?.source === "Early market estimate") {
    return true;
  }

  if (ungraded?.source === "Localized market estimate") {
    return true;
  }

  if (card.priceConsensus?.sources?.some((source) => source.source === "Rarity estimate")) {
    return true;
  }

  if (card.priceConsensus?.sources?.some((source) => source.source === "Early market estimate")) {
    return true;
  }

  if (
    card.priceConsensus?.sources?.some(
      (source) => source.source === "Localized market estimate",
    )
  ) {
    return true;
  }

  return card.sources.some(
    (source) =>
      source.source === "Localized search group estimate" ||
      source.source === "Localized market estimate" ||
      source.source === "Early market estimate",
  );
}

export function isLowConfidenceSearchMarketPrice(card: TcgCard) {
  if (isRarityDerivedMarketPrice(card)) {
    return true;
  }

  return (
    card.priceConsensus?.confidence === "low" &&
    (card.priceConsensus.confidenceScore ?? 1) < 0.4
  );
}

function isLocalizedCatalogOnlyMarketPrice(card: TcgCard) {
  if (card.language === "en" || hasVerifiedLocalizedSearchPrice(card)) {
    return false;
  }

  const headline = getHeadlineMarketPriceUsd(card);

  if (!(headline > 0)) {
    return false;
  }

  const consensusSources = card.priceConsensus?.sources ?? [];

  if (!consensusSources.length) {
    return true;
  }

  return consensusSources.every(
    (source) =>
      source.evidenceType === "catalog" &&
      !/pricecharting|public guide|public sold|magery|grading market consensus/i.test(
        source.source,
      ),
  );
}

function shouldHideLocalizedSearchEstimate(card: TcgCard) {
  return (
    card.language !== "en" &&
    !hasVerifiedLocalizedSearchPrice(card) &&
    (isLowConfidenceSearchMarketPrice(card) || isLocalizedCatalogOnlyMarketPrice(card))
  );
}

export function hasVerifiedLocalizedSearchPrice(card: TcgCard) {
  const consensusVerified = card.priceConsensus?.sources?.some((source) => {
    const score = source.confidenceScore ?? 0;

    return (
      (source.evidenceType === "guide_snapshot" && score >= 0.5) ||
      (source.evidenceType === "sold_comp" && score >= 0.44) ||
      /pricecharting|public guide|public sold|magery|grading market consensus|tcgdex/i.test(
        source.source ?? "",
      )
    );
  });
  const sourceVerified = card.sources?.some((source) =>
    /pricecharting|public guide|public sold|magery|grading market consensus|tcgdex/i.test(
      source.source,
    ),
  );
  const ungradedVerified = card.gradedPrices?.some(
    (price) =>
      price.grade === "Ungraded" &&
      price.value > 0 &&
      /pricecharting|public guide|public sold|magery|consensus|tcgdex/i.test(price.source ?? ""),
  );

  return Boolean(consensusVerified || sourceVerified || ungradedVerified);
}

export function stripLocalizedSearchEstimate(card: TcgCard): TcgCard {
  if (!shouldHideLocalizedSearchEstimate(card)) {
    return card;
  }

  const estimateSources = [
    "Early market estimate",
    "Card-adjusted rarity estimate",
    "Localized market estimate",
    "Localized search group estimate",
    "Rarity estimate",
  ];
  const isEstimateSource = (source?: string) =>
    estimateSources.some((estimateSource) =>
      source?.toLowerCase().includes(estimateSource.toLowerCase()),
    );
  const filteredConsensusSources = (card.priceConsensus?.sources ?? []).filter(
    (source) => !isEstimateSource(source.source),
  );

  return {
    ...card,
    marketPriceUsd: 0,
    priceHistory: card.priceHistory.map((point) => ({
      ...point,
      value: point.isProjected || point.value === card.marketPriceUsd ? 0 : point.value,
      isProjected: point.isProjected ? false : point.isProjected,
    })),
    sources: card.sources.filter((source) => !isEstimateSource(source.source)),
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded" && isEstimateSource(price.source)
        ? {
            ...price,
            value: 0,
            source: undefined,
            confidence: undefined,
            confidenceScore: undefined,
            warning: "Waiting for a verified localized market price.",
          }
        : price,
    ),
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: 0,
          confidence: "low",
          confidenceScore: 0,
          sourceCount: filteredConsensusSources.length,
          sampleCount: 0,
          methodology:
            "Localized search price is pending until a verified guide or sold-comp source is available.",
          sources: filteredConsensusSources,
        }
      : card.priceConsensus,
  };
}

export function isOfficialJapaneseCatalogFallbackCard(card: TcgCard) {
  if (card.language !== "ja") {
    return false;
  }

  const hasOfficialCatalogIdentity = card.sources.some((source) =>
    /Pokemon Card Japan official catalog/i.test(source.source),
  );
  const hasIndexedCardDataset = card.sources.some((source) =>
    /TCGdex|Pokemon TCG API/i.test(source.source),
  );

  return hasOfficialCatalogIdentity && !hasIndexedCardDataset;
}

export function stripOfficialJapaneseCatalogFallbackPrice(card: TcgCard): TcgCard {
  if (!isOfficialJapaneseCatalogFallbackCard(card)) {
    return card;
  }

  return {
    ...stripLocalizedSearchEstimate(card),
    marketPriceUsd: 0,
    priceHistory: card.priceHistory.map((point) => ({
      ...point,
      value: 0,
      isProjected: false,
    })),
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: 0,
            source: undefined,
            confidence: undefined,
            confidenceScore: undefined,
            warning:
              "Price pending until this official Japanese catalog set is indexed by a localized market source.",
          }
        : price,
    ),
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: 0,
          confidence: "low",
          confidenceScore: 0,
          sourceCount: 0,
          sampleCount: 0,
          methodology:
            "Official Japanese catalog identity only. Price matching is disabled until the set is indexed by a localized market source.",
          sources: [],
        }
      : card.priceConsensus,
    sources: card.sources.filter(
      (source) =>
        !/pricecharting|public guide|public sold|magery|rarity estimate|early market estimate|localized market estimate|localized search group estimate/i.test(
          source.source,
        ),
    ),
  };
}

export function sanitizeSearchResultPrices(results: SearchResult[]) {
  return results.map((result) => {
    return {
      ...result,
      card: stripOfficialJapaneseCatalogFallbackPrice(stripLocalizedSearchEstimate(result.card)),
    };
  });
}

export function sanitizeLiveSearchResponsePrices(response: LiveSearchResponse): LiveSearchResponse {
  return {
    ...response,
    results: sanitizeSearchResultPrices(response.results),
  };
}

function currentSearchPrice(card: TcgCard) {
  const price = getHeadlineMarketPriceUsd(
    stripOfficialJapaneseCatalogFallbackPrice(stripLocalizedSearchEstimate(card)),
  );

  return price > 0 ? price : 0;
}

function currentSearchPriceForAscending(card: TcgCard) {
  const price = currentSearchPrice(card);

  return price > 0 ? price : Number.POSITIVE_INFINITY;
}

function comparePendingPriceBottom(leftPrice: number, rightPrice: number) {
  const leftHasPrice = leftPrice > 0;
  const rightHasPrice = rightPrice > 0;

  if (leftHasPrice && !rightHasPrice) {
    return -1;
  }

  if (rightHasPrice && !leftHasPrice) {
    return 1;
  }

  if (!leftHasPrice && !rightHasPrice) {
    return 0;
  }

  return null;
}

function searchPriceChange(card: TcgCard) {
  const values = card.priceHistory
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length < 2) {
    return 0;
  }

  return values[values.length - 1] - values[0];
}

export function collectorNumberSortValue(value: string) {
  const trimmed = value.trim();
  const slashMatch = trimmed.match(/(?:^|[^\d])0*(\d+)\s*\/\s*0*\d+(?:[^\d]|$)/);

  if (slashMatch?.[1]) {
    return Number.parseInt(slashMatch[1], 10);
  }

  const matches = [...trimmed.matchAll(/\d+/g)];
  const match = matches[matches.length - 1];

  return match ? Number.parseInt(match[0], 10) : 0;
}

function compareSearchResultText(left: SearchResult, right: SearchResult) {
  return left.card.name.localeCompare(right.card.name);
}

export function applySearchResultSort(
  results: SearchResult[],
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
) {
  if (sort === "relevance") {
    return results;
  }

  const next = results.slice();

  next.sort((left, right) => {
    switch (sort) {
      case "price-desc":
        {
          const leftPrice = currentSearchPrice(left.card);
          const rightPrice = currentSearchPrice(right.card);
          const pendingOrder = comparePendingPriceBottom(leftPrice, rightPrice);

          if (pendingOrder !== null) {
            return pendingOrder || compareSearchResultText(left, right);
          }

          return rightPrice - leftPrice || compareSearchResultText(left, right);
        }
      case "price-asc":
        {
          const leftPrice = currentSearchPrice(left.card);
          const rightPrice = currentSearchPrice(right.card);
          const pendingOrder = comparePendingPriceBottom(leftPrice, rightPrice);

          if (pendingOrder !== null) {
            return pendingOrder || compareSearchResultText(left, right);
          }

          return (
            currentSearchPriceForAscending(left.card) -
              currentSearchPriceForAscending(right.card) ||
            compareSearchResultText(left, right)
          );
        }
      case "change-desc":
        return (
          searchPriceChange(right.card) -
            searchPriceChange(left.card) ||
          compareSearchResultText(left, right)
        );
      case "change-asc":
        return (
          searchPriceChange(left.card) -
            searchPriceChange(right.card) ||
          compareSearchResultText(left, right)
        );
      case "number-desc":
        return (
          collectorNumberSortValue(right.card.collectorNumber) -
            collectorNumberSortValue(left.card.collectorNumber) ||
          compareSearchResultText(left, right)
        );
      case "number-asc":
        return (
          collectorNumberSortValue(left.card.collectorNumber) -
            collectorNumberSortValue(right.card.collectorNumber) ||
          compareSearchResultText(left, right)
        );
      default:
        return 0;
    }
  });

  return next;
}
