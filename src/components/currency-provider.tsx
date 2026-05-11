"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { fallbackExchangeRates, supportedCurrencies } from "@/lib/cards";
import type { SupportedCurrency } from "@/types/pokemon";

interface CurrencyContextValue {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  supportedCurrencies: SupportedCurrency[];
  exchangeRates: Record<SupportedCurrency, number>;
  ratesUpdatedAt: string | null;
}

const STORAGE_KEY = "pokedex_currency";
const STORAGE_EVENT = "pokedex-currency-change";
const FX_STORAGE_KEY = "pokedex_fx_rates_v1";
const FX_REFRESH_MS = 1000 * 60 * 60 * 6;

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

interface StoredRatesPayload {
  rates: Record<SupportedCurrency, number>;
  updatedAt: string;
}

function readCurrency(): SupportedCurrency {
  if (typeof window === "undefined") {
    return "USD";
  }

  const storedValue = window.localStorage.getItem(STORAGE_KEY) as
    | SupportedCurrency
    | null;

  if (storedValue && supportedCurrencies.includes(storedValue)) {
    return storedValue;
  }

  return "USD";
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => callback();

  window.addEventListener("storage", handler);
  window.addEventListener(STORAGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(STORAGE_EVENT, handler);
  };
}

function isValidRatesPayload(payload: unknown): payload is StoredRatesPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as StoredRatesPayload;

  return supportedCurrencies.every(
    (currency) => typeof candidate.rates?.[currency] === "number",
  ) && typeof candidate.updatedAt === "string";
}

function readStoredRates(): StoredRatesPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(FX_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValidRatesPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const currency = useSyncExternalStore<SupportedCurrency>(
    subscribe,
    readCurrency,
    () => "USD",
  );
  const storedRates = readStoredRates();
  const [exchangeRates, setExchangeRates] = useState<Record<SupportedCurrency, number>>(
    storedRates?.rates ?? fallbackExchangeRates,
  );
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(
    storedRates?.updatedAt ?? null,
  );

  useEffect(() => {
    let isCancelled = false;

    async function refreshRates() {
      const previous = readStoredRates();
      const lastUpdatedMs = previous?.updatedAt ? Date.parse(previous.updatedAt) : 0;
      const shouldRefresh = !lastUpdatedMs || Date.now() - lastUpdatedMs > FX_REFRESH_MS;

      if (previous && !shouldRefresh) {
        setExchangeRates(previous.rates);
        setRatesUpdatedAt(previous.updatedAt);
        return;
      }

      try {
        const response = await fetch("https://open.er-api.com/v6/latest/USD");
        const payload = (await response.json()) as {
          result?: string;
          rates?: Partial<Record<Lowercase<SupportedCurrency>, number>>;
          time_last_update_utc?: string;
        };

        if (payload.result !== "success" || !payload.rates) {
          return;
        }

        const nextRates: Record<SupportedCurrency, number> = {
          USD: 1,
          EUR: payload.rates.eur ?? fallbackExchangeRates.EUR,
          GBP: payload.rates.gbp ?? fallbackExchangeRates.GBP,
          JPY: payload.rates.jpy ?? fallbackExchangeRates.JPY,
          MYR: payload.rates.myr ?? fallbackExchangeRates.MYR,
        };
        const updatedAt = payload.time_last_update_utc ?? new Date().toISOString();

        if (isCancelled) {
          return;
        }

        setExchangeRates(nextRates);
        setRatesUpdatedAt(updatedAt);
        window.localStorage.setItem(
          FX_STORAGE_KEY,
          JSON.stringify({ rates: nextRates, updatedAt }),
        );
      } catch {
        if (previous) {
          setExchangeRates(previous.rates);
          setRatesUpdatedAt(previous.updatedAt);
        }
      }
    }

    void refreshRates();

    return () => {
      isCancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      currency,
      exchangeRates,
      ratesUpdatedAt,
      supportedCurrencies,
      setCurrency: (nextCurrency: SupportedCurrency) => {
        window.localStorage.setItem(STORAGE_KEY, nextCurrency);
        window.dispatchEvent(new Event(STORAGE_EVENT));
      },
    }),
    [currency, exchangeRates, ratesUpdatedAt],
  );

  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);

  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider.");
  }

  return context;
}
