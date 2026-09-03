/**
 * Default-on guard for the grading/value path. Catalog identity and raw prices
 * may still come from the app's existing catalog providers, but slab estimates,
 * population, and calibration stay on data collected by PokePokedex itself.
 */
export function firstPartyMarketOnly() {
  return process.env.FIRST_PARTY_MARKET_ONLY?.trim().toLowerCase() !== "false";
}
