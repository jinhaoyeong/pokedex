"use client";

import { useEffect, useState } from "react";

import { SearchResults } from "@/components/search/search-results";
import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";
import {
  getBootHotSearchForRequest,
  getCachedClientSearch,
  makeClientSearchCacheKey,
  warmClientSearchCache,
} from "@/lib/client-catalog-cache";
import { DEFAULT_SEARCH_SORT } from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter, LiveSearchResponse, SearchSortOption } from "@/types/pokemon";

function buildSearchHref({
  query,
  setFilter,
  language,
  sort,
  page,
}: {
  query: string;
  setFilter: string;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  page: number;
}) {
  const nextParams = new URLSearchParams();

  if (query) {
    nextParams.set("q", query);
  }

  if (setFilter) {
    nextParams.set("set", setFilter);
  }

  if (language !== "all") {
    nextParams.set("lang", language);
  }

  if (sort !== DEFAULT_SEARCH_SORT) {
    nextParams.set("sort", sort);
  }

  if (page > 1) {
    nextParams.set("page", page.toString());
  }

  const queryString = nextParams.toString();
  return queryString ? `/search?${queryString}` : "/search";
}

export function SearchResultsLoader({
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
  const [searchResponse, setSearchResponse] = useState<LiveSearchResponse | null>(
    () =>
      getCachedClientSearch(cacheKey) ??
      getBootHotSearchForRequest({ query, setFilter, page, language, sort }),
  );
  useEffect(() => {
    if (searchResponse) {
      return;
    }

    const controller = new AbortController();

    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (setFilter) {
      params.set("set", setFilter);
    }
    if (language !== "all") {
      params.set("lang", language);
    }
    if (sort !== DEFAULT_SEARCH_SORT) {
      params.set("sort", sort);
    }
    if (page > 1) {
      params.set("page", page.toString());
    }

    fetch(`/api/live-search?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Search request failed");
        }

        return response.json() as Promise<LiveSearchResponse>;
      })
      .then((payload) => {
        warmClientSearchCache(cacheKey, payload);
        setSearchResponse(payload);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setSearchResponse({
          results: [],
          totalCount: 0,
          page,
          pageSize: 0,
          hasNextPage: false,
          notice: "Search failed. Please try again.",
        });
      });

    return () => {
      controller.abort();
    };
  }, [cacheKey, language, page, query, searchResponse, setFilter, sort]);

  if (!searchResponse) {
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
    typeof searchResponse.totalCount === "number"
      ? isSetBrowse
        ? `${searchResponse.totalCount.toLocaleString()} cards in ${setLabel}`
        : `${searchResponse.totalCount.toLocaleString()} matches for "${query || "Trending & Hot Cards"}"`
      : isSetBrowse
        ? `Showing cards in ${setLabel}`
        : `Showing cards for "${query || "all cards"}"`;
  const pricePendingNotice = isSetBrowse
    ? "Set loaded. Prices appear automatically once catalog or sold-comp data is available."
    : undefined;

  return (
    <>
      <SearchResults
        heading={resultHeading}
        pricePendingNotice={pricePendingNotice}
        results={searchResponse.results}
        query={query}
        summary={resultSummary}
        totalCount={searchResponse.totalCount}
        notice={searchResponse.notice}
      />

      {searchResponse.page > 1 || searchResponse.hasNextPage ? (
        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-sm text-slate-400 sm:max-w-[65%]">
            {typeof searchResponse.totalCount === "number"
              ? `Showing ${(searchResponse.page - 1) * searchResponse.pageSize + 1}-${Math.min(
                  searchResponse.page * searchResponse.pageSize,
                  searchResponse.totalCount,
                )} of ${searchResponse.totalCount.toLocaleString()} matches`
              : `Showing browse results on page ${searchResponse.page}`}
          </p>
          <div className="flex w-full gap-3 sm:w-auto">
            <a
              href={buildSearchHref({
                query,
                setFilter,
                language,
                sort,
                page: searchResponse.page - 1,
              })}
              aria-disabled={searchResponse.page <= 1}
              className={`flex-1 rounded-2xl px-4 py-2 text-center text-sm font-semibold transition-colors sm:flex-none ${
                searchResponse.page <= 1
                  ? "pointer-events-none border border-white/10 text-slate-500"
                  : "border border-white/10 text-slate-200 hover:border-white/20 hover:text-white"
              }`}
            >
              Previous
            </a>
            <a
              href={buildSearchHref({
                query,
                setFilter,
                language,
                sort,
                page: searchResponse.page + 1,
              })}
              aria-disabled={!searchResponse.hasNextPage}
              className={`flex-1 rounded-2xl px-4 py-2 text-center text-sm font-semibold transition-colors sm:flex-none ${
                !searchResponse.hasNextPage
                  ? "pointer-events-none border border-white/10 text-slate-500"
                  : "bg-blue-500 text-white hover:bg-blue-400"
              }`}
            >
              Next
            </a>
          </div>
        </section>
      ) : null}
    </>
  );
}
