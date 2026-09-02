"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SearchResults } from "@/components/search/search-results";
import { SearchResultsPaint } from "@/components/search/search-results-paint";
import { SearchResultsSkeleton } from "@/components/search/search-results-skeleton";
import {
  getBootHotSearchForRequest,
  getCachedClientSearch,
  makeClientSearchCacheKey,
  warmClientSearchCache,
} from "@/lib/client-catalog-cache";
import { buildSearchHref } from "@/lib/search-href";
import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import {
  isPriceSort,
  searchResultsHaveDisplayablePrices,
} from "@/lib/search-price-sort";
import type { CardLanguageFilter, LiveSearchResponse, SearchSortOption } from "@/types/pokemon";

export function SearchResultsLoader({
  query,
  setFilter,
  page,
  language,
  sort,
  initialResponse,
}: {
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  initialResponse?: LiveSearchResponse | null;
}) {
  const cacheKey = makeClientSearchCacheKey({ query, setFilter, page, language, sort });
  const [searchResponse, setSearchResponse] = useState<LiveSearchResponse | null>(
    () => {
      const candidate =
        initialResponse ??
        getCachedClientSearch(cacheKey) ??
        getBootHotSearchForRequest({ query, setFilter, page, language, sort });

      if (
        candidate?.results.length &&
        isPriceSort(sort) &&
        !searchResultsHaveDisplayablePrices(candidate.results)
      ) {
        return null;
      }

      return candidate ?? null;
    },
  );

  useEffect(() => {
    if (initialResponse) {
      warmClientSearchCache(cacheKey, initialResponse);
    }
  }, [cacheKey, initialResponse]);

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

    fetch(`/api/live-search?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Search request failed");
        }

        return response.json() as Promise<LiveSearchResponse>;
      })
      .then((payload) => {
        warmClientSearchCache(cacheKey, payload, { setFilter });
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
    typeof searchResponse.totalCount === "number"
      ? isSetBrowse
        ? `${searchResponse.totalCount.toLocaleString()} cards in ${setLabel}`
        : `${searchResponse.totalCount.toLocaleString()} matches for "${query || "Trending & Hot Cards"}"`
      : isSetBrowse
        ? `Showing cards in ${setLabel}`
        : `Showing cards for "${query || "all cards"}"`;

  return (
    <SearchResultsPaint>
      <SearchResults
        heading={resultHeading}
        results={searchResponse.results}
        query={query}
        sort={sort}
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
            {searchResponse.page <= 1 ? (
              <span
                aria-disabled
                className="btn btn-ghost btn-sm pagination-btn pagination-btn--disabled"
              >
                Previous
              </span>
            ) : (
              <Link
                href={buildSearchHref({
                  query,
                  setFilter,
                  language,
                  sort,
                  page: searchResponse.page - 1,
                })}
                className="btn btn-ghost btn-sm pagination-btn"
              >
                Previous
              </Link>
            )}
            {!searchResponse.hasNextPage ? (
              <span
                aria-disabled
                className="btn btn-ghost btn-sm pagination-btn pagination-btn--disabled"
              >
                Next
              </span>
            ) : (
              <Link
                href={buildSearchHref({
                  query,
                  setFilter,
                  language,
                  sort,
                  page: searchResponse.page + 1,
                })}
                className="btn btn-primary btn-sm pagination-btn"
              >
                Next
              </Link>
            )}
          </div>
        </section>
      ) : null}
    </SearchResultsPaint>
  );
}
