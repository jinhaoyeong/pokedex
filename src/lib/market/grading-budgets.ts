/**
 * Card-detail market gather budgets.
 *
 * First paint (core) must return in 4.5s, hard-capped at 5s on the client.
 * Magery sold-comp pages (~18s) and a 12s PriceCharting HTML wait cannot finish
 * on that path. Core uses the shared PriceCharting set guide, cached population,
 * and one product page. After those rows paint, the client automatically starts
 * `mode=full` so extra grades, census, and sold comps can fill in. Expanding
 * sold comps still forces a full gather if one is not already running.
 */

/** First-paint gather for `/api/grading-market?mode=core` and SSR overlay. */
export const CARD_DETAIL_FIRST_PAINT_MS = 4_500;
/** Browser abort for the first grading-market request. */
export const CARD_DETAIL_FIRST_PAINT_CLIENT_MS = 5_000;

/** Magery public sold-comp pages routinely need more than 10s. */
export const MAGERY_SOLD_COMP_BUDGET_MS = 18_000;
/** PriceCharting product HTML, including Jina reader fallback after Cloudflare 403. */
export const PRICECHARTING_HTML_BUDGET_MS = 12_000;

/** Core gather: set-guide + product page, no Magery. */
export const CORE_SOURCE_BUDGET_MS = CARD_DETAIL_FIRST_PAINT_MS;
/** Full gather: PriceCharting in parallel with Magery sold comps. */
export const FULL_SOURCE_BUDGET_MS = MAGERY_SOLD_COMP_BUDGET_MS + 4_000;
export const SOLD_COMP_SOURCE_BUDGET_MS = MAGERY_SOLD_COMP_BUDGET_MS;
export const POPULATION_SOURCE_BUDGET_MS = PRICECHARTING_HTML_BUDGET_MS;

/** `/api/grading-market` wrapper around core (small padding over the inner gather). */
export const LOCALIZED_CORE_GRADING_BUDGET_MS = CARD_DETAIL_FIRST_PAINT_CLIENT_MS;
export const ENGLISH_CORE_GRADING_BUDGET_MS = CARD_DETAIL_FIRST_PAINT_CLIENT_MS;
/**
 * Outer full-mode cap. Stay under the route `maxDuration` of 60s.
 * Used when the user expands sold comps, not on first paint.
 */
export const FULL_GRADING_BUDGET_MS = 50_000;

/** Browser abort must outlive the serverless gather so Magery is not cancelled first. */
export const LIVE_MARKET_CLIENT_TIMEOUT_MS = FULL_GRADING_BUDGET_MS + 8_000;
