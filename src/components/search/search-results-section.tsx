import Link from "next/link";

import { SearchResults } from "@/components/search/search-results";
import { SearchResultsCacheWarmer } from "@/components/search/search-results-cache-warmer";
import { buildSearchHref, makeSearchCacheKey } from "@/lib/search-href";
import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  searchLiveCards,
} from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter, LiveSearchResponse, SearchSortOption } from "@/types/pokemon";

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

const SORT_LABELS: Record<SearchSortOption, string> = {
  relevance: "Relevant",
  "price-desc": "Price: high to low",
  "price-asc": "Price: low to high",
  "change-desc": "Change: high to low",
  "change-asc": "Change: low to high",
  "number-desc": "Number: high to low",
  "number-asc": "Number: low to high",
};

export async function SearchResultsSection({
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
      error,
    });

    searchResponse = {
      results: [],
      totalCount: 0,
      page,
      pageSize: 50,
      hasNextPage: false,
      notice:
        setFilter && sort !== "relevance"
          ? "Price sorting took too long for this set. Try again in a moment, or switch to Relevance while prices load."
          : "Search is temporarily unavailable. Please try again.",
    };
  }

  const cacheKey = makeSearchCacheKey({ query, setFilter, page, language, sort });

  const hasQuery = query.trim().length > 0;
  const isSetBrowse = Boolean(setFilter && !hasQuery);
  const setLabel = setFilter ? setFilter.toUpperCase() : "";
  const resultHeading = hasQuery
    ? "Search results"
    : isSetBrowse
      ? "Set cards"
      : "Popular cards";
  const resultSummary =
    typeof searchResponse.totalCount === "number"
      ? isSetBrowse
        ? `${searchResponse.totalCount.toLocaleString()} cards in ${setLabel}`
        : hasQuery
          ? `${searchResponse.totalCount.toLocaleString()} matching cards for "${query}"`
          : `${searchResponse.totalCount.toLocaleString()} cards ready to browse`
      : isSetBrowse
        ? `Showing cards in ${setLabel}`
        : `Showing cards for "${query || "all cards"}"`;
  const pricePendingNotice = isSetBrowse
    ? "Set loaded. Prices appear automatically once catalog or sold-comp data is available."
    : undefined;
  const languageLabel =
    CARD_LANGUAGE_FILTERS.find((item) => item.code === language)?.label ?? language;
  const activeFilterChips = [
    ...(hasQuery
      ? [
          {
            label: `"${query}"`,
            ariaLabel: `Remove search query ${query}`,
            href: buildSearchHref({
              query: "",
              setFilter,
              language,
              sort,
              page: 1,
            }),
          },
        ]
      : []),
    ...(setFilter
      ? [
          {
            label: setLabel,
            ariaLabel: `Remove set filter ${setLabel}`,
            href: buildSearchHref({
              query,
              setFilter: "",
              language,
              sort,
              page: 1,
            }),
          },
        ]
      : []),
    ...(language !== "all"
      ? [
          {
            label: languageLabel,
            ariaLabel: `Remove language filter ${languageLabel}`,
            href: buildSearchHref({
              query,
              setFilter,
              language: "all",
              sort,
              page: 1,
            }),
          },
        ]
      : []),
    ...(sort !== DEFAULT_SEARCH_SORT
      ? [
          {
            label: SORT_LABELS[sort],
            ariaLabel: `Remove sort ${SORT_LABELS[sort]}`,
            href: buildSearchHref({
              query,
              setFilter,
              language,
              sort: DEFAULT_SEARCH_SORT,
              page: 1,
            }),
          },
        ]
      : []),
  ];

  return (
    <>
      <SearchResultsCacheWarmer
        cacheKey={cacheKey}
        response={searchResponse}
        query={query}
        setFilter={setFilter}
        page={page}
        language={language}
        sort={sort}
      />
      <SearchResults
        activeFilterChips={activeFilterChips}
        clearHref="/search"
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
    </>
  );
}

export function parseSearchPageParams(params: {
  q?: string;
  set?: string;
  page?: string;
  lang?: string;
  sort?: string;
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

  return {
    query,
    setFilter,
    page: Number.isNaN(page) ? 1 : page,
    language,
    sort,
  };
}
