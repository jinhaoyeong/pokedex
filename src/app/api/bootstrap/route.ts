import { NextResponse } from "next/server";

import { getFeaturedCards } from "@/lib/cards";
import { getLivePreviewCards, MARKET_PICKS_LIMIT } from "@/lib/preview-cards";
import { fetchSearchSets, searchLiveCards } from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter, LiveSearchResponse, TcgCard, TcgSet } from "@/types/pokemon";

export const runtime = "nodejs";
export const revalidate = 1800;
export const maxDuration = 30;

const BOOT_SERVER_BUDGET_MS = 5_500;
const HOT_SEARCH_LIMIT = 24;
const PREVIEW_LIMIT = MARKET_PICKS_LIMIT;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function settleBeforeBudget<T>(
  promise: Promise<T>,
  startedAt: number,
): Promise<T | null> {
  const remaining = BOOT_SERVER_BUDGET_MS - (Date.now() - startedAt);

  if (remaining <= 0) {
    return null;
  }

  return Promise.race([
    promise.catch(() => null),
    delay(remaining).then(() => null),
  ]);
}

function trimHotSearch(response: LiveSearchResponse | null): LiveSearchResponse | null {
  if (!response) {
    return null;
  }

  return {
    ...response,
    results: response.results.slice(0, HOT_SEARCH_LIMIT),
  };
}

export async function GET() {
  const startedAt = Date.now();
  const fallbackCards = getFeaturedCards(PREVIEW_LIMIT);

  const [
    setsAll,
    setsEn,
    setsJa,
    previewCards,
    hotAll,
    hotEn,
    hotJa,
  ] = await Promise.all([
    settleBeforeBudget(fetchSearchSets("all"), startedAt),
    settleBeforeBudget(fetchSearchSets("en"), startedAt),
    settleBeforeBudget(fetchSearchSets("ja"), startedAt),
    settleBeforeBudget(getLivePreviewCards(PREVIEW_LIMIT), startedAt),
    settleBeforeBudget(
      searchLiveCards("", undefined, 1, "all", "price-desc"),
      startedAt,
    ),
    settleBeforeBudget(
      searchLiveCards("", undefined, 1, "en", "price-desc"),
      startedAt,
    ),
    settleBeforeBudget(
      searchLiveCards("", undefined, 1, "ja", "price-desc"),
      startedAt,
    ),
  ]);

  const resolvedPreview =
    previewCards && previewCards.length ? previewCards : fallbackCards;

  const setsByLanguage: Partial<Record<CardLanguageFilter, TcgSet[]>> = {};

  if (setsAll?.length) {
    setsByLanguage.all = setsAll;
  }

  if (setsEn?.length) {
    setsByLanguage.en = setsEn;
  }

  if (setsJa?.length) {
    setsByLanguage.ja = setsJa;
  }

  const hotSearchByLanguage: Partial<Record<CardLanguageFilter, LiveSearchResponse>> = {};
  const trimmedHotAll = trimHotSearch(hotAll);
  const trimmedHotEn = trimHotSearch(hotEn);
  const trimmedHotJa = trimHotSearch(hotJa);

  if (trimmedHotAll) {
    hotSearchByLanguage.all = trimmedHotAll;
  }

  if (trimmedHotEn) {
    hotSearchByLanguage.en = trimmedHotEn;
  }

  if (trimmedHotJa) {
    hotSearchByLanguage.ja = trimmedHotJa;
  }

  const cardSlugs = [
    ...new Set(
      [
        ...resolvedPreview.map((card) => card.slug),
        ...(trimmedHotAll?.results ?? []).map((result) => result.card.slug),
        ...(trimmedHotEn?.results ?? []).map((result) => result.card.slug),
        ...(trimmedHotJa?.results ?? []).map((result) => result.card.slug),
      ].filter(Boolean),
    ),
  ].slice(0, 24);

  const stats = {
    setCount: setsAll?.length ?? 0,
    previewCount: resolvedPreview.length,
    hotCardCount:
      (trimmedHotAll?.results.length ?? 0) +
      (trimmedHotEn?.results.length ?? 0) +
      (trimmedHotJa?.results.length ?? 0),
    loadMs: Date.now() - startedAt,
  };

  return NextResponse.json(
    {
      setsByLanguage,
      previewCards: resolvedPreview as TcgCard[],
      hotSearchByLanguage,
      cardSlugs,
      stats,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
