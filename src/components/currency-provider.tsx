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

import {
  fallbackExchangeRates,
  sanitizeExchangeRates,
  supportedCurrencies,
} from "@/lib/cards";
import {
  CURRENCY_STORAGE_EVENT,
  DEFAULT_PREFERRED_CURRENCY,
  FX_STORAGE_KEY,
  persistPreferredCurrency,
  readStoredPreferredCurrency,
} from "@/lib/currency-preference";
import type { SupportedCurrency } from "@/types/pokemon";

interface CurrencyContextValue {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  supportedCurrencies: SupportedCurrency[];
  exchangeRates: Record<SupportedCurrency, number>;
  ratesUpdatedAt: string | null;
}

const FX_REFRESH_MS = 1000 * 60 * 60 * 6;

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

interface StoredRatesPayload {
  rates: Record<SupportedCurrency, number>;
  updatedAt: string;
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => callback();

  window.addEventListener("storage", handler);
  window.addEventListener(CURRENCY_STORAGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(CURRENCY_STORAGE_EVENT, handler);
  };
}

function isValidRatesPayload(payload: unknown): payload is StoredRatesPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as StoredRatesPayload;

  return (
    supportedCurrencies.every((currency) => typeof candidate.rates?.[currency] === "number") &&
    typeof candidate.updatedAt === "string"
  );
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

export function CurrencyProvider({
  children,
  initialCurrency = DEFAULT_PREFERRED_CURRENCY,
}: {
  children: ReactNode;
  initialCurrency?: SupportedCurrency;
}) {
  const currency = useSyncExternalStore<SupportedCurrency>(
    subscribe,
    () => readStoredPreferredCurrency() ?? initialCurrency,
    () => initialCurrency,
  );
  const [exchangeRates, setExchangeRates] =
    useState<Record<SupportedCurrency, number>>(fallbackExchangeRates);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    persistPreferredCurrency(readStoredPreferredCurrency() ?? initialCurrency);
  }, [initialCurrency]);

  useEffect(() => {
    let isCancelled = false;

    async function refreshRates(force = false) {
      const previous = readStoredRates();
      const lastUpdatedMs = previous?.updatedAt ? Date.parse(previous.updatedAt) : 0;
      const shouldRefresh =
        force || !lastUpdatedMs || Date.now() - lastUpdatedMs > FX_REFRESH_MS;

      if (previous && !shouldRefresh) {
        setExchangeRates(sanitizeExchangeRates(previous.rates));
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
          if (previous) {
            setExchangeRates(sanitizeExchangeRates(previous.rates));
            setRatesUpdatedAt(previous.updatedAt);
          }
          return;
        }

        const nextRates = sanitizeExchangeRates({
          USD: 1,
          EUR: payload.rates.eur,
          GBP: payload.rates.gbp,
          JPY: payload.rates.jpy,
          MYR: payload.rates.myr,
        });
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
          setExchangeRates(sanitizeExchangeRates(previous.rates));
          setRatesUpdatedAt(previous.updatedAt);
        }
      }
    }

    const handleStorageRefresh = () => {
      if (!readStoredRates()) {
        void refreshRates(true);
      }
    };

    void refreshRates();
    window.addEventListener(CURRENCY_STORAGE_EVENT, handleStorageRefresh);

    return () => {
      isCancelled = true;
      window.removeEventListener(CURRENCY_STORAGE_EVENT, handleStorageRefresh);
    };
  }, []);

  const value = useMemo(
    () => ({
      currency,
      exchangeRates,
      ratesUpdatedAt,
      supportedCurrencies,
      setCurrency: persistPreferredCurrency,
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
