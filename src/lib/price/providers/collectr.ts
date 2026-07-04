import { fetchCollectrFallbackPrice } from "@/lib/price/collectr-fallback";

import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";

export const collectrProvider: PriceProvider = {
  id: "collectr-fallback",
  label: "Collectr catalog",
  scrapes: false,
  isConfigured() {
    return process.env.COLLECTR_FALLBACK_ENABLED !== "false";
  },
  async fetchPrice(query: PriceQuery, signal?: AbortSignal): Promise<ProviderPriceResult | null> {
    return fetchCollectrFallbackPrice(query, signal);
  },
};
