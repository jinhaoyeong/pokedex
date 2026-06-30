import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";
import { fetchJsonWithTimeout, nowIso } from "./shared";

/**
 * Official PriceCharting API (token-based JSON). This is the SUPPORTED endpoint —
 * unlike scraping the HTML guide pages it is not anti-bot-walled, so it never
 * IP-blocks. Highest-accuracy ungraded guide price. Paid: needs
 * PRICECHARTING_API_TOKEN. No-ops (returns null) when the token is absent.
 *
 * Docs: https://www.pricecharting.com/api-documentation — prices are integer cents.
 */

const PRICECHARTING_API_BASE_URL = "https://www.pricecharting.com/api";

type PriceChartingProduct = {
  status?: string;
  "product-name"?: string;
  "console-name"?: string;
  /** Ungraded, in pennies. */
  "loose-price"?: number;
};

function isConfigured() {
  return Boolean(process.env.PRICECHARTING_API_TOKEN?.trim());
}

export const priceChartingApiProvider: PriceProvider = {
  id: "pricecharting-api",
  label: "PriceCharting API",
  scrapes: false,
  isConfigured,
  async fetchPrice(query: PriceQuery, signal?: AbortSignal): Promise<ProviderPriceResult | null> {
    const token = process.env.PRICECHARTING_API_TOKEN?.trim();
    if (!token) {
      return null;
    }

    // Search by the English identity PriceCharting indexes under.
    const name = query.englishName?.trim() || query.name.trim();
    const setName = query.setEnglishName?.trim() || query.setName?.trim() || "";
    const number = query.collectorNumber?.trim() ? `#${query.collectorNumber.trim()}` : "";
    const q = [setName, name, number].filter(Boolean).join(" ");
    if (!q) {
      return null;
    }

    const product = await fetchJsonWithTimeout<PriceChartingProduct>(
      `${PRICECHARTING_API_BASE_URL}/product?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`,
      { signal, timeoutMs: 8_000 },
    );

    if (!product || product.status === "error") {
      return null;
    }

    const loosePennies = product["loose-price"] ?? 0;
    const ungradedUsd = loosePennies > 0 ? loosePennies / 100 : 0;
    if (!(ungradedUsd > 0)) {
      return null;
    }

    return {
      provider: this.id,
      sourceLabel: "PriceCharting public guide",
      ungradedUsd: Math.round(ungradedUsd * 100) / 100,
      confidenceScore: 0.62,
      evidenceType: "guide_snapshot",
      fetchedAt: nowIso(),
    };
  },
};
