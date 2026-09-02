import { cache } from "react";

import { fetchLiveCardBySlug, searchLiveCards } from "@/lib/pokemon-tcg-api";
import {
  HERO_FAN_SIZE,
  HOME_LIVE_POOL_LIMIT,
  MARKET_PICKS_LIMIT,
  TODAYS_PICKS_LIMIT,
} from "@/lib/preview-constants";
import {
  isUsablePreviewCard,
  pushUniquePreviewCards,
  slimHomePreviewCard,
} from "@/lib/preview-selection";
import { getStaticMarketPool } from "@/lib/static-trending";
import { selectTodaysPicks } from "@/lib/todays-picks";
import { isLiveTrendingMatchReason } from "@/lib/trending";
import type { TcgCard } from "@/types/pokemon";

export { getStaticMarketPool, getStaticTrendingSearchResponse } from "@/lib/static-trending";

export { HERO_FAN_SIZE, MARKET_PICKS_LIMIT, TODAYS_PICKS_LIMIT } from "@/lib/preview-constants";
export { selectTodaysPicks, shuffleMarqueeCards } from "@/lib/todays-picks";

/** Fixed hero lineup: recognizable chase cards with stable layout order. */
const CURATED_PREVIEW_SLUGS = ["sv8pt5-179", "sv3pt5-183", "sv8pt5-60"];

const PREVIEW_SEARCH_FALLBACKS: Array<{ query: string; setFilter?: string }> = [
  { query: "pikachu ex", setFilter: "sv8pt5" },
  { query: "charizard ex", setFilter: "sv3pt5" },
  { query: "umbreon ex", setFilter: "sv8pt5" },
];

/** Upper bound on decorative market pools. */
const MARKET_POOL_TARGET = 80;
/** Don't hang the homepage waiting for the chase catalog. */
const TODAYS_PICKS_FETCH_MS = 1_800;

export type TodaysPicksResult = {
  cards: TcgCard[];
  source: "live" | "static";
};

export type HomeLivePreview = {
  pool: TcgCard[];
  hero: TcgCard[];
  picks: TcgCard[];
  source: "live" | "static";
};

/**
 * Optional live preview cards for bootstrap / warm paths.
 * Failures are swallowed — callers must tolerate an empty or partial list.
 */
export const getLivePreviewCards = cache(async (limit = MARKET_PICKS_LIMIT): Promise<TcgCard[]> => {
  const previewCards: TcgCard[] = [];

  const slugCards = await Promise.all(
    CURATED_PREVIEW_SLUGS.map((slug) =>
      fetchLiveCardBySlug(slug, {
        includePublicPriceFallback: false,
      }).catch(() => null),
    ),
  );

  for (const card of slugCards) {
    if (previewCards.length >= limit) {
      break;
    }

    if (card) {
      pushUniquePreviewCards(previewCards, [card], limit);
    }
  }

  if (previewCards.length < limit) {
    for (const search of PREVIEW_SEARCH_FALLBACKS) {
      if (previewCards.length >= limit) {
        break;
      }

      try {
        const response = await searchLiveCards(
          search.query,
          search.setFilter,
          1,
          "en",
          "price-desc",
        );
        pushUniquePreviewCards(
          previewCards,
          response.results.map((result) => result.card),
          limit,
        );
      } catch {
        // Try the next fallback search.
      }
    }
  }

  return previewCards.slice(0, limit);
});

/**
 * Market pool for decorative hero/marquee surfaces.
 * Static catalog only — live discovery used to fan out many searchLiveCards
 * calls and hang binder/home for 60s+ when upstream APIs timed out.
 */
export const getMarketPickPool = cache(async (): Promise<TcgCard[]> => {
  return getStaticMarketPool().slice(0, MARKET_POOL_TARGET);
});

function buildHomePreview(pool: TcgCard[], source: "live" | "static"): HomeLivePreview {
  const slim = pool.map(slimHomePreviewCard);

  return {
    pool: slim,
    hero: slim.slice(0, HERO_FAN_SIZE),
    picks: selectTodaysPicks(slim, TODAYS_PICKS_LIMIT),
    source,
  };
}

async function fetchLiveHomePool(): Promise<TcgCard[]> {
  const response = await Promise.race([
    searchLiveCards("", undefined, 1, "en", "relevance"),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), TODAYS_PICKS_FETCH_MS);
    }),
  ]);

  if (!response?.results.length) {
    return [];
  }

  const liveCards = response.results
    .filter((result) => isLiveTrendingMatchReason(result.matchReason))
    .map((result) => result.card);

  const pool: TcgCard[] = [];
  pushUniquePreviewCards(pool, liveCards, HOME_LIVE_POOL_LIMIT);
  return pool.filter((card) => isUsablePreviewCard(card));
}

/**
 * One live chase-catalog read for the homepage. Hero, marquee, and today's
 * picks all derive from this pool so we never fan out extra market fetches.
 */
export const getLiveHomePreview = cache(async (): Promise<HomeLivePreview> => {
  const staticPreview = buildHomePreview(
    getStaticMarketPool().slice(0, MARKET_POOL_TARGET),
    "static",
  );

  try {
    const livePool = await fetchLiveHomePool();
    if (livePool.length >= HERO_FAN_SIZE) {
      return buildHomePreview(livePool, "live");
    }
  } catch {
    // Keep the bundled preview.
  }

  return staticPreview;
});

/**
 * Three featured prints for the homepage: a UTC-day slice of the live chase
 * catalog ranked by 7-day momentum. Bundled grails are a last-resort fallback.
 */
export const getLiveTodaysPicks = cache(async (): Promise<TodaysPicksResult> => {
  const preview = await getLiveHomePreview();
  return { cards: preview.picks, source: preview.source };
});
