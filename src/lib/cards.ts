import { tcgCards, tcgSets } from "@/data/cards";
import type {
  SearchResult,
  SupportedCurrency,
  TcgCard,
  TcgSet,
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

function normalizeTerm(value: string) {
  return value.trim().toLowerCase();
}

export function getSets(): TcgSet[] {
  return tcgSets;
}

export function getCards(): TcgCard[] {
  return tcgCards;
}

export function getFeaturedCards(limit = 3): TcgCard[] {
  return [...tcgCards].sort((a, b) => b.marketPriceUsd - a.marketPriceUsd).slice(0, limit);
}

export function getCardBySlug(slug: string): TcgCard | undefined {
  return tcgCards.find((card) => card.slug === slug);
}

export function getCardById(id: string): TcgCard | undefined {
  return tcgCards.find((card) => card.id === id);
}

export function formatCurrency(
  amountUsd: number,
  currency: SupportedCurrency = "USD",
  exchangeRates: Record<SupportedCurrency, number> = fallbackExchangeRates,
) {
  const convertedValue = amountUsd * exchangeRates[currency];

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(convertedValue);
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
