/**
 * Japanese Dex rows from TCGdex carry a real printed number (`neo3-001`) but no
 * pokemon-card.com official id. The official-detail identity gate must not block
 * those rows from the shared PriceCharting set-guide. Vintage TCGdex ids are
 * English-parallel (`neo3-001` = EN Ampharos, JA Zubat), so the list path must
 * price by the localized English name, not the companion id.
 */

export {
  inferEnglishNameFromTcgdexLocalizedName,
  resolveJapaneseListEnglishName,
  tcgdexEnglishCompanionNameAgrees,
} from "@/lib/tcgdex-japanese-name";

export function isGuideSecretRareCardId(
  cardId?: string | null,
  slug?: string | null,
) {
  return (
    /^ja--official-pc-[a-z0-9]+-\d+$/i.test(slug ?? "") ||
    /^official-pc-[a-z0-9]+-\d+$/i.test(cardId ?? "")
  );
}

export function isTcgdexStyleJapaneseCardId(
  cardId?: string | null,
  slug?: string | null,
) {
  if (isGuideSecretRareCardId(cardId, slug)) {
    return false;
  }

  if (/^ja--official-/i.test(slug ?? "") || /^official-/i.test(cardId ?? "")) {
    return false;
  }

  const raw = (cardId?.trim() || slug?.trim().replace(/^ja--/i, "") || "").trim();

  if (!raw || /^official-/i.test(raw)) {
    return false;
  }

  return /^[A-Za-z0-9][A-Za-z0-9.]*-\d+[A-Za-z0-9]*$/i.test(raw);
}

export function canUseJapaneseSetGuideWithoutOfficialIdentity(query: {
  language?: string | null;
  cardId?: string | null;
  slug?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  englishName?: string | null;
  setEnglishName?: string | null;
  setName?: string | null;
}) {
  if (query.language !== "ja") {
    return false;
  }

  if (
    !isGuideSecretRareCardId(query.cardId, query.slug) &&
    !isTcgdexStyleJapaneseCardId(query.cardId, query.slug)
  ) {
    return false;
  }

  if (!query.setCode?.trim() || !query.collectorNumber?.trim()) {
    return false;
  }

  return Boolean(
    query.englishName?.trim() ||
      query.setEnglishName?.trim() ||
      query.setName?.trim(),
  );
}
