/**
 * English Pokémon TCG API prints host art at images.pokemontcg.io.
 * Local index / learned-cache rows sometimes store the parent set (SWSH09)
 * for a Trainer Gallery number (TG16) and omit the image URL. Map those
 * back to the TG/GG subset so Dex tiles are not artless.
 */

const POKEMON_TCG_IMAGE_HOST = "https://images.pokemontcg.io";

const TRAINER_GALLERY_PARENT_TO_SET: Record<string, string> = {
  swsh9: "swsh9tg",
  swsh09: "swsh9tg",
  swsh10: "swsh10tg",
  swsh11: "swsh11tg",
  swsh12: "swsh12tg",
  swsh12pt5: "swsh12pt5gg",
};

export type EnglishPrintImageCard = {
  id?: string | null;
  language?: string | null;
  image?: string | null;
  imageStatus?: string | null;
  setId?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
};

function compactSetKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function catalogSetIdFromCardId(cardId?: string | null) {
  const clean = (cardId ?? "").trim();
  if (!clean || clean.includes("--")) {
    return "";
  }

  const separatorIndex = clean.lastIndexOf("-");
  return separatorIndex > 0 ? clean.slice(0, separatorIndex) : "";
}

export function resolveTrainerGalleryEnglishSetId(
  setId: string | null | undefined,
  collectorNumber: string | null | undefined,
) {
  const number = (collectorNumber ?? "").trim().toUpperCase();
  const raw = compactSetKey(setId ?? "");
  if (!raw) {
    return "";
  }

  if (/^tg\d+$/i.test(number)) {
    if (raw.endsWith("tg")) {
      return raw;
    }
    return TRAINER_GALLERY_PARENT_TO_SET[raw] ?? (raw.startsWith("swsh") ? `${raw.replace(/^swsh0+/, "swsh")}tg` : raw);
  }

  if (/^gg\d+$/i.test(number)) {
    if (raw.endsWith("gg")) {
      return raw;
    }
    return TRAINER_GALLERY_PARENT_TO_SET[raw] ?? "swsh12pt5gg";
  }

  return raw;
}

export function pokemonTcgPrintImageUrl(setId: string, collectorNumber: string) {
  const set = compactSetKey(setId);
  const number = collectorNumber.trim();
  if (!set || !number || /official/i.test(set)) {
    return "";
  }

  return `${POKEMON_TCG_IMAGE_HOST}/${set}/${encodeURIComponent(number)}_hires.png`;
}

function hasUsablePrintImage(image?: string | null) {
  const value = image?.trim() ?? "";
  return Boolean(value) && value !== "/icon.svg";
}

export function withDerivedEnglishPrintImage<T extends EnglishPrintImageCard>(card: T): T {
  if (card.language && card.language !== "en") {
    return card;
  }

  if (hasUsablePrintImage(card.image) && card.imageStatus !== "placeholder") {
    return card;
  }

  const collectorNumber = (card.collectorNumber ?? "").trim();
  const setId =
    catalogSetIdFromCardId(card.id) ||
    resolveTrainerGalleryEnglishSetId(card.setId ?? card.setCode, collectorNumber) ||
    compactSetKey(card.setId ?? "") ||
    compactSetKey(card.setCode ?? "");

  if (!collectorNumber || !setId) {
    return card;
  }

  const gallerySetId = resolveTrainerGalleryEnglishSetId(setId, collectorNumber) || setId;
  const image = pokemonTcgPrintImageUrl(gallerySetId, collectorNumber);
  if (!image) {
    return card;
  }

  return {
    ...card,
    image,
    imageStatus: "derived",
    ...(gallerySetId && gallerySetId !== compactSetKey(card.setId ?? "")
      ? { setId: gallerySetId }
      : {}),
  };
}
