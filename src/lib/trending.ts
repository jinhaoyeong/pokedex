import type { LiveSearchResponse, SearchResult, TcgCard } from "@/types/pokemon";

const MIN_TRENDING_PRICE_USD = 2;
const WEEK_DAYS_MIN = 5;
const WEEK_DAYS_MAX = 10;

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
      matchReason: result.matchReason || "Trending & Hot",
    }));
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
