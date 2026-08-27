import assert from "node:assert/strict";
import test from "node:test";

import {
  convertUsdToCurrency,
  fallbackExchangeRates,
  formatCurrency,
  sanitizeExchangeRates,
} from "../src/lib/cards";
import {
  DEFAULT_PREFERRED_CURRENCY,
  getCurrencyBootScript,
  parsePreferredCurrencyCookie,
  parseSupportedCurrency,
  readPreferredCurrencyFromCookieHeader,
  serializePreferredCurrencyCookie,
} from "../src/lib/currency-preference";

test("preferred currency defaults to MYR, not USD", () => {
  assert.equal(DEFAULT_PREFERRED_CURRENCY, "MYR");
  assert.equal(parseSupportedCurrency("myr"), "MYR");
  assert.equal(parseSupportedCurrency("USD"), "USD");
  assert.equal(parseSupportedCurrency("yen"), null);
});

test("cookie header round-trips the selected currency for SSR", () => {
  assert.equal(
    readPreferredCurrencyFromCookieHeader("pokedex_currency=MYR; Path=/"),
    "MYR",
  );
  assert.equal(
    parsePreferredCurrencyCookie("theme=dark; pokedex_currency=USD"),
    "USD",
  );
  assert.equal(parsePreferredCurrencyCookie(""), null);
  assert.equal(readPreferredCurrencyFromCookieHeader(undefined), "MYR");
  assert.match(serializePreferredCurrencyCookie("MYR"), /pokedex_currency=MYR/);
});

test("boot script prefers localStorage then cookie then MYR", () => {
  const script = getCurrencyBootScript();
  assert.match(script, /pokedex_currency/);
  assert.match(script, /"MYR"/);
  assert.match(script, /localStorage\.getItem/);
});

test("MYR prices multiply the USD amount by the FX quote", () => {
  assert.equal(convertUsdToCurrency(6500, "MYR"), 6500 * 3.93);
  assert.equal(formatCurrency(6500, "USD"), "$6,500.00");
  assert.equal(formatCurrency(6500, "MYR"), "MYR 25,545.00");
  assert.equal(formatCurrency(1, "MYR"), "MYR 3.93");
});

test("MYR formatting never keeps the USD numeral and only swaps the label", () => {
  assert.notEqual(formatCurrency(6500, "MYR"), "MYR 6,500.00");
  assert.notEqual(formatCurrency(6500, "MYR"), "$25,545.00");
});

test("inverted MYR quotes fall back so prices are not far too low", () => {
  const inverted = sanitizeExchangeRates({
    USD: 1,
    EUR: 0.93,
    GBP: 0.8,
    JPY: 153.8,
    MYR: 1 / 3.93,
  });

  assert.equal(inverted.MYR, fallbackExchangeRates.MYR);
  assert.equal(convertUsdToCurrency(6500, "MYR", { ...fallbackExchangeRates, MYR: 0.25 }), 25545);
});
