"use client";

import type { PortfolioItem } from "@/types/pokemon";

export const PORTFOLIO_STORAGE_KEY = "pokedex_portfolio";
export const PORTFOLIO_STORAGE_EVENT = "pokedex-portfolio-change";

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
    grade:
      item.grade === "PSA 8" ||
      item.grade === "PSA 9" ||
      item.grade === "PSA 10" ||
      item.grade === "BGS 9.5" ||
      item.grade === "CGC 10"
        ? item.grade
        : "Ungraded",
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
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(PORTFOLIO_STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map((item, index) => sanitizePortfolioItem(item, index))
      .filter((item): item is PortfolioItem => Boolean(item));
  } catch {
    return [];
  }
}

export function writePortfolio(items: PortfolioItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(items));
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
