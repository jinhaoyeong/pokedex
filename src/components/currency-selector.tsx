"use client";

import { useEffect, useRef, useState } from "react";

import { useCurrency } from "@/components/currency-provider";
import type { SupportedCurrency } from "@/types/pokemon";

const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  MYR: "Malaysian Ringgit",
};

export function CurrencySelector() {
  const { currency, setCurrency, supportedCurrencies } = useCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (
        wrapperRef.current &&
        event.target instanceof Node &&
        !wrapperRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    window.addEventListener("click", closeOnOutsideClick);
    return () => window.removeEventListener("click", closeOnOutsideClick);
  }, []);

  return (
    <div ref={wrapperRef} className="currency-selector relative w-full shrink-0 sm:w-auto">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="currency-trigger group flex w-full items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition sm:w-auto sm:gap-2.5 sm:px-4 sm:text-sm"
      >
        <span className="currency-trigger-icon flex h-5 w-5 items-center justify-center" aria-hidden>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 10h12l-4-4M17 14H5l4 4"
            />
          </svg>
        </span>
        <span className="currency-trigger-label hidden sm:inline">Currency</span>
        <span className="currency-trigger-value tabular-nums">{currency}</span>
        <span
          className={`currency-chevron transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.24-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {isOpen ? (
        <div className="currency-menu absolute right-0 z-50 mt-3 w-[min(17rem,calc(100vw-1rem))] overflow-hidden p-1.5 sm:w-[min(18rem,calc(100vw-1.5rem))]">
          <div className="currency-menu-label px-3 py-2">Currency</div>
          <div role="listbox" aria-label="Select currency" className="space-y-0.5">
            {supportedCurrencies.map((item) => {
              const isSelected = item === currency;

              return (
                <button
                  key={item}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setCurrency(item);
                    setIsOpen(false);
                  }}
                  className={`currency-option flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                    isSelected ? "currency-option--active" : ""
                  }`}
                >
                  <span>
                    <span className="currency-option-code block font-semibold">{item}</span>
                    <span className="currency-option-name text-xs">{CURRENCY_LABELS[item]}</span>
                  </span>
                  <span className="currency-option-dot" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
