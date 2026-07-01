import type { CardLanguageCode, CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

export const DEFAULT_SEARCH_SORT: SearchSortOption = "relevance";

export const LANGUAGE_LABELS: Record<CardLanguageCode, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  "pt-br": "Portuguese (Brazil)",
  "pt-pt": "Portuguese (Portugal)",
  de: "German",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  "zh-tw": "Chinese Traditional",
  id: "Indonesian",
  th: "Thai",
  "zh-cn": "Chinese Simplified",
};

const PRIMARY_MARKET_LANGUAGE_CODES = ["en", "ja", "zh-cn", "zh-tw"] as const;

export const SUPPORTED_CARD_LANGUAGES = PRIMARY_MARKET_LANGUAGE_CODES.map((code) => ({
  code,
  label: LANGUAGE_LABELS[code],
}));

/** Non-English catalogs queried when language filter is "all" (keeps search fast). */
export const ALL_LANGUAGE_SEARCH_PREVIEW_CODES: CardLanguageCode[] = [
  "ja",
  "zh-cn",
  "zh-tw",
];

export const CARD_LANGUAGE_FILTERS: Array<{
  code: CardLanguageFilter;
  label: string;
}> = [
  { code: "all", label: "All supported languages" },
  ...SUPPORTED_CARD_LANGUAGES,
];
