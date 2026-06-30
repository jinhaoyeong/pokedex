import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";
import { fetchJsonWithTimeout, median, nowIso } from "./shared";

/**
 * eBay Browse API — official, OAuth-token, never IP-blocks. Free developer
 * signup (EBAY_APP_ID + EBAY_CERT_ID). Returns the median of ACTIVE listing
 * asking prices as a price signal.
 *
 * NOTE: the free Browse API exposes ACTIVE listings (asking prices), not SOLD
 * comps. True realized-sale data needs eBay's gated Marketplace Insights API —
 * tracked as a follow-up. No-ops (returns null) when credentials are absent.
 */

const EBAY_OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope";
// Pokemon single trading cards.
const EBAY_CARD_CATEGORY = "183454";

let cachedToken: { token: string; expiresAt: number } | null = null;

function isConfigured() {
  return Boolean(process.env.EBAY_APP_ID?.trim() && process.env.EBAY_CERT_ID?.trim());
}

async function getAppToken(signal?: AbortSignal): Promise<string | null> {
  const appId = process.env.EBAY_APP_ID?.trim();
  const certId = process.env.EBAY_CERT_ID?.trim();
  if (!appId || !certId) {
    return null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  try {
    const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
    const response = await fetch(EBAY_OAUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_SCOPE)}`,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      return null;
    }
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
    return cachedToken.token;
  } catch {
    return null;
  }
}

type EbaySearchResponse = {
  itemSummaries?: Array<{ price?: { value?: string; currency?: string } }>;
};

export const ebayProvider: PriceProvider = {
  id: "ebay",
  label: "eBay listings",
  scrapes: false,
  isConfigured,
  async fetchPrice(query: PriceQuery, signal?: AbortSignal): Promise<ProviderPriceResult | null> {
    const token = await getAppToken(signal);
    if (!token) {
      return null;
    }

    const name = query.englishName?.trim() || query.name.trim();
    const setName = query.setEnglishName?.trim() || query.setName?.trim() || "";
    const number = query.collectorNumber?.trim() ?? "";
    const q = [name, setName, number].filter(Boolean).join(" ");
    if (!q) {
      return null;
    }

    const url =
      `${EBAY_BROWSE_URL}?q=${encodeURIComponent(q)}` +
      `&category_ids=${EBAY_CARD_CATEGORY}` +
      `&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE}")}` +
      `&limit=50`;

    const data = await fetchJsonWithTimeout<EbaySearchResponse>(url, {
      signal,
      timeoutMs: 9_000,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    const prices = (data?.itemSummaries ?? [])
      .map((item) => Number.parseFloat(item.price?.value ?? ""))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (prices.length < 3) {
      return null;
    }

    const ungradedUsd = median(prices);
    if (!(ungradedUsd > 0)) {
      return null;
    }

    return {
      provider: this.id,
      sourceLabel: "eBay active listings",
      ungradedUsd: Math.round(ungradedUsd * 100) / 100,
      // Asking prices, not sold — a softer signal than guide/sold sources.
      confidenceScore: 0.45,
      evidenceType: "guide_snapshot",
      sampleCount: prices.length,
      fetchedAt: nowIso(),
    };
  },
};
