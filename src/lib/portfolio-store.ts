"use client";

import type { PortfolioItem } from "@/types/pokemon";

export const PORTFOLIO_STORAGE_KEY = "pokedex_portfolio";
export const PORTFOLIO_STORAGE_EVENT = "pokedex-portfolio-change";

const EMPTY_PORTFOLIO: PortfolioItem[] = [];
let cachedRawPortfolioValue: string | null = null;
let cachedPortfolioItems: PortfolioItem[] = EMPTY_PORTFOLIO;

function sanitizePortfolioItem(rawItem: unknown, index: number): PortfolioItem | null {
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
    addedAt:
      typeof item.addedAt === "string" && item.addedAt
        ? item.addedAt
        : `legacy-${index}`,
  };
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
    cachedPortfolioItems = parsedValue
      .map((item, index) => sanitizePortfolioItem(item, index))
      .filter((item): item is PortfolioItem => Boolean(item));

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

  const nextRawValue = JSON.stringify(items);
  cachedRawPortfolioValue = nextRawValue;
  cachedPortfolioItems = items;
  window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, nextRawValue);
  window.dispatchEvent(new Event(PORTFOLIO_STORAGE_EVENT));
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
