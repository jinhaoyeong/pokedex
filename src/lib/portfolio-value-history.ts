"use client";

import type { PortfolioHistoryPoint } from "@/lib/binder-analytics";

export const PORTFOLIO_VALUE_HISTORY_KEY = "pokedex_portfolio_value_history";
export const PORTFOLIO_VALUE_HISTORY_EVENT = "pokedex-portfolio-value-history-change";

const MAX_HISTORY_POINTS = 180;

export type PortfolioValueSnapshot = {
  /** Calendar day (YYYY-MM-DD) used for daily bucketing. */
  date: string;
  /** ISO timestamp of the latest write for this day. */
  at: string;
  valueUsd: number;
  holdings: number;
};

type BinderHistorySeedItem = {
  addedAt: string;
  quantity: number;
  currentValueUsd: number;
};

let cachedRaw: string | null = null;
let cachedSnapshots: PortfolioValueSnapshot[] = [];

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function dayKeyFromAddedAt(addedAt: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(addedAt)) {
    return addedAt.slice(0, 10);
  }

  const parsed = Date.parse(addedAt);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}

function sanitizeSnapshot(raw: unknown): PortfolioValueSnapshot | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entry = raw as Partial<PortfolioValueSnapshot>;
  const date =
    typeof entry.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
      ? entry.date
      : typeof entry.at === "string" && /^\d{4}-\d{2}-\d{2}/.test(entry.at)
        ? entry.at.slice(0, 10)
        : null;
  const valueUsd =
    typeof entry.valueUsd === "number" && Number.isFinite(entry.valueUsd) && entry.valueUsd >= 0
      ? Number(entry.valueUsd.toFixed(2))
      : null;
  const holdings =
    typeof entry.holdings === "number" && Number.isFinite(entry.holdings) && entry.holdings >= 0
      ? Math.floor(entry.holdings)
      : 0;

  if (!date || valueUsd == null) {
    return null;
  }

  return {
    date,
    at:
      typeof entry.at === "string" && entry.at
        ? entry.at
        : `${date}T12:00:00.000Z`,
    valueUsd,
    holdings,
  };
}

function normalizeSnapshots(snapshots: PortfolioValueSnapshot[]) {
  const byDate = new Map<string, PortfolioValueSnapshot>();

  for (const snapshot of snapshots) {
    const existing = byDate.get(snapshot.date);
    if (!existing || existing.at <= snapshot.at) {
      byDate.set(snapshot.date, snapshot);
    }
  }

  return [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_HISTORY_POINTS);
}

export function readPortfolioValueHistory(): PortfolioValueSnapshot[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(PORTFOLIO_VALUE_HISTORY_KEY);

    if (!raw) {
      cachedRaw = null;
      cachedSnapshots = [];
      return cachedSnapshots;
    }

    if (raw === cachedRaw) {
      return cachedSnapshots;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      cachedRaw = raw;
      cachedSnapshots = [];
      return cachedSnapshots;
    }

    cachedRaw = raw;
    cachedSnapshots = normalizeSnapshots(
      parsed
        .map((entry) => sanitizeSnapshot(entry))
        .filter((entry): entry is PortfolioValueSnapshot => Boolean(entry)),
    );
    return cachedSnapshots;
  } catch {
    cachedRaw = null;
    cachedSnapshots = [];
    return cachedSnapshots;
  }
}

function writeSnapshots(snapshots: PortfolioValueSnapshot[]) {
  if (typeof window === "undefined") {
    return;
  }

  const next = normalizeSnapshots(snapshots);
  const raw = JSON.stringify(next);
  cachedRaw = raw;
  cachedSnapshots = next;
  window.localStorage.setItem(PORTFOLIO_VALUE_HISTORY_KEY, raw);
  window.dispatchEvent(new Event(PORTFOLIO_VALUE_HISTORY_EVENT));
}

/**
 * Build an ownership timeline from binder add dates using each card's current
 * market value. This seeds the chart so users immediately see growth from
 * adding cards, even before daily snapshots accumulate.
 */
export function bootstrapPortfolioValueHistory(
  items: BinderHistorySeedItem[],
): PortfolioValueSnapshot[] {
  if (!items.length) {
    return [];
  }

  const dayValues = new Map<string, number>();

  for (const item of items) {
    const day = dayKeyFromAddedAt(item.addedAt);
    if (!day) {
      continue;
    }

    const value = Math.max(0, item.currentValueUsd) * Math.max(1, item.quantity);
    dayValues.set(day, (dayValues.get(day) ?? 0) + value);
  }

  if (!dayValues.size) {
    return [];
  }

  const sortedDays = [...dayValues.keys()].sort((left, right) => left.localeCompare(right));
  const snapshots: PortfolioValueSnapshot[] = [];
  let running = 0;
  let holdings = 0;

  // Start from empty the day before the first add so the sparkline has a baseline.
  const firstDay = sortedDays[0];
  const firstDate = new Date(`${firstDay}T12:00:00.000Z`);
  firstDate.setUTCDate(firstDate.getUTCDate() - 1);
  snapshots.push({
    date: firstDate.toISOString().slice(0, 10),
    at: firstDate.toISOString(),
    valueUsd: 0,
    holdings: 0,
  });

  for (const day of sortedDays) {
    const addedValue = dayValues.get(day) ?? 0;
    running += addedValue;
    holdings += items
      .filter((item) => dayKeyFromAddedAt(item.addedAt) === day)
      .reduce((sum, item) => sum + Math.max(1, item.quantity), 0);

    snapshots.push({
      date: day,
      at: `${day}T12:00:00.000Z`,
      valueUsd: Number(running.toFixed(2)),
      holdings,
    });
  }

  return normalizeSnapshots(snapshots);
}

/**
 * Upsert today's portfolio total. Replaces the same-day point so market
 * refreshes and quantity edits keep the latest reading without flooding history.
 */
export function recordPortfolioValueSnapshot(input: {
  valueUsd: number;
  holdings: number;
  items?: BinderHistorySeedItem[];
  now?: Date;
}): PortfolioValueSnapshot[] {
  if (typeof window === "undefined") {
    return [];
  }

  const now = input.now ?? new Date();
  const date = todayKey(now);
  const valueUsd =
    Number.isFinite(input.valueUsd) && input.valueUsd >= 0
      ? Number(input.valueUsd.toFixed(2))
      : 0;
  const holdings = Math.max(0, Math.floor(input.holdings));

  let existing = readPortfolioValueHistory();

  if (!existing.length && input.items?.length) {
    existing = bootstrapPortfolioValueHistory(input.items);
  }

  if (!existing.length && valueUsd <= 0 && holdings <= 0) {
    writeSnapshots([]);
    return [];
  }

  const withoutToday = existing.filter((snapshot) => snapshot.date !== date);
  const todayExisting = existing.find((snapshot) => snapshot.date === date);
  const nextSnapshot: PortfolioValueSnapshot = {
    date,
    at: now.toISOString(),
    valueUsd,
    holdings,
  };

  if (
    todayExisting &&
    Math.abs(todayExisting.valueUsd - valueUsd) < 0.01 &&
    todayExisting.holdings === holdings
  ) {
    return existing;
  }

  const next = normalizeSnapshots([...withoutToday, nextSnapshot]);
  writeSnapshots(next);
  return next;
}

export function clearPortfolioValueHistory() {
  if (typeof window === "undefined") {
    return;
  }

  cachedRaw = null;
  cachedSnapshots = [];
  window.localStorage.removeItem(PORTFOLIO_VALUE_HISTORY_KEY);
  window.dispatchEvent(new Event(PORTFOLIO_VALUE_HISTORY_EVENT));
}

export function portfolioValueHistoryToPoints(
  snapshots: PortfolioValueSnapshot[],
): PortfolioHistoryPoint[] {
  return snapshots.map((snapshot) => ({
    date: snapshot.date,
    value: snapshot.valueUsd,
  }));
}

/**
 * Prefer persisted binder snapshots. Fall back to a live ownership bootstrap
 * so a first visit still shows growth from card adds.
 */
export function resolvePortfolioTrendHistory(
  items: BinderHistorySeedItem[],
  totalValueUsd: number,
  holdings: number,
): PortfolioHistoryPoint[] {
  const persisted = readPortfolioValueHistory();
  const recorded = recordPortfolioValueSnapshot({
    valueUsd: totalValueUsd,
    holdings,
    items,
  });
  const source = recorded.length ? recorded : persisted.length ? persisted : bootstrapPortfolioValueHistory(items);

  return portfolioValueHistoryToPoints(source);
}
