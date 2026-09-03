import type { LiveSearchResponse, SearchResult, TcgCard } from "@/types/pokemon";

const MIN_TRENDING_PRICE_USD = 2;
const WEEK_DAYS_MIN = 5;
const WEEK_DAYS_MAX = 10;

/** Live Dex landing ranked by Cardmarket 7-day momentum, not bundled grails. */
export const LIVE_TRENDING_MATCH_REASON = "Live 7-day momentum";
/** Bundled fallback when the live chase catalog misses. */
export const STATIC_TRENDING_MATCH_REASON = "Trending & Hot";

export type CardWeekChange = {
  current: number;
  baseline: number;
  percent: number;
  dollar: number;
};

function positivePrice(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function historyPoints(card: TcgCard) {
  return card.priceHistory
    .filter((point) => positivePrice(point.value) > 0 && !point.isProjected)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
}

function daysAgo(isoDate: string, nowMs: number) {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return (nowMs - timestamp) / 86_400_000;
}

function currentMarketUsd(card: TcgCard) {
  const fromCard = positivePrice(card.marketPriceUsd);
  if (fromCard > 0) {
    return fromCard;
  }

  const points = historyPoints(card);
  return points.length ? points[points.length - 1]!.value : 0;
}

function weekBaselineUsd(card: TcgCard, current: number, nowMs: number) {
  const points = historyPoints(card);
  if (!points.length) {
    return current;
  }

  const weekPoint = [...points]
    .reverse()
    .find((point) => {
      const age = daysAgo(point.date, nowMs);
      return age != null && age >= WEEK_DAYS_MIN && age <= WEEK_DAYS_MAX;
    });

  if (weekPoint) {
    return weekPoint.value;
  }

  const older = points.filter((point) => {
    const age = daysAgo(point.date, nowMs);
    return age != null && age >= 3;
  });

  if (older.length) {
    return older[older.length - 1]!.value;
  }

  return points[0]?.value ?? current;
}

function recencyBoost(card: TcgCard, nowMs: number) {
  const latest = historyPoints(card).at(-1);
  if (!latest) {
    return 0;
  }

  const age = daysAgo(latest.date, nowMs);
  if (age == null || age < 0) {
    return 0;
  }

  return Math.max(0, 14 - age) / 14;
}

/**
 * Rank Dex landing cards by live 7-day market momentum, not by how expensive
 * they are. A $20 SIR that jumped 20% outranks a $6k Charizard that barely moved.
 */
export function cardTrendingScore(card: TcgCard, nowMs = Date.now()) {
  const current = currentMarketUsd(card);
  if (current < MIN_TRENDING_PRICE_USD) {
    return 0;
  }

  const baseline = weekBaselineUsd(card, current, nowMs);
  const percent = baseline > 0 ? (current - baseline) / baseline : 0;
  const dollar = current - baseline;
  const noisy = Math.abs(percent) < 0.03 && Math.abs(dollar) < 2;
  const momentum = noisy ? 0 : percent;
  const upward = Math.max(0, momentum);
  const dump = Math.max(0, -momentum) * 0.2;
  const scale = Math.log10(current + 10);

  return (upward * 5 + dump) * scale * 100 + recencyBoost(card, nowMs);
}

export function rankSearchResultsByTrending(results: SearchResult[], nowMs = Date.now()) {
  return results
    .map((result, index) => ({ result, index, score: cardTrendingScore(result.card, nowMs) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result, score }) => ({
      ...result,
      score,
      matchReason: result.matchReason || STATIC_TRENDING_MATCH_REASON,
    }));
}

/**
 * 7-day percent vs the week baseline used by {@link cardTrendingScore}.
 * Returns null when the print is below the trending floor.
 */
export function cardWeekChange(card: TcgCard, nowMs = Date.now()): CardWeekChange | null {
  const current = currentMarketUsd(card);
  if (current < MIN_TRENDING_PRICE_USD) {
    return null;
  }

  const baseline = weekBaselineUsd(card, current, nowMs);
  if (!(baseline > 0)) {
    return null;
  }

  const percent = (current - baseline) / baseline;
  const dollar = current - baseline;
  const noisy = Math.abs(percent) < 0.03 && Math.abs(dollar) < 2;

  return {
    current,
    baseline,
    percent: noisy ? 0 : percent,
    dollar: noisy ? 0 : dollar,
  };
}

export function formatWeekChangePercent(change: CardWeekChange | null): string | null {
  if (!change || change.percent === 0) {
    return null;
  }

  const rounded = Math.round(change.percent * 1000) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

export function isLiveTrendingMatchReason(reason?: string) {
  return reason === LIVE_TRENDING_MATCH_REASON;
}

export function isStaticTrendingResponse(results: SearchResult[]) {
  return (
    results.length > 0 &&
    results.every((result) => result.matchReason === STATIC_TRENDING_MATCH_REASON)
  );
}

export function pageTrendingSearchResults(
  results: SearchResult[],
  page: number,
  pageSize: number,
): Pick<LiveSearchResponse, "results" | "page" | "pageSize" | "totalCount" | "hasNextPage"> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const start = (normalizedPage - 1) * pageSize;
  const paged = results.slice(start, start + pageSize);

  return {
    results: paged,
    page: normalizedPage,
    pageSize,
    totalCount: results.length,
    hasNextPage: start + pageSize < results.length,
  };
}
