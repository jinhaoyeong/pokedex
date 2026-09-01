import { DEFAULT_SEARCH_SORT } from "@/lib/search-constants";
import type { SearchSortOption } from "@/types/pokemon";

export const SEARCH_UNAVAILABLE_NOTICE =
  "Search is temporarily unavailable. Please try again.";

export function isEmptyLandingSearch(
  query: string,
  setFilter?: string,
  page = 1,
) {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  return !query.trim() && !setFilter?.trim() && normalizedPage <= 1;
}

export function isSearchUnavailableNotice(notice?: string) {
  return notice === SEARCH_UNAVAILABLE_NOTICE;
}

export function shouldReplaceWithStaticTrending({
  query,
  setFilter,
  page = 1,
  resultsLength,
  notice,
}: {
  query: string;
  setFilter?: string;
  page?: number;
  resultsLength: number;
  notice?: string;
}) {
  if (!isEmptyLandingSearch(query, setFilter, page)) {
    return false;
  }

  return resultsLength === 0 || isSearchUnavailableNotice(notice);
}

/**
 * Empty Dex (`/search` with no query, set, or sort) must keep the bundled
 * trending list. Live/boot price-desc payloads are a different catalog and
 * must not replace the first paint.
 */
export function shouldCommitStaticDexLanding({
  query,
  setFilter,
  page = 1,
  sort,
}: {
  query: string;
  setFilter?: string;
  page?: number;
  sort?: SearchSortOption | string | null;
}) {
  if (!isEmptyLandingSearch(query, setFilter, page)) {
    return false;
  }

  return !sort || sort === DEFAULT_SEARCH_SORT;
}

export function shouldApplyStoredSearchDefaults({
  query,
  setFilter,
}: {
  query: string;
  setFilter?: string;
}) {
  return Boolean(query.trim() || setFilter?.trim());
}

export function shouldUseBootHotSearchForRequest({
  query,
  setFilter,
  page = 1,
  sort,
}: {
  query: string;
  setFilter?: string;
  page?: number;
  sort?: SearchSortOption | string | null;
}) {
  return isEmptyLandingSearch(query, setFilter, page) && sort === "price-desc";
}
