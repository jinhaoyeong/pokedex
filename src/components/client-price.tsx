"use client";

import { formatCurrency } from "@/lib/cards";
import {
  CURRENCY_LABEL_ATTR,
  PRICE_FX_PAINTED_ATTR,
  PRICE_USD_ATTR,
} from "@/lib/currency-preference";
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

  return (
    <span
      className={className}
      suppressHydrationWarning
      {...{
        [PRICE_USD_ATTR]: String(amountUsd),
        [PRICE_FX_PAINTED_ATTR]: currency,
      }}
    >
      {formatCurrency(amountUsd, currency, exchangeRates)}
    </span>
  );
}

export function CurrencyLabel({ className }: { className?: string }) {
  const { currency } = useCurrency();

  return (
    <span className={className} suppressHydrationWarning {...{ [CURRENCY_LABEL_ATTR]: "" }}>
      {currency}
    </span>
  );
}
