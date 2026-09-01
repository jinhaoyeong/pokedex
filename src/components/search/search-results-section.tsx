import Link from "next/link";

import { SearchResults } from "@/components/search/search-results";
import { SearchResultsCacheWarmer } from "@/components/search/search-results-cache-warmer";
import { SearchResultsPaint } from "@/components/search/search-results-paint";
import { applyEditionFilterToSearchResponse } from "@/lib/card-finish";
import { buildSearchHref, makeSearchCacheKey } from "@/lib/search-href";
import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  SEARCH_PAGE_SIZE,
  searchLiveCards,
} from "@/lib/pokemon-tcg-api";
import { parseCardEditionFilter } from "@/lib/search-constants";
import {
  SEARCH_UNAVAILABLE_NOTICE,
  shouldReplaceWithStaticTrending,
} from "@/lib/search-landing-fallback";
import { getStaticTrendingSearchResponse } from "@/lib/static-trending";
import type {
  CardEditionFilter,
  CardLanguageFilter,
  LiveSearchResponse,
  SearchSortOption,
} from "@/types/pokemon";

function isSearchSortOption(value: string): value is SearchSortOption {
  return [
    "relevance",
    "price-desc",
    "price-asc",
    "change-desc",
    "change-asc",
    "number-desc",
    "number-asc",
  ].includes(value);
}

export async function SearchResultsSection({
  query,
  setFilter,
  page,
  language,
  sort,
  edition,
}: {
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  edition: CardEditionFilter;
}) {
  let searchResponse: LiveSearchResponse;

  try {
    searchResponse = await searchLiveCards(query, setFilter, page, language, sort);
  } catch (error) {
    console.error("SearchResultsSection failed", {
      query,
      setFilter,
      page,
      language,
      sort,
      edition,
      error,
    });

    searchResponse = {
      results: [],
      totalCount: 0,
      page,
      pageSize: SEARCH_PAGE_SIZE,
      hasNextPage: false,
      notice:
        setFilter && sort !== "relevance"
          ? "Price sorting took too long for this set. Try again in a moment, or switch to Relevance while prices load."
          : SEARCH_UNAVAILABLE_NOTICE,
    };
  }

  if (
    shouldReplaceWithStaticTrending({
      query,
      setFilter,
      page,
      resultsLength: searchResponse.results.length,
      notice: searchResponse.notice,
    })
  ) {
    searchResponse = getStaticTrendingSearchResponse();
  }

  searchResponse = applyEditionFilterToSearchResponse(searchResponse, edition);

  const cacheKey = makeSearchCacheKey({ query, setFilter, page, language, sort, edition });

  const hasQuery = query.trim().length > 0;
  const isSetBrowse = Boolean(setFilter && !hasQuery);
  const setLabel = setFilter ? setFilter.toUpperCase() : "";
  const resultHeading = hasQuery ? "Results" : isSetBrowse ? setLabel : "Trending";
  const resultSummary =
    typeof searchResponse.totalCount === "number"
      ? `${searchResponse.totalCount.toLocaleString()} cards`
      : "";
  const pricePendingNotice = isSetBrowse ? "Prices are still loading." : undefined;

  return (
    <SearchResultsPaint>
      <SearchResultsCacheWarmer
        cacheKey={cacheKey}
        response={searchResponse}
        query={query}
        setFilter={setFilter}
        page={page}
        language={language}
        sort={sort}
        edition={edition}
      />
      <SearchResults
        heading={resultHeading}
        pricePendingNotice={pricePendingNotice}
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
                  edition,
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
                  edition,
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

export function parseSearchPageParams(params: {
  q?: string;
  set?: string;
  page?: string;
  lang?: string;
  sort?: string;
  edition?: string;
}) {
  const query = params.q ?? "";
  const setFilter = params.set ?? "";
  const page = Number.parseInt(params.page ?? "1", 10);
  const requestedLanguage = params.lang ?? "all";
  const language = CARD_LANGUAGE_FILTERS.some((item) => item.code === requestedLanguage)
    ? (requestedLanguage as CardLanguageFilter)
    : "all";
  const requestedSort = params.sort ?? DEFAULT_SEARCH_SORT;
  const sort = isSearchSortOption(requestedSort) ? requestedSort : DEFAULT_SEARCH_SORT;
  const edition = parseCardEditionFilter(params.edition);

  return {
    query,
    setFilter,
    page: Number.isNaN(page) ? 1 : page,
    language,
    sort,
    edition,
  };
}
