"use client";

import {
  getBootHotSearchForRequest,
  getCachedClientSearch,
  makeClientSearchCacheKey,
} from "@/lib/client-catalog-cache";
import { applyEditionFilterToSearchResponse } from "@/lib/card-finish";
import { DEFAULT_EDITION_FILTER, formatResultCount } from "@/lib/search-constants";
import { shouldCommitStaticDexLanding } from "@/lib/search-landing-fallback";
import { isLiveTrendingMatchReason } from "@/lib/trending";
import {
  isPriceSort,
  searchResultsHaveDisplayablePrices,
} from "@/lib/search-price-sort";
import type {
  CardEditionFilter,
  CardLanguageFilter,
  LiveSearchResponse,
  SearchSortOption,
} from "@/types/pokemon";

import { SearchResultsLiveRefresh } from "@/components/search/search-results-live-refresh";
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
  const pinStaticLanding =
    shouldCommitStaticDexLanding({ query, setFilter, page, sort }) && instantResponse;
  const cachedCandidate =
    getCachedClientSearch(cacheKey) ??
    (unfilteredKey ? getCachedClientSearch(unfilteredKey) : null) ??
    getBootHotSearchForRequest({
      query,
      setFilter,
      page,
      language,
      sort,
    });
  const cachedHasLiveMomentum = cachedCandidate?.results.some((result) =>
    isLiveTrendingMatchReason(result.matchReason),
  );
  const cachedRaw = pinStaticLanding && !cachedHasLiveMomentum
    ? instantResponse
    : cachedCandidate ?? instantResponse;
  const cached = cachedRaw
    ? applyEditionFilterToSearchResponse(cachedRaw, edition)
    : null;
  const waitForPricedPayload =
    Boolean(cached?.results.length) &&
    isPriceSort(sort) &&
    !searchResultsHaveDisplayablePrices(cached?.results ?? []);

  if (!cached || (setFilter && !cached.results.length) || waitForPricedPayload) {
    return (
      <SearchResultsPaint>
        <SearchResultsSkeleton />
      </SearchResultsPaint>
    );
  }

  const hasQuery = query.trim().length > 0;
  const isSetBrowse = Boolean(setFilter && !hasQuery);
  const setLabel = setFilter ? setFilter.toUpperCase() : "";
  const resultHeading = hasQuery ? "Results" : isSetBrowse ? setLabel : "Trending";
  const resultSummary =
    typeof cached.totalCount === "number"
      ? formatResultCount(cached.totalCount)
      : "";

  return (
    <SearchResultsPaint>
      <SearchResultsLiveRefresh
        key={cacheKey}
        initialResponse={cached}
        heading={resultHeading}
        query={query}
        setFilter={setFilter}
        page={page}
        language={language}
        sort={sort}
        edition={edition}
        summary={resultSummary}
      />
    </SearchResultsPaint>
  );
}
