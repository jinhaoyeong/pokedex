import type {
  CardEditionFilter,
  CardLanguageCode,
  CardLanguageFilter,
  SearchSortOption,
} from "@/types/pokemon";

export const DEFAULT_SEARCH_SORT: SearchSortOption = "relevance";
export const DEFAULT_EDITION_FILTER: CardEditionFilter = "all";

export const CARD_EDITION_FILTERS: Array<{
  value: CardEditionFilter;
  label: string;
}> = [
  { value: "all", label: "All editions" },
  { value: "unlimited", label: "Unlimited" },
  { value: "1st", label: "1st Edition" },
];

export function parseCardEditionFilter(value?: string | null): CardEditionFilter {
  if (value === "unlimited" || value === "1st") {
    return value;
  }
  return DEFAULT_EDITION_FILTER;
}

/** First Dex/search page size. Modest so tiles paint with art instead of a long empty tail. */
export const SEARCH_PAGE_SIZE = 24;
export const LOCALIZED_SEARCH_PAGE_SIZE = 24;

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
  { code: "all", label: "All languages" },
  ...SUPPORTED_CARD_LANGUAGES,
];
