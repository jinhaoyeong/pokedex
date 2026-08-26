import { catalogProviderCardId, isFirstEditionFinish, parseCardFinishId } from "@/lib/card-finish";
import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";
import { EUR_TO_USD, fetchJsonWithTimeout, nowIso, providerCardId } from "./shared";

/**
 * TCGdex — free, no-key, never IP-blocks. Best multilingual catalog coverage
 * (Cardmarket EUR + TCGplayer USD). Quality varies per card, so confidence is
 * modest; it serves as the always-on baseline that keeps a price on every card.
 */

const TCGDEX_API_BASE_URL = "https://api.tcgdex.net/v2";

type TcgdexPricing = {
  cardmarket?: {
    trend?: number | null;
    avg?: number | null;
    avg7?: number | null;
    avg30?: number | null;
    low?: number | null;
  } | null;
  tcgplayer?: {
    market?: number | null;
    mid?: number | null;
    low?: number | null;
    holofoil?: { market?: number | null; mid?: number | null } | null;
    "reverse-holofoil"?: { market?: number | null; mid?: number | null } | null;
  } | null;
};

type TcgdexCard = { name?: string; pricing?: TcgdexPricing | null };

function tcgdexLanguage(language: string): string {
  const lang = language.toLowerCase();
  if (lang === "zh-tw" || lang === "zh-cn" || lang.startsWith("zh")) {
    return "zh-tw";
  }
  // TCGdex supports en, fr, de, es, it, pt, ja, ko, id, th, ...
  return lang || "en";
}

function bestUsd(pricing: TcgdexPricing | null | undefined): number {
  if (!pricing) {
    return 0;
  }

  const tp = pricing.tcgplayer;
  const tcgplayerUsd =
    tp?.market ??
    tp?.holofoil?.market ??
    tp?.["reverse-holofoil"]?.market ??
    tp?.mid ??
    tp?.holofoil?.mid ??
    0;
  if (tcgplayerUsd && tcgplayerUsd > 0) {
    return tcgplayerUsd;
  }

  const cm = pricing.cardmarket;
  const cardmarketEur = cm?.trend ?? cm?.avg7 ?? cm?.avg ?? cm?.avg30 ?? 0;
  if (cardmarketEur && cardmarketEur > 0) {
    return cardmarketEur * EUR_TO_USD;
  }

  return 0;
}

export const tcgdexProvider: PriceProvider = {
  id: "tcgdex",
  label: "TCGdex catalog",
  scrapes: false,
  isConfigured() {
    return true;
  },
  async fetchPrice(query: PriceQuery, signal?: AbortSignal): Promise<ProviderPriceResult | null> {
    const id =
      catalogProviderCardId(query.cardId) || providerCardId(query.setCode, query.collectorNumber);
    if (!id) {
      return null;
    }

    if (isFirstEditionFinish(parseCardFinishId(query.finish))) {
      return null;
    }

    const lang = tcgdexLanguage(query.language);
    const card = await fetchJsonWithTimeout<TcgdexCard>(
      `${TCGDEX_API_BASE_URL}/${lang}/cards/${encodeURIComponent(id)}`,
      { signal, timeoutMs: 8_000 },
    );

    const ungradedUsd = bestUsd(card?.pricing);
    if (!(ungradedUsd > 0)) {
      return null;
    }

    return {
      provider: this.id,
      sourceLabel: query.language === "en" ? "TCGdex catalog" : "TCGdex Japanese catalog",
      ungradedUsd: Math.round(ungradedUsd * 100) / 100,
      // Catalog feed: useful baseline, but localized listings are often mismatched.
      confidenceScore: query.language === "en" ? 0.5 : 0.34,
      // Exact id match — but the underlying CardMarket listing can still be wrong,
      // which the resolver's cross-validation/outlier check handles separately.
      matchConfidence: 1,
      evidenceType: "catalog",
      fetchedAt: nowIso(),
    };
  },
};
