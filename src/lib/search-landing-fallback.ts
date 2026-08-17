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
