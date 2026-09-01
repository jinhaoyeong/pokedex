/**
 * Japanese Dex rows from TCGdex carry a real printed number (`neo3-001`) but no
 * pokemon-card.com official id. Official browse tiles have the opposite gap:
 * an official id with no printed number. The official-detail identity gate
 * must not block those list rows from the shared PriceCharting set-guide.
 * Vintage TCGdex ids are English-parallel (`neo3-001` = EN Ampharos, JA Zubat),
 * so the list path must price by the localized English name, not the companion id.
 */

import { isLatinCardName, resolveJapaneseListEnglishName } from "@/lib/tcgdex-japanese-name";

export {
  inferEnglishNameFromTcgdexLocalizedName,
  isLatinCardName,
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

export function isOfficialJapaneseCatalogCardId(
  cardId?: string | null,
  slug?: string | null,
  officialCardId?: string | null,
) {
  if (isGuideSecretRareCardId(cardId, slug)) {
    return false;
  }

  if (/^ja--official-\d+$/i.test(slug ?? "") || /^official-\d+$/i.test(cardId ?? "")) {
    return true;
  }

  return /^\d+$/.test((officialCardId ?? "").trim());
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
  officialCardId?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  englishName?: string | null;
  setEnglishName?: string | null;
  setName?: string | null;
}) {
  if (query.language !== "ja") {
    return false;
  }

  if (!query.setCode?.trim()) {
    return false;
  }

  const hasMarketName = Boolean(
    query.englishName?.trim() ||
      query.setEnglishName?.trim() ||
      query.setName?.trim(),
  );

  if (isGuideSecretRareCardId(query.cardId, query.slug)) {
    return Boolean(query.collectorNumber?.trim() && hasMarketName);
  }

  if (isTcgdexStyleJapaneseCardId(query.cardId, query.slug)) {
    return Boolean(query.collectorNumber?.trim() && hasMarketName);
  }

  // Official Dex browse rows omit the printed number until official-detail
  // hydrates. Price those list tiles from the native set guide by English name.
  // Numbered official rows stay behind the confirmed-identity gate.
  if (
    isOfficialJapaneseCatalogCardId(query.cardId, query.slug, query.officialCardId) &&
    !query.collectorNumber?.trim()
  ) {
    return Boolean(query.englishName?.trim());
  }

  return false;
}

export function listEnglishNameForJapaneseSetGuide(query: {
  cardId?: string | null;
  slug?: string | null;
  officialCardId?: string | null;
  name?: string | null;
  englishName?: string | null;
  localizedName?: string | null;
}) {
  const syncName = resolveJapaneseListEnglishName({
    name: query.name,
    englishName: query.englishName,
    localizedName: query.localizedName,
  });

  if (syncName) {
    return syncName;
  }

  const officialEnglish = query.englishName?.trim();
  if (
    isOfficialJapaneseCatalogCardId(query.cardId, query.slug, query.officialCardId) &&
    officialEnglish &&
    isLatinCardName(officialEnglish)
  ) {
    return officialEnglish;
  }

  return undefined;
}
