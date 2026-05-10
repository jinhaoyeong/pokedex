"use client";

import { useCurrency } from "@/components/currency-provider";

export function CurrencySelector() {
  const { currency, setCurrency, supportedCurrencies } = useCurrency();

  return (
    <label className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
      <span className="text-slate-400">Currency</span>
      <select
        aria-label="Select currency"
        className="bg-transparent font-medium outline-none"
        value={currency}
        onChange={(event) => setCurrency(event.target.value as typeof currency)}
      >
        {supportedCurrencies.map((item) => (
          <option key={item} value={item} className="bg-slate-950 text-white">
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}
