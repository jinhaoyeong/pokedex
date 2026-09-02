export function buildExactPrintPopulationQuery(card: {
  name?: string | null;
  englishName?: string | null;
  setName?: string | null;
  setEnglishName?: string | null;
  collectorNumber?: string | null;
  language?: string | null;
}) {
  const name = card.englishName?.trim() || card.name?.trim() || "";
  const setName = card.setEnglishName?.trim() || card.setName?.trim() || "";
  const number = card.collectorNumber?.trim() || "";
  const language =
    card.language && card.language !== "en"
      ? card.language === "ja"
        ? "Japanese"
        : card.language
      : "";
  return [name, setName, number, language].filter(Boolean).join(" ");
}

export function psaPopulationSearchHref(query: string) {
  return `https://www.psacard.com/pop?q=${encodeURIComponent(query)}`;
}

export function cgcPopulationSearchHref(query: string) {
  return `https://www.cgccards.com/census/?q=${encodeURIComponent(query)}`;
}
