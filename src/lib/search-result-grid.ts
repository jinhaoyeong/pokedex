/**
 * No gutters: the results grid separates cells with hairlines instead, so a
 * gap here would double the seam. See .search-result-grid in dex-results.css.
 */
export const SEARCH_RESULT_GRID_CLASS =
  "search-result-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/** First two desktop rows (6-col) so above-the-fold art is not `loading=lazy`. */
export const SEARCH_RESULT_EAGER_IMAGE_COUNT = 12;
