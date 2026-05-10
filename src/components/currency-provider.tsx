"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { supportedCurrencies } from "@/lib/cards";
import type { SupportedCurrency } from "@/types/pokemon";

interface CurrencyContextValue {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  supportedCurrencies: SupportedCurrency[];
}

const STORAGE_KEY = "pokedex_currency";
const STORAGE_EVENT = "pokedex-currency-change";

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

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

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const currency = useSyncExternalStore<SupportedCurrency>(
    subscribe,
    readCurrency,
    () => "USD",
  );

  const value = useMemo(
    () => ({
      currency,
      supportedCurrencies,
      setCurrency: (nextCurrency: SupportedCurrency) => {
        window.localStorage.setItem(STORAGE_KEY, nextCurrency);
        window.dispatchEvent(new Event(STORAGE_EVENT));
      },
    }),
    [currency],
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
