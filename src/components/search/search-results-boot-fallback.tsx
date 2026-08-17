"use client";

import {
  getBootHotSearchForRequest,
  getCachedClientSearch,
  makeClientSearchCacheKey,
} from "@/lib/client-catalog-cache";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

import { SearchResults } from "@/components/search/search-results";
import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";

export function SearchResultsBootFallback({
  query,
  setFilter,
  page,
  language,
  sort,
}: {
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
}) {
  const cacheKey = makeClientSearchCacheKey({ query, setFilter, page, language, sort });
  const cached =
    getCachedClientSearch(cacheKey) ??
    getBootHotSearchForRequest({
      query,
      setFilter,
      page,
      language,
      sort,
    });

  if (!cached || (setFilter && !cached.results.length)) {
    return <SearchResultsSkeleton />;
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
    <SearchResults
      heading={resultHeading}
      results={cached.results}
      query={query}
      summary={resultSummary}
      totalCount={cached.totalCount}
      notice={cached.notice}
    />
  );
}
