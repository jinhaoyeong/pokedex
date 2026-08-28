import { buildSearchHref } from "@/lib/search-href";
import type { CardLanguageFilter, TcgCard } from "@/types/pokemon";

export function cardSetFilterValue(card: Pick<TcgCard, "setId" | "setCode" | "language">) {
  if (card.language === "ja") {
    return (card.setCode || card.setId || "").trim().toUpperCase();
  }

  return (card.setId || card.setCode || "").trim();
}

export function cardSetSearchLanguage(card: Pick<TcgCard, "language">): CardLanguageFilter {
  return card.language && card.language !== "en" ? card.language : "en";
}

export function buildSetSearchHref(card: Pick<TcgCard, "setId" | "setCode" | "language">) {
  const setFilter = cardSetFilterValue(card);

  if (!setFilter) {
    return "/search";
  }

  return buildSearchHref({
    query: "",
    setFilter,
    language: cardSetSearchLanguage(card),
    sort: "number-asc",
    page: 1,
  });
}
