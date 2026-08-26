import type { PriceProvider, PriceQuery, ProviderPriceResult } from "../types";
import { EUR_TO_USD, fetchJsonWithTimeout, nowIso, providerCardId } from "./shared";
import { catalogProviderCardId, isFirstEditionFinish, parseCardFinishId, selectFinishMarketUsd } from "@/lib/card-finish";

/**
 * PokemonTCG API (pokemontcg.io) — free (optional key for higher quota), never
 * IP-blocks. Strong English coverage via TCGplayer + Cardmarket. Mostly useful
 * for English cards; localized ids rarely match, so it simply returns null then.
 */

const API_BASE_URL = "https://api.pokemontcg.io/v2";

type PokemonTcgPriceBucket = { market?: number | null; mid?: number | null; low?: number | null };

type PokemonTcgCard = {
  tcgplayer?: { prices?: Record<string, PokemonTcgPriceBucket | null> | null } | null;
  cardmarket?: {
    prices?: { trendPrice?: number | null; averageSellPrice?: number | null; avg7?: number | null } | null;
  } | null;
};

type PokemonTcgResponse = { data?: PokemonTcgCard[] | null };

function bestUsd(card: PokemonTcgCard | undefined, finish?: string): number {
  const buckets = card?.tcgplayer?.prices ?? {};
  const finishId = parseCardFinishId(finish);
  const finishUsd = selectFinishMarketUsd(buckets, finishId);
  if (finishUsd > 0) {
    return finishUsd;
  }

  if (isFirstEditionFinish(finishId)) {
    return 0;
  }

  const cm = card?.cardmarket?.prices;
  const cardmarketEur = cm?.trendPrice ?? cm?.avg7 ?? cm?.averageSellPrice ?? 0;
  if (cardmarketEur && cardmarketEur > 0) {
    return cardmarketEur * EUR_TO_USD;
  }

  return 0;
}

export const pokemonTcgProvider: PriceProvider = {
  id: "pokemontcg",
  label: "PokemonTCG catalog",
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

    const apiKey = process.env.POKEMONTCG_API_KEY?.trim();
    const response = await fetchJsonWithTimeout<PokemonTcgResponse>(
      `${API_BASE_URL}/cards?q=${encodeURIComponent(`id:${id}`)}&pageSize=1`,
      { signal, timeoutMs: 8_000, headers: apiKey ? { "X-Api-Key": apiKey } : undefined },
    );

    const card = response?.data?.[0];
    const ungradedUsd = bestUsd(card, query.finish);
    if (!(ungradedUsd > 0)) {
      return null;
    }

    return {
      provider: this.id,
      sourceLabel: "PokemonTCG catalog market",
      ungradedUsd: Math.round(ungradedUsd * 100) / 100,
      confidenceScore: query.language === "en" ? 0.64 : 0.34,
      matchConfidence: 1,
      evidenceType: "catalog",
      fetchedAt: nowIso(),
    };
  },
};
