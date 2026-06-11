import { LANGUAGE_LABELS } from "@/lib/search-constants";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

const SHORT_LANGUAGE_TAGS: Record<CardLanguageCode, string> = {
  en: "EN",
  ja: "JP",
  ko: "KO",
  "zh-cn": "CN",
  "zh-tw": "TW",
  fr: "FR",
  de: "DE",
  es: "ES",
  it: "IT",
  pt: "PT",
  "pt-br": "BR",
  "pt-pt": "PT",
  nl: "NL",
  pl: "PL",
  ru: "RU",
  id: "ID",
  th: "TH",
};

function parseEnglishFromBilingualName(name: string): string | null {
  const match = name.trim().match(/\(([^)]+)\)\s*$/);

  return match?.[1]?.trim() || null;
}

function resolveEnglishCardName(card: Pick<TcgCard, "name" | "englishName" | "localizedName">) {
  const explicitEnglish = card.englishName?.trim();

  if (explicitEnglish) {
    return explicitEnglish;
  }

  const fromBilingual = parseEnglishFromBilingualName(card.name);

  if (fromBilingual) {
    return fromBilingual;
  }

  if (card.localizedName?.trim() && card.localizedName.trim() !== card.name.trim()) {
    const fromLocalizedBilingual = parseEnglishFromBilingualName(card.localizedName);

    if (fromLocalizedBilingual) {
      return fromLocalizedBilingual;
    }
  }

  return card.name.trim();
}

/**
 * Search/list display: English cards use their name; localized prints show
 * English first with a short language tag, e.g. "Pikachu (JP)".
 */
export function formatCardDisplayName(
  card: Pick<TcgCard, "language" | "name" | "englishName" | "localizedName">,
): string {
  if (card.language === "en") {
    return card.name;
  }

  const englishName = resolveEnglishCardName(card);
  const languageTag = SHORT_LANGUAGE_TAGS[card.language] ?? card.language.toUpperCase();

  return `${englishName} (${languageTag})`;
}

export function formatCardLanguageTag(language: CardLanguageCode) {
  return SHORT_LANGUAGE_TAGS[language] ?? LANGUAGE_LABELS[language] ?? language.toUpperCase();
}
