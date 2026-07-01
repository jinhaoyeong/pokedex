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

  return <span className={className}>{formatCurrency(amountUsd, currency, exchangeRates)}</span>;
}
