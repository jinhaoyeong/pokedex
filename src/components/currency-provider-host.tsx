import type { ReactNode } from "react";

import { CurrencyProvider } from "@/components/currency-provider";
import { DEFAULT_PREFERRED_CURRENCY } from "@/lib/currency-preference";

/**
 * Currency lives in localStorage / the cookie boot script. Reading cookies()
 * here would dynamize the root layout and force every tab switch to wait on
 * a fresh RSC payload for the whole shell.
 */
export function CurrencyProviderHost({ children }: { children: ReactNode }) {
  return (
    <CurrencyProvider initialCurrency={DEFAULT_PREFERRED_CURRENCY}>{children}</CurrencyProvider>
  );
}
