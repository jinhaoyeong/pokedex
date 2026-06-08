import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

export function buildCardKey(input: {
  language: string;
  setCode: string;
  collectorNumber: string;
}) {
  const number = input.collectorNumber.replace(/^0+(?=\d)/, "") || "0";
  return `${input.language.toLowerCase()}:${input.setCode.toUpperCase()}:${number}`;
}

export function cardKeyFromTcgCard(card: TcgCard) {
  return buildCardKey({
    language: card.language,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
  });
}

export function normalizeSetId(value: string) {
  return value.trim().toLowerCase();
}

export const SUPPORTED_INGEST_LANGUAGES: CardLanguageCode[] = [
  "en",
  "fr",
  "es",
  "it",
  "pt-br",
  "de",
  "nl",
  "pl",
  "ru",
  "ja",
  "ko",
  "zh-tw",
  "zh-cn",
  "id",
  "th",
];
