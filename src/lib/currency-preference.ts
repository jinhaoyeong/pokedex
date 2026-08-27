import type { SupportedCurrency } from "@/types/pokemon";

export const CURRENCY_COOKIE_NAME = "pokedex_currency";
export const CURRENCY_STORAGE_KEY = "pokedex_currency";
export const CURRENCY_STORAGE_EVENT = "pokedex-currency-change";
export const FX_STORAGE_KEY = "pokedex_fx_rates_v1";
export const CURRENCY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const PRICE_USD_ATTR = "data-price-usd";
export const PRICE_FX_PAINTED_ATTR = "data-fx-painted";
export const CURRENCY_LABEL_ATTR = "data-currency-label";

/** Matches the account-settings default so first paint is MYR, not USD. */
export const DEFAULT_PREFERRED_CURRENCY: SupportedCurrency = "MYR";

const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "MYR",
];

const BOOT_FALLBACK_RATES: Record<SupportedCurrency, number> = {
  USD: 1,
  EUR: 0.93,
  GBP: 0.8,
  JPY: 153.8,
  MYR: 3.93,
};

declare global {
  interface Window {
    __POKEDEX_CURRENCY__?: SupportedCurrency;
    __POKEDEX_PAINT_CURRENCY__?: (currency?: SupportedCurrency) => void;
  }
}

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

export function readClientPreferredCurrency(
  fallback: SupportedCurrency = DEFAULT_PREFERRED_CURRENCY,
): SupportedCurrency {
  if (typeof window === "undefined") {
    return fallback;
  }

  return (
    parseSupportedCurrency(window.__POKEDEX_CURRENCY__) ??
    parseSupportedCurrency(document.documentElement.dataset.currency) ??
    readStoredPreferredCurrency() ??
    fallback
  );
}

function expirePreferredCurrencyCookie(): string {
  return `${CURRENCY_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function persistPreferredCurrency(currency: SupportedCurrency) {
  if (typeof window === "undefined") {
    return;
  }

  const previous = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
  window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  document.cookie = serializePreferredCurrencyCookie(currency);
  window.__POKEDEX_CURRENCY__ = currency;
  document.documentElement.dataset.currency = currency;
  window.__POKEDEX_PAINT_CURRENCY__?.(currency);

  if (previous !== currency) {
    window.dispatchEvent(new Event(CURRENCY_STORAGE_EVENT));
  }
}

export function clearPreferredCurrency() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(CURRENCY_STORAGE_KEY);
  document.cookie = expirePreferredCurrencyCookie();
  delete window.__POKEDEX_CURRENCY__;
  document.documentElement.removeAttribute("data-currency");
  window.dispatchEvent(new Event(CURRENCY_STORAGE_EVENT));
}

/**
 * Blocking <head> script: stamp the device currency before the body parses, hide
 * mismatched SSR dollar amounts, and rewrite [data-price-usd] nodes as they appear.
 */
export function getCurrencyBootScript() {
  const key = JSON.stringify(CURRENCY_STORAGE_KEY);
  const fxKey = JSON.stringify(FX_STORAGE_KEY);
  const allowed = JSON.stringify(SUPPORTED_CURRENCIES);
  const fallback = JSON.stringify(DEFAULT_PREFERRED_CURRENCY);
  const rates = JSON.stringify(BOOT_FALLBACK_RATES);
  const maxAge = String(CURRENCY_COOKIE_MAX_AGE_SECONDS);

  return `(function(){try{var d=document;var de=d.documentElement;var st=d.createElement("style");st.setAttribute("data-currency-boot","true");st.appendChild(d.createTextNode('html[data-currency] [data-price-usd]{visibility:hidden}html[data-currency="USD"] [data-price-usd][data-fx-painted="USD"],html[data-currency="EUR"] [data-price-usd][data-fx-painted="EUR"],html[data-currency="GBP"] [data-price-usd][data-fx-painted="GBP"],html[data-currency="JPY"] [data-price-usd][data-fx-painted="JPY"],html[data-currency="MYR"] [data-price-usd][data-fx-painted="MYR"]{visibility:visible}'));(d.head||de).appendChild(st);var k=${key};var a=${allowed};var rates=${rates};try{var fx=JSON.parse(localStorage.getItem(${fxKey})||"null");if(fx&&fx.rates){var myr=fx.rates.MYR;if(typeof myr==="number"&&myr>=2&&myr<=8){rates=Object.assign({},rates,fx.rates)}}}catch(e){}var s="";try{s=localStorage.getItem(k)||""}catch(e){}var m=d.cookie.match(/(?:^|; )pokedex_currency=([^;]*)/);var c=m?decodeURIComponent(m[1]):"";var n=a.indexOf(s)>=0?s:a.indexOf(c)>=0?c:${fallback};window.__POKEDEX_CURRENCY__=n;de.setAttribute("data-currency",n);if(c!==n){d.cookie=k+"="+n+"; Path=/; Max-Age=${maxAge}; SameSite=Lax"}function fmt(usd){var v=usd*(rates[n]||1);var dig=n==="JPY"?0:2;var num=v.toLocaleString("en-US",{minimumFractionDigits:dig,maximumFractionDigits:dig});if(n==="USD")return"$"+num;if(n==="EUR")return"\\u20ac"+num;if(n==="GBP")return"\\u00a3"+num;if(n==="JPY")return"\\u00a5"+num;return n+" "+num}function paint(el){var usd=Number(el.getAttribute("data-price-usd"));if(!isFinite(usd))return;var text=fmt(usd);if(el.getAttribute("data-fx-painted")===n&&el.textContent===text)return;el.textContent=text;el.setAttribute("data-fx-painted",n)}function paintAll(root){if(!root||root.nodeType!==1)return;if(root.getAttribute&&root.getAttribute("data-price-usd")!=null)paint(root);var nodes=root.querySelectorAll?root.querySelectorAll("[data-price-usd]"):[];for(var i=0;i<nodes.length;i++)paint(nodes[i]);if(root.getAttribute&&root.hasAttribute("data-currency-label")&&root.textContent!==n)root.textContent=n;var labels=root.querySelectorAll?root.querySelectorAll("[data-currency-label]"):[];for(var j=0;j<labels.length;j++){if(labels[j].textContent!==n)labels[j].textContent=n}}function sync(){paintAll(d.documentElement)}window.__POKEDEX_PAINT_CURRENCY__=function(next){if(typeof next==="string"&&a.indexOf(next)>=0){n=next;window.__POKEDEX_CURRENCY__=next;de.setAttribute("data-currency",next)}sync()};new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var mu=muts[i];if(mu.type==="childList"){for(var j=0;j<mu.addedNodes.length;j++)paintAll(mu.addedNodes[j])}else if(mu.target&&mu.target.getAttribute&&mu.target.getAttribute("data-price-usd")!=null){paint(mu.target)}}}).observe(de,{childList:true,subtree:true,attributes:true,attributeFilter:["data-price-usd","data-fx-painted"]});if(d.body)sync();else d.addEventListener("DOMContentLoaded",sync)}catch(e){}})();`;
}
