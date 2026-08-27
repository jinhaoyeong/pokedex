import type { SupportedCurrency } from "@/types/pokemon";

export const CURRENCY_COOKIE_NAME = "pokedex_currency";
export const CURRENCY_STORAGE_KEY = "pokedex_currency";
export const CURRENCY_STORAGE_EVENT = "pokedex-currency-change";
export const FX_STORAGE_KEY = "pokedex_fx_rates_v1";
export const CURRENCY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Matches the account-settings default so first paint is MYR, not USD. */
export const DEFAULT_PREFERRED_CURRENCY: SupportedCurrency = "MYR";

const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "MYR",
];

export function parseSupportedCurrency(
  value: string | null | undefined,
): SupportedCurrency | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  return SUPPORTED_CURRENCIES.includes(normalized as SupportedCurrency)
    ? (normalized as SupportedCurrency)
    : null;
}

export function parsePreferredCurrencyCookie(
  cookieHeader: string | undefined,
): SupportedCurrency | null {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(/(?:^|;\s*)pokedex_currency=([^;]*)/i);
  return parseSupportedCurrency(match?.[1] ? decodeURIComponent(match[1]) : null);
}

export function readPreferredCurrencyFromCookieHeader(
  cookieHeader: string | undefined,
  fallback: SupportedCurrency = DEFAULT_PREFERRED_CURRENCY,
): SupportedCurrency {
  return parsePreferredCurrencyCookie(cookieHeader) ?? fallback;
}

export function serializePreferredCurrencyCookie(currency: SupportedCurrency): string {
  return `${CURRENCY_COOKIE_NAME}=${currency}; Path=/; Max-Age=${CURRENCY_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function readStoredPreferredCurrency(): SupportedCurrency | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = parseSupportedCurrency(window.localStorage.getItem(CURRENCY_STORAGE_KEY));
  if (stored) {
    return stored;
  }

  return parsePreferredCurrencyCookie(document.cookie);
}

function expirePreferredCurrencyCookie(): string {
  return `${CURRENCY_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function persistPreferredCurrency(currency: SupportedCurrency) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  document.cookie = serializePreferredCurrencyCookie(currency);
  window.dispatchEvent(new Event(CURRENCY_STORAGE_EVENT));
}

export function clearPreferredCurrency() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(CURRENCY_STORAGE_KEY);
  document.cookie = expirePreferredCurrencyCookie();
  window.dispatchEvent(new Event(CURRENCY_STORAGE_EVENT));
}

/** Runs before React hydrates so the next request's SSR cookie matches this device. */
export function getCurrencyBootScript() {
  const key = JSON.stringify(CURRENCY_STORAGE_KEY);
  const allowed = JSON.stringify(SUPPORTED_CURRENCIES);
  const fallback = JSON.stringify(DEFAULT_PREFERRED_CURRENCY);

  return `try{var k=${key};var a=${allowed};var s="";try{s=localStorage.getItem(k)||""}catch(e){}var m=document.cookie.match(/(?:^|; )pokedex_currency=([^;]*)/);var c=m?decodeURIComponent(m[1]):"";var n=a.indexOf(s)>=0?s:a.indexOf(c)>=0?c:${fallback};if(c!==n){document.cookie=k+"="+n+"; Path=/; Max-Age=${CURRENCY_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax"}document.documentElement.dataset.currency=n}catch(e){}`;
}
