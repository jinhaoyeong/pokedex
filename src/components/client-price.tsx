"use client";

import { formatCurrency } from "@/lib/cards";
import { useCurrency } from "@/components/currency-provider";

export function ClientPrice({
  amountUsd,
  className,
}: {
  amountUsd: number;
  className?: string;
}) {
  const { currency, exchangeRates } = useCurrency();

  if (!Number.isFinite(amountUsd)) {
    return <span className={className}>N/A</span>;
  }

  return <span className={className}>{formatCurrency(amountUsd, currency, exchangeRates)}</span>;
}
