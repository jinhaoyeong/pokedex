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
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="group flex items-center gap-2 rounded-full border border-yellow-200/30 bg-gradient-to-r from-slate-950 via-[#10182f] to-slate-950 px-3 py-2 text-xs font-black text-yellow-50 shadow-lg shadow-black/25 transition hover:border-yellow-200/60 sm:gap-3 sm:px-4 sm:text-sm"
      >
        <span className="flex h-5 w-5 items-center justify-center text-yellow-200/90" aria-hidden>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 10h12l-4-4M17 14H5l4 4"
            />
          </svg>
        </span>
        <span className="hidden text-blue-200 sm:inline">Currency</span>
        <span className="tabular-nums">{currency}</span>
        <span
          className={`text-yellow-200/95 transition-transform duration-200 group-hover:text-yellow-100 ${isOpen ? "rotate-180" : ""}`}
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
        <div className="absolute right-0 z-50 mt-3 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-yellow-200/30 bg-[#071124]/95 p-2 shadow-2xl shadow-black/45 backdrop-blur-xl">
          <div className="px-3 py-2 text-xs font-black uppercase tracking-[0.22em] text-yellow-200">
            Trainer wallet
          </div>
          <div role="listbox" aria-label="Select currency" className="space-y-1">
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
                  className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition ${
                    isSelected
                      ? "border border-yellow-200/40 bg-yellow-300/15 text-yellow-50"
                      : "text-slate-200 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <span>
                    <span className="block font-black">{item}</span>
                    <span className="text-xs text-slate-400">{CURRENCY_LABELS[item]}</span>
                  </span>
                  <span
                    className={`h-3 w-3 rounded-full ${
                      isSelected ? "bg-yellow-300" : "bg-slate-600"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
