import { DEFAULT_EDITION_FILTER, DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import type { CardEditionFilter, CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

export function makeSearchCacheKey({
  query = "",
  setFilter = "",
  page = 1,
  language = "all",
  sort = DEFAULT_SEARCH_SORT,
  edition = DEFAULT_EDITION_FILTER,
}: {
  query?: string;
  setFilter?: string;
  page?: number;
  language?: CardLanguageFilter;
  sort?: SearchSortOption;
  edition?: CardEditionFilter;
}) {
  return [
    query.trim().toLowerCase(),
    setFilter.trim().toLowerCase(),
    page,
    language,
    sort,
    edition,
  ].join("|");
}

export function buildLiveSearchApiParams({
  query = "",
  setFilter = "",
  page = 1,
  language = "all",
  sort = DEFAULT_SEARCH_SORT,
  edition = DEFAULT_EDITION_FILTER,
}: {
  query?: string;
  setFilter?: string;
  page?: number;
  language?: CardLanguageFilter;
  sort?: SearchSortOption;
  edition?: CardEditionFilter;
}) {
  const params = new URLSearchParams();
  const cleanQuery = query.trim();

  if (cleanQuery) {
    params.set("q", cleanQuery);
  }

  if (setFilter.trim()) {
    params.set("set", setFilter.trim());
  }

  if (language !== "all") {
    params.set("lang", language);
  }

  if (sort !== DEFAULT_SEARCH_SORT) {
    params.set("sort", sort);
  }

  if (edition !== DEFAULT_EDITION_FILTER) {
    params.set("edition", edition);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  return params;
}

export function buildSearchHref({
  query,
  setFilter,
  language,
  sort,
  page,
  edition = DEFAULT_EDITION_FILTER,
}: {
  query: string;
  setFilter: string;
  language: CardLanguageFilter;
  sort: SearchSortOption;
  page: number;
  edition?: CardEditionFilter;
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

  if (edition !== DEFAULT_EDITION_FILTER) {
    nextParams.set("edition", edition);
  }

  if (page > 1) {
    nextParams.set("page", page.toString());
  }

  const queryString = nextParams.toString();
  return queryString ? `/search?${queryString}` : "/search";
}
