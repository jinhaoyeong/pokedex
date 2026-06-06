import type { Metadata } from "next";

import { SearchForm } from "@/components/search/search-form";
import { SearchResults } from "@/components/search/search-results";
import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  searchLiveCards,
} from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

export const metadata: Metadata = {
  title: "Search",
};

const SEARCH_SORT_OPTIONS: SearchSortOption[] = [
  "relevance",
  "price-desc",
  "price-asc",
  "change-desc",
  "change-asc",
  "number-desc",
  "number-asc",
];

function isSearchSortOption(value: string): value is SearchSortOption {
  return SEARCH_SORT_OPTIONS.includes(value as SearchSortOption);
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    set?: string;
    page?: string;
    lang?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const query = params.q ?? "";
  const setFilter = params.set ?? "";
  const page = Number.parseInt(params.page ?? "1", 10);
  const requestedLanguage = params.lang ?? "all";
  const language = CARD_LANGUAGE_FILTERS.some(
    (item) => item.code === requestedLanguage,
  )
    ? (requestedLanguage as CardLanguageFilter)
    : "all";
  const requestedSort = params.sort ?? DEFAULT_SEARCH_SORT;
  const sort = isSearchSortOption(requestedSort)
    ? requestedSort
    : DEFAULT_SEARCH_SORT;
  const searchResponse = await searchLiveCards(
    query,
    setFilter,
    Number.isNaN(page) ? 1 : page,
    language,
    sort,
  );
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
    ? "This set is loaded, but the public catalog has not exposed usable market prices for these cards yet. The app keeps the cards visible and will show prices automatically once catalog or sold-comp data appears."
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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-2.5 py-3 sm:gap-10 sm:px-10 sm:py-10 lg:px-12">
      <section className="search-hero relative overflow-hidden rounded-[1.5rem] border border-yellow-200/20 bg-gradient-to-br from-[#142d64] via-[#0b1022] to-[#1d1026] p-3 sm:rounded-[2rem] sm:p-8">
        <div className="pixel-cloud left-5 top-7" aria-hidden="true" />
        <div className="pixel-cloud pixel-cloud-small bottom-8 right-12" aria-hidden="true" />
        <div className="absolute -right-12 -top-12 hidden h-32 w-32 rounded-full border-[14px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:block sm:-right-10 sm:-top-10 sm:h-36 sm:w-36 sm:border-[18px] sm:opacity-35" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-center">
          <div className="space-y-3 sm:space-y-4">
            <span className="premium-kicker">
              Card Dex scanner
            </span>
            <h1 className="section-title max-w-4xl text-[1.65rem] sm:text-6xl">
              Find cards by name, set, or number.
            </h1>
            <p className="section-copy max-w-3xl text-sm leading-6 sm:text-base sm:leading-7">
              Search across English, Japanese, Chinese, Korean, and more. Collector numbers like
              100/095 work too.
            </p>
          </div>
          <div className="search-scanner-card hidden justify-self-end lg:block" aria-hidden="true">
            <div className="scanner-card-frame">
              <div className="scanner-card-top">
                <span>DEX-01</span>
                <strong>Scan Ready</strong>
              </div>
              <div className="scanner-card-screen">
                <span className="scanner-line" />
                <span className="scanner-card-shape" />
                <span className="scanner-code code-a" />
                <span className="scanner-code code-b" />
                <span className="scanner-code code-c" />
              </div>
              <div className="scanner-card-footer">
                <span>Set</span>
                <span>Lang</span>
                <span>No.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SearchForm
        key={`${language}:${setFilter}:${query}:${sort}`}
        initialLanguage={language}
        initialQuery={query}
        initialSetFilter={setFilter}
        initialSort={sort}
        languageOptions={CARD_LANGUAGE_FILTERS}
        resultPage={searchResponse.page}
        totalPages={totalPages}
      />

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
        <section className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/4 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-5">
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
    </main>
  );
}
