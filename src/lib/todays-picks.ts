import { TODAYS_PICKS_LIMIT } from "@/lib/preview-constants";
import type { TcgCard } from "@/types/pokemon";

/** Size of the high-value "chase tier" that today's picks rotate within. */
const TODAYS_PICKS_CHASE_TIER = 12;

/** UTC day key so a rotation is stable within a day but changes each day. */
export function getDaySeed(now = new Date()): number {
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

/** Deterministic PRNG (mulberry32) — stable for a given seed across renders. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a deterministic seed. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const random = createSeededRandom(seed);
  const out = [...items];

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/**
 * Today's picks: rotate daily among the leading movers in the pool.
 * The daily seed keeps the selection stable within a UTC day.
 */
export function selectTodaysPicks(pool: TcgCard[], count = TODAYS_PICKS_LIMIT): TcgCard[] {
  if (pool.length <= count) {
    return pool.slice(0, count);
  }

  const chaseTier = pool.slice(0, Math.max(count, Math.min(pool.length, TODAYS_PICKS_CHASE_TIER)));
  return seededShuffle(chaseTier, getDaySeed()).slice(0, count);
}

/** Marquee imagery: a shuffled run of the same pool, no duplicate visible prints. */
export function shuffleMarqueeCards(pool: TcgCard[]): TcgCard[] {
  return seededShuffle(pool, Math.floor(Math.random() * 0xffffffff));
}
