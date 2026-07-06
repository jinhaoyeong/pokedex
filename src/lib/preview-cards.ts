import { cache } from "react";

import { tcgCards as STATIC_CARDS } from "@/data/cards";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { fetchLiveCardBySlug, searchLiveCards } from "@/lib/pokemon-tcg-api";
import { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";
import {
  isUsablePreviewCard,
  normalizePreviewCard,
  pushUniquePreviewCards,
} from "@/lib/preview-selection";
import type { TcgCard } from "@/types/pokemon";

export { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";

/** Fixed hero lineup: recognizable chase cards with stable layout order. */
const CURATED_PREVIEW_SLUGS = ["sv8pt5-179", "sv3pt5-183", "sv8pt5-60"];

const PREVIEW_SEARCH_FALLBACKS: Array<{ query: string; setFilter?: string }> = [
  { query: "pikachu ex", setFilter: "sv8pt5" },
  { query: "charizard ex", setFilter: "sv3pt5" },
  { query: "umbreon ex", setFilter: "sv8pt5" },
];

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
 * Live discovery seeds for the market pool. These are search *entry points* —
 * popular Pokémon archetypes — NOT pinned cards. Every card and price returned
 * below is fetched live and ranked by real market value, so the pool naturally
 * shifts as the market moves and as new sets are released.
 */
const MARKET_DISCOVERY_SEEDS = [
  "charizard ex",
  "pikachu ex",
  "umbreon ex",
  "mewtwo ex",
  "rayquaza ex",
  "gardevoir ex",
  "sylveon ex",
  "lugia",
  "giratina",
  "eevee",
] as const;

/** Top N results pulled from each seed search (already price-sorted by the API). */
const MARKET_POOL_PER_SEED = 6;
/** Upper bound on the de-duplicated, value-ranked pool. */
const MARKET_POOL_TARGET = 36;
/** Size of the high-value "chase tier" that today's picks rotate within. */
const TODAYS_PICKS_CHASE_TIER = 12;

/**
 * Build a live, de-duplicated pool of real, high-value cards ranked by actual
 * market price. Replaces hard-coded preview slugs with genuine discovery: it
 * fans out a set of price-sorted searches, merges the usable results, and ranks
 * everything by real headline market value. Falls back to the curated lineup
 * only if live discovery comes up short, so the page never renders empty.
 */
/** Last-resort static pool bundled with the app, so the home page always has
 *  real, well-formed cards to render even if the live API is fully unreachable
 *  at build time (a Pokémon TCG API 504 must never fail the deploy). */
export function getStaticMarketPool(): TcgCard[] {
  return STATIC_CARDS.filter(isUsablePreviewCard).map(normalizePreviewCard);
}

/**
 * Wrapper: builds the live pool but is guaranteed to never throw and never
 * return empty. Any failure (or an empty result when the API is down) degrades
 * to the bundled static pool, so static generation of the home page can't be
 * broken by an upstream outage.
 */
export const getMarketPickPool = cache(async (): Promise<TcgCard[]> => {
  try {
    const pool = await buildLiveMarketPool();
    return pool.length ? pool : getStaticMarketPool();
  } catch {
    return getStaticMarketPool();
  }
});

async function buildLiveMarketPool(): Promise<TcgCard[]> {
  const pool: TcgCard[] = [];
  const seen = new Set<string>();

  const responses = await Promise.allSettled(
    MARKET_DISCOVERY_SEEDS.map((query) =>
      searchLiveCards(query, undefined, 1, "en", "price-desc"),
    ),
  );

  for (const response of responses) {
    if (response.status !== "fulfilled") {
      continue;
    }

    for (const result of response.value.results.slice(0, MARKET_POOL_PER_SEED)) {
      const card = result.card;

      if (!isUsablePreviewCard(card) || seen.has(card.slug)) {
        continue;
      }

      seen.add(card.slug);
      pool.push(normalizePreviewCard(card));
    }
  }

  // Rank by real headline market value — most valuable chase cards first.
  pool.sort((left, right) => getHeadlineMarketPriceUsd(right) - getHeadlineMarketPriceUsd(left));

  // Resilience: top up from the curated lineup if discovery returned too few.
  if (pool.length < MARKET_PICKS_LIMIT) {
    const fallback = await getLivePreviewCards(MARKET_PICKS_LIMIT);

    for (const card of fallback) {
      if (seen.has(card.slug)) {
        continue;
      }

      seen.add(card.slug);
      pool.push(card);
    }
  }

  return pool.slice(0, MARKET_POOL_TARGET);
}

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
 * Today's picks: rotate daily among the highest-value cards in the live pool.
 * The cards are real and price-ranked; the daily seed keeps the selection
 * stable within a day while genuinely changing the lineup each day.
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
 * visible cards repeat. Seeded off the day so server and client agree.
 */
export function shuffleMarqueeCards(pool: TcgCard[]): TcgCard[] {
  return seededShuffle(pool, getDaySeed() + 0x9e37);
}
