import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

export function makeSearchCacheKey({
  query = "",
  setFilter = "",
  page = 1,
  language = "all",
  sort = DEFAULT_SEARCH_SORT,
}: {
  query?: string;
  setFilter?: string;
  page?: number;
  language?: CardLanguageFilter;
  sort?: SearchSortOption;
}) {
  return [
    query.trim().toLowerCase(),
    setFilter.trim().toLowerCase(),
    page,
    language,
    sort,
  ].join("|");
}

export function buildSearchHref({
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
