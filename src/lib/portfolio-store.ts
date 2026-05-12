"use client";

import type { PortfolioItem } from "@/types/pokemon";

export const PORTFOLIO_STORAGE_KEY = "pokedex_portfolio";
export const PORTFOLIO_STORAGE_EVENT = "pokedex-portfolio-change";

const EMPTY_PORTFOLIO: PortfolioItem[] = [];
let cachedRawPortfolioValue: string | null = null;
let cachedPortfolioItems: PortfolioItem[] = EMPTY_PORTFOLIO;

export function sanitizePortfolioItem(rawItem: unknown, index: number): PortfolioItem | null {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

  const item = rawItem as Partial<PortfolioItem>;

  if (!item.cardId || !item.name || !item.setName || !item.collectorNumber) {
    return null;
  }

  return {
    cardId: String(item.cardId),
    slug: String(item.slug ?? item.cardId),
    name: String(item.name),
    setName: String(item.setName),
    setCode: typeof item.setCode === "string" ? item.setCode : undefined,
    rarity: typeof item.rarity === "string" ? item.rarity : undefined,
    collectorNumber: String(item.collectorNumber),
    image: typeof item.image === "string" ? item.image : "/icon.svg",
    quantity:
      typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
        ? item.quantity
        : 1,
    grade: typeof item.grade === "string" && item.grade.trim() ? item.grade : "Ungraded",
    costBasisUsd:
      typeof item.costBasisUsd === "number" && Number.isFinite(item.costBasisUsd)
        ? item.costBasisUsd
        : 0,
    marketValueUsd:
      typeof item.marketValueUsd === "number" &&
      Number.isFinite(item.marketValueUsd) &&
      item.marketValueUsd > 0
        ? item.marketValueUsd
        : undefined,
    marketValueUpdatedAt:
      typeof item.marketValueUpdatedAt === "string" && item.marketValueUpdatedAt
        ? item.marketValueUpdatedAt
        : undefined,
    marketSource:
      typeof item.marketSource === "string" && item.marketSource
        ? item.marketSource
        : undefined,
    addedAt:
      typeof item.addedAt === "string" && item.addedAt
        ? item.addedAt
        : `legacy-${index}`,
  };
}

function normalizePortfolioItems(items: PortfolioItem[]) {
  const mergedItems = new Map<string, PortfolioItem>();

  for (const item of items) {
    const key = portfolioItemKey(item);
    const existing = mergedItems.get(key);

    if (!existing) {
      mergedItems.set(key, item);
      continue;
    }

    const nextQuantity = existing.quantity + item.quantity;

    mergedItems.set(key, {
      ...existing,
      image: existing.image !== "/icon.svg" ? existing.image : item.image,
      setCode: existing.setCode ?? item.setCode,
      rarity: existing.rarity ?? item.rarity,
      quantity: nextQuantity,
      costBasisUsd:
        nextQuantity > 0
          ? (existing.costBasisUsd * existing.quantity + item.costBasisUsd * item.quantity) /
            nextQuantity
          : existing.costBasisUsd,
      marketValueUsd: item.marketValueUsd ?? existing.marketValueUsd,
      marketValueUpdatedAt: item.marketValueUpdatedAt ?? existing.marketValueUpdatedAt,
      marketSource: item.marketSource ?? existing.marketSource,
      addedAt: existing.addedAt < item.addedAt ? existing.addedAt : item.addedAt,
    });
  }

  return [...mergedItems.values()].sort((left, right) => right.addedAt.localeCompare(left.addedAt));
}

export function readPortfolio(): PortfolioItem[] {
  if (typeof window === "undefined") {
    return EMPTY_PORTFOLIO;
  }

  try {
    const rawValue = window.localStorage.getItem(PORTFOLIO_STORAGE_KEY);

    if (!rawValue) {
      cachedRawPortfolioValue = null;
      cachedPortfolioItems = EMPTY_PORTFOLIO;
      return cachedPortfolioItems;
    }

    if (rawValue === cachedRawPortfolioValue) {
      return cachedPortfolioItems;
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsedValue)) {
      cachedRawPortfolioValue = rawValue;
      cachedPortfolioItems = EMPTY_PORTFOLIO;
      return cachedPortfolioItems;
    }

    cachedRawPortfolioValue = rawValue;
    cachedPortfolioItems = normalizePortfolioItems(
      parsedValue
        .map((item, index) => sanitizePortfolioItem(item, index))
        .filter((item): item is PortfolioItem => Boolean(item)),
    );

    return cachedPortfolioItems;
  } catch {
    cachedRawPortfolioValue = null;
    cachedPortfolioItems = EMPTY_PORTFOLIO;
    return cachedPortfolioItems;
  }
}

export function writePortfolio(items: PortfolioItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  const cleanItems = normalizePortfolioItems(
    items
      .map((item, index) => sanitizePortfolioItem(item, index))
      .filter((item): item is PortfolioItem => Boolean(item)),
  );
  const nextRawValue = JSON.stringify(cleanItems);
  cachedRawPortfolioValue = nextRawValue;
  cachedPortfolioItems = cleanItems;
  window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, nextRawValue);
  window.dispatchEvent(new Event(PORTFOLIO_STORAGE_EVENT));
}

export function portfolioItemKey(item: Pick<PortfolioItem, "cardId" | "grade">) {
  return `${item.cardId}__${item.grade}`;
}

export function subscribeToPortfolio(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => callback();

  window.addEventListener("storage", handler);
  window.addEventListener(PORTFOLIO_STORAGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(PORTFOLIO_STORAGE_EVENT, handler);
  };
}
