/**
 * Card-detail market gather budgets.
 *
 * The Dex redesign cut these to 3.8–5s to make the page feel faster. PriceCharting
 * HTML (and the Jina 403 fallback) needs ~8–12s, Magery sold-comp pages ~18s, and
 * the route already allows 60s. The short caps aborted those scrapes, so the
 * panel showed API BLOCKED / TIMED OUT while the chart kept a leftover snapshot.
 */

/** Magery public sold-comp pages routinely need more than 10s. */
export const MAGERY_SOLD_COMP_BUDGET_MS = 18_000;
/** PriceCharting product HTML, including Jina reader fallback after Cloudflare 403. */
export const PRICECHARTING_HTML_BUDGET_MS = 12_000;

/** Core gather: PriceCharting guide + population, no Magery. */
export const CORE_SOURCE_BUDGET_MS = PRICECHARTING_HTML_BUDGET_MS + 4_000;
/** Full gather: PriceCharting in parallel with Magery sold comps. */
export const FULL_SOURCE_BUDGET_MS = MAGERY_SOLD_COMP_BUDGET_MS + 4_000;
export const SOLD_COMP_SOURCE_BUDGET_MS = MAGERY_SOLD_COMP_BUDGET_MS;
export const POPULATION_SOURCE_BUDGET_MS = PRICECHARTING_HTML_BUDGET_MS;

/** `/api/grading-market` wrapper around the gather (must exceed inner source budgets). */
export const LOCALIZED_CORE_GRADING_BUDGET_MS = CORE_SOURCE_BUDGET_MS + 8_000;
export const ENGLISH_CORE_GRADING_BUDGET_MS = CORE_SOURCE_BUDGET_MS + 8_000;
/**
 * Outer full-mode cap. 6s of padding over the 22s inner gather was not enough:
 * PriceCharting HTML (12s) plus Magery (18s) plus cache/identity overhead ran
 * past 28s, and the route discarded the in-flight scrape as a blank timeout.
 * Stay under the route `maxDuration` of 60s.
 */
export const FULL_GRADING_BUDGET_MS = 50_000;

/** Browser abort must outlive the serverless gather so Magery is not cancelled first. */
export const LIVE_MARKET_CLIENT_TIMEOUT_MS = FULL_GRADING_BUDGET_MS + 8_000;
