"use client";

import {
  getBootHotSearchForRequest,
  getCachedClientSearch,
  makeClientSearchCacheKey,
} from "@/lib/client-catalog-cache";
import { applyEditionFilterToSearchResponse } from "@/lib/card-finish";
import { DEFAULT_EDITION_FILTER } from "@/lib/search-constants";
import type {
  CardEditionFilter,
  CardLanguageFilter,
  LiveSearchResponse,
  SearchSortOption,
} from "@/types/pokemon";

import { SearchResults } from "@/components/search/search-results";
import { SearchResultsPaint } from "@/components/search/search-results-paint";
import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";

export function SearchResultsBootFallback({
  query,
  setFilter,
  page,
  language,
  sort,
  edition = DEFAULT_EDITION_FILTER,
  instantResponse = null,
}: {
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  edition?: CardEditionFilter;
  instantResponse?: LiveSearchResponse | null;
}) {
  const cacheKey = makeClientSearchCacheKey({
    query,
    setFilter,
    page,
    language,
    sort,
    edition,
  });
  const unfilteredKey =
    edition === DEFAULT_EDITION_FILTER
      ? null
      : makeClientSearchCacheKey({ query, setFilter, page, language, sort });
  const cachedRaw =
    getCachedClientSearch(cacheKey) ??
    (unfilteredKey ? getCachedClientSearch(unfilteredKey) : null) ??
    getBootHotSearchForRequest({
      query,
      setFilter,
      page,
      language,
      sort,
    }) ??
    instantResponse;
  const cached = cachedRaw
    ? applyEditionFilterToSearchResponse(cachedRaw, edition)
    : null;

  if (!cached || (setFilter && !cached.results.length)) {
    return (
      <SearchResultsPaint>
        <SearchResultsSkeleton />
      </SearchResultsPaint>
    );
  }

  const hasQuery = query.trim().length > 0;
  const isSetBrowse = Boolean(setFilter && !hasQuery);
  const setLabel = setFilter ? setFilter.toUpperCase() : "";
  const resultHeading = hasQuery
    ? "Search results"
    : isSetBrowse
      ? "Set cards"
      : "Trending & Hot Cards";
  const resultSummary =
    typeof cached.totalCount === "number"
      ? isSetBrowse
        ? `${cached.totalCount.toLocaleString()} cards in ${setLabel}`
        : `${cached.totalCount.toLocaleString()} matches for "${query || "Trending & Hot Cards"}"`
      : isSetBrowse
        ? `Showing cards in ${setLabel}`
        : `Showing cards for "${query || "all cards"}"`;

  return (
    <SearchResultsPaint>
      <SearchResults
        heading={resultHeading}
        results={cached.results}
        query={query}
        sort={sort}
        summary={resultSummary}
        totalCount={cached.totalCount}
        notice={cached.notice}
      />
    </SearchResultsPaint>
  );
}
