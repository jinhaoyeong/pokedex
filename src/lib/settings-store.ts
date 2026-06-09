"use client";

import { DEFAULT_SEARCH_SORT } from "@/lib/pokemon-tcg-api";
import {
  PORTFOLIO_STORAGE_EVENT,
  PORTFOLIO_STORAGE_KEY,
  writePortfolio,
} from "@/lib/portfolio-store";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

export const SETTINGS_STORAGE_KEY = "pokedex_settings_v1";
export const SETTINGS_STORAGE_EVENT = "pokedex-settings-change";

export const CURRENCY_STORAGE_KEY = "pokedex_currency";
export const FX_STORAGE_KEY = "pokedex_fx_rates_v1";
export const CURRENCY_STORAGE_EVENT = "pokedex-currency-change";

export type ChartRange = "1m" | "3m" | "6m" | "1y" | "all";
export type BinderHoldingType = "Ungraded" | "Graded";
export type BinderGradingService = "PSA" | "BGS" | "CGC" | "SGC" | "TAG";
export type GradeFamilyFilter = "All" | "Ungraded" | "PSA" | "BGS" | "CGC" | "TAG" | "SGC";

export interface AppSettings {
  defaultSearchLanguage: CardLanguageFilter;
  defaultSearchSort: SearchSortOption;
  defaultChartRange: ChartRange;
  defaultGradeFamily: GradeFamilyFilter;
  scrollToTopOnNavigate: boolean;
  binderDefaults: {
    holdingType: BinderHoldingType;
    gradingService: BinderGradingService;
    serviceGrade: string;
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultSearchLanguage: "all",
  defaultSearchSort: DEFAULT_SEARCH_SORT,
  defaultChartRange: "1m",
  defaultGradeFamily: "All",
  scrollToTopOnNavigate: true,
  binderDefaults: {
    holdingType: "Ungraded",
    gradingService: "PSA",
    serviceGrade: "10",
  },
};

const CHART_RANGES: ChartRange[] = ["1m", "3m", "6m", "1y", "all"];
const GRADE_FAMILIES: GradeFamilyFilter[] = [
  "All",
  "Ungraded",
  "PSA",
  "BGS",
  "CGC",
  "TAG",
  "SGC",
];
const BINDER_SERVICES: BinderGradingService[] = ["PSA", "BGS", "CGC", "SGC", "TAG"];
const SEARCH_SORT_OPTIONS: SearchSortOption[] = [
  "relevance",
  "price-desc",
  "price-asc",
  "change-desc",
  "change-asc",
  "number-desc",
  "number-asc",
];

let cachedRawSettings: string | null = null;
let cachedSettings: AppSettings = DEFAULT_APP_SETTINGS;

function isBinderHoldingType(value: unknown): value is BinderHoldingType {
  return value === "Ungraded" || value === "Graded";
}

function isBinderGradingService(value: unknown): value is BinderGradingService {
  return typeof value === "string" && BINDER_SERVICES.includes(value as BinderGradingService);
}

function sanitizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_APP_SETTINGS;
  }

  const candidate = raw as Partial<AppSettings>;
  const binderDefaults: Partial<AppSettings["binderDefaults"]> =
    candidate.binderDefaults && typeof candidate.binderDefaults === "object"
      ? candidate.binderDefaults
      : {};

  return {
    defaultSearchLanguage:
      typeof candidate.defaultSearchLanguage === "string"
        ? (candidate.defaultSearchLanguage as CardLanguageFilter)
        : DEFAULT_APP_SETTINGS.defaultSearchLanguage,
    defaultSearchSort: SEARCH_SORT_OPTIONS.includes(candidate.defaultSearchSort as SearchSortOption)
      ? (candidate.defaultSearchSort as SearchSortOption)
      : DEFAULT_APP_SETTINGS.defaultSearchSort,
    defaultChartRange: CHART_RANGES.includes(candidate.defaultChartRange as ChartRange)
      ? (candidate.defaultChartRange as ChartRange)
      : DEFAULT_APP_SETTINGS.defaultChartRange,
    defaultGradeFamily: GRADE_FAMILIES.includes(candidate.defaultGradeFamily as GradeFamilyFilter)
      ? (candidate.defaultGradeFamily as GradeFamilyFilter)
      : DEFAULT_APP_SETTINGS.defaultGradeFamily,
    scrollToTopOnNavigate:
      typeof candidate.scrollToTopOnNavigate === "boolean"
        ? candidate.scrollToTopOnNavigate
        : DEFAULT_APP_SETTINGS.scrollToTopOnNavigate,
    binderDefaults: {
      holdingType: isBinderHoldingType(binderDefaults.holdingType)
        ? binderDefaults.holdingType
        : DEFAULT_APP_SETTINGS.binderDefaults.holdingType,
      gradingService: isBinderGradingService(binderDefaults.gradingService)
        ? binderDefaults.gradingService
        : DEFAULT_APP_SETTINGS.binderDefaults.gradingService,
      serviceGrade:
        typeof binderDefaults.serviceGrade === "string" && binderDefaults.serviceGrade.trim()
          ? binderDefaults.serviceGrade
          : DEFAULT_APP_SETTINGS.binderDefaults.serviceGrade,
    },
  };
}

export function readSettings(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!rawValue) {
      cachedRawSettings = null;
      cachedSettings = DEFAULT_APP_SETTINGS;
      return cachedSettings;
    }

    if (rawValue === cachedRawSettings) {
      return cachedSettings;
    }

    const parsed = JSON.parse(rawValue) as unknown;
    cachedRawSettings = rawValue;
    cachedSettings = sanitizeSettings(parsed);
    return cachedSettings;
  } catch {
    cachedRawSettings = null;
    cachedSettings = DEFAULT_APP_SETTINGS;
    return cachedSettings;
  }
}

export function writeSettings(nextSettings: AppSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const cleanSettings = sanitizeSettings(nextSettings);
  const nextRawValue = JSON.stringify(cleanSettings);
  cachedRawSettings = nextRawValue;
  cachedSettings = cleanSettings;
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, nextRawValue);
  window.dispatchEvent(new Event(SETTINGS_STORAGE_EVENT));
}

export function updateSettings(patch: Partial<AppSettings>) {
  const current = readSettings();
  writeSettings({
    ...current,
    ...patch,
    binderDefaults: {
      ...current.binderDefaults,
      ...(patch.binderDefaults ?? {}),
    },
  });
}

export function resetSettings() {
  writeSettings(DEFAULT_APP_SETTINGS);
}

export function subscribeToSettings(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => callback();

  window.addEventListener("storage", handler);
  window.addEventListener(SETTINGS_STORAGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(SETTINGS_STORAGE_EVENT, handler);
  };
}

export function subscribeToAppStorage(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => callback();

  window.addEventListener("storage", handler);
  window.addEventListener(SETTINGS_STORAGE_EVENT, handler);
  window.addEventListener(PORTFOLIO_STORAGE_EVENT, handler);
  window.addEventListener(CURRENCY_STORAGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(SETTINGS_STORAGE_EVENT, handler);
    window.removeEventListener(PORTFOLIO_STORAGE_EVENT, handler);
    window.removeEventListener(CURRENCY_STORAGE_EVENT, handler);
  };
}

export function listLocalStorageKeys() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  const keys: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (key?.startsWith("pokedex_")) {
      keys.push(key);
    }
  }

  return keys.sort();
}

export function clearFxRateCache() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(FX_STORAGE_KEY);
  window.dispatchEvent(new Event(CURRENCY_STORAGE_EVENT));
}

export function clearBinderData() {
  writePortfolio([]);
}

export function clearCurrencyPreference() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(CURRENCY_STORAGE_KEY);
  window.dispatchEvent(new Event(CURRENCY_STORAGE_EVENT));
}

export function clearAllLocalAppData() {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of listLocalStorageKeys()) {
    window.localStorage.removeItem(key);
  }

  cachedRawSettings = null;
  cachedSettings = DEFAULT_APP_SETTINGS;
  window.dispatchEvent(new Event(SETTINGS_STORAGE_EVENT));
  window.dispatchEvent(new Event(PORTFOLIO_STORAGE_EVENT));
  window.dispatchEvent(new Event(CURRENCY_STORAGE_EVENT));
}

export function exportPortfolioJson() {
  if (typeof window === "undefined") {
    return "[]";
  }

  return window.localStorage.getItem(PORTFOLIO_STORAGE_KEY) ?? "[]";
}

export function importPortfolioJson(rawJson: string) {
  const parsed = JSON.parse(rawJson) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Portfolio backup must be a JSON array.");
  }

  writePortfolio(parsed);
}
