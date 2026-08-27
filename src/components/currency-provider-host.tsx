import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { CurrencyProvider } from "@/components/currency-provider";
import {
  CURRENCY_COOKIE_NAME,
  DEFAULT_PREFERRED_CURRENCY,
  parseSupportedCurrency,
} from "@/lib/currency-preference";

export async function CurrencyProviderHost({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const initialCurrency =
    parseSupportedCurrency(cookieStore.get(CURRENCY_COOKIE_NAME)?.value) ??
    DEFAULT_PREFERRED_CURRENCY;

  return <CurrencyProvider initialCurrency={initialCurrency}>{children}</CurrencyProvider>;
}
