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

export const SUPPORTED_CARD_LANGUAGES = Object.entries(LANGUAGE_LABELS).map(
  ([code, label]) => ({
    code: code as CardLanguageCode,
    label,
  }),
);

/** Non-English catalogs queried when language filter is "all" (keeps search fast). */
export const ALL_LANGUAGE_SEARCH_PREVIEW_CODES: CardLanguageCode[] = [
  "ja",
  "ko",
  "zh-cn",
  "zh-tw",
  "fr",
];

export const CARD_LANGUAGE_FILTERS: Array<{
  code: CardLanguageFilter;
  label: string;
}> = [
  { code: "all", label: "All languages" },
  ...SUPPORTED_CARD_LANGUAGES,
];
