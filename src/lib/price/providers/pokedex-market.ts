import { lookupPokedexMarketGuide } from "@/lib/market/pokedex-market-guide";
import { hasPricedMarketPayload } from "../priced-payload";
import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";

/**
 * Seeded first-party guide for search/list price resolve. Live binder/vault
 * observations are merged on the Grade Values path (`lookupPokedexMarketGuideLive`)
 * so Dex browse does not wait on Postgres for every card.
 */
export const pokedexMarketProvider: PriceProvider = {
  id: "pokedex-market",
  label: "PokePokedex market",
  scrapes: false,
  isConfigured() {
    return true;
  },
  async fetchPrice(query: PriceQuery): Promise<ProviderPriceResult | null> {
    const market = lookupPokedexMarketGuide(query);
    if (!market || !hasPricedMarketPayload(market)) {
      return null;
    }
    return market;
  },
};
