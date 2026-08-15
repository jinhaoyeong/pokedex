import { cache } from "react";

import learnedCardsSeed from "../../data/pokemon-cards-seed.json";
import { tcgCards as STATIC_CARDS } from "@/data/cards";
import { fetchLiveCardBySlug, searchLiveCards } from "@/lib/pokemon-tcg-api";
import { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";
import {
  isUsablePreviewCard,
  normalizePreviewCard,
  pushUniquePreviewCards,
} from "@/lib/preview-selection";
import type { LiveSearchResponse, TcgCard } from "@/types/pokemon";

export { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";

/** Fixed hero lineup: recognizable chase cards with stable layout order. */
const CURATED_PREVIEW_SLUGS = ["sv8pt5-179", "sv3pt5-183", "sv8pt5-60"];

const PREVIEW_SEARCH_FALLBACKS: Array<{ query: string; setFilter?: string }> = [
  { query: "pikachu ex", setFilter: "sv8pt5" },
  { query: "charizard ex", setFilter: "sv3pt5" },
  { query: "umbreon ex", setFilter: "sv8pt5" },
];

/** Upper bound on decorative market pools. */
const MARKET_POOL_TARGET = 80;
/** Size of the high-value "chase tier" that today's picks rotate within. */
const TODAYS_PICKS_CHASE_TIER = 12;

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
 * Bundled static pool so home/binder always have cards even when live APIs
 * are unreachable (a Pokémon TCG API timeout must never block the page).
 */
export function getStaticMarketPool(): TcgCard[] {
  const seen = new Set<string>();
  const pool: TcgCard[] = [];
  const seedCards = (learnedCardsSeed as { cards?: TcgCard[] }).cards ?? [];

  for (const card of [...STATIC_CARDS, ...seedCards]) {
    if (!isUsablePreviewCard(card) || seen.has(card.slug)) {
      continue;
    }

    seen.add(card.slug);
    pool.push(normalizePreviewCard(card));
  }

  return pool;
}

export function getStaticTrendingSearchResponse(limit = 24): LiveSearchResponse {
  const cards = getStaticMarketPool().slice(0, limit);

  return {
    results: cards.map((card) => ({
      card,
      score: 90,
      matchReason: "Trending & Hot",
    })),
    totalCount: cards.length,
    page: 1,
    pageSize: limit,
    hasNextPage: false,
  };
}

/**
 * Market pool for decorative hero/marquee surfaces.
 * Static catalog only — live discovery used to fan out many searchLiveCards
 * calls and hang binder/home for 60s+ when upstream APIs timed out.
 */
export const getMarketPickPool = cache(async (): Promise<TcgCard[]> => {
  return getStaticMarketPool().slice(0, MARKET_POOL_TARGET);
});

/** UTC day key so a rotation is stable within a day but changes each day. */
function getDaySeed(): number {
  const now = new Date();
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

/** Deterministic PRNG (mulberry32) — stable for a given seed across renders. */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a deterministic seed. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const random = createSeededRandom(seed);
  const out = [...items];

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/**
 * Today's picks: rotate daily among cards in the pool.
 * The daily seed keeps the selection stable within a day.
 */
export function selectTodaysPicks(pool: TcgCard[], count = MARKET_PICKS_LIMIT): TcgCard[] {
  if (pool.length <= count) {
    return pool.slice(0, count);
  }

  const chaseTier = pool.slice(0, Math.max(count, Math.min(pool.length, TODAYS_PICKS_CHASE_TIER)));
  return seededShuffle(chaseTier, getDaySeed()).slice(0, count);
}

/**
 * Marquee imagery: a randomized run of the de-duplicated pool, so no two
 * visible cards repeat. Unlike Today's Picks, the homepage ring should not
 * look locked to one daily order.
 */
export function shuffleMarqueeCards(pool: TcgCard[]): TcgCard[] {
  return seededShuffle(pool, Math.floor(Math.random() * 0xffffffff));
}
