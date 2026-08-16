import type { CardSourceNote, TcgCard } from "@/types/pokemon";

const PLACEHOLDER_HP = /^(?:-|\u2014|n\/a|na|unknown)?$/i;
const PLACEHOLDER_ARTIST = /^(?:unknown|n\/a|-|\u2014)?$/i;
const PLACEHOLDER_RARITY =
  /^(localized release|official\s+\w+\s+release|unknown.*|type pending|[-—–])$/i;
const PLACEHOLDER_SET_NAME = /^(?:unknown|n\/a|-)?$/i;

export type CatalogFactsPatch = {
  collectorNumber?: string;
  setCode?: string;
  setId?: string;
  name?: string;
  englishName?: string;
  localizedName?: string;
  hp?: string;
  types?: string[];
  artist?: string;
  rarity?: string;
  stage?: string;
  dexIds?: number[];
  attacks?: TcgCard["attacks"];
  retreatCost?: number | null;
  legalities?: TcgCard["legalities"];
  setName?: string;
  setEnglishName?: string;
  setLocalizedName?: string;
  setPrintedTotal?: number;
  setTotal?: number;
  image?: string;
  imageStatus?: TcgCard["imageStatus"];
  sources?: CardSourceNote[];
};

export function isMissingHp(hp?: string | null) {
  return !hp || PLACEHOLDER_HP.test(hp.trim());
}

export function isPlaceholderArtist(artist?: string | null) {
  return !artist || PLACEHOLDER_ARTIST.test(artist.trim());
}

export function isPlaceholderRarity(rarity?: string | null) {
  const normalized = (rarity ?? "").trim();
  return !normalized || PLACEHOLDER_RARITY.test(normalized);
}

export function isPlaceholderSetName(value?: string | null) {
  const normalized = (value ?? "").trim();
  return !normalized || PLACEHOLDER_SET_NAME.test(normalized) || /^[A-Z0-9.]+$/.test(normalized);
}

export function isThinCatalogCard(card: Pick<TcgCard, "hp" | "types" | "rarity">) {
  return !card.types?.length || isPlaceholderRarity(card.rarity);
}

function normalizeName(value?: string | null) {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCollectorNumber(value?: string | null) {
  return (value ?? "").trim().replace(/^0+(?=\d)/, "").toLowerCase();
}

function normalizeSetToken(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SET_TOKEN_ALIASES: Record<string, string[]> = {
  me2pt5: ["me025", "me25"],
  me025: ["me2pt5", "me25"],
  me25: ["me2pt5", "me025"],
};

function setsMatch(left?: string | null, right?: string | null) {
  const a = normalizeSetToken(left);
  const b = normalizeSetToken(right);

  if (!a || !b) {
    return false;
  }

  return a === b || Boolean(SET_TOKEN_ALIASES[a]?.includes(b));
}

export function catalogNamesAgree(
  left: { englishName?: string; name?: string },
  right: { englishName?: string; name?: string },
) {
  const leftName = normalizeName(left.englishName) || normalizeName(left.name);
  const rightName = normalizeName(right.englishName) || normalizeName(right.name);

  if (!leftName || !rightName) {
    return true;
  }

  return leftName.includes(rightName) || rightName.includes(leftName);
}

export function isSameCatalogPrint(base: TcgCard, patch: CatalogFactsPatch) {
  const numberMatch =
    Boolean(patch.collectorNumber) &&
    normalizeCollectorNumber(base.collectorNumber) ===
      normalizeCollectorNumber(patch.collectorNumber);
  const setMatch =
    setsMatch(base.setCode, patch.setCode) ||
    setsMatch(base.setId, patch.setId) ||
    setsMatch(base.setCode, patch.setId) ||
    setsMatch(base.setId, patch.setCode);

  if (numberMatch && setMatch) {
    return true;
  }

  return Boolean(setMatch && catalogNamesAgree(base, patch));
}

function pickText(
  current: string | undefined,
  incoming: string | undefined,
  isPlaceholder: (value?: string | null) => boolean,
) {
  if (incoming && !isPlaceholder(incoming)) {
    return incoming;
  }

  return current;
}

function mergeSources(current: CardSourceNote[] = [], incoming: CardSourceNote[] = []) {
  const bySource = new Map(current.map((source) => [source.source, source]));

  for (const source of incoming) {
    bySource.set(source.source, source);
  }

  return [...bySource.values()];
}

export function applyCatalogFactsPatch(base: TcgCard, patch: CatalogFactsPatch): TcgCard {
  if (!isSameCatalogPrint(base, patch)) {
    return {
      ...base,
      types: base.types.length ? base.types : patch.types ?? base.types,
      dexIds: base.dexIds?.length ? base.dexIds : patch.dexIds,
      stage: base.stage || patch.stage,
      sources: mergeSources(base.sources, patch.sources),
    };
  }

  const nextImage =
    patch.image && patch.image !== "/icon.svg" && (base.image === "/icon.svg" || !base.image)
      ? patch.image
      : base.image;
  const nextSetName = pickText(base.setName, patch.setName, isPlaceholderSetName);
  const nextEnglishSet = pickText(base.setEnglishName, patch.setEnglishName, isPlaceholderSetName);

  return {
    ...base,
    hp: pickText(base.hp, patch.hp, isMissingHp) ?? base.hp,
    types: patch.types?.length ? patch.types : base.types,
    artist: pickText(base.artist, patch.artist, isPlaceholderArtist) ?? base.artist,
    rarity: pickText(base.rarity, patch.rarity, isPlaceholderRarity) ?? base.rarity,
    stage: base.stage || patch.stage,
    dexIds: patch.dexIds?.length ? patch.dexIds : base.dexIds,
    attacks: patch.attacks?.length ? patch.attacks : base.attacks,
    retreatCost: base.retreatCost ?? patch.retreatCost,
    legalities: base.legalities ?? patch.legalities,
    setName: nextSetName ?? base.setName,
    setEnglishName: nextEnglishSet ?? base.setEnglishName,
    setLocalizedName: pickText(base.setLocalizedName, patch.setLocalizedName, isPlaceholderSetName) ??
      base.setLocalizedName,
    setPrintedTotal: base.setPrintedTotal ?? patch.setPrintedTotal,
    setTotal: Math.max(base.setTotal ?? 0, patch.setTotal ?? 0) || base.setTotal || patch.setTotal,
    image: nextImage,
    imageStatus:
      nextImage && nextImage !== "/icon.svg"
        ? patch.imageStatus === "official" || base.imageStatus === "official"
          ? "official"
          : base.imageStatus === "placeholder"
            ? patch.imageStatus ?? "derived"
            : base.imageStatus
        : base.imageStatus,
    englishName: base.englishName?.trim() || patch.englishName,
    localizedName: base.localizedName?.trim() || patch.localizedName,
    sources: mergeSources(base.sources, patch.sources),
  };
}

export function inferStageFromCardName(name?: string | null) {
  const text = name ?? "";

  if (/\bmega\b/i.test(text)) {
    return "Basic";
  }

  if (/\b(vmax|vstar|v-union|gx|ex|\bv\b)\b/i.test(text)) {
    return "Basic";
  }

  return undefined;
}

export function latestCardTimestamp(card: Pick<TcgCard, "sources" | "psaPopulation">) {
  const stamps = [
    card.psaPopulation?.fetchedAt,
    ...card.sources.map((source) => source.fetchedAt),
  ]
    .map((value) => Date.parse(value ?? ""))
    .filter((value) => Number.isFinite(value));

  if (!stamps.length) {
    return null;
  }

  return new Date(Math.max(...stamps)).toISOString();
}
