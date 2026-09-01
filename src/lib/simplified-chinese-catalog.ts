import catalogPayload from "../../data/simplified-chinese-catalog.json";

import { LANGUAGE_LABELS } from "@/lib/search-constants";
import { compareTcgSetsForDisplay } from "@/lib/set-display-sort";
import type { CollectorCodeQuery } from "@/lib/pokemon-tcg/api-types";
import {
  buildLocalizedSlug,
  collectorCodeConstrainsPrintedTotal,
  collectorNumberMatchesCode,
  collectorSetCodeSearchKeys,
  formatBilingualName,
  normalizeSearchText,
  parseLocalizedSlug,
  textMatchesQuery,
} from "@/lib/pokemon-tcg/text-and-collector-utils";
import type {
  CardLanguageFilter,
  SearchResult,
  TcgCard,
  TcgSet,
} from "@/types/pokemon";

type SimplifiedChineseSetRecord = {
  id: string;
  code: string;
  localizedName: string;
  englishName: string;
  releaseDate?: string;
  printedTotal?: number | null;
  total?: number | null;
  aliases?: string[];
};

type SimplifiedChineseCardRecord = {
  id: string;
  setId: string;
  collectorNumber: string;
  localizedName: string;
  englishName?: string;
  supertype?: string;
  rarity?: string;
  subtype?: string;
  hp?: string;
  types?: string[];
  artist?: string;
  image?: string;
  promotion?: string;
};

type SimplifiedChineseCatalogFile = {
  version: number;
  sets: SimplifiedChineseSetRecord[];
  cards: SimplifiedChineseCardRecord[];
};

const payload = catalogPayload as SimplifiedChineseCatalogFile;
const catalogSets = Array.isArray(payload.sets) ? payload.sets : [];
const catalogCards = Array.isArray(payload.cards) ? payload.cards : [];

const EMPTY_PRICE_HISTORY = [
  { date: "1970-01-01", value: 0 },
  { date: "1970-01-01", value: 0 },
  { date: "1970-01-01", value: 0 },
  { date: "1970-01-01", value: 0 },
  { date: "1970-01-01", value: 0 },
];

function normalizeNeedle(value: string) {
  return normalizeSearchText(value).replace(/[\s/_-]+/g, " ").trim();
}

function compactSetKey(value: string) {
  return value.trim().toUpperCase().replace(/[\s_-]+/g, "");
}

function setSearchBlob(set: SimplifiedChineseSetRecord) {
  return normalizeNeedle(
    [set.id, set.code, set.localizedName, set.englishName, ...(set.aliases ?? [])]
      .filter(Boolean)
      .join(" "),
  );
}

function cardSearchBlob(card: SimplifiedChineseCardRecord, set: SimplifiedChineseSetRecord) {
  return normalizeNeedle(
    [
      card.localizedName,
      card.englishName,
      card.collectorNumber,
      card.promotion,
      card.rarity,
      card.supertype,
      card.subtype,
      set.id,
      set.code,
      set.localizedName,
      set.englishName,
      ...(set.aliases ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const setsById = new Map(catalogSets.map((set) => [set.id.trim().toUpperCase(), set]));

function setForCard(card: SimplifiedChineseCardRecord) {
  return setsById.get(card.setId.trim().toUpperCase()) ?? catalogSets[0];
}

function supplementToTcgSet(set: SimplifiedChineseSetRecord): TcgSet {
  const localizedName = set.localizedName.trim();
  const englishName = set.englishName.trim();

  return {
    id: set.id,
    name: formatBilingualName(localizedName, englishName),
    localizedName,
    englishName,
    code: set.code.trim().toUpperCase(),
    series: LANGUAGE_LABELS["zh-cn"],
    releaseDate: set.releaseDate ?? "",
    language: "zh-cn",
    languageLabel: LANGUAGE_LABELS["zh-cn"],
    printedTotal: set.printedTotal ?? undefined,
    total: set.total ?? undefined,
  };
}

function recordToTcgCard(card: SimplifiedChineseCardRecord): TcgCard {
  const set = setForCard(card);
  const localizedName = card.localizedName.trim();
  const englishName = card.englishName?.trim();
  const image = card.image?.trim() || "/icon.svg";
  const fetchedAt = "2026-09-01T00:00:00.000Z";

  return {
    id: card.id,
    slug: buildLocalizedSlug("zh-cn", card.id),
    language: "zh-cn",
    languageLabel: LANGUAGE_LABELS["zh-cn"],
    name: formatBilingualName(localizedName, englishName),
    localizedName,
    englishName: englishName || localizedName,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity || "Promo",
    supertype: card.supertype || "Pokemon",
    hp: card.hp || "-",
    types: card.types ?? [],
    setId: set.id,
    setCode: set.code.trim().toUpperCase(),
    setName: formatBilingualName(set.localizedName, set.englishName),
    setLocalizedName: set.localizedName,
    setEnglishName: set.englishName,
    setPrintedTotal: set.printedTotal ?? undefined,
    setTotal: set.total ?? undefined,
    image,
    artist: card.artist || "Unknown",
    imageStatus: image.startsWith("http") ? "official" : "placeholder",
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Simplified Chinese catalog",
      fetchedAt: null,
      note: "Identity loaded from the Simplified Chinese promo catalog. Live market data refreshes when sources have a match.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: EMPTY_PRICE_HISTORY,
    gradedPrices: [{ grade: "Ungraded", value: 0, populationCount: 0 }],
    recentSales: [],
    sources: [
      {
        source: "Simplified Chinese catalog",
        status: "verified",
        fetchedAt,
        confidence: 0.9,
        note: card.promotion
          ? `Printed ${card.collectorNumber}/${set.code} (${card.promotion}).`
          : `Printed ${card.collectorNumber}/${set.code} Simplified Chinese promo.`,
      },
    ],
  };
}

const cardsBySlug = new Map(
  catalogCards.map((card) => [buildLocalizedSlug("zh-cn", card.id), recordToTcgCard(card)]),
);
const cardsById = new Map(
  [...cardsBySlug.values()].map((card) => [card.id.trim().toLowerCase(), card]),
);

export function isSimplifiedChineseCatalogLanguage(
  language?: CardLanguageFilter | null,
) {
  return language == null || language === "all" || language === "zh-cn";
}

export function getSimplifiedChineseSets(): TcgSet[] {
  return catalogSets.map(supplementToTcgSet).sort(compareTcgSetsForDisplay);
}

export function getSimplifiedChineseSetById(setId: string): TcgSet | null {
  const key = setId.trim();
  if (!key) {
    return null;
  }

  const upper = key.toUpperCase();
  const compact = compactSetKey(key);
  const entry = catalogSets.find((set) => {
    if (set.id.toUpperCase() === upper || set.code.toUpperCase() === upper) {
      return true;
    }
    if (compactSetKey(set.code) === compact || compactSetKey(set.id) === compact) {
      return true;
    }
    return (set.aliases ?? []).some(
      (alias) => alias.toUpperCase() === upper || compactSetKey(alias) === compact,
    );
  });

  return entry ? supplementToTcgSet(entry) : null;
}

export function searchSimplifiedChineseSets(query: string, limit = 80): TcgSet[] {
  const terms = normalizeNeedle(query).split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return getSimplifiedChineseSets().slice(0, limit);
  }

  return catalogSets
    .filter((set) => {
      const blob = setSearchBlob(set);
      return terms.every((term) => blob.includes(term));
    })
    .slice(0, limit)
    .map(supplementToTcgSet);
}

export function mergeSimplifiedChineseSetSupplements(
  sets: TcgSet[],
  language: CardLanguageFilter,
): TcgSet[] {
  if (!isSimplifiedChineseCatalogLanguage(language)) {
    return sets;
  }

  const byId = new Map<string, TcgSet>();
  for (const set of sets) {
    byId.set(`${set.language}:${set.id.trim().toLowerCase()}`, set);
  }

  for (const set of getSimplifiedChineseSets()) {
    byId.set(`${set.language}:${set.id.trim().toLowerCase()}`, set);
  }

  return [...byId.values()].sort(compareTcgSetsForDisplay);
}

function catalogSetMatchesFilter(
  set: SimplifiedChineseSetRecord,
  setFilter: string,
  language: CardLanguageFilter,
) {
  const raw = setFilter.trim();
  if (!raw) {
    return true;
  }

  const upper = raw.toUpperCase();
  const compact = compactSetKey(raw);
  const blob = setSearchBlob(set);

  if (set.id.toUpperCase() === upper || compactSetKey(set.id) === compact) {
    return true;
  }

  if ((set.aliases ?? []).some((alias) => compactSetKey(alias) === compact)) {
    return true;
  }

  const namedQuery = normalizeNeedle(raw);
  const namedTerms = namedQuery.split(/\s+/).filter((term) => term.length >= 4);
  if (namedTerms.length > 0 && namedTerms.every((term) => blob.includes(term))) {
    return true;
  }

  // `SV-P` / `SVP` collide with English Black Star Promos and Japanese SV-P.
  // Only treat those codes as this Simplified Chinese set when the Dex language
  // filter is already Chinese Simplified.
  if (language === "zh-cn") {
    return set.code.toUpperCase() === upper || compactSetKey(set.code) === compact;
  }

  return false;
}

function collectorMatchesCard(
  card: SimplifiedChineseCardRecord,
  set: SimplifiedChineseSetRecord,
  collectorCode?: CollectorCodeQuery | null,
) {
  if (!collectorCode) {
    return true;
  }

  if (!collectorNumberMatchesCode(card.collectorNumber, collectorCode)) {
    return false;
  }

  if (collectorCodeConstrainsPrintedTotal(collectorCode)) {
    const setTotal = set.printedTotal ?? null;
    if (setTotal !== collectorCode.printedTotal) {
      return false;
    }
  }

  if (!collectorCode.setCode) {
    return true;
  }

  const keys = new Set(collectorSetCodeSearchKeys(collectorCode.setCode).map((key) => compactSetKey(key)));
  return (
    keys.has(compactSetKey(set.code)) ||
    keys.has(compactSetKey(set.id)) ||
    (set.aliases ?? []).some((alias) => keys.has(compactSetKey(alias)))
  );
}

export function lookupSimplifiedChineseCardBySlug(slug: string): TcgCard | null {
  return cardsBySlug.get(slug) ?? cardsById.get(parseLocalizedSlug(slug).id.trim().toLowerCase()) ?? null;
}

export function searchSimplifiedChineseCatalog({
  query = "",
  setFilter = "",
  collectorCode,
  language = "zh-cn",
  limit = 0,
}: {
  query?: string;
  setFilter?: string;
  collectorCode?: CollectorCodeQuery | null;
  language?: CardLanguageFilter;
  limit?: number;
}): TcgCard[] {
  if (!isSimplifiedChineseCatalogLanguage(language)) {
    return [];
  }

  const needle = normalizeNeedle(query);
  const terms = needle.split(/\s+/).filter(Boolean);
  const matched: TcgCard[] = [];

  for (const record of catalogCards) {
    const set = setForCard(record);
    if (!set) {
      continue;
    }
    if (setFilter && !catalogSetMatchesFilter(set, setFilter, language)) {
      continue;
    }
    if (!collectorMatchesCard(record, set, collectorCode)) {
      continue;
    }
    if (terms.length) {
      const blob = cardSearchBlob(record, set);
      const nameHit = textMatchesQuery(
        [record.localizedName, record.englishName].filter(Boolean).join(" "),
        query,
      );
      const blobHit = terms.every((term) => blob.includes(term) || blob.includes(term.replace(/^0+(?=\d)/, "")));
      if (!nameHit && !blobHit) {
        continue;
      }
    }

    const card = cardsById.get(record.id.trim().toLowerCase());
    if (card) {
      matched.push(card);
    }
  }

  return limit > 0 ? matched.slice(0, limit) : matched;
}

export function simplifiedChineseCatalogSearchResults(options: {
  query?: string;
  setFilter?: string;
  collectorCode?: CollectorCodeQuery | null;
  language?: CardLanguageFilter;
  limit?: number;
}): SearchResult[] {
  return searchSimplifiedChineseCatalog(options).map((card) => ({
    card,
    score: 210,
    matchReason: "Simplified Chinese catalog",
  }));
}

export function isSimplifiedChineseCatalogCardId(id?: string | null) {
  return Boolean(id?.toLowerCase().startsWith("cn-"));
}

export function isSimplifiedChineseCatalogSetFilter(
  setFilter?: string | null,
  language: CardLanguageFilter = "zh-cn",
) {
  if (!setFilter?.trim() || !isSimplifiedChineseCatalogLanguage(language)) {
    return false;
  }

  return catalogSets.some((set) => catalogSetMatchesFilter(set, setFilter, language));
}
