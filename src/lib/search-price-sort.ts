import { officialJapaneseChaseSortScore } from "@/lib/pokemon-tcg/chase-sort-score";
import {
  cardNeedsListPriceLookup,
  displayableListPriceUsd,
  trustedListPriceUsd,
} from "@/lib/price/list-price-trust";
import {
  getPriceLookupUsd,
  isReliablePriceResult,
  type PriceLookupPayload,
} from "@/lib/price/price-query";
import type { SearchResult, SearchSortOption, TcgCard } from "@/types/pokemon";

/** User-visible paint target: cards and prices together by 3s, hard cap 5s. */
export const PRICE_SORT_REVEAL_BUDGET_MS = 3_000;

export function isPriceSort(sort: SearchSortOption) {
  return sort === "price-desc" || sort === "price-asc";
}

export function compareByPriceSort(
  leftCard: TcgCard,
  rightCard: TcgCard,
  leftPrice: number,
  rightPrice: number,
  sort: SearchSortOption,
) {
  if (sort === "price-desc") {
    if (leftPrice > 0 && rightPrice <= 0) {
      return -1;
    }

    if (rightPrice > 0 && leftPrice <= 0) {
      return 1;
    }

    if (leftPrice > 0 && rightPrice > 0) {
      return rightPrice - leftPrice || leftCard.name.localeCompare(rightCard.name);
    }

    return (
      officialJapaneseChaseSortScore(rightCard) - officialJapaneseChaseSortScore(leftCard) ||
      leftCard.name.localeCompare(rightCard.name)
    );
  }

  const leftAsc = leftPrice > 0 ? leftPrice : Number.POSITIVE_INFINITY;
  const rightAsc = rightPrice > 0 ? rightPrice : Number.POSITIVE_INFINITY;

  if (leftAsc === rightAsc && !(leftPrice > 0) && !(rightPrice > 0)) {
    return (
      officialJapaneseChaseSortScore(rightCard) - officialJapaneseChaseSortScore(leftCard) ||
      leftCard.name.localeCompare(rightCard.name)
    );
  }

  return leftAsc - rightAsc || leftCard.name.localeCompare(rightCard.name);
}

export function collectTrustedListPrices(results: SearchResult[]) {
  const prices: Record<string, number> = {};

  for (const result of results) {
    const priceUsd = trustedListPriceUsd(result.card);
    if (priceUsd > 0) {
      prices[result.card.slug] = priceUsd;
    }
  }

  return prices;
}

export function collectDisplayableListPrices(results: SearchResult[]) {
  const prices: Record<string, number> = {};

  for (const result of results) {
    const priceUsd = displayableListPriceUsd(result.card);
    if (priceUsd > 0) {
      prices[result.card.slug] = priceUsd;
    }
  }

  return prices;
}

export function searchResultsHaveDisplayablePrices(results: SearchResult[]) {
  return results.some((result) => displayableListPriceUsd(result.card) > 0);
}

export function cardsNeedingPriceSortLookup(results: SearchResult[]) {
  return results.filter((result) => cardNeedsListPriceLookup(result.card)).map((result) => result.card);
}

export function needsPriceSortBatch(results: SearchResult[]) {
  return cardsNeedingPriceSortLookup(results).length > 0;
}

export function extractReliableBatchPrices(
  payloads: Record<string, PriceLookupPayload | null | undefined>,
) {
  const prices: Record<string, number> = {};

  for (const [slug, payload] of Object.entries(payloads)) {
    if (!isReliablePriceResult(payload)) {
      continue;
    }

    const priceUsd = getPriceLookupUsd(payload);
    if (priceUsd && priceUsd > 0) {
      prices[slug] = priceUsd;
    }
  }

  return prices;
}

export function mergePriceSortUsd(
  trusted: Record<string, number>,
  batch: Record<string, number>,
) {
  return { ...trusted, ...batch };
}

export function freezePriceSortedResults(
  results: SearchResult[],
  prices: Record<string, number>,
  sort: SearchSortOption,
) {
  return results.slice().sort((left, right) =>
    compareByPriceSort(
      left.card,
      right.card,
      prices[left.card.slug] ?? 0,
      prices[right.card.slug] ?? 0,
      sort,
    ),
  );
}

export function applyFrozenSearchOrder(results: SearchResult[], frozenSlugs: string[]) {
  const bySlug = new Map(results.map((result) => [result.card.slug, result]));
  const ordered: SearchResult[] = [];
  const seen = new Set<string>();

  for (const slug of frozenSlugs) {
    const result = bySlug.get(slug);
    if (!result || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    ordered.push(result);
  }

  for (const result of results) {
    if (seen.has(result.card.slug)) {
      continue;
    }
    seen.add(result.card.slug);
    ordered.push(result);
  }

  return ordered;
}
