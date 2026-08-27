import { tcgCards } from "@/data/cards";
import type {
  SearchResult,
  SupportedCurrency,
  TcgCard,
} from "@/types/pokemon";

export const supportedCurrencies: SupportedCurrency[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "MYR",
];

export const fallbackExchangeRates: Record<SupportedCurrency, number> = {
  USD: 1,
  EUR: 0.93,
  GBP: 0.8,
  JPY: 153.8,
  MYR: 3.93,
};

/** Quotes must be units of `currency` per 1 USD. Inverted MYR (~0.25) would make prices look far too low. */
const USD_QUOTE_BOUNDS: Record<SupportedCurrency, readonly [number, number]> = {
  USD: [1, 1],
  EUR: [0.5, 1.5],
  GBP: [0.4, 1.3],
  JPY: [80, 250],
  MYR: [2, 8],
};

export function isPlausibleUsdQuoteRate(currency: SupportedCurrency, rate: number): boolean {
  if (!Number.isFinite(rate) || rate <= 0) {
    return false;
  }

  const [min, max] = USD_QUOTE_BOUNDS[currency];
  return rate >= min && rate <= max;
}

export function sanitizeExchangeRates(
  rates: Partial<Record<SupportedCurrency, number>> | null | undefined,
): Record<SupportedCurrency, number> {
  const next: Record<SupportedCurrency, number> = { ...fallbackExchangeRates };

  for (const currency of supportedCurrencies) {
    const rate = rates?.[currency];
    if (typeof rate === "number" && isPlausibleUsdQuoteRate(currency, rate)) {
      next[currency] = rate;
    }
  }

  next.USD = 1;
  return next;
}

export function convertUsdToCurrency(
  amountUsd: number,
  currency: SupportedCurrency,
  exchangeRates: Record<SupportedCurrency, number> = fallbackExchangeRates,
): number {
  const rates = sanitizeExchangeRates(exchangeRates);
  return amountUsd * rates[currency];
}

function normalizeTerm(value: string) {
  return value.trim().toLowerCase();
}

export function getCards(): TcgCard[] {
  return tcgCards;
}

export function getCardBySlug(slug: string): TcgCard | undefined {
  return tcgCards.find((card) => card.slug === slug);
}

export function formatCurrency(
  amountUsd: number,
  currency: SupportedCurrency = "USD",
  exchangeRates: Record<SupportedCurrency, number> = fallbackExchangeRates,
) {
  const convertedValue = convertUsdToCurrency(amountUsd, currency, exchangeRates);

  // Intl separates a currency code from the amount with U+00A0. Most of our
  // price type is `tabular-nums`, and the no-break space picks up the tabular
  // figure width there, which reads as a conspicuous gap ("MYR    5,698.50").
  // A plain space renders at its normal width; the wrap-point it introduces is
  // handled by `word-break: keep-all` on the figures that must not split.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  })
    .format(convertedValue)
    .replace(/[\u00a0\u202f]/g, " ");
}

export function searchCards(query: string, setFilter?: string): SearchResult[] {
  const term = normalizeTerm(query);
  const normalizedSetFilter = setFilter ? normalizeTerm(setFilter) : "";

  return tcgCards
    .map((card) => {
      let score = 0;
      let matchReason = "Related result";

      const searchableText = [
        card.name,
        card.collectorNumber,
        card.setCode,
        card.setName,
        card.rarity,
      ]
        .join(" ")
        .toLowerCase();

      if (!term) {
        score += 10;
      } else if (
        normalizeTerm(card.collectorNumber) === term ||
        `${normalizeTerm(card.setCode)} ${normalizeTerm(card.collectorNumber)}` === term
      ) {
        score += 120;
        matchReason = "Exact set and number match";
      } else if (
        searchableText.includes(term) ||
        normalizeTerm(card.name).includes(term)
      ) {
        score += 60;
        matchReason = "Text search match";
      }

      if (normalizedSetFilter) {
        const setMatched =
          normalizeTerm(card.setCode) === normalizedSetFilter ||
          normalizeTerm(card.setName).includes(normalizedSetFilter);

        if (setMatched) {
          score += 40;
          matchReason =
            matchReason === "Exact set and number match"
              ? matchReason
              : "Set-filtered match";
        } else {
          score -= 100;
        }
      }

      return { card, score, matchReason };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.card.marketPriceUsd - a.card.marketPriceUsd);
}
