import { positivePrice } from "@/lib/binder-market";
import type { PricePoint } from "@/types/pokemon";

/**
 * Shape the binder analytics needs from an enriched portfolio row. Kept
 * structural (not tied to the portfolio component) so the math stays testable.
 */
export interface BinderAnalyticsItem {
  cardId: string;
  slug: string;
  name: string;
  image: string;
  grade: string;
  rarity: string;
  setName: string;
  setCode?: string;
  quantity: number;
  /** Per-card live market value. */
  currentValueUsd: number;
  /** currentValueUsd * quantity. */
  totalCurrentUsd: number;
  /** Per-card cost basis. */
  costBasisUsd: number;
  totalCostUsd: number;
  gainLossUsd: number;
  gainLossPercent: number | null;
  /** Per-card day move. */
  dayChangeUsd: number;
  dayChangePercent: number;
  hasTrackedCost: boolean;
  priceHistory?: PricePoint[];
}

export interface CollectorRank {
  title: string;
  icon: string;
  blurb: string;
  /** 0..1 progress toward the next tier. */
  progress: number;
  /** Dollars still needed to reach the next tier, or 0 at the top tier. */
  toNextUsd: number;
  nextTitle: string | null;
}

const RANK_TIERS: Array<{ title: string; icon: string; floor: number; blurb: string }> = [
  { title: "Youngster", icon: "sprout", floor: 0, blurb: "Every Champion starts with a single card." },
  { title: "Bug Catcher", icon: "leaf", floor: 50, blurb: "The collection is catching momentum." },
  { title: "Ace Trainer", icon: "bolt", floor: 250, blurb: "A sharp, well-rounded binder." },
  { title: "Gym Leader", icon: "medal", floor: 1000, blurb: "Serious holdings — badge earned." },
  { title: "Elite Four", icon: "crown", floor: 5000, blurb: "Elite-tier vault. Few make it here." },
  { title: "Champion", icon: "trophy", floor: 20000, blurb: "You are the Champion. Hall of Fame stuff." },
];

export function computeCollectorRank(totalValueUsd: number): CollectorRank {
  const value = Number.isFinite(totalValueUsd) && totalValueUsd > 0 ? totalValueUsd : 0;

  let tierIndex = 0;
  for (let index = 0; index < RANK_TIERS.length; index += 1) {
    if (value >= RANK_TIERS[index].floor) {
      tierIndex = index;
    }
  }

  const tier = RANK_TIERS[tierIndex];
  const next = RANK_TIERS[tierIndex + 1];

  if (!next) {
    return {
      title: tier.title,
      icon: tier.icon,
      blurb: tier.blurb,
      progress: 1,
      toNextUsd: 0,
      nextTitle: null,
    };
  }

  const span = next.floor - tier.floor;
  const progress = span > 0 ? Math.min(Math.max((value - tier.floor) / span, 0), 1) : 0;

  return {
    title: tier.title,
    icon: tier.icon,
    blurb: tier.blurb,
    progress,
    toNextUsd: Math.max(next.floor - value, 0),
    nextTitle: next.title,
  };
}

export interface DistributionSlice {
  key: string;
  /** Number of cards (quantity-weighted) in this bucket. */
  count: number;
  /** Total market value held in this bucket. */
  value: number;
  /** Value share 0..1 of the whole collection. */
  share: number;
}

export function distributionByValue(
  items: BinderAnalyticsItem[],
  keyFn: (item: BinderAnalyticsItem) => string,
  limit = 6,
): DistributionSlice[] {
  const buckets = new Map<string, { count: number; value: number }>();

  for (const item of items) {
    const key = keyFn(item) || "Unknown";
    const bucket = buckets.get(key) ?? { count: 0, value: 0 };
    bucket.count += item.quantity;
    bucket.value += item.totalCurrentUsd;
    buckets.set(key, bucket);
  }

  const totalValue = [...buckets.values()].reduce((sum, bucket) => sum + bucket.value, 0);

  const slices = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      count: bucket.count,
      value: bucket.value,
      share: totalValue > 0 ? bucket.value / totalValue : 0,
    }))
    .sort((left, right) => right.value - left.value || right.count - left.count);

  if (slices.length <= limit) {
    return slices;
  }

  const head = slices.slice(0, limit - 1);
  const tail = slices.slice(limit - 1);
  const tailSlice = tail.reduce(
    (acc, slice) => ({
      key: "Other",
      count: acc.count + slice.count,
      value: acc.value + slice.value,
      share: acc.share + slice.share,
    }),
    { key: "Other", count: 0, value: 0, share: 0 },
  );

  return [...head, tailSlice];
}

export interface BinderHighlights {
  crownJewel: BinderAnalyticsItem | null;
  topMover: BinderAnalyticsItem | null;
  biggestWinner: BinderAnalyticsItem | null;
  biggestLoser: BinderAnalyticsItem | null;
}

export function pickHighlights(items: BinderAnalyticsItem[]): BinderHighlights {
  let crownJewel: BinderAnalyticsItem | null = null;
  let topMover: BinderAnalyticsItem | null = null;
  let biggestWinner: BinderAnalyticsItem | null = null;
  let biggestLoser: BinderAnalyticsItem | null = null;

  for (const item of items) {
    if (item.totalCurrentUsd > 0 && (!crownJewel || item.totalCurrentUsd > crownJewel.totalCurrentUsd)) {
      crownJewel = item;
    }

    if (
      item.currentValueUsd > 0 &&
      item.dayChangePercent !== 0 &&
      (!topMover || Math.abs(item.dayChangePercent) > Math.abs(topMover.dayChangePercent))
    ) {
      topMover = item;
    }

    if (item.hasTrackedCost) {
      if (!biggestWinner || item.gainLossUsd > biggestWinner.gainLossUsd) {
        biggestWinner = item;
      }
      if (!biggestLoser || item.gainLossUsd < biggestLoser.gainLossUsd) {
        biggestLoser = item;
      }
    }
  }

  // Only surface a loser when it is actually in the red and distinct from the winner.
  if (biggestLoser && (biggestLoser.gainLossUsd >= 0 || biggestLoser === biggestWinner)) {
    biggestLoser = null;
  }

  return { crownJewel, topMover, biggestWinner, biggestLoser };
}

export interface DiversificationStats {
  uniqueCards: number;
  totalCards: number;
  uniqueSets: number;
  gradedCount: number;
  gradedShare: number;
  /** Value share of the single largest holding (0..1). */
  topHoldingShare: number;
  /** 0..100, higher = more spread out across holdings (1 - HHI). */
  diversityScore: number;
}

export function computeDiversification(
  items: BinderAnalyticsItem[],
  totalValueUsd: number,
): DiversificationStats {
  const totalCards = items.reduce((sum, item) => sum + item.quantity, 0);
  const uniqueSets = new Set(items.map((item) => item.setName || "Unknown")).size;
  const gradedCount = items.reduce(
    (sum, item) => sum + (item.grade !== "Ungraded" ? item.quantity : 0),
    0,
  );

  let topHoldingValue = 0;
  let herfindahl = 0;

  if (totalValueUsd > 0) {
    for (const item of items) {
      const share = item.totalCurrentUsd / totalValueUsd;
      herfindahl += share * share;
      if (item.totalCurrentUsd > topHoldingValue) {
        topHoldingValue = item.totalCurrentUsd;
      }
    }
  }

  return {
    uniqueCards: items.length,
    totalCards,
    uniqueSets,
    gradedCount,
    gradedShare: totalCards > 0 ? gradedCount / totalCards : 0,
    topHoldingShare: totalValueUsd > 0 ? topHoldingValue / totalValueUsd : 0,
    diversityScore: totalValueUsd > 0 ? Math.round((1 - herfindahl) * 100) : 0,
  };
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  unlocked: boolean;
}

const RAINBOW_RARITY = /rainbow|secret|hyper|special illustration|gold|ultra/i;

export function computeAchievements(
  items: BinderAnalyticsItem[],
  stats: DiversificationStats,
  totalValueUsd: number,
): Achievement[] {
  const hasPsa10 = items.some((item) => /\b10\b/.test(item.grade));
  const diamondHand = items.some(
    (item) => typeof item.gainLossPercent === "number" && item.gainLossPercent >= 50,
  );
  const rainbowChaser = items.some((item) => RAINBOW_RARITY.test(item.rarity));

  return [
    {
      id: "first-catch",
      title: "First Catch",
      desc: "Add your first card",
      icon: "bag",
      unlocked: stats.totalCards >= 1,
    },
    {
      id: "double-digits",
      title: "Double Digits",
      desc: "Hold 10+ cards",
      icon: "layers",
      unlocked: stats.totalCards >= 10,
    },
    {
      id: "set-collector",
      title: "Set Collector",
      desc: "Span 5+ different sets",
      icon: "folder",
      unlocked: stats.uniqueSets >= 5,
    },
    {
      id: "slab-hunter",
      title: "Slab Hunter",
      desc: "Own 3+ graded cards",
      icon: "box",
      unlocked: stats.gradedCount >= 3,
    },
    {
      id: "psa-10-club",
      title: "Gem Mint Club",
      desc: "Land a grade 10 card",
      icon: "gem",
      unlocked: hasPsa10,
    },
    {
      id: "high-roller",
      title: "High Roller",
      desc: "Binder worth $1,000+",
      icon: "coins",
      unlocked: totalValueUsd >= 1000,
    },
    {
      id: "diamond-hand",
      title: "Diamond Hands",
      desc: "A holding up 50%+",
      icon: "shield",
      unlocked: diamondHand,
    },
    {
      id: "rainbow-chaser",
      title: "Rainbow Chaser",
      desc: "Pull a rainbow/secret rare",
      icon: "sparkles",
      unlocked: rainbowChaser,
    },
    {
      id: "diversified",
      title: "Well Diversified",
      desc: "Spread across 3+ sets, no card over half your value",
      icon: "scale",
      unlocked: stats.uniqueSets >= 3 && stats.topHoldingShare < 0.5 && stats.uniqueCards >= 3,
    },
  ];
}

export function getHistoryValue(point: PricePoint, grade: string): number | undefined {
  if (grade === "Ungraded") {
    return positivePrice(point.gradeValues?.Ungraded) ?? positivePrice(point.value);
  }

  return positivePrice(point.gradeValues?.[grade]);
}

export interface PortfolioHistoryPoint {
  date: string;
  value: number;
}

/**
 * Sum every holding's grade-matched price history into one collection curve,
 * carrying each card's last known value forward so a card missing a given day
 * does not yank the whole portfolio line to zero.
 */
export function aggregatePortfolioHistory(
  items: BinderAnalyticsItem[],
  maxPoints = 32,
): PortfolioHistoryPoint[] {
  const series: Array<{ quantity: number; points: Map<string, number> }> = [];
  const allDates = new Set<string>();

  for (const item of items) {
    const points = new Map<string, number>();

    for (const point of item.priceHistory ?? []) {
      const value = getHistoryValue(point, item.grade);
      if (typeof value === "number") {
        points.set(point.date, value);
        allDates.add(point.date);
      }
    }

    if (points.size > 0) {
      series.push({ quantity: item.quantity, points });
    }
  }

  if (!allDates.size) {
    return [];
  }

  const sortedDates = [...allDates].sort((left, right) => left.localeCompare(right));
  const curve: PortfolioHistoryPoint[] = [];

  for (const date of sortedDates) {
    let total = 0;

    for (const entry of series) {
      const direct = entry.points.get(date);

      if (typeof direct === "number") {
        total += direct * entry.quantity;
        continue;
      }

      // Carry forward the most recent known value at or before this date.
      let carried: number | undefined;
      let carriedDate = "";
      for (const [pointDate, pointValue] of entry.points) {
        if (pointDate <= date && pointDate >= carriedDate) {
          carried = pointValue;
          carriedDate = pointDate;
        }
      }

      if (typeof carried === "number") {
        total += carried * entry.quantity;
      }
    }

    curve.push({ date, value: Number(total.toFixed(2)) });
  }

  return curve.slice(-maxPoints);
}

export interface SparklineGeometry {
  linePath: string;
  areaPath: string;
  last: { x: number; y: number } | null;
  changePercent: number;
}

export function sparklineGeometry(
  values: number[],
  width: number,
  height: number,
  pad = 3,
): SparklineGeometry {
  if (values.length < 2) {
    return { linePath: "", areaPath: "", last: null, changePercent: 0 };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = innerW / (values.length - 1);

  const coords = values.map((value, index) => {
    const x = pad + index * step;
    const y = pad + innerH - ((value - min) / span) * innerH;
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  });

  const linePath = coords
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1].x} ${height - pad} L${coords[0].x} ${height - pad} Z`;
  const first = values[0];
  const lastValue = values[values.length - 1];
  const changePercent = first > 0 ? ((lastValue - first) / first) * 100 : 0;

  return { linePath, areaPath, last: coords[coords.length - 1], changePercent };
}
