import type { SaleRecord } from "@/types/pokemon";

import { isSolidMatch, median, scoreCardMatch, type MatchQuery } from "../match";
import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";
import { nowIso } from "./shared";

/**
 * eBay — official OAuth Browse / Marketplace Insights APIs. Never HTML scrape.
 * Free developer signup (EBAY_APP_ID + EBAY_CERT_ID).
 *
 * Headline price uses Marketplace Insights sold comps only. Active fixed-price
 * asks are a separate lookup for estimate validation / "For sale now" and must
 * not win provider selection.
 */

const EBAY_OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_INSIGHTS_URL =
  "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
const EBAY_CARD_CATEGORY = "183454";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function isEbayConfigured() {
  return Boolean(process.env.EBAY_APP_ID?.trim() && process.env.EBAY_CERT_ID?.trim());
}

async function getAppToken(scope: string, signal?: AbortSignal): Promise<string | null> {
  const appId = process.env.EBAY_APP_ID?.trim();
  const certId = process.env.EBAY_CERT_ID?.trim();
  if (!appId || !certId) {
    return null;
  }

  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  try {
    const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
    const response = await fetch(EBAY_OAUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      return null;
    }
    tokenCache.set(scope, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    });
    return data.access_token;
  } catch {
    return null;
  }
}

export function buildEbayQuery(query: PriceQuery): { q: string; match: MatchQuery } {
  const name = query.englishName?.trim() || query.name.trim();
  const setName = query.setEnglishName?.trim() || query.setName?.trim() || "";
  const number = query.collectorNumber?.trim() ?? "";
  const japanese = query.language && query.language !== "en" ? "japanese" : "";
  const q = [name, setName, number, japanese].filter(Boolean).join(" ");
  return {
    q,
    match: {
      name: query.name,
      englishName: query.englishName,
      collectorNumber: query.collectorNumber,
      setName: query.setName,
      setEnglishName: query.setEnglishName,
      language: query.language,
    },
  };
}

type SoldMatch = { price: number; score: number; sale: SaleRecord };

async function fetchSold(
  q: string,
  match: MatchQuery,
  signal?: AbortSignal,
): Promise<SoldMatch[]> {
  const token = await getAppToken(`${BASE_SCOPE} ${INSIGHTS_SCOPE}`, signal);
  if (!token) {
    return [];
  }

  try {
    const url =
      `${EBAY_INSIGHTS_URL}?q=${encodeURIComponent(q)}` +
      `&category_ids=${EBAY_CARD_CATEGORY}&limit=50`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(9_000)]) : AbortSignal.timeout(9_000),
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as {
      itemSales?: Array<{
        title?: string;
        lastSoldPrice?: { value?: string };
        lastSoldDate?: string;
        itemWebUrl?: string;
      }>;
    };

    return (data.itemSales ?? []).flatMap((item) => {
      const price = Number.parseFloat(item.lastSoldPrice?.value ?? "");
      const title = item.title ?? "";
      const score = scoreCardMatch(match, title);
      if (!(price > 0) || !isSolidMatch(match, title)) {
        return [];
      }
      return [
        {
          price,
          score,
          sale: {
            date: item.lastSoldDate ?? nowIso(),
            title,
            condition: "Ungraded",
            price,
            source: "eBay sold (Marketplace Insights)",
            listingUrl: item.itemWebUrl,
            evidenceType: "sold_comp",
          },
        },
      ];
    });
  } catch {
    return [];
  }
}

export type EbayBrowseItem = {
  title: string;
  priceUsd: number;
  listingUrl?: string;
  score: number;
};

export async function searchEbayBrowseListings(
  q: string,
  signal?: AbortSignal,
): Promise<EbayBrowseItem[]> {
  const token = await getAppToken(BASE_SCOPE, signal);
  if (!token || !q.trim()) {
    return [];
  }

  try {
    const url =
      `${EBAY_BROWSE_URL}?q=${encodeURIComponent(q)}` +
      `&category_ids=${EBAY_CARD_CATEGORY}` +
      `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE}")}&limit=50`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(9_000)]) : AbortSignal.timeout(9_000),
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as {
      itemSummaries?: Array<{
        title?: string;
        price?: { value?: string };
        itemWebUrl?: string;
      }>;
    };

    return (data.itemSummaries ?? []).flatMap((item) => {
      const priceUsd = Number.parseFloat(item.price?.value ?? "");
      const title = item.title ?? "";
      if (!(priceUsd > 0) || !title) {
        return [];
      }
      return [{ title, priceUsd, listingUrl: item.itemWebUrl, score: 0 }];
    });
  } catch {
    return [];
  }
}

export const ebayProvider: PriceProvider = {
  id: "ebay",
  label: "eBay",
  scrapes: false,
  isConfigured: isEbayConfigured,
  async fetchPrice(query: PriceQuery, signal?: AbortSignal): Promise<ProviderPriceResult | null> {
    if (!isEbayConfigured()) {
      return null;
    }
    const { q, match } = buildEbayQuery(query);
    if (!q) {
      return null;
    }

    const sold = await fetchSold(q, match, signal);
    if (sold.length >= 2) {
      const prices = sold.map((entry) => entry.price);
      return {
        provider: this.id,
        sourceLabel: "eBay last sold",
        ungradedUsd: Math.round(median(prices) * 100) / 100,
        confidenceScore: 0.8,
        matchConfidence: median(sold.map((entry) => entry.score)),
        evidenceType: "sold_comp",
        sampleCount: sold.length,
        sales: sold.slice(0, 8).map((entry) => entry.sale),
        fetchedAt: nowIso(),
      };
    }

    return null;
  },
};
