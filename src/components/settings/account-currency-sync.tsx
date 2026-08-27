"use client";

import { useEffect } from "react";

import { useCurrency } from "@/components/currency-provider";
import { parseSupportedCurrency } from "@/lib/currency-preference";

export function AccountCurrencySync({
  preferredCurrency,
}: {
  preferredCurrency: string | null;
}) {
  const { currency, setCurrency } = useCurrency();

  useEffect(() => {
    const parsed = parseSupportedCurrency(preferredCurrency);

    if (parsed && parsed !== currency) {
      setCurrency(parsed);
    }
  }, [currency, preferredCurrency, setCurrency]);

  return null;
}
