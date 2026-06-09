import { SearchResults } from "@/components/search/search-results";
import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  searchLiveCards,
} from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

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
}: {
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
}) {
  const searchResponse = await searchLiveCards(query, setFilter, page, language, sort);
  const totalPages =
    typeof searchResponse.totalCount === "number"
      ? Math.max(1, Math.ceil(searchResponse.totalCount / searchResponse.pageSize))
      : null;
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

  const buildSearchHref = (nextPage: number) => {
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

    if (nextPage > 1) {
      nextParams.set("page", nextPage.toString());
    }

    const queryString = nextParams.toString();
    return queryString ? `/search?${queryString}` : "/search";
  };

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
              href={buildSearchHref(searchResponse.page - 1)}
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
              href={buildSearchHref(searchResponse.page + 1)}
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
