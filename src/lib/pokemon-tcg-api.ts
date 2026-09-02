import "server-only";

import { resolveJapaneseCardIdentity } from "@/lib/japanese-card-identity";
import { japaneseMarketIdentityMaterialKey } from "@/lib/japanese-market-identity";
import { resolveJapaneseMarketIdentity } from "@/lib/japanese-market-identity.server";
import {
  fetchGradingMarketData,
  fetchQuickLocalizedGuidePrice,
  mergeCatalogAndLiveGradedPrices,
} from "@/lib/grading-market";
import { fetchPriceChartingProductImageUrl } from "@/lib/psa-population";
import {
  applyJapaneseMarketSetLabels,
  getHeadlineMarketPriceUsd,
  getLocalizedSetMarketProfile,
  hasLocalizedMarketIndex,
  isSuspiciouslyLowCatalogPrice,
  isTrustedCatalogMarketPrice,
  SHARED_POKEMON_TCG_SET_IDS,
} from "@/lib/localized-set-market";
import {
  applyPriceChartingSetGuideToCards,
  buildGuideSecretRareCard,
  fetchPriceChartingSetGuideForSet,
  hydrateCardsFromPriceChartingSetGuides,
} from "@/lib/market/pricecharting-set-guide.server";
import { resolvePriceChartingSetSlugs } from "@/lib/pricecharting-set-discovery";
import {
  findJapaneseCardNameSearchAliases,
  findLocalizedPokemonNameAliases as findDbLocalizedPokemonNameAliases,
  resolveLocalizedQueryToEnglishTerms,
  resolveJapanesePrintedNameToEnglishSync,
} from "@/lib/pokemon-name-db.server";
import { buildLearnedSearchResults } from "@/lib/card-learning.server";
import {
  lookupCachedCardsByCollectorCode,
  lookupCatalogCardsByFuzzyQuery,
  persistSearchResultCards,
} from "@/lib/pokemon-cards-cache.server";
import { lookupCardInIndexBySlug, lookupCardsInIndexByCollector, lookupCardsInIndexByName, lookupCardsInIndexByNameAndSet, lookupCardsInIndexBySet } from "@/lib/pokemon-cards-index.server";
import {
  readSearchResult as readPersistedSearchResult,
  writeSearchResult as writePersistedSearchResult,
} from "@/lib/search-result-store.server";
import {
  getSetsFromDatabase,
  getSetFromDatabase,
  mergeSetCatalogs,
  searchSetsInDatabase,
  setMatchesSearchQuery,
} from "@/lib/pokemon-sets-db.server";
import { searchBundledCards } from "@/lib/bundled-cards";
import {
  findOfficialJapaneseBrowseSeedByCardId,
  fetchOfficialJapaneseSetBrowseAllItems,
  fetchOfficialJapaneseSetBrowsePage,
  applyOfficialJapaneseBrowseArtworkToCard,
  resolveOfficialJapaneseBrowseImageUrl,
  searchOfficialJapaneseBrowseSeed,
} from "@/lib/official-japanese-browse.server";
import type { OfficialJapaneseBrowseSeedMatch } from "@/lib/official-japanese-browse.server";
import {
  getOfficialJapaneseSetSupplementById,
  mergeOfficialJapaneseSetSupplements,
  resolveOfficialJapaneseBrowseCodes,
} from "@/lib/official-japanese-sets.server";
import {
  getSimplifiedChineseSetById,
  isSimplifiedChineseCatalogCardId,
  isSimplifiedChineseCatalogSetFilter,
  lookupSimplifiedChineseCardBySlug,
  mergeSimplifiedChineseSetSupplements,
  simplifiedChineseCatalogSearchResults,
} from "@/lib/simplified-chinese-catalog";
import { mergeJapaneseOfficialBrowseCodeCandidates } from "@/lib/japanese-set-filter";
import { sortTcgSetsForDisplay } from "@/lib/set-display-sort";
import { overlayCachedSearchResponsePrices } from "@/lib/price/overlay.server";
import {
  FAST_SEARCH_BUDGET_MS,
  SEARCH_LEARNED_MERGE_BUDGET_MS,
  SEARCH_LOCALIZED_PREVIEW_BUDGET_MS,
  SEARCH_OFFICIAL_JP_NAME_BUDGET_MS,
  SEARCH_OVERLAY_BUDGET_MS,
  SEARCH_PERSIST_READ_BUDGET_MS,
  isSimpleNameSearchQuery,
  remainingSearchBudget,
  withSearchBudget,
  firstSuccessfulSearch,
} from "@/lib/search-deadline";
import {
  SEARCH_UNAVAILABLE_NOTICE,
  isEmptyLandingSearch,
  isIncompleteSetBrowseFallback,
  isSearchUnavailableNotice,
  shouldCommitStaticDexLanding,
  shouldReplaceWithStaticTrending,
} from "@/lib/search-landing-fallback";
import { getStaticTrendingSearchResponse } from "@/lib/static-trending";
import { hydrateJapaneseTcgdexListPrices } from "@/lib/price/japanese-list-price.server";
import {
  inferEnglishNameFromTcgdexLocalizedName,
  tcgdexEnglishCompanionNameAgrees,
} from "@/lib/tcgdex-japanese-name";
import {
  applyEditionFinish,
  applySelectedFinish,
  attachFinishMarketsToCard,
  collapseSearchResponseEditions,
  collapseSearchResultEditions,
  expandSearchResponseEditions,
  expandSearchResultEditions,
  extractFinishIdsFromTcgdexVariants,
  splitEditionCardId,
  splitOfficialJapaneseCardSlugId,
} from "@/lib/card-finish";
import {
  pageTrendingSearchResults,
  rankSearchResultsByTrending,
} from "@/lib/trending";
import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  LANGUAGE_LABELS,
  LOCALIZED_SEARCH_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  SUPPORTED_CARD_LANGUAGES,
} from "@/lib/search-constants";
import type {
  CollectorCodeQuery,
  CollectorMarketFallback,
  NormalizeTcgdexCardsForSearchOptions,
  PokemonCardJpDetail,
  PokemonCardJpSearchResponse,
  PokemonTcgCardApiPriceBucket,
  PokemonTcgCardApiResponse,
  PokemonTcgSetApiResponse,
  PokeApiPokemonSpeciesResponse,
  SetSortGuideEnrichmentOptions,
  TcgdexCardBrief,
  TcgdexCardResponse,
  TcgdexEnglishCompanion,
  TcgdexSetBrief,
  TcgdexSetResponse,
} from "@/lib/pokemon-tcg/api-types";
import {
  buildLocalizedSlug,
  collectorCardMatchesNameHint,
  collectorCodeConstrainsPrintedTotal,
  collectorCodeDisplayLabel,
  collectorCodeLabel,
  collectorCodeLabelVariants,
  collectorCodeMatchesSetFilter,
  collectorDetailMatchesCode,
  collectorHeuristicLookup,
  collectorNumberMatchesCode,
  collectorSetCodeSearchKeys,
  escapeRegex,
  findCollectorCodeInQuery,
  formatBilingualName,
  isFullCollectorCode,
  isOrdinalCollectorToken,
  isTrainerGalleryCollectorCode,
  localizedCardMatchesNameQuery,
  localizedNameSearchVariants,
  normalizeSearchText,
  normalizeSetCode,
  normalizeWhitespace,
  parseCollectorCodeQuery,
  parseLocalizedSlug,
  parsePartialCollectorToken,
  pickJapaneseCatalogSearchKeyword,
  pokemonSpeciesQueryTerms,
  expandCatalogSetFilterKeys,
  localizedLanguageCodesForSetFilter,
  resolveEnglishCatalogSetFilterId,
  resolveEnglishCompanionSetId,
  resolveLocalizedSetFilterId,
  resolvePokemonTcgApiSetFilterId,
  textMatchesQuery,
} from "@/lib/pokemon-tcg/text-and-collector-utils";
import {
  buildOfficialJapaneseDetailFromBrowseItem,
  buildOfficialJapaneseFallbackDetail,
  buildOfficialJapaneseFallbackSearchCard,
  fetchOfficialJapaneseCardDetail,
  fetchOfficialJapaneseFallbackDetailForCollectorCode,
  fetchOfficialJapaneseKeywordSearchItems,
  fetchPokemonCardJpSearchPage,
  findOfficialJapaneseCollectorFallbackByCardId,
  lookupOfficialJapanesePartialCollectorFallback,
  normalizeOfficialJapaneseCard,
  padTcgdexLocalId,
  resolveOfficialJapaneseEnglishName,
  resolveOfficialJapaneseIdentityName,
  setCodeFromOfficialJapaneseThumb,
  shouldSkipTcgdexOfficialJapaneseEnrichment,
} from "@/lib/pokemon-tcg/official-japanese-catalog";
import {
  TCGDEX_API_BASE_URL,
  buildEnglishCardIdCandidates,
  buildLocalizedSetIdCandidates,
  preferTcgdexCardLookupId,
  dedupeTcgdexBriefs,
  fetchLocalizedCardFromEnglishBrief,
  fetchTcgdexDetailCardsFromBriefs,
  fetchTcgdexJson,
  getLocalizedSetEnglishName,
  getTcgdexCardImage,
  getTcgdexImageStatus,
  resolveTcgdexApiLanguage,
  tcgdexApiLanguageFallbacks,
  tryDeriveLocalizedTcgdexAsset,
} from "@/lib/pokemon-tcg/tcgdex-normalizers";
import {
  isPokemonTcgPocketPrint,
  isPokemonTcgPocketSet,
} from "@/lib/pokemon-tcg/tcg-pocket";
import { withDerivedEnglishPrintImage } from "@/lib/pokemon-tcg/english-print-image";
import {
  applySearchResultSort,
  collectorNumberSortValue,
  fetchPublicUngradedPriceFallback,
  isLowConfidenceSearchMarketPrice,
  isRarityDerivedMarketPrice,
  sanitizeLiveSearchResponsePrices,
  sanitizeSearchResultPrices,
  shouldStripOfficialJapaneseCatalogFallbackPrice,
  stripLocalizedSearchEstimate,
  stripOfficialJapaneseCatalogFallbackPrice,
  stripUnverifiedSearchEstimates,
} from "@/lib/pokemon-tcg/market-enrichment";
import type {
  CardLanguageFilter,
  CardLanguageCode,
  LiveSearchResponse,
  SearchResult,
  SearchSortOption,
  TcgCard,
  TcgSet,
} from "@/types/pokemon";

export {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  SEARCH_PAGE_SIZE,
  SUPPORTED_CARD_LANGUAGES,
};

const API_BASE_URL = "https://api.pokemontcg.io/v2";
const POKEAPI_BASE_URL = "https://pokeapi.co/api/v2";
const POKEMON_TCG_DEFAULT_CARD_ORDER = "-set.releaseDate,number";
const POKEMON_TCG_API_TIMEOUT_MS = 12_000;
/** Dex named/collector search must not wait a 12s hang + retry. */
const POKEMON_TCG_SEARCH_TIMEOUT_MS = 1_800;
const TCGDEX_COLLECTOR_TIMEOUT_MS = 1_800;
const TCGDEX_COLLECTOR_PAGE_SIZE = 24;
const TCGDEX_COLLECTOR_DETAIL_LIMIT = 12;
const SEARCH_OFFICIAL_JP_MAX_DETAILS = 8;
const SEARCH_OFFICIAL_JP_SET_BROWSE_MAX_DETAILS = 39;
/** Name+# queries must detail later official pages (Dialga 071 is after page 1). */
const SEARCH_OFFICIAL_JP_NAME_COLLECTOR_MAX_DETAILS = 72;
const SEARCH_OFFICIAL_JP_COLLECTOR_DETAIL_TIMEOUT_MS = 1_500;
/** Card-detail identity must not wait on the full search timeout + Magery scrape. */
const ENGLISH_LIVE_IDENTITY_BUDGET_MS = 2_200;
const ENGLISH_POKEMON_TCG_IDENTITY_TIMEOUT_MS = 2_000;
const PUBLIC_PRICE_FALLBACK_BUDGET_MS = 2_500;

class PokemonTcgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "PokemonTcgApiError";
  }
}

const EUR_TO_USD = 1 / 0.93;
const ALL_LANGUAGE_PREVIEW_PER_LANGUAGE = 5;
/** Dex named/collector "all languages" stays on EN + JA inside the 5s budget. */
const DEX_QUERY_LOCALIZED_CODES: CardLanguageCode[] = ["ja"];
// Share of an "all languages" results page reserved for localized (non-English)
// cards. Popular Pokemon fill an entire page with English catalog matches, so
// without a reserved share the Japanese/Korean/etc. results are truncated off
// the end and the language filter silently behaves as English-only.
const ALL_LANGUAGE_LOCALIZED_PAGE_SHARE = 0.4;
const LIVE_CATALOG_REVALIDATE_SECONDS = 3600;
const LIVE_SET_REVALIDATE_SECONDS = 1800;
const PUBLIC_SOLD_COMP_REVALIDATE_SECONDS = 21600;
const SEARCH_SET_MEMORY_TTL_MS = LIVE_SET_REVALIDATE_SECONDS * 1000;
const LATINISH_NAME_QUERY_MAX = 256;
const SET_CONTEXT_PHRASE_STOP_WORDS = new Set([
  "ex",
  "gx",
  "tg",
  "v",
  "vmax",
  "vstar",
  "holo",
  "reverse",
  "promo",
]);

const COLLECTOR_MARKET_FALLBACKS: CollectorMarketFallback[] = [
  {
    numbers: ["615", "0615"],
    printedTotal: 15,
    language: "zh-cn",
    englishCardName: "Umbreon",
    localizedName: "月亮伊布",
    setCode: "CBB2C",
    setEnglishName: "Gem Pack Vol. 2",
  },
  {
    numbers: ["615", "0615"],
    printedTotal: 15,
    language: "zh-tw",
    englishCardName: "Umbreon",
    localizedName: "月亮伊布",
    setCode: "CBB2C",
    setEnglishName: "Gem Pack Vol. 2",
  },
];

const POKEAPI_LANGUAGE_CODES: Partial<Record<CardLanguageCode, string[]>> = {
  ja: ["ja-Hrkt", "ja"],
  ko: ["ko"],
  "zh-tw": ["zh-Hant", "zh-Hans"],
  "zh-cn": ["zh-Hans", "zh-Hant"],
  fr: ["fr"],
  es: ["es"],
  it: ["it"],
  de: ["de"],
  ru: ["ru"],
  pt: ["pt", "pt-BR"],
  "pt-br": ["pt-BR", "pt"],
  "pt-pt": ["pt", "pt-PT"],
  nl: ["nl"],
  pl: ["pl"],
  id: ["id"],
  th: ["th"],
};

const PREFERRED_PRICE_BUCKET_ORDER = [
  "normal",
  "holofoil",
  "unlimitedHolofoil",
  "reverseHolofoil",
  "1stEditionHolofoil",
  "1stEditionNormal",
];

const LOCALIZED_SET_ID_ALIASES: Partial<Record<CardLanguageCode, Record<string, string>>> = {
  en: {
    me2pt5: "me02.5",
    sv8pt5: "sv08.5",
    sv3pt5: "sv03.5",
    sv6pt5: "sv06.5",
  },
  ja: {
    rsv10pt5: "SV11W",
    sv10: "SV10",
    sv9: "SV9",
    zsv10pt5: "SV11B",
    sv3pt5: "SV2a",
    "sv03.5": "SV2a",
    cel25: "S8a",
    cel25c: "S8a",
    swsh8: "S8",
    swsh9: "S9",
    swsh10: "S10",
    swsh11: "S11",
    sv1: "SV1S",
    sv2: "SV2P",
    sv3: "SV3",
    sv4: "SV4K",
    sv5: "SV5K",
    sv6: "SV6",
    sv7: "SV7",
    sv8: "SV8",
  },
};

const EARLY_MARKET_RARITY_BASELINES_USD: Array<[RegExp, number]> = [
  [/special illustration|sir|sar/i, 65],
  [/illustration rare|art rare|character rare|ar|chr/i, 12],
  [/hyper rare|secret rare|rainbow|gold/i, 28],
  [/ultra rare|super rare|\bsr\b/i, 8],
  [/double rare|triple rare|\brrr?\b/i, 3],
  [/ace spec/i, 2.5],
  [/\brare\b|\br\b/i, 0.75],
  [/uncommon|\bu\b/i, 0.25],
  [/common|\bc\b/i, 0.12],
];

async function isStandalonePartialCollectorQuery(query: string) {
  const trimmed = query.trim();

  if (!trimmed || trimmed.includes("/")) {
    return false;
  }

  const compact = trimmed.replace(/^#/, "").trim();

  if (isOrdinalCollectorToken(compact) || (await isLikelySetCodeToken(compact))) {
    return false;
  }

  const partial = parsePartialCollectorToken(compact);

  if (!partial) {
    return false;
  }

  const raw = (partial.rawNumber ?? partial.number).toUpperCase();

  if (await isLikelySetCodeToken(raw)) {
    return false;
  }

  if (/^[A-Z]+\d+[A-Z]*$/.test(raw)) {
    return true;
  }

  return /^\d{2,4}$/.test(raw);
}

async function findPartialCollectorInQuery(trimmed: string) {
  if (findCollectorCodeInQuery(trimmed)) {
    return null;
  }

  const tokenPattern = /#?([A-Za-z]*\d+[A-Za-z]*)/g;

  for (const match of trimmed.matchAll(tokenPattern)) {
    if (match.index == null) {
      continue;
    }

    if (isOrdinalCollectorToken(match[1]) || (await isLikelySetCodeToken(match[1]))) {
      continue;
    }

    const partial = parsePartialCollectorToken(match[1]);

    if (!partial) {
      continue;
    }

    const raw = (partial.rawNumber ?? partial.number).toUpperCase();

    if (await isLikelySetCodeToken(raw)) {
      continue;
    }

    const before = trimmed.slice(0, match.index).trim();
    const after = trimmed.slice(match.index + match[0].length).trim();
    const nameQuery = `${before} ${after}`
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-:,]+|[-:,]+$/g, "")
      .trim();

    if (!nameQuery) {
      continue;
    }

    return { collectorCode: partial, nameQuery };
  }

  if (await isStandalonePartialCollectorQuery(trimmed)) {
    const partial = parsePartialCollectorToken(trimmed);

    if (partial) {
      return { collectorCode: partial, nameQuery: "" };
    }
  }

  return null;
}

async function isLikelySetCodeToken(token: string) {
  const compact = token.trim();

  if (!compact || compact.length < 2) {
    return false;
  }

  if (/^(TG|GG)\d+$/i.test(compact.replace(/^#/, ""))) {
    return false;
  }

  const sets = await searchSetsInDatabase(compact, "all", 4);

  if (!sets?.length) {
    return false;
  }

  const normalized = compact.toUpperCase();

  return sets.some(
    (set) =>
      set.id.toUpperCase() === normalized || set.code.toUpperCase() === normalized,
  );
}

async function queryHasCollectorCodeIntent(query: string) {
  const trimmed = query.trim();

  if (!trimmed) {
    return false;
  }

  if (parseCollectorCodeQuery(trimmed)) {
    return true;
  }

  const partialMatch = await findPartialCollectorInQuery(trimmed);

  return Boolean(partialMatch);
}

function pickSetFilterIdForSearchLanguage(
  set: { id: string; language: CardLanguageCode },
  language: CardLanguageFilter,
) {
  if (language === "ja") {
    return resolveLocalizedSetFilterId("ja", set.id) || set.id;
  }

  if (language === "en") {
    return resolvePokemonTcgApiSetFilterId(set.id) || set.id;
  }

  if (set.language === "ja") {
    return resolveLocalizedSetFilterId("ja", set.id) || set.id;
  }

  return resolvePokemonTcgApiSetFilterId(set.id) || set.id;
}

const CARD_SEARCH_SET_CONTEXT_PATTERNS: Array<{
  pattern: RegExp;
  pickSetId: (language: CardLanguageFilter) => string;
}> = [
  {
    pattern: /\b(?:pokemon\s*)?25th\s+anniversary(?:\s+collection)?\b/i,
    pickSetId: (language) => (language === "ja" ? "S8a" : "cel25c"),
  },
  {
    pattern: /\b25th\b/i,
    pickSetId: (language) => (language === "ja" ? "S8a" : "cel25c"),
  },
  {
    pattern: /\bcelebrations?\b/i,
    pickSetId: (language) => (language === "ja" ? "S8a" : "cel25c"),
  },
  {
    pattern: /\bpokemon\s+151\b/i,
    pickSetId: (language) => (language === "ja" ? "SV2a" : "sv3pt5"),
  },
  {
    pattern: /\b(?:sv\s*)?151\b/i,
    pickSetId: (language) => (language === "ja" ? "SV2a" : "sv3pt5"),
  },
  {
    pattern: /\btrainer\s+gallery\b/i,
    pickSetId: () => "swsh12tg",
  },
];

const TRAINER_GALLERY_SET_IDS = ["swsh9tg", "swsh10tg", "swsh11tg", "swsh12tg"];

function extractTrainerGallerySuffixContext(query: string) {
  const match = query.trim().match(/^(.+?)\s+tg$/i);

  if (!match?.[1]?.trim()) {
    return null;
  }

  return {
    setFilter: "__trainer_gallery__",
    nameQuery: match[1].trim(),
  };
}

function isTrainerGallerySetFilter(setFilter?: string) {
  return setFilter?.trim() === "__trainer_gallery__";
}

async function searchTrainerGalleryNameQuery(
  nameQuery: string,
  page: number,
  language: CardLanguageFilter,
  sort: SearchSortOption,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;
  const responses = await Promise.all(
    TRAINER_GALLERY_SET_IDS.map((setId) =>
      language === "all"
        ? searchAllLanguageCards(nameQuery, setId, 1, sort)
        : searchLiveCardsUncached(nameQuery, setId, 1, language, sort).catch(
            (): LiveSearchResponse => ({
              results: [],
              totalCount: 0,
              page: 1,
              pageSize,
              hasNextPage: false,
            }),
          ),
    ),
  );
  const seenSlugs = new Set<string>();
  const merged = responses
    .flatMap((response) => response.results)
    .filter((result) => {
      if (seenSlugs.has(result.card.slug)) {
        return false;
      }

      seenSlugs.add(result.card.slug);
      return true;
    });
  const sorted = applySearchResultSort(applyEarlyMarketSearchEstimates(merged), sort);
  const start = (normalizedPage - 1) * pageSize;

  return {
    results: sorted.slice(start, start + pageSize),
    totalCount: sorted.length,
    page: normalizedPage,
    pageSize,
    hasNextPage: start + pageSize < sorted.length,
    notice: "Searched all Trainer Gallery releases for this Pokémon.",
  };
}

function extractSetNicknameContext(
  query: string,
  language: CardLanguageFilter = "all",
) {
  for (const entry of CARD_SEARCH_SET_CONTEXT_PATTERNS) {
    const match = query.match(entry.pattern);

    if (!match || match.index == null) {
      continue;
    }

    const setFilter = entry.pickSetId(
      language === "ja" ? "ja" : language === "en" ? "en" : "en",
    );
    const nameQuery = `${query.slice(0, match.index)}${query.slice(match.index + match[0].length)}`
      .replace(/\s+/g, " ")
      .trim();

    if (!nameQuery) {
      continue;
    }

    return { setFilter, nameQuery };
  }

  return null;
}

async function extractSetContextFromQuery(
  query: string,
  language: CardLanguageFilter = "all",
): Promise<{ setFilter?: string; nameQuery: string }> {
  const trimmed = query.trim();

  if (!trimmed) {
    return { nameQuery: "" };
  }

  const galleryToken = parsePartialCollectorToken(trimmed.replace(/^#/, ""));
  if (galleryToken && isTrainerGalleryCollectorCode(galleryToken) && !/\s/.test(trimmed.replace(/^#/, "").trim())) {
    return { nameQuery: trimmed };
  }

  const nicknameContext = extractSetNicknameContext(trimmed, language);

  if (nicknameContext) {
    return nicknameContext;
  }

  if (isSimpleNameSearchQuery(trimmed)) {
    return { nameQuery: trimmed };
  }

  const trainerGalleryContext = extractTrainerGallerySuffixContext(trimmed);

  if (trainerGalleryContext) {
    return trainerGalleryContext;
  }

  if (await queryHasCollectorCodeIntent(trimmed)) {
    return { nameQuery: trimmed };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  let bestMatch: { setFilter: string; nameQuery: string; score: number } | null = null;
  const setSearchLanguage = language === "all" ? "all" : language;

  for (let start = 0; start < words.length; start += 1) {
    for (let end = words.length; end > start; end -= 1) {
      const phrase = words.slice(start, end).join(" ");

      if (phrase.length < 2 || end - start === words.length) {
        continue;
      }

      const normalizedPhrase = normalizeSearchText(phrase);

      if (
        SET_CONTEXT_PHRASE_STOP_WORDS.has(normalizedPhrase) &&
        !(await isLikelySetCodeToken(phrase))
      ) {
        continue;
      }

      if (
        (await isStandalonePartialCollectorQuery(phrase)) ||
        (await isLikelySetCodeToken(phrase))
      ) {
        const nameQuery = [...words.slice(0, start), ...words.slice(end)].join(" ").trim();

        if (!nameQuery) {
          continue;
        }

        const sets = await searchSetsInDatabase(phrase, "all", 6);
        const normalizedPhraseCode = phrase.trim().toUpperCase();
        const topSet =
          sets?.find(
            (set) =>
              set.id.toUpperCase() === normalizedPhraseCode ||
              set.code.toUpperCase() === normalizedPhraseCode,
          ) ?? sets?.[0];

        if (!topSet) {
          continue;
        }

        const candidate = {
          setFilter: pickSetFilterIdForSearchLanguage(topSet, language),
          nameQuery,
          score: 28 + phrase.length,
        };

        if (!bestMatch || candidate.score > bestMatch.score) {
          bestMatch = candidate;
        }

        continue;
      }

      let sets = await searchSetsInDatabase(phrase, setSearchLanguage, 6);

      if (!sets?.length && setSearchLanguage !== "all") {
        sets = await searchSetsInDatabase(phrase, "all", 6);
      }

      if (!sets?.length) {
        continue;
      }

      const ranked = sets
        .map((set) => {
          const setText = normalizeSearchText(
            `${set.name} ${set.englishName ?? ""} ${set.code} ${set.id}`,
          );
          let score = 0;

          if (normalizeSearchText(set.name) === normalizedPhrase) {
            score += 24;
          }

          if (normalizeSearchText(set.englishName ?? "") === normalizedPhrase) {
            score += 22;
          }

          if (normalizeSearchText(set.code) === normalizedPhrase) {
            score += 26;
          }

          if (normalizeSearchText(set.id) === normalizedPhrase) {
            score += 26;
          }

          if (setText.includes(normalizedPhrase)) {
            score += 12;
          }

          const terms = normalizedPhrase.split(/\s+/).filter(Boolean);
          score += terms.filter((term) => setText.includes(term)).length * 4;

          return { set, score };
        })
        .sort((left, right) => right.score - left.score);

      const top = ranked[0];

      if (!top || top.score < 8) {
        continue;
      }

      const nameQuery = [...words.slice(0, start), ...words.slice(end)].join(" ").trim();

      if (!nameQuery || (await isStandalonePartialCollectorQuery(nameQuery))) {
        continue;
      }

      const candidate = {
        setFilter: pickSetFilterIdForSearchLanguage(top.set, language),
        nameQuery,
        score: top.score + phrase.length,
      };

      if (!bestMatch || candidate.score > bestMatch.score) {
        bestMatch = candidate;
      }
    }
  }

  if (bestMatch) {
    return {
      setFilter: bestMatch.setFilter,
      nameQuery: bestMatch.nameQuery,
    };
  }

  return { nameQuery: trimmed };
}

async function extractSearchQueryParts(query: string) {
  const trimmed = query.trim();
  const galleryToken = parsePartialCollectorToken(trimmed.replace(/^#/, ""));
  if (
    galleryToken &&
    isTrainerGalleryCollectorCode(galleryToken) &&
    !/\s/.test(trimmed.replace(/^#/, "").trim())
  ) {
    return {
      collectorCode: galleryToken,
      nameQuery: "",
    };
  }
  const slashMatch = findCollectorCodeInQuery(trimmed);

  if (slashMatch) {
    return {
      collectorCode: slashMatch.collectorCode,
      nameQuery: slashMatch.nameQuery,
    };
  }

  if (isSimpleNameSearchQuery(trimmed)) {
    return {
      collectorCode: parseCollectorCodeQuery(trimmed),
      nameQuery: trimmed,
    };
  }

  const partialMatch = await findPartialCollectorInQuery(trimmed);

  if (partialMatch) {
    return partialMatch;
  }

  return {
    collectorCode: parseCollectorCodeQuery(trimmed),
    nameQuery: trimmed,
  };
}

function searchResultMatchesSetFilter(card: TcgCard, setFilter: string) {
  const keys = new Set(
    [
      ...expandCatalogSetFilterKeys(setFilter),
      ...mergeJapaneseOfficialBrowseCodeCandidates(setFilter),
      ...resolveOfficialJapaneseBrowseCodes(setFilter),
    ]
      .filter(Boolean)
      .map((value) => value.trim().toUpperCase()),
  );

  const cardKeys = [card.setCode, card.setId]
    .filter(Boolean)
    .map((value) => value!.trim().toUpperCase());

  return cardKeys.some((cardKey) => keys.has(cardKey));
}

async function localizedLanguagesForSetSearch(setFilter: string): Promise<CardLanguageCode[]> {
  const known = localizedLanguageCodesForSetFilter(setFilter);
  if (!known.length || (known.length === 1 && known[0] === "ja")) {
    return known;
  }

  const jaSet = await getSetFromDatabase(setFilter, "ja");
  return localizedLanguageCodesForSetFilter(setFilter, {
    hasJapaneseSetRecord: Boolean(jaSet),
  });
}

function isLikelyEnglishCatalogQuery(query: string): boolean {
  const q = query.trim();
  if (!q || q.length > LATINISH_NAME_QUERY_MAX) {
    return false;
  }
  if (
    parseCollectorCodeQuery(q) ||
    /(?:^|\s)#?[A-Za-z]*\d+[A-Za-z]*(?:\s|$)/.test(q)
  ) {
    return false;
  }
  return !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/.test(q);
}


async function fetchLocalizedPokemonNameAliases(
  query: string,
  language: CardLanguageCode,
) {
  const dbAliases = await findDbLocalizedPokemonNameAliases(query, language);

  if (dbAliases.length) {
    return dbAliases;
  }

  const preferredLanguageCodes = POKEAPI_LANGUAGE_CODES[language];

  if (!preferredLanguageCodes?.length || !isLikelyEnglishCatalogQuery(query)) {
    return [];
  }

  const speciesNames = pokemonSpeciesQueryTerms(query);
  const responses = await Promise.all(
    speciesNames.map((name) =>
      fetchPokeApiJson<PokeApiPokemonSpeciesResponse>(
        `${POKEAPI_BASE_URL}/pokemon-species/${encodeURIComponent(name)}`,
      ).catch(() => null),
    ),
  );
  const aliases = new Set<string>();

  for (const response of responses) {
    if (!response) {
      continue;
    }

    for (const languageCode of preferredLanguageCodes) {
      const localizedName = response.names.find(
        (entry) => entry.language.name === languageCode,
      )?.name;

      if (localizedName) {
        aliases.add(localizedName);
      }
    }
  }

  return [...aliases];
}

function getPreferredPriceBuckets(card: PokemonTcgCardApiResponse["data"][number]) {
  const priceMap = card.tcgplayer?.prices ?? {};
  const preferredBuckets = PREFERRED_PRICE_BUCKET_ORDER
    .map((bucketKey) => priceMap[bucketKey])
    .filter((bucket): bucket is PokemonTcgCardApiPriceBucket => Boolean(bucket));
  const remainingBuckets = Object.entries(priceMap)
    .filter(([bucketKey]) => !PREFERRED_PRICE_BUCKET_ORDER.includes(bucketKey))
    .map(([, bucket]) => bucket);

  return [...preferredBuckets, ...remainingBuckets];
}

/**
 * TCGPlayer often lists both a common/holo finish and a scarce reverse-holo
 * finish. Blending those markets (e.g. Machop normal $0.73 + reverse $200)
 * lets reverse inflate the default ungraded price. Prefer the first finish in
 * PREFERRED_PRICE_BUCKET_ORDER; only keep later finishes within 3× of that
 * primary market so reverse can still contribute when it is the only print.
 */
function getPrimaryAlignedTcgMarketPrices(card: PokemonTcgCardApiResponse["data"][number]) {
  const priceMap = card.tcgplayer?.prices ?? {};
  const orderedBuckets = [
    ...PREFERRED_PRICE_BUCKET_ORDER.map((bucketKey) => priceMap[bucketKey]),
    ...Object.entries(priceMap)
      .filter(([bucketKey]) => !PREFERRED_PRICE_BUCKET_ORDER.includes(bucketKey))
      .map(([, bucket]) => bucket),
  ].filter((bucket): bucket is PokemonTcgCardApiPriceBucket => Boolean(bucket));

  const markets = orderedBuckets
    .map((bucket) => positivePrice(bucket.market))
    .filter((price): price is number => typeof price === "number" && price > 0);

  if (markets.length <= 1) {
    return markets;
  }

  const primary = markets[0];
  return markets.filter(
    (price) => price >= primary / 3 && price <= primary * 3,
  );
}

function convertCardmarketToUsd(value?: number) {
  if (typeof value !== "number" || value <= 0) {
    return null;
  }

  return value * EUR_TO_USD;
}

async function fetchEnglishTcgdexCardByIdCandidates(idCandidates: string[]) {
  const uniqueIds = [...new Set(idCandidates)].slice(0, 3);
  const matches = await Promise.all(
    uniqueIds.map(async (candidateId) => {
      try {
        const card = await fetchTcgdexJson<TcgdexCardResponse>(
          `${TCGDEX_API_BASE_URL}/en/cards/${encodeURIComponent(candidateId)}`,
        );
        const [normalizedCard] = await normalizeTcgdexCards([card], "en");
        return normalizedCard ?? null;
      } catch {
        return null;
      }
    }),
  );

  return matches.find((card) => card) ?? null;
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function positivePrice(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function robustPrice(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => positivePrice(value) !== null);

  if (!valid.length) {
    return 0;
  }

  if (valid.length === 1) {
    return valid[0];
  }

  const baseline = median(valid);
  const filtered = valid.filter((value) => value >= baseline / 3 && value <= baseline * 3);

  return median(filtered.length ? filtered : valid);
}

function getUsdMarketPrice(card: PokemonTcgCardApiResponse["data"][number]) {
  const priceBuckets = getPreferredPriceBuckets(card);
  const tcgMarketPrices = getPrimaryAlignedTcgMarketPrices(card);
  const cardmarketPrices = [
    convertCardmarketToUsd(card.cardmarket?.prices?.trendPrice),
    convertCardmarketToUsd(card.cardmarket?.prices?.avg7),
    convertCardmarketToUsd(card.cardmarket?.prices?.avg30),
    convertCardmarketToUsd(card.cardmarket?.prices?.avg1),
    convertCardmarketToUsd(card.cardmarket?.prices?.averageSellPrice),
    convertCardmarketToUsd(card.cardmarket?.prices?.lowPriceExPlus),
    convertCardmarketToUsd(card.cardmarket?.prices?.lowPrice),
  ].filter((price): price is number => typeof price === "number" && price > 0);
  const bestTcgPrice = robustPrice(tcgMarketPrices);
  const robustCardmarketPrice = robustPrice(cardmarketPrices);
  // Align mid/low samples to the same primary-finish band so reverse-holo
  // mids cannot pull robustCatalogPrice away from the default print.
  const primaryMarket = tcgMarketPrices[0] ?? 0;
  const alignedBucketPrices = priceBuckets.flatMap((bucket) => {
    const samples = [
      positivePrice(bucket.market),
      positivePrice(bucket.mid),
      positivePrice(bucket.low),
    ].filter((price): price is number => typeof price === "number" && price > 0);

    if (!(primaryMarket > 0)) {
      return samples;
    }

    return samples.filter(
      (price) => price >= primaryMarket / 3 && price <= primaryMarket * 3,
    );
  });
  const allCatalogPrices = [...alignedBucketPrices, ...cardmarketPrices];
  const robustCatalogPrice = robustPrice(allCatalogPrices);

  if (bestTcgPrice > 0 && robustCardmarketPrice > 0) {
    const priceRatio = robustCardmarketPrice / bestTcgPrice;

    if (priceRatio > 4) {
      if (bestTcgPrice < 150 && robustCardmarketPrice > 400) {
        return robustCardmarketPrice;
      }

      return bestTcgPrice;
    }

    if (priceRatio < 0.25) {
      return bestTcgPrice;
    }
  }

  for (const marketPrice of tcgMarketPrices) {
    if (
      typeof marketPrice === "number" &&
      (robustCatalogPrice === 0 ||
        (marketPrice >= robustCatalogPrice / 3 && marketPrice <= robustCatalogPrice * 3))
    ) {
      return marketPrice;
    }
  }

  if (bestTcgPrice > 0 && robustCardmarketPrice > 0) {
    return robustPrice([bestTcgPrice, robustCardmarketPrice]);
  }

  return bestTcgPrice || robustCardmarketPrice || robustCatalogPrice;
}

function tcgdxTcgplayerBuckets(
  tcgplayer?: NonNullable<TcgdexCardResponse["pricing"]>["tcgplayer"],
) {
  if (!tcgplayer) {
    return [];
  }

  return Object.entries(tcgplayer)
    .filter(
      ([key, value]) =>
        typeof value === "object" &&
        value !== null &&
        key !== "unit" &&
        key !== "updated",
    )
    .map(([, value]) => value);
}

function tcgdxTcgplayerPrice(
  bucket: {
    market?: number;
    low?: number;
    mid?: number;
    marketPrice?: number;
    lowPrice?: number;
    midPrice?: number;
    highPrice?: number;
  },
  field: "market" | "low" | "mid",
) {
  if (field === "market") {
    return positivePrice(bucket.marketPrice ?? bucket.market);
  }

  if (field === "low") {
    return positivePrice(bucket.lowPrice ?? bucket.low);
  }

  return positivePrice(bucket.midPrice ?? bucket.mid);
}

function tcgdxCardmarketPrice(
  cardmarket: NonNullable<TcgdexCardResponse["pricing"]>["cardmarket"],
  field:
    | "trend"
    | "avg7"
    | "avg30"
    | "avg1"
    | "averageSellPrice"
    | "lowPriceExPlus"
    | "lowPrice",
) {
  if (!cardmarket) {
    return null;
  }

  switch (field) {
    case "trend":
      return positivePrice(cardmarket.trend ?? cardmarket.trendPrice);
    case "avg1":
      return positivePrice(cardmarket.avg1);
    case "avg7":
      return positivePrice(cardmarket.avg7);
    case "avg30":
      return positivePrice(cardmarket.avg30);
    case "averageSellPrice":
      return positivePrice(cardmarket.averageSellPrice ?? cardmarket.avg);
    case "lowPriceExPlus":
      return positivePrice(cardmarket.lowPriceExPlus);
    case "lowPrice":
      return positivePrice(cardmarket.lowPrice ?? cardmarket.low);
    default:
      return null;
  }
}

function getTcgdexMarketPrice(
  card: TcgdexCardResponse,
  options: { language?: string } = {},
) {
  const tcgplayerBuckets = tcgdxTcgplayerBuckets(card.pricing?.tcgplayer);
  const tcgMarketPrices = tcgplayerBuckets
    .map((bucket) => tcgdxTcgplayerPrice(bucket, "market"))
    .filter((price): price is number => typeof price === "number" && price > 0);
  const cardmarket = card.pricing?.cardmarket;
  const isJapanese = options.language === "ja";
  // JP Cardmarket "low" fields are routinely €0.20 placeholders for chase cards
  // and drag the robust median into the cents. Prefer trend/averages only.
  const cardmarketCandidates = [
    convertCardmarketToUsd(tcgdxCardmarketPrice(cardmarket, "trend") ?? undefined),
    convertCardmarketToUsd(tcgdxCardmarketPrice(cardmarket, "avg7") ?? undefined),
    convertCardmarketToUsd(tcgdxCardmarketPrice(cardmarket, "avg30") ?? undefined),
    convertCardmarketToUsd(tcgdxCardmarketPrice(cardmarket, "avg1") ?? undefined),
    convertCardmarketToUsd(tcgdxCardmarketPrice(cardmarket, "averageSellPrice") ?? undefined),
    ...(isJapanese
      ? []
      : [
          convertCardmarketToUsd(tcgdxCardmarketPrice(cardmarket, "lowPriceExPlus") ?? undefined),
          convertCardmarketToUsd(tcgdxCardmarketPrice(cardmarket, "lowPrice") ?? undefined),
        ]),
  ];
  const robustCatalogPrice = robustPrice([
    ...tcgplayerBuckets.flatMap((bucket) => [
      tcgdxTcgplayerPrice(bucket, "market"),
      tcgdxTcgplayerPrice(bucket, "mid"),
      ...(isJapanese ? [] : [tcgdxTcgplayerPrice(bucket, "low")]),
    ]),
    ...cardmarketCandidates,
  ]);

  for (const marketPrice of tcgMarketPrices) {
    if (
      typeof marketPrice === "number" &&
      (robustCatalogPrice === 0 ||
        (marketPrice >= robustCatalogPrice / 3 && marketPrice <= robustCatalogPrice * 3))
    ) {
      return marketPrice;
    }
  }

  return robustCatalogPrice;
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function buildPriceHistory(card: PokemonTcgCardApiResponse["data"][number]) {
  const currentValue = getUsdMarketPrice(card);
  const cardmarket = card.cardmarket?.prices;
  const catalogTrend = convertCardmarketToUsd(cardmarket?.trendPrice) ?? currentValue;

  return [
    { date: isoDaysAgo(30), value: convertCardmarketToUsd(cardmarket?.avg30) ?? currentValue },
    { date: isoDaysAgo(14), value: catalogTrend },
    { date: isoDaysAgo(7), value: convertCardmarketToUsd(cardmarket?.avg7) ?? catalogTrend },
    { date: isoDaysAgo(1), value: convertCardmarketToUsd(cardmarket?.avg1) ?? catalogTrend },
    {
      date: isoDaysAgo(0),
      value: currentValue,
    },
  ];
}

function applyRarityEstimateFloor(card: TcgCard): TcgCard {
  if (card.marketPriceUsd > 0) {
    return card;
  }

  const estimate = cardAdjustedEstimate(card, rarityBaselinePrice(card), "wide");

  if (!(estimate > 0)) {
    return card;
  }

  return applyEarlyMarketEstimateToCard(card, estimate, "Card-adjusted rarity estimate", 0.26);
}

function applyEarlyMarketEstimateToCard(
  card: TcgCard,
  estimatedPrice: number,
  sourceLabel = "Early market estimate",
  confidenceScore = 0.28,
): TcgCard {
  return {
    ...card,
    marketPriceUsd: estimatedPrice,
    priceHistory: card.priceHistory.map((point) => ({
      ...point,
      value: point.value > 0 ? point.value : estimatedPrice,
      isProjected: point.value <= 0 ? true : point.isProjected,
    })),
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: estimatedPrice,
            source: sourceLabel,
            confidence: "low" as const,
            confidenceScore,
            warning:
              sourceLabel === "Early market estimate"
                ? "No live public price was exposed yet for this new print; this is a low-confidence launch-window estimate."
                : "No public price was exposed for this print; this is a low-confidence estimate from rarity and card identity.",
          }
        : price,
    ),
    priceConsensus: {
      ...card.priceConsensus,
      finalEstimateUsd: estimatedPrice,
      confidence: "low",
      confidenceScore,
      sourceCount: Math.max(1, card.priceConsensus?.sourceCount ?? 0),
      sampleCount: card.priceConsensus?.sampleCount ?? 0,
      methodology:
        sourceLabel === "Early market estimate"
          ? "Card-adjusted early market estimate used because public catalog and sold-comp sources have not exposed a usable price for this new print yet."
          : "Low-confidence estimate from rarity and card identity because no public price fields were available for this print.",
      sources: [
        ...(card.priceConsensus?.sources ?? []),
        {
          source: sourceLabel,
          value: estimatedPrice,
          confidence: "low" as const,
          confidenceScore,
          evidenceType: "catalog" as const,
          note:
            sourceLabel === "Early market estimate"
              ? "Temporary card-adjusted estimate from same-set pricing where available, otherwise from rarity, collector number, and card identity signals until live prices arrive."
              : "Fallback estimate so localized prints do not display a zero market value.",
        },
      ],
    },
    sources: [
      ...card.sources,
      {
        source: sourceLabel,
        status: "estimated" as const,
        fetchedAt: new Date().toISOString(),
        confidence: confidenceScore,
        note:
          sourceLabel === "Early market estimate"
            ? "No live market price was available yet; search uses a low-confidence card-adjusted estimate so sorting and display remain usable without flattening every card to one price."
            : "No direct price was exposed for this print.",
      },
    ],
  };
}

async function enrichCardDetailLocalizedGuidePrice(card: TcgCard): Promise<TcgCard> {
  if (shouldStripOfficialJapaneseCatalogFallbackPrice(card)) {
    return stripOfficialJapaneseCatalogFallbackPrice(card);
  }

  if (card.language === "en" || !getLocalizedSetMarketProfile(card.setCode)) {
    return card;
  }

  const localizedName = card.localizedName ?? card.name;
  const englishName =
    card.englishName?.trim() ||
    (card.language === "ja"
      ? await resolveJapaneseCardEnglishName(localizedName, {
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
          cardId: card.id,
          skipTcgdex: true,
        })
      : undefined);

  if (!englishName || !/[a-z]/i.test(englishName)) {
    return card;
  }

  try {
    const guide = await Promise.race([
      fetchLocalizedSetGuidePrice(card, englishName),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), JAPANESE_SEARCH_QUICK_GUIDE_TIMEOUT_MS);
      }),
    ]);

    if (guide?.ungradedUsd && shouldAcceptGuidePrice(card, guide.ungradedUsd)) {
      return applyOfficialJapaneseGuidePrice(
        card,
        englishName !== localizedName ? englishName : card.englishName,
        guide,
      );
    }
  } catch {
    return card;
  }

  return card;
}

async function alignCardDetailPriceWithSearch(card: TcgCard): Promise<TcgCard> {
  let next = await applyQuickSearchPriceFallback(card);

  if (next.language !== "en") {
    next = await enrichCardDetailLocalizedGuidePrice(next);
    return stripLocalizedSearchEstimate(next);
  }

  const needsEarlyEstimate =
    next.language === "en" &&
    (next.marketPriceUsd <= 0 ||
      isSuspiciouslyLowCatalogPrice(next) ||
      shouldEnrichSetSortGuidePrice(next));

  if (!needsEarlyEstimate) {
    return next.marketPriceUsd <= 0 ? applyRarityEstimateFloor(next) : next;
  }

  const baseline = rarityBaselinePrice(next);
  const estimateBase = baseline > 0 ? baseline : 0.18;
  const estimatedPrice = cardAdjustedEstimate(
    next,
    estimateBase,
    baseline > 0 ? "narrow" : "wide",
  );

  if (!(estimatedPrice > 0)) {
    return next;
  }

  if (next.marketPriceUsd > 0 && estimatedPrice <= next.marketPriceUsd * 1.05) {
    return next;
  }

  return applyEarlyMarketEstimateToCard(next, estimatedPrice);
}

async function finalizeLiveCardLookup(
  card: TcgCard,
  includePublicPriceFallback: boolean,
): Promise<TcgCard> {
  if (card.language !== "en") {
    return shouldStripOfficialJapaneseCatalogFallbackPrice(card)
      ? stripOfficialJapaneseCatalogFallbackPrice(card)
      : stripLocalizedSearchEstimate(card);
  }

  if (!includePublicPriceFallback) {
    return card;
  }

  return alignCardDetailPriceWithSearch(await applyPublicPriceFallback(card));
}

async function applyPublicPriceFallback(card: TcgCard): Promise<TcgCard> {
  if (shouldStripOfficialJapaneseCatalogFallbackPrice(card)) {
    return stripOfficialJapaneseCatalogFallbackPrice(card);
  }

  // Magery sold-comp scrapes take 10–25s. Card detail already refines price via
  // /api/price; skip the scrape when the catalog already has a usable number.
  if (
    card.language === "en" &&
    card.marketPriceUsd > 0 &&
    !isSuspiciouslyLowCatalogPrice(card)
  ) {
    return card;
  }

  try {
    const fallback = await Promise.race([
      fetchPublicUngradedPriceFallback(card),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), PUBLIC_PRICE_FALLBACK_BUDGET_MS);
      }),
    ]);
    const fallbackPrice = fallback?.priceUsd ?? 0;
    const catalogPrice = card.marketPriceUsd;
    const shouldUseFallback =
      fallbackPrice > 0 &&
      (card.language !== "en"
        ? (fallback?.sampleCount ?? 0) >= 2 ||
          !(catalogPrice > 0) ||
          fallbackPrice > catalogPrice * 1.35 ||
          catalogPrice > fallbackPrice * 1.35
        : !(catalogPrice > 0) ||
          fallbackPrice > catalogPrice * 4 ||
          catalogPrice > fallbackPrice * 4);
    const weakSingleSampleFallback = Boolean(
      fallback &&
        (fallback.sampleCount ?? 0) < 2 &&
        fallback.matchTier === "strict" &&
        fallbackPrice < Math.max(rarityBaselinePrice(card) * 2.5, 30),
    );

    if (!shouldUseFallback || weakSingleSampleFallback) {
      const rarityFloor = card.language === "en" ? applyRarityEstimateFloor(card) : card;
      return await enrichLocalizedSearchGuidePrice(
        rarityFloor.marketPriceUsd > 0 ? rarityFloor : card,
      );
    }

    return {
      ...card,
      marketPriceUsd: fallbackPrice,
      priceHistory: card.priceHistory.map((point) => ({
        ...point,
        value: fallbackPrice,
      })),
      gradedPrices: card.gradedPrices.map((price) =>
        price.grade === "Ungraded"
          ? {
              ...price,
              value: fallbackPrice,
              source: "Engineered from public sold comps",
              saleCount: fallback?.sampleCount,
              confidence: fallback?.matchTier === "strict" ? ("medium" as const) : ("low" as const),
              confidenceScore: fallback?.matchTier === "strict" ? 0.68 : 0.44,
            }
          : price,
      ),
      priceConsensus: {
        finalEstimateUsd: fallbackPrice,
        confidence: fallback?.matchTier === "strict" ? "medium" : "low",
        confidenceScore: fallback?.matchTier === "strict" ? 0.68 : 0.44,
        sourceCount: Math.max(1, card.priceConsensus?.sourceCount ?? 0),
        sampleCount: fallback?.sampleCount ?? 0,
        methodology:
          card.language === "ja"
            ? "Japanese market estimate from public sold listings matched by card name, set code, and collector number."
            : "Market estimate from public sold listings matched by card name, set, and collector number.",
        sources: [
          ...(card.priceConsensus?.sources ?? []),
          {
            source: "Public sold comps fallback",
            value: fallbackPrice,
            confidence: fallback?.matchTier === "strict" ? ("medium" as const) : ("low" as const),
            confidenceScore: fallback?.matchTier === "strict" ? 0.68 : 0.44,
            evidenceType: "sold_comp" as const,
            sampleCount: fallback?.sampleCount,
            note: `Median from ${fallback?.sampleCount ?? 0} ${fallback?.matchTier ?? "loose"} public sold listings.`,
          },
        ],
      },
      sources: [
        ...card.sources,
        {
          source: "Public sold comps fallback",
          status: "estimated",
          fetchedAt: new Date().toISOString(),
          confidence: fallback?.matchTier === "strict" ? 0.68 : 0.44,
          note:
            catalogPrice > 0
              ? "Ungraded price was replaced with public sold-listing comps because the catalog snapshot looked like an outlier."
              : "Ungraded price was estimated from public sold listings because the live catalog had no TCGplayer/Cardmarket price fields.",
        },
      ],
    };
  } catch {
    const fallbackCard = card.language === "en" ? applyRarityEstimateFloor(card) : card;
    return await enrichLocalizedSearchGuidePrice(fallbackCard);
  }
}

async function enrichLocalizedSearchGuidePrice(card: TcgCard): Promise<TcgCard> {
  const localizedProfile = getLocalizedSetMarketProfile(card.setCode);
  const suspiciousCatalog = isSuspiciouslyLowCatalogPrice(card);
  const isJapanese = card.language === "ja";

  if (card.language === "en" && !suspiciousCatalog) {
    return card;
  }

  if (card.language !== "en" && !localizedProfile && !isJapanese) {
    return card;
  }

  const headline = getHeadlineMarketPriceUsd(card);
  const hasStrongSoldCompPrice = Boolean(
    card.priceConsensus?.sources?.some(
      (source) =>
        source.evidenceType === "sold_comp" && (source.confidenceScore ?? 0) >= 0.68,
    ),
  );

  if (
    !isJapanese &&
    headline >= 40 &&
    !isRarityDerivedMarketPrice(card) &&
    !suspiciousCatalog
  ) {
    return card;
  }

  if (isJapanese && hasStrongSoldCompPrice && headline >= 15 && !suspiciousCatalog) {
    return card;
  }

  try {
    const lookupSetName = card.setEnglishName?.trim() || card.setName;
    const lookupCardName = card.englishName?.trim() || card.name;
    const lookupOptions = {
      setCode: card.setCode,
      isJapanese: card.language === "ja",
      language: card.language,
      englishCardName: card.englishName?.trim() || undefined,
    };
    const guide = await fetchQuickLocalizedGuidePrice(
      lookupSetName,
      lookupCardName,
      card.collectorNumber,
      card.setPrintedTotal ?? card.setTotal,
      lookupOptions,
    );
    const marketData =
      card.language === "en" && suspiciousCatalog
        ? null
        : await Promise.race([
            fetchGradingMarketData(
              lookupSetName,
              lookupCardName,
              card.collectorNumber,
              card.marketPriceUsd,
              card.setPrintedTotal ?? card.setTotal,
              card.rarity,
              lookupOptions,
            ),
            new Promise<null>((resolve) => {
              setTimeout(() => resolve(null), 30_000);
            }),
          ]);

    const consensusPrice = marketData?.priceConsensus
      ? getHeadlineMarketPriceUsd({
          marketPriceUsd: card.marketPriceUsd,
          gradedPrices: marketData.gradedPrices,
          priceConsensus: marketData.priceConsensus,
        })
      : 0;
    const guidePrice = guide?.ungradedUsd ?? 0;
    const nextPrice = Math.max(consensusPrice, guidePrice);
    const shouldApplyJapaneseGuide =
      isJapanese &&
      guidePrice > 0 &&
      (suspiciousCatalog ||
        isRarityDerivedMarketPrice(card) ||
        !isTrustedCatalogMarketPrice(card) ||
        guidePrice > headline * 0.85);

    if (!shouldApplyJapaneseGuide && !(nextPrice > headline * 1.05)) {
      return card;
    }

    const gradedPrices = mergeCatalogAndLiveGradedPrices(
      card.gradedPrices,
      marketData?.gradedPrices?.length ? marketData.gradedPrices : (guide?.gradedPrices ?? []),
    );

    return {
      ...card,
      marketPriceUsd: nextPrice,
      gradedPrices,
      priceHistory: card.priceHistory.map((point) => ({
        ...point,
        value: point.value > 0 ? point.value : nextPrice,
      })),
      priceConsensus: marketData?.priceConsensus ?? {
        finalEstimateUsd: nextPrice,
        confidence: "medium",
        confidenceScore: 0.62,
        sourceCount: 1,
        sampleCount: 0,
        methodology:
          "Localized search price from PriceCharting's public guide snapshot for this print.",
        sources: [
          {
            source: "PriceCharting public guide",
            value: nextPrice,
            confidence: "medium",
            confidenceScore: 0.62,
            evidenceType: "guide_snapshot",
            note: "Guide snapshot used to align search list pricing with card detail for localized prints.",
          },
        ],
      },
      sources: [
        ...card.sources,
        {
          source:
            consensusPrice >= guidePrice && marketData?.priceConsensus
              ? "Grading market consensus"
              : "PriceCharting public guide",
          status: "verified" as const,
          fetchedAt: new Date().toISOString(),
          confidence: consensusPrice >= guidePrice ? 0.72 : 0.62,
          note: "Search list price aligned with the same public market sources used on the card detail page.",
        },
      ],
    };
  } catch {
    return card;
  }
}


// Keep the per-render PriceCharting load gentle: that source hard-blocks IPs (403)
// when scraped too aggressively, after which every price falls back to an estimate.
// Cards beyond this cap keep their display estimate and are still upgraded
// client-side by the cache-first /api/price hook (which is itself bounded).
const OFFICIAL_JP_SET_BROWSE_PRICE_CONCURRENCY = 5;
const OFFICIAL_JP_SET_BROWSE_PRICE_MAX_CARDS = 24;
// Price-sort for official-catalog JP sets must enrich chase cards (secret slots /
// ex / mega) before paging — otherwise page 1 is commons at ~$1.50 and the UI
// looks like the set tops out at MYR 7. Cap keeps Jina guide lookups inside the
// route budget while covering every named chase print in typical Mega sets.
const OFFICIAL_JP_SET_PRICE_SORT_MAX_CARDS = 24;
const OFFICIAL_JP_SET_BROWSE_GUIDE_CARD_TIMEOUT_MS = 2_000;
const OFFICIAL_JP_SET_GUIDE_DEADLINE_MS = 3_800;
// Rolling-window pool size for per-card pokemon-card.com detail fetches. Bounds
// concurrent connections (avoids self-throttling) while keeping the tail short.
const OFFICIAL_JP_DETAIL_CONCURRENCY = 10;
// Per-card cap for the official-Japanese default-browse enrichment. Each card
// may chase up to three TCGdex lookups; without a cap a throttled upstream made
// a 50-card set browse take ~36s (close to the route budget). A timed-out card
// falls back to the card built from the browse payload (id/name/image), so the
// set still renders fast and completely.
const OFFICIAL_JP_DETAIL_CARD_TIMEOUT_MS = 6_500;
const SET_PRICE_SORT_JP_MAX_CARDS = 400;
const SET_PRICE_SORT_GUIDE_MAX_CARDS = 30;
const SET_PRICE_SORT_GUIDE_CARD_TIMEOUT_MS = 2_500;
const SEARCH_QUICK_GUIDE_TIMEOUT_MS = 2_500;
const JAPANESE_SEARCH_QUICK_GUIDE_TIMEOUT_MS = 5_000;
// One shared PriceCharting console snapshot prices the whole set. Keep this
// inside the 3s search paint budget so set + price-sort does not stall.
const SET_PRICE_SORT_ENRICHMENT_BUDGET_MS = 2_000;
const SET_PRICE_SORT_TCGDEX_FILL_BUDGET_MS = 1_600;
const SET_PRICE_SORT_TCGDEX_FILL_MAX_CARDS = 48;
const SET_PRICE_SORT_TCGDEX_FILL_CARD_TIMEOUT_MS = 700;

async function resolveJapaneseCardEnglishName(
  jpName: string,
  context: {
    setCode?: string;
    collectorNumber?: string;
    cardId?: string;
    dexIds?: number[];
    skipTcgdex?: boolean;
  } = {},
): Promise<string | undefined> {
  return resolveJapaneseCardIdentity({
    jpName,
    setCode: context.setCode,
    collectorNumber: context.collectorNumber,
    cardId: context.cardId,
    dexIds: context.dexIds,
    skipTcgdex: context.skipTcgdex,
  });
}

async function enrichJapaneseEnglishNames(
  cards: TcgCard[],
  options: { skipTcgdex?: boolean } = {},
): Promise<TcgCard[]> {
  return mapWithConcurrency(cards, 10, async (card) => {
    if (card.language !== "ja") {
      return card;
    }

    const localizedName = card.localizedName ?? card.name;
    const inferred = inferEnglishNameFromTcgdexLocalizedName(localizedName);
    const companionOk = tcgdexEnglishCompanionNameAgrees(localizedName, card.englishName);

    if (inferred && (!card.englishName?.trim() || !companionOk)) {
      return {
        ...card,
        englishName: inferred,
        name: formatBilingualName(localizedName, inferred),
      };
    }

    if (companionOk && card.englishName?.trim()) {
      return card;
    }

    try {
      const englishName = await resolveJapaneseCardIdentity({
        jpName: localizedName,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        cardId: card.id,
        dexIds: card.dexIds,
        skipTcgdex: options.skipTcgdex,
      });

      if (!englishName) {
        return inferred
          ? {
              ...card,
              englishName: inferred,
              name: formatBilingualName(localizedName, inferred),
            }
          : card;
      }

      return {
        ...card,
        englishName,
        name: formatBilingualName(localizedName, englishName),
      };
    } catch {
      return card;
    }
  });
}

async function fetchLocalizedSetGuidePrice(
  card: TcgCard,
  englishName: string,
): Promise<Awaited<ReturnType<typeof fetchQuickLocalizedGuidePrice>>> {
  const profile = getLocalizedSetMarketProfile(card.setCode);

  if (!profile || (!profile.englishName && !profile.priceChartingSlug)) {
    return null;
  }

  const lookupOptions = {
    setCode: card.setCode,
    isJapanese: card.language === "ja",
    language: card.language,
    englishCardName: englishName,
    allowScrape: false as const,
  };
  const setTotal = card.setPrintedTotal ?? card.setTotal;
  const setEnglishName = profile.englishName ?? card.setName;
  const withNumber = await fetchQuickLocalizedGuidePrice(
    setEnglishName,
    englishName,
    card.collectorNumber,
    setTotal,
    lookupOptions,
  );

  if (withNumber?.ungradedUsd) {
    return withNumber;
  }

  if (!card.collectorNumber?.trim()) {
    return withNumber;
  }

  return (
    (await fetchQuickLocalizedGuidePrice(
      setEnglishName,
      englishName,
      "",
      setTotal,
      lookupOptions,
    )) ?? withNumber
  );
}

function applyOfficialJapaneseGuidePrice(
  card: TcgCard,
  englishName: string | undefined,
  guide: NonNullable<Awaited<ReturnType<typeof fetchQuickLocalizedGuidePrice>>>,
): TcgCard {
  const jpName = card.localizedName ?? card.name;
  const guidePrice = guide.ungradedUsd;
  const fetchedAt = new Date().toISOString();

  return {
    ...card,
    englishName,
    name: formatBilingualName(jpName, englishName),
    marketPriceUsd: guidePrice,
    gradedPrices: mergeCatalogAndLiveGradedPrices(card.gradedPrices, guide.gradedPrices),
    priceHistory: card.priceHistory.map((point) => ({
      ...point,
      value: guidePrice,
    })),
    priceConsensus: {
      finalEstimateUsd: guidePrice,
      confidence: "medium",
      confidenceScore: 0.62,
      sourceCount: 1,
      sampleCount: 0,
      methodology:
        "Japanese set browse price from PriceCharting's public guide snapshot for this print.",
      sources: [
        {
          source: "PriceCharting public guide",
          value: guidePrice,
          confidence: "medium",
          confidenceScore: 0.62,
          evidenceType: "guide_snapshot",
          note: "Per-card guide snapshot for official Japanese catalog set browse.",
        },
      ],
    },
    sources: [
      ...card.sources,
      {
        source: "PriceCharting public guide",
        status: "verified" as const,
        fetchedAt,
        confidence: 0.62,
        note: "Per-card Japanese set browse price from PriceCharting.",
      },
    ],
  };
}

function officialJapaneseSetHasPricedChase(cards: TcgCard[]) {
  const priced = cards.map((card) => card.marketPriceUsd).filter((price) => price > 0);
  const maxPriced = priced.length ? Math.max(...priced) : 0;
  return priced.length >= 8 || maxPriced >= 20;
}

async function fetchSetGuideForBrowse(
  card: TcgCard,
  setMeta?: { setName?: string; englishSetName?: string },
) {
  return Promise.race([
    fetchPriceChartingSetGuideForSet({
      language: card.language,
      setCode: card.setCode,
      setName:
        setMeta?.englishSetName ||
        setMeta?.setName ||
        card.setEnglishName ||
        card.setName,
      setEnglishName: setMeta?.englishSetName || card.setEnglishName,
    }).catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), OFFICIAL_JP_SET_GUIDE_DEADLINE_MS);
    }),
  ]);
}

async function enrichLocalizedSetBrowsePrices(
  cards: TcgCard[],
  options: {
    maxCards?: number;
    concurrency?: number;
    cardTimeoutMs?: number;
    preferCardIds?: ReadonlySet<string>;
  } = {},
): Promise<TcgCard[]> {
  const sample = cards.find(
    (card) =>
      card.language !== "en" &&
      card.setCode?.trim() &&
      !shouldStripOfficialJapaneseCatalogFallbackPrice(card) &&
      hasLocalizedMarketIndex(card.setCode),
  );

  if (!sample) {
    return cards;
  }

  const unnamed = cards.filter(
    (card) => card.language === "ja" && !card.englishName?.trim(),
  );
  let namedCards = cards;

  if (unnamed.length) {
    const namedById = new Map<string, TcgCard>();
    await mapWithConcurrency(unnamed.slice(0, options.maxCards ?? 40), 8, async (card) => {
      try {
        const englishName = await resolveJapaneseCardEnglishName(
          card.localizedName ?? card.name,
          {
            setCode: card.setCode,
            collectorNumber: card.collectorNumber,
            cardId: card.id,
            skipTcgdex: true,
          },
        );
        if (englishName?.trim()) {
          namedById.set(card.id, {
            ...card,
            englishName,
            name: formatBilingualName(card.localizedName ?? card.name, englishName),
          });
        }
      } catch {
        // Best-effort DB name lookup; never reject the browse.
      }
    });
    if (namedById.size) {
      namedCards = cards.map((card) => namedById.get(card.id) ?? card);
    }
  }

  const guide = await fetchSetGuideForBrowse(sample);
  if (!guide?.entries.length) {
    return namedCards;
  }

  return applyPriceChartingSetGuideToCards(namedCards, guide, {
    language: sample.language,
    setCode: sample.setCode,
  });
}

function isOfficialJapaneseChaseIdentity(card: TcgCard) {
  const identity = `${card.name} ${card.englishName ?? ""} ${card.localizedName ?? ""}`;
  return /\bmega\b|メガ|\bex\b|ｅｘ|VMAX|VSTAR|\bGX\b|special illustration|\bsir\b|\bsar\b|hyper rare|illustration rare|アートレア|スーパーレア/i.test(
    identity,
  );
}

function clearStaleOfficialJapaneseGuidePrice(card: TcgCard): TcgCard {
  if (!(card.marketPriceUsd > 0)) {
    return card;
  }

  return {
    ...card,
    marketPriceUsd: 0,
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: 0,
            source: undefined,
            confidence: undefined,
            confidenceScore: undefined,
          }
        : price,
    ),
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: 0,
          confidence: "low",
          confidenceScore: 0,
          sourceCount: 0,
          sampleCount: 0,
          sources: [],
        }
      : card.priceConsensus,
    sources: card.sources.filter(
      (source) => !/pricecharting|public guide/i.test(source.source),
    ),
  };
}

async function hydrateOfficialJapanesePrintedCollectorNumbers(
  cards: TcgCard[],
): Promise<TcgCard[]> {
  return mapWithConcurrency(cards, 4, async (card) => {
    const officialId =
      card.officialCardId?.trim() ||
      card.marketIdentity?.officialCardId?.trim() ||
      card.id.replace(/^official-/i, "").trim();

    // PriceCharting-only supplement rows use ids such as `official-pc-m5-118`
    // and do not have a pokemon-card.com detail page. Preserve the existing
    // guard while routing every real official card through the canonical resolver.
    if (!/^\d+$/.test(officialId)) {
      return card;
    }

    const previousNumber = card.collectorNumber?.trim() ?? "";
    const previousIdentity = card.marketIdentity;
    const identity = await resolveJapaneseMarketIdentity({
      officialCardId: officialId,
      browseIndex: card.browseIndex ?? card.marketIdentity?.browseIndex ?? null,
      japaneseName: card.localizedName ?? card.marketIdentity?.japaneseName ?? card.name,
      englishMarketName: card.englishName ?? card.marketIdentity?.englishMarketName ?? null,
      printedCollectorNumber:
        card.marketIdentity?.printedCollectorNumber ?? card.collectorNumber ?? null,
      collectorNumberTotal:
        card.marketIdentity?.collectorNumberTotal ??
        card.setPrintedTotal ??
        card.setTotal ??
        null,
      japaneseSetCode: card.marketIdentity?.japaneseSetCode ?? card.setCode ?? null,
      japaneseSetName:
        card.marketIdentity?.japaneseSetName ?? card.setLocalizedName ?? card.setName ?? null,
      englishSetName:
        card.marketIdentity?.englishSetName ?? card.setEnglishName ?? null,
      priceChartingSetSlug: card.marketIdentity?.priceChartingSetSlug ?? null,
      priceChartingProductId: card.marketIdentity?.priceChartingProductId ?? null,
      priceChartingProductUrl: card.marketIdentity?.priceChartingProductUrl ?? null,
      identitySource: card.marketIdentity?.identitySource,
    }).catch(() => null);

    if (!identity) {
      return card;
    }

    const printed = identity.printedCollectorNumber ?? "";
    const englishName = identity.englishMarketName ?? undefined;
    const localizedName = identity.japaneseName || card.localizedName || card.name;
    const localizedSetName =
      identity.japaneseSetName || card.setLocalizedName || card.setName;
    const englishSetName = identity.englishSetName ?? card.setEnglishName;
    const setName = englishSetName
      ? formatBilingualName(localizedSetName, englishSetName)
      : localizedSetName;

    const next: TcgCard = {
      ...card,
      officialCardId: identity.officialCardId,
      browseIndex: identity.browseIndex ?? card.browseIndex,
      marketIdentity: identity,
      collectorNumber: printed,
      englishName,
      localizedName,
      name: englishName ? formatBilingualName(localizedName, englishName) : localizedName,
      setId: identity.japaneseSetCode ?? card.setId,
      setCode: identity.japaneseSetCode ?? card.setCode,
      setName,
      setLocalizedName: localizedSetName,
      setEnglishName: englishSetName,
      setPrintedTotal: identity.collectorNumberTotal ?? card.setPrintedTotal,
    };
    const identityChanged = previousIdentity
      ? japaneseMarketIdentityMaterialKey(previousIdentity) !==
        japaneseMarketIdentityMaterialKey(identity)
      : printed !== previousNumber ||
        identity.officialCardId !== officialId ||
        (englishName ?? "") !== (card.englishName?.trim() ?? "") ||
        (identity.japaneseSetCode ?? "") !== (card.setCode?.trim() ?? "");

    // A previously priced browse index/product identity is unsafe once any
    // canonical material field changes, not only when the number changes.
    return identityChanged ? clearStaleOfficialJapaneseGuidePrice(next) : next;
  });
}

function selectOfficialJapanesePriceSortCandidates(cards: TcgCard[], maxCards: number) {
  const chaseByName = cards.filter(isOfficialJapaneseChaseIdentity);
  const byPriority = cards
    .slice()
    .sort((left, right) => setSortGuidePriorityScore(right) - setSortGuidePriorityScore(left));
  // High browse-index rows are often secret/SAR slots once printed numbers hydrate.
  const byNumber = cards
    .slice()
    .sort(
      (left, right) =>
        collectorNumberSortValue(right.collectorNumber) -
        collectorNumberSortValue(left.collectorNumber),
    )
    .slice(0, Math.max(12, Math.ceil(maxCards / 2)));
  const selected: TcgCard[] = [];
  const seen = new Set<string>();

  for (const card of [...chaseByName, ...byNumber, ...byPriority]) {
    if (seen.has(card.id)) {
      continue;
    }
    seen.add(card.id);
    selected.push(card);
    // Always keep every named chase print (ex/mega/SAR). Fill remaining slots
    // from priority order up to a hard cap so large sets stay within budget.
    if (
      selected.length >= Math.max(maxCards, chaseByName.length) &&
      selected.length >= chaseByName.length
    ) {
      break;
    }
    if (selected.length >= Math.max(maxCards * 2, 36)) {
      break;
    }
  }

  return selected;
}

async function enrichOfficialJapaneseSetBrowsePrices(
  cards: TcgCard[],
  options: { maxCards?: number } = {},
): Promise<TcgCard[]> {
  const sample = cards.find((card) => card.setCode?.trim());
  if (sample?.setCode) {
    await resolvePriceChartingSetSlugs(sample.setName || sample.setCode, {
      setCode: sample.setCode,
      language: "ja",
    }).catch(() => undefined);
  }

  const stripped = cards.map(stripOfficialJapaneseCatalogFallbackPrice);
  const guide = sample ? await fetchSetGuideForBrowse(sample) : null;

  if (guide?.entries.length) {
    return applyPriceChartingSetGuideToCards(stripped, guide, {
      language: "ja",
      setCode: sample?.setCode,
    });
  }

  // Guide miss: keep the old bounded chase-hydrate path so price-desc still
  // has something to rank, but never wait on per-card resolvePrice.
  const maxCards = options.maxCards ?? OFFICIAL_JP_SET_PRICE_SORT_MAX_CARDS;
  const toHydrate = selectOfficialJapanesePriceSortCandidates(stripped, maxCards);
  const hydratedChase = await Promise.race([
    hydrateOfficialJapanesePrintedCollectorNumbers(toHydrate),
    new Promise<TcgCard[]>((resolve) => {
      setTimeout(() => resolve(toHydrate), 3_000);
    }),
  ]);
  const hydratedById = new Map(hydratedChase.map((card) => [card.id, card]));
  return stripped.map((card) => hydratedById.get(card.id) ?? card);
}

const OFFICIAL_JP_SECRET_RARE_GUIDE_MAX_CARDS = 80;

/**
 * The official Pokemon Card catalog only exposes the BASE print run for
 * supplement sets (M5 "Abyss Eye" reports hitCnt 81 — no SAR/UR slots), so a
 * price-desc set browse topped out at the ~$3 base ex prints while the $300+
 * secret rares were never listed at all. English APIs can omit the same high
 * numbers when TCGPlayer has no SKU yet. PriceCharting's set-level guide knows
 * every print with prices and thumbnails; append the missing above-printed-total
 * slots as guide-backed cards so browsing and price sorting reflect the real set.
 */
async function appendSecretRaresFromSetGuide(
  cards: TcgCard[],
  setMeta?: { printedTotal?: number; total?: number },
): Promise<TcgCard[]> {
  const sample = cards.find((card) => card.setCode?.trim());

  if (!sample?.setCode) {
    return cards;
  }

  const printedTotal =
    setMeta?.printedTotal ?? sample.setPrintedTotal ?? setMeta?.total ?? sample.setTotal ?? cards.length;

  if (!(printedTotal > 0)) {
    return cards;
  }

  const guide = await fetchPriceChartingSetGuideForSet({
    language: sample.language,
    setCode: sample.setCode,
    setName: sample.setEnglishName || sample.setName,
    setEnglishName: sample.setEnglishName,
  }).catch(() => null);

  if (!guide?.entries.length) {
    return cards;
  }

  const knownNumbers = new Set(
    cards
      .map((card) => card.collectorNumber?.trim().replace(/^0+(?=\d)/, "") ?? "")
      .filter(Boolean),
  );
  const secretCards = guide.entries
    .filter((entry) => {
      const numeric = Number.parseInt(entry.numberBase, 10);
      return (
        Number.isFinite(numeric) &&
        numeric > printedTotal &&
        entry.ungradedUsd > 0 &&
        !knownNumbers.has(entry.numberBase)
      );
    })
    .sort(
      (left, right) =>
        Number.parseInt(left.numberBase, 10) - Number.parseInt(right.numberBase, 10),
    )
    .slice(0, OFFICIAL_JP_SECRET_RARE_GUIDE_MAX_CARDS)
    .map((entry) =>
      buildGuideSecretRareCard(
        entry,
        {
          setId: sample.setId,
          setCode: sample.setCode,
          setName: sample.setName,
          setLocalizedName: sample.setLocalizedName,
          setEnglishName: sample.setEnglishName,
          setPrintedTotal: sample.setPrintedTotal,
          setTotal: sample.setTotal,
          language: sample.language,
        },
        guide.url,
      ),
    );

  const withSecrets = secretCards.length ? [...cards, ...secretCards] : cards;
  return applyPriceChartingSetGuideToCards(withSecrets, guide, {
    language: sample.language,
    setCode: sample.setCode,
  });
}

async function appendOfficialJapaneseSecretRaresFromSetGuide(
  cards: TcgCard[],
  setMeta?: { printedTotal?: number; total?: number },
): Promise<TcgCard[]> {
  return appendSecretRaresFromSetGuide(cards, setMeta);
}

const SEARCH_PRICE_FALLBACK_MAX_RESULTS = 4;
const SEARCH_PRICE_FALLBACK_MAX_SET_RESULTS = 6;
const SEARCH_RESULT_CACHE_TTL_MS = 15 * 60 * 1000;
const LOCALIZED_ALIAS_BRIEF_LIMIT = 56;
const ALL_LANGUAGE_SEARCH_CONCURRENCY = 5;
const ENGLISH_SET_PRICE_SORT_PAGE_SIZE = 250;
const ENGLISH_SET_PRICE_SORT_MAX_CARDS = 300;
// TCGdex is an optional enrichment source for English set price sorting. Some
// sets (including newly released ones) are missing there or have slow detail
// hydration; never let that optional branch consume the entire search budget.
const ENGLISH_SET_TCGDEX_DEADLINE_MS = 2_500;
const ENGLISH_SET_POKEMON_TCG_DEADLINE_MS = 1_800;
const LOCALIZED_PRICE_SORT_MAX_CARDS = 500;
const SET_PRICE_SORT_CACHE_TTL_MS = 15 * 60 * 1000;
const SET_SORT_GUIDE_MAX_CARDS = 14;
const SET_SORT_GUIDE_CONCURRENCY = 2;
const SET_SORT_GUIDE_BUDGET_MS = 3_000;
const SET_SORT_GUIDE_CARD_TIMEOUT_MS = 800;
const SET_SORT_GUIDE_RARITY_PATTERN =
  /special illustration|illustration rare|hyper rare|secret rare|art rare|ultra rare|double rare|triple rare|mega attack/i;
const SEARCH_CACHE_KEY_VERSION = "v66";

const setPriceSortCache = new Map<
  string,
  {
    expiresAt: number;
    response: Omit<LiveSearchResponse, "page" | "results" | "hasNextPage"> & {
      sortedResults: SearchResult[];
    };
  }
>();
const searchResultCache = new Map<
  string,
  { expiresAt: number; value: LiveSearchResponse }
>();
const searchResultInFlight = new Map<string, Promise<LiveSearchResponse>>();

const LIVE_SEARCH_PRIMARY_TIMEOUT_MS = Number.parseInt(
  process.env.LIVE_SEARCH_PRIMARY_TIMEOUT_MS ?? "",
  10,
);
const LIVE_SEARCH_FALLBACK_TIMEOUT_MS = Number.parseInt(
  process.env.LIVE_SEARCH_FALLBACK_TIMEOUT_MS ?? "",
  10,
);
// Named Dex queries must paint identities in well under 3s. Prices lazy-load.
const SEARCH_PRIMARY_TIMEOUT_MS =
  Number.isFinite(LIVE_SEARCH_PRIMARY_TIMEOUT_MS) && LIVE_SEARCH_PRIMARY_TIMEOUT_MS > 0
    ? LIVE_SEARCH_PRIMARY_TIMEOUT_MS
    : 2_000;
const SEARCH_PRICE_HYDRATE_TIMEOUT_MS = 800;
const SEARCH_RESPONSE_BUDGET_MS = FAST_SEARCH_BUDGET_MS;
const SEARCH_FALLBACK_TIMEOUT_MS =
  Number.isFinite(LIVE_SEARCH_FALLBACK_TIMEOUT_MS) && LIVE_SEARCH_FALLBACK_TIMEOUT_MS > 0
    ? LIVE_SEARCH_FALLBACK_TIMEOUT_MS
    : 700;
/** Empty Dex landing must not wait on a slow Pokémon TCG trending query. */
const TRENDING_UPSTREAM_DEADLINE_MS = 1_800;
/** Extra identities so 7-day momentum ranking has a real pool, not one API page of grails. */
const TRENDING_POOL_SIZE = 32;
/**
 * Live Dex trending is chase rarities with Cardmarket history. Famous-name ORs
 * turned this into a Charizard hall of fame sorted by price, not movers.
 */
const TRENDING_CATALOG_QUERY =
  '(rarity:"Special Illustration Rare" OR rarity:"Illustration Rare" OR rarity:"Hyper Rare" OR rarity:"Secret Rare" OR rarity:"Rare Holo Star" OR rarity:"Amazing Rare" OR rarity:"Rare Shining" OR rarity:"Rare Rainbow" OR rarity:"Ultra Rare" OR rarity:"Double Rare")';
const TRENDING_CATALOG_QUERY_FALLBACK =
  '(rarity:"Special Illustration Rare" OR rarity:"Illustration Rare" OR rarity:"Hyper Rare" OR rarity:"Secret Rare")';
/** Set filter browses must paint identities quickly; local catalog fills misses. */
const SET_BROWSE_PRIMARY_TIMEOUT_MS = 1_800;
/** Full-set identity + one shared PriceCharting guide; stay under the 4.5s wall. */
const SET_PRICE_SORT_PRIMARY_TIMEOUT_MS = 4_000;
/** Hard wall for set + price-sort so fallbacks cannot stack past 5s. */
const SET_PRICE_SORT_WALL_MS = 4_500;
const SET_PRICE_SORT_ENGLISH_RACE_MS = 3_800;
const SET_PRICE_SORT_POKEMON_TCG_DEADLINE_MS = 2_800;
const ALL_LANGUAGE_SET_PRICE_SORT_BUDGET_MS = 3_500;

function timeoutAfter<T>(ms: number, label: string): Promise<T> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
    timer.unref?.();
  });
}

function withSearchTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([promise, timeoutAfter<T>(ms, label)]);
}

/** Expected upstream/DB degradation — log quietly so Next overlay stays clean. */
function isExpectedSearchDegradation(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    error.name === "PokemonTcgApiError" ||
    message.includes("timed out") ||
    message.includes("circuitbreaker") ||
    message.includes("too many failed attempts to connect")
  );
}

function logSearchDegradation(label: string, error: unknown, context: Record<string, unknown>) {
  if (isExpectedSearchDegradation(error)) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[search] ${label}: ${message}`, {
      query: context.query,
      setFilter: context.setFilter,
      page: context.page,
      language: context.language,
      sort: context.sort,
    });
    return;
  }

  console.error(`🔥 CRITICAL SEARCH FAILURE:`, error);
  console.error(label, {
    ...context,
    error: describeUnknownError(error),
  });
}

export function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    const extraFields = Object.fromEntries(
      Object.entries(error).filter(([, value]) => value !== undefined),
    );

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...extraFields,
    };
  }

  if (error && typeof error === "object") {
    return Object.fromEntries(
      Object.entries(error).filter(([, value]) => value !== undefined),
    );
  }

  return {
    value: error,
  };
}

// Persistent search cache: serves cold instances / pre-seeded browses locally.
// Sits behind the 15-min in-memory cache; longer TTL since it's a cold-start
// accelerator, not the freshness layer.
const SEARCH_RESULT_PERSIST_TTL_MS = 6 * 60 * 60 * 1000;

function makeSearchResultCacheKey(
  query: string,
  setFilter: string | undefined,
  page: number,
  language: CardLanguageFilter,
  sort: SearchSortOption,
) {
  return [
    SEARCH_CACHE_KEY_VERSION,
    query.trim().toLowerCase(),
    (setFilter ?? "").trim().toLowerCase(),
    page,
    language,
    sort,
  ].join("|");
}

function makeOfficialJapaneseFullSetCacheKey(
  query: string,
  setFilter: string | undefined,
  language: CardLanguageFilter,
) {
  const normalizedSet = (setFilter ?? "").trim().toLowerCase();

  if (language !== "ja" || query.trim() || !normalizedSet) {
    return "";
  }

  return [SEARCH_CACHE_KEY_VERSION, "official-japanese-set", normalizedSet, language, "full"].join("|");
}

function pageFullSetSearchResponse(
  response: LiveSearchResponse,
  page: number,
  pageSize: number,
  sort: SearchSortOption,
): LiveSearchResponse {
  const sortedResults =
    sort === "relevance" ? response.results.slice() : applySearchResultSort(response.results, sort);
  const totalCount = sortedResults.length || (response.totalCount ?? 0);
  const startIndex = (page - 1) * pageSize;

  return {
    ...response,
    results: sortedResults.slice(startIndex, startIndex + pageSize),
    totalCount,
    page,
    pageSize,
    hasNextPage: startIndex + pageSize < (totalCount ?? 0),
  };
}

function getCachedSearchResult(cacheKey: string) {
  const cached = searchResultCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) {
      searchResultCache.delete(cacheKey);
    }

    return null;
  }

  return sanitizeLiveSearchResponsePrices(cached.value);
}

function isThinFallbackSearchResponse(value: LiveSearchResponse) {
  return value.notice === LOCAL_CATALOG_FALLBACK_NOTICE;
}

function isLearnedOnlySearchResponse(value: LiveSearchResponse) {
  return (
    /learned from prior searches/i.test(value.notice ?? "") &&
    value.results.length > 0 &&
    value.results.every((result) => result.matchReason.startsWith("Learned"))
  );
}

function setCachedSearchResult(cacheKey: string, value: LiveSearchResponse) {
  // Never freeze an empty page or a 1-card bundled stub. Timeouts used to cache
  // those for 15 minutes and make a 165-card set look permanently empty.
  if (
    !value.results.length ||
    isThinFallbackSearchResponse(value) ||
    isLearnedOnlySearchResponse(value)
  ) {
    return;
  }

  const sanitizedValue = sanitizeLiveSearchResponsePrices(value);

  searchResultCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_RESULT_CACHE_TTL_MS,
    value: structuredClone(sanitizedValue),
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function mapWithConcurrencyUntil<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  isDone: (results: Array<R | undefined>) => boolean,
): Promise<Array<R | undefined>> {
  if (!items.length) {
    return [];
  }

  const results = new Array<R | undefined>(items.length);
  let nextIndex = 0;
  let stop = false;

  async function worker() {
    while (!stop && nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      if (isDone(results)) {
        stop = true;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function isPriceAwareSort(sort: SearchSortOption) {
  return (
    sort === "price-desc" ||
    sort === "price-asc" ||
    sort === "change-desc" ||
    sort === "change-asc"
  );
}

// Number sorting must be materialized before paging. The Pokemon TCG API's
// `-number` ordering is not reliable (it can return page one in ascending
// order). Price sorts used to take only page 1 of trendPrice and let the
// client re-sort; unpriced chase cards then sat at $0 after cheap commons.
function isEnglishSetLocalSort(sort: SearchSortOption) {
  return sort === "number-desc" || sort === "number-asc";
}

function shouldMaterializeFullEnglishSet(sort: SearchSortOption) {
  return isEnglishSetLocalSort(sort) || isPriceAwareSort(sort);
}

function makeSetPriceSortCacheKey(parts: Array<string | number | undefined>) {
  return [SEARCH_CACHE_KEY_VERSION, ...parts]
    .map((part) => String(part ?? "").trim().toLowerCase())
    .join("::");
}

function getCachedSetPriceSort(cacheKey: string) {
  const cached = setPriceSortCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) {
      setPriceSortCache.delete(cacheKey);
    }
    return null;
  }

  return cached.response;
}

function setCachedSetPriceSort(
  cacheKey: string,
  response: Omit<LiveSearchResponse, "page" | "results" | "hasNextPage"> & {
    sortedResults: SearchResult[];
  },
) {
  setPriceSortCache.set(cacheKey, {
    expiresAt: Date.now() + SET_PRICE_SORT_CACHE_TTL_MS,
    response,
  });
}

function pageCachedSetPriceSort(
  cached: Omit<LiveSearchResponse, "page" | "results" | "hasNextPage"> & {
    sortedResults: SearchResult[];
  },
  page: number,
  pageSize: number,
): LiveSearchResponse {
  const start = (page - 1) * pageSize;
  const { sortedResults, ...baseResponse } = cached;
  const totalCount =
    typeof cached.totalCount === "number" ? cached.totalCount : sortedResults.length;

  return {
    ...baseResponse,
    results: sortedResults.slice(start, start + pageSize),
    page,
    pageSize,
    totalCount,
    hasNextPage: start + pageSize < totalCount,
  };
}

function searchFallbackBudget({
  cleanQuery,
  setFilter,
  sort,
  resultCount,
}: {
  cleanQuery: string;
  setFilter?: string;
  sort: SearchSortOption;
  resultCount: number;
}) {
  if (!resultCount) {
    return 0;
  }

  if (setFilter && isPriceAwareSort(sort)) {
    return 0;
  }

  if (setFilter && !cleanQuery) {
    return Math.min(resultCount, SEARCH_PRICE_FALLBACK_MAX_SET_RESULTS);
  }

  if (isPriceAwareSort(sort)) {
    return Math.min(resultCount, SEARCH_PRICE_FALLBACK_MAX_SET_RESULTS);
  }

  if (cleanQuery || setFilter) {
    return Math.min(resultCount, SEARCH_PRICE_FALLBACK_MAX_RESULTS);
  }

  return 0;
}

/** Search list only gets fast catalog estimates; card detail pages run full market enrichment. */
function applySearchCardPriceSnapshot(card: TcgCard): TcgCard {
  if (card.marketPriceUsd > 0) {
    return card;
  }

  if (card.language !== "en") {
    return card;
  }

  return applyRarityEstimateFloor(card);
}

function applyGuidePriceToSearchCard(card: TcgCard, priceUsd: number): TcgCard {
  if (shouldStripOfficialJapaneseCatalogFallbackPrice(card)) {
    return stripOfficialJapaneseCatalogFallbackPrice(card);
  }

  if (!shouldAcceptGuidePrice(card, priceUsd)) {
    return card;
  }

  const nextPrice = Math.round(priceUsd * 100) / 100;

  return {
    ...card,
    marketPriceUsd: nextPrice,
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: nextPrice,
          }
        : price,
    ),
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: nextPrice,
        }
      : card.priceConsensus,
    sources: [
      ...card.sources,
      {
        source: "PriceCharting public guide",
        status: "verified" as const,
        fetchedAt: new Date().toISOString(),
        confidence: 0.62,
        note: "Search list price aligned with a public guide snapshot.",
      },
    ],
  };
}

async function applyQuickSearchPriceFallback(card: TcgCard): Promise<TcgCard> {
  if (shouldStripOfficialJapaneseCatalogFallbackPrice(card)) {
    return stripOfficialJapaneseCatalogFallbackPrice(card);
  }

  const catalogPrice = card.marketPriceUsd;
  const isJapanese = card.language === "ja";
  const needsEnrichment =
    catalogPrice <= 0 ||
    isSuspiciouslyLowCatalogPrice(card) ||
    (isJapanese && catalogPrice > 0 && !isTrustedCatalogMarketPrice(card));

  if (!needsEnrichment) {
    return card;
  }

  const guideTimeoutMs = isJapanese
    ? JAPANESE_SEARCH_QUICK_GUIDE_TIMEOUT_MS
    : SEARCH_QUICK_GUIDE_TIMEOUT_MS;

  try {
    const guide = await Promise.race([
      fetchQuickLocalizedGuidePrice(
        card.setEnglishName?.trim() || card.setName,
        card.englishName?.trim() || card.name,
        card.collectorNumber,
        card.setPrintedTotal ?? card.setTotal,
        {
          setCode: card.setCode,
          isJapanese,
          language: card.language,
          englishCardName: card.englishName?.trim() || undefined,
          allowScrape: false,
        },
      ),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), guideTimeoutMs);
      }),
    ]);

    const guideThreshold = isJapanese ? 0.98 : 1.05;

    if (
      guide?.ungradedUsd &&
      shouldAcceptGuidePrice(card, guide.ungradedUsd) &&
      (isJapanese || guide.ungradedUsd > Math.max(catalogPrice, 0) * guideThreshold)
    ) {
      return applyGuidePriceToSearchCard(card, guide.ungradedUsd);
    }
  } catch {
    // Fall through to the rarity floor below.
  }

  return catalogPrice <= 0 && (card.language === "en" || card.language === "ja")
    ? applyRarityEstimateFloor(card)
    : card;
}

/**
 * List building must stay network-free: the initial search payload carries core
 * identities plus instant local estimates only, and the client's lazy price
 * hooks (`use-lazy-card-price`) resolve verified prices from `/api/price` in
 * small parallel batches after the list has painted. Live PriceCharting guide
 * lookups here used to add multi-second budgets to every search page.
 */
async function enrichSearchResultsWithPublicPriceFallback(
  results: SearchResult[],
  options: { budgetMs?: number; maxCandidates?: number } = {},
): Promise<SearchResult[]> {
  const maxCandidates = options.maxCandidates ?? SEARCH_PRICE_FALLBACK_MAX_RESULTS;

  if (maxCandidates <= 0) {
    return results;
  }

  return results.map((result) => {
    const card = result.card;

    if (shouldStripOfficialJapaneseCatalogFallbackPrice(card)) {
      return { ...result, card: stripOfficialJapaneseCatalogFallbackPrice(card) };
    }

    if (card.marketPriceUsd > 0 && !isSuspiciouslyLowCatalogPrice(card)) {
      return result;
    }

    return { ...result, card: applySearchCardPriceSnapshot(card) };
  });
}

function prepareSetBrowseSortResults(results: SearchResult[]) {
  const cleaned = results.map((result) => ({
    ...result,
    card: stripOfficialJapaneseCatalogFallbackPrice(result.card),
  }));

  return applyEarlyMarketSearchEstimates(applyLocalizedSearchPriceEstimate(cleaned));
}

function prepareSetBrowsePriceSortResults(results: SearchResult[]) {
  // Price sort should rely on direct guide/catalog prices. Sibling/group
  // estimates copy cheap commons onto chase prints and break high-to-low.
  return results.map((result) => ({
    ...result,
    card: stripOfficialJapaneseCatalogFallbackPrice(result.card),
  }));
}

function withHydratedSearchResults(results: SearchResult[], cards: TcgCard[]): SearchResult[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return results.map((result) => ({
    ...result,
    card: byId.get(result.card.id) ?? result.card,
  }));
}

function normalizeSearchCollectorKey(value: string) {
  return value.replace(/^0+(?=\d)/, "").trim().toLowerCase();
}

function applyTcgdexCatalogPrice(card: TcgCard, incoming: TcgCard): TcgCard {
  const nextPrice = incoming.marketPriceUsd;
  const incomingUngraded = incoming.gradedPrices.find((price) => price.grade === "Ungraded");

  return {
    ...card,
    marketPriceUsd: nextPrice,
    finishMarkets: incoming.finishMarkets?.length ? incoming.finishMarkets : card.finishMarkets,
    gradedPrices: card.gradedPrices.some((price) => price.grade === "Ungraded")
      ? card.gradedPrices.map((price) =>
          price.grade === "Ungraded" && nextPrice > 0
            ? {
                ...price,
                ...incomingUngraded,
                grade: "Ungraded",
                value: nextPrice,
              }
            : price,
        )
      : incoming.gradedPrices.some((price) => price.value > 0)
        ? incoming.gradedPrices
        : card.gradedPrices,
    priceHistory: incoming.priceHistory.length ? incoming.priceHistory : card.priceHistory,
    priceConsensus: incoming.priceConsensus ?? card.priceConsensus,
    sources: [
      ...incoming.sources.filter((source) =>
        /tcgdex|tcgplayer|cardmarket/i.test(source.source),
      ),
      ...card.sources,
    ],
  };
}

function mergeSetPriceSortCardPrices(primary: TcgCard[], secondary: TcgCard[]): TcgCard[] {
  const secondaryById = new Map(secondary.map((card) => [card.id, card]));

  return primary.map((card) => {
    if (card.marketPriceUsd > 0) {
      return card;
    }

    const incoming = secondaryById.get(card.id);
    if (!incoming || !(incoming.marketPriceUsd > 0)) {
      return card;
    }

    return applyTcgdexCatalogPrice(card, incoming);
  });
}

function tcgdexDetailPriceForCard(
  card: TcgCard,
  pricedById: Map<string, TcgCard>,
  pricedByCollector: Map<string, TcgCard>,
) {
  for (const candidate of [
    card.id,
    preferTcgdexCardLookupId(card.id),
    ...buildEnglishCardIdCandidates(card.id),
  ]) {
    const hit = pricedById.get(candidate);
    if (hit && hit.marketPriceUsd > 0) {
      return hit;
    }
  }

  return pricedByCollector.get(normalizeSearchCollectorKey(card.collectorNumber));
}

async function fillUnpricedCardsFromTcgdexDetails(
  cards: TcgCard[],
  language: CardLanguageCode,
  options: { budgetMs?: number; maxCards?: number } = {},
): Promise<TcgCard[]> {
  const budgetMs = options.budgetMs ?? SET_PRICE_SORT_TCGDEX_FILL_BUDGET_MS;
  const maxCards = options.maxCards ?? SET_PRICE_SORT_TCGDEX_FILL_MAX_CARDS;
  const unpriced = cards
    .filter((card) => card.language === language && !(card.marketPriceUsd > 0) && card.id.trim())
    .sort(
      (left, right) =>
        collectorNumberSortValue(right.collectorNumber) -
        collectorNumberSortValue(left.collectorNumber),
    )
    .slice(0, maxCards);

  if (!unpriced.length) {
    return cards;
  }

  const detailed = await fetchTcgdexDetailCardsFromBriefs(
    unpriced.map((card) => ({
      id: preferTcgdexCardLookupId(card.id),
      localId: card.collectorNumber,
      name: card.englishName || card.name,
      image: card.image,
    })),
    language,
    { deadlineMs: budgetMs, perCardTimeoutMs: SET_PRICE_SORT_TCGDEX_FILL_CARD_TIMEOUT_MS },
  ).catch(() => [] as TcgdexCardResponse[]);

  if (!detailed.length) {
    return cards;
  }

  const pricedById = new Map<string, TcgCard>();
  const pricedByCollector = new Map<string, TcgCard>();
  for (const detail of detailed) {
    const normalized = normalizeTcgdexCard(detail, language, {
      name: language === "en" ? detail.name : inferEnglishNameFromTcgdexLocalizedName(detail.name),
      setName: getLocalizedSetEnglishName(detail.set.id, detail.set.name),
    });
    if (!(normalized.marketPriceUsd > 0)) {
      continue;
    }

    pricedById.set(normalized.id, normalized);
    pricedById.set(detail.id, normalized);
    for (const candidate of buildEnglishCardIdCandidates(normalized.id)) {
      pricedById.set(candidate, normalized);
    }
    pricedByCollector.set(normalizeSearchCollectorKey(normalized.collectorNumber), normalized);
  }

  if (!pricedById.size) {
    return cards;
  }

  return cards.map((card) => {
    if (card.marketPriceUsd > 0) {
      return card;
    }

    const incoming = tcgdexDetailPriceForCard(card, pricedById, pricedByCollector);
    if (!incoming) {
      return card;
    }

    return applyTcgdexCatalogPrice(card, incoming);
  });
}

async function enrichResultsForSetPriceSort(
  results: SearchResult[],
  language: CardLanguageCode,
): Promise<SearchResult[]> {
  if (!results.length) {
    return results;
  }

  const cards = await appendSecretRaresFromSetGuide(results.map((result) => result.card)).catch(
    () => results.map((result) => result.card),
  );
  const withSecrets =
    cards.length === results.length
      ? results
      : [
          ...withHydratedSearchResults(results, cards),
          ...cards.slice(results.length).map((card) => ({
            card,
            score: results[0]?.score ?? 100,
            matchReason: results[0]?.matchReason ?? "PriceCharting set guide",
          })),
        ];
  const [guidePricedCards, tcgdexFilledCards] = await Promise.all([
    language !== "en"
      ? enrichLocalizedSetBrowsePrices(cards, {
          maxCards: SET_PRICE_SORT_JP_MAX_CARDS,
        })
      : hydrateCardsFromPriceChartingSetGuides(cards, {
          budgetMs: SET_PRICE_SORT_ENRICHMENT_BUDGET_MS,
        }),
    language === "en"
      ? fillUnpricedCardsFromTcgdexDetails(cards, language)
      : Promise.resolve(cards),
  ]);
  const pricedCards = mergeSetPriceSortCardPrices(guidePricedCards, tcgdexFilledCards);
  const nextResults = prepareSetBrowsePriceSortResults(
    withHydratedSearchResults(withSecrets, pricedCards),
  );
  const pricedCount = nextResults.filter((result) => result.card.marketPriceUsd > 0).length;

  // Per-card guide lookups only when the shared set snapshot left most rows empty.
  if (pricedCount < Math.max(8, Math.ceil(nextResults.length * 0.4))) {
    return prepareSetBrowsePriceSortResults(
      await enrichSetSortGuidePrices(nextResults, {
        maxCards: SET_PRICE_SORT_GUIDE_MAX_CARDS,
        budgetMs: 1_200,
        cardTimeoutMs: SET_PRICE_SORT_GUIDE_CARD_TIMEOUT_MS,
        skipWhenSufficient: true,
      }),
    );
  }

  return nextResults;
}

function dedupeSearchResultsByCardId(results: SearchResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = result.card.id.trim().toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function setSortGuideRarityScore(rarity: string) {
  if (/special illustration|\bsir\b|\bsar\b/i.test(rarity)) {
    return 4;
  }

  if (/hyper rare|secret rare/i.test(rarity)) {
    return 3;
  }

  if (/illustration rare|art rare/i.test(rarity)) {
    return 2;
  }

  if (/double rare|ultra rare|triple rare|mega attack/i.test(rarity)) {
    return 1;
  }

  return 0;
}

function setSortGuidePriorityScore(card: TcgCard) {
  const rarityScore = setSortGuideRarityScore(card.rarity);
  const number = collectorNumberSortValue(card.collectorNumber);
  // Prefer the printed main-set size when available. Official JP browse often
  // sets setTotal to the full catalog hit count (e.g. 120) while setPrintedTotal
  // is the main set (83) — secret/SAR slots are numbers above the printed total.
  const printedTotal = card.setPrintedTotal ?? card.setTotal ?? 0;
  const secretSlot = printedTotal > 0 && number > printedTotal;
  // Official-catalog JP cards share a placeholder rarity ("Official Japanese
  // release"), so name/identity signals are required to prefer chase prints
  // (Cinccino ex SAR, Mega Greninja ex, …) over high-number commons/trainers.
  const identity = `${card.name} ${card.englishName ?? ""} ${card.localizedName ?? ""}`;
  const nameChaseScore = /special illustration|\bsir\b|\bsar\b|hyper rare/i.test(identity)
    ? 4
    : /\bmega\b|メガ/i.test(identity)
      ? 3
      : /\bex\b|ｅｘ|VMAX|VSTAR|\bGX\b/i.test(identity)
        ? 2
        : /illustration|art rare|アートレア/i.test(identity)
          ? 1
          : 0;

  return Math.max(rarityScore, nameChaseScore) * 1_000 + (secretSlot ? 800 : 0) + number;
}

function shouldEnrichSetSortGuidePrice(card: TcgCard) {
  const baseline = rarityBaselinePrice(card);
  const priceNeedsGuide =
    card.marketPriceUsd <= 0 || card.marketPriceUsd <= baseline * 1.35;

  if (
    card.sources?.some((source) => source.source === "Localized search group estimate") ||
    card.priceConsensus?.sources?.some(
      (source) => source.source === "Localized search group estimate",
    )
  ) {
    return true;
  }

  if (!priceNeedsGuide) {
    return false;
  }

  if (SET_SORT_GUIDE_RARITY_PATTERN.test(card.rarity)) {
    return true;
  }

  const number = collectorNumberSortValue(card.collectorNumber);
  const printedTotal = card.setPrintedTotal ?? card.setTotal ?? 0;

  if (printedTotal > 0 && number > printedTotal) {
    return true;
  }

  if (number >= 100) {
    return true;
  }

  const identity = `${card.name} ${card.englishName ?? ""} ${card.localizedName ?? ""}`;

  return /ex|vstar|vmax|gx|\bsar\b|\bsir\b|\bar\b/i.test(identity);
}

function shouldSkipSetSortGuideEnrichment(results: SearchResult[]) {
  if (!results.length) {
    return true;
  }

  const topTier = results.filter((result) => {
    const score = setSortGuidePriorityScore(result.card);
    return score >= 3_000 || (score >= 2_000 && shouldEnrichSetSortGuidePrice(result.card));
  });

  if (!topTier.length) {
    const pricedCount = results.filter((result) => result.card.marketPriceUsd > 0).length;
    return pricedCount >= Math.min(results.length, 20);
  }

  const pricedTopTier = topTier.filter(
    (result) =>
      result.card.marketPriceUsd > 0 && !isSuspiciouslyLowCatalogPrice(result.card),
  );

  return pricedTopTier.length >= Math.ceil(topTier.length * 0.55);
}

async function enrichSetSortGuidePrices(
  results: SearchResult[],
  options: SetSortGuideEnrichmentOptions = {},
) {
  const maxCards = options.maxCards ?? SET_SORT_GUIDE_MAX_CARDS;
  const budgetMs = options.budgetMs ?? SET_SORT_GUIDE_BUDGET_MS;
  const cardTimeoutMs = options.cardTimeoutMs ?? SET_SORT_GUIDE_CARD_TIMEOUT_MS;
  const skipWhenSufficient = options.skipWhenSufficient ?? true;

  if (skipWhenSufficient && shouldSkipSetSortGuideEnrichment(results)) {
    return results;
  }

  const candidates = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => shouldEnrichSetSortGuidePrice(result.card))
    .sort(
      (left, right) =>
        setSortGuidePriorityScore(right.result.card) -
        setSortGuidePriorityScore(left.result.card),
    )
    .slice(0, maxCards);

  if (!candidates.length) {
    return results;
  }

  const next = results.slice();
  const startedAt = Date.now();

  await mapWithConcurrency(candidates, SET_SORT_GUIDE_CONCURRENCY, async ({ result, index }) => {
    if (Date.now() - startedAt > budgetMs) {
      return;
    }

    const card = result.card;
    const isJapanese = card.language === "ja";
    const lookupSetName = card.setEnglishName?.trim() || card.setName;
    const lookupCardName =
      card.englishName?.trim() ||
      (card.language === "en" ? card.name : card.englishName?.trim() || card.name);

    try {
      const guide = await Promise.race([
        fetchQuickLocalizedGuidePrice(
          lookupSetName,
          lookupCardName,
          card.collectorNumber,
          card.setPrintedTotal ?? card.setTotal,
          {
            setCode: card.setCode,
            isJapanese,
            language: card.language,
            englishCardName: card.englishName?.trim() || undefined,
            // Same routing as /api/price: cache + free APIs only. Never scrape
            // PriceCharting from set browse (that was the 429 burst).
            allowScrape: false,
          },
        ),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), cardTimeoutMs);
        }),
      ]);

      if (guide?.ungradedUsd && guide.ungradedUsd > 0 && shouldAcceptGuidePrice(card, guide.ungradedUsd)) {
        next[index] = {
          ...result,
          card: applyGuidePriceToSearchCard(card, guide.ungradedUsd),
        };
      }
    } catch {
      // Keep the catalog estimate for this card.
    }
  });

  return next;
}
async function fetchEnglishSetCardsForPriceSort(filters: string[]) {
  // Pokemon TCG API set pagination is unreliable with number/releaseDate ordering
  // (page 2 can repeat low numbers and omit secret slots). Name ordering returns
  // the full unique set across pages.
  const setBrowseOrderBy = "name";
  // The public API may silently cap pageSize (often at 50), so do not assume
  // two 250-card pages cover a set. Walk every bounded page until the set is
  // materialized, otherwise number-desc can incorrectly start at #50.
  const pageSize = Math.min(ENGLISH_SET_PRICE_SORT_PAGE_SIZE, 250);
  const firstPayload = await fetchCardSearchPage(filters, 1, pageSize, setBrowseOrderBy);
  const totalToFetch = Math.min(firstPayload.totalCount, ENGLISH_SET_PRICE_SORT_MAX_CARDS);
  const pageCount = Math.ceil(totalToFetch / Math.max(1, firstPayload.data.length));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      fetchCardSearchPage(filters, index + 2, pageSize, setBrowseOrderBy).catch(() => null),
    ),
  );
  const seenIds = new Set<string>();
  const data = [firstPayload.data, ...rest.map((payload) => payload?.data ?? [])].flat()
    .filter((card) => {
      if (!card.id || seenIds.has(card.id)) {
        return false;
      }

      seenIds.add(card.id);
      return true;
    })
    .slice(0, totalToFetch);

  return {
    ...firstPayload,
    data,
    page: 1,
    pageSize: data.length,
  };
}

function filterTcgdexSetBriefsForSearch(
  briefs: TcgdexCardBrief[],
  cleanQuery: string,
  collectorCode: CollectorCodeQuery | null,
  setName?: string,
) {
  if (!cleanQuery) {
    return briefs;
  }

  if (collectorCode) {
    const targetNumber = collectorCode.number.toUpperCase();
    const targetRaw = (collectorCode.rawNumber ?? collectorCode.number).toUpperCase();

    return briefs.filter((card) => {
      const localId = card.localId.replace(/^0+(?=\d)/, "").toUpperCase();
      const rawId = card.localId.toUpperCase();

      return (
        localId === targetNumber ||
        rawId === targetRaw ||
        rawId === targetNumber.padStart(3, "0")
      );
    });
  }

  return briefs.filter((card) => {
    const searchableText = [card.name, card.localId, setName].filter(Boolean).join(" ");
    return textMatchesQuery(searchableText, cleanQuery);
  });
}

async function searchEnglishSetPriceSortViaTcgdex(
  setFilter: string,
  cleanQuery: string,
  collectorCode: CollectorCodeQuery | null,
  sort: SearchSortOption,
  normalizedPage: number,
): Promise<LiveSearchResponse | null> {
  const catalogSet = await fetchTcgdexLocalizedSet("en", setFilter);
  const set = catalogSet?.set;

  if (!set?.cards?.length) {
    return null;
  }

  const filteredBriefs = filterTcgdexSetBriefsForSearch(
    set.cards,
    cleanQuery,
    collectorCode,
    set.name,
  );

  if (!filteredBriefs.length) {
    return makeSearchResponse({
      results: [],
      totalCount: 0,
      page: normalizedPage,
      pageSize: SEARCH_PAGE_SIZE,
      hasNextPage: false,
      notice: collectorCode
        ? `No exact English card found for ${collectorCode.number}/${collectorCode.printedTotal ?? "?"} in this set.`
        : undefined,
    });
  }

  const briefs = filteredBriefs.slice(0, ENGLISH_SET_PRICE_SORT_MAX_CARDS);
  const detailed = await fetchTcgdexDetailCardsFromBriefs(briefs, "en");

  if (!detailed.length) {
    return null;
  }

  const cards = await normalizeTcgdexCardsForSearch(detailed, "en");
  const matchReason = cleanQuery ? "Live catalog match" : "Latest cards";
  const sortedResults = applySearchResultSort(
    await enrichResultsForSetPriceSort(
      cards.map((card) => ({
        card,
        score: 100,
        matchReason,
      })),
      "en",
    ),
    sort,
  );
  const totalCount = Math.min(filteredBriefs.length, ENGLISH_SET_PRICE_SORT_MAX_CARDS);
  const cacheKey = makeSetPriceSortCacheKey([
    "english-set-price-sort",
    setFilter,
    cleanQuery,
    sort,
  ]);

  setCachedSetPriceSort(cacheKey, {
    sortedResults,
    totalCount,
    pageSize: SEARCH_PAGE_SIZE,
  });

  return {
    results: sortedResults.slice(
      (normalizedPage - 1) * SEARCH_PAGE_SIZE,
      normalizedPage * SEARCH_PAGE_SIZE,
    ),
    totalCount,
    page: normalizedPage,
    pageSize: SEARCH_PAGE_SIZE,
    hasNextPage: normalizedPage * SEARCH_PAGE_SIZE < totalCount,
  };
}

async function searchEnglishSetViaTcgdexBriefs(
  setFilter: string,
  cleanQuery: string,
  collectorCode: CollectorCodeQuery | null,
  sort: SearchSortOption,
  normalizedPage: number,
): Promise<LiveSearchResponse | null> {
  const catalogSet = await fetchTcgdexLocalizedSet("en", setFilter, { timeoutMs: 1_600 });
  const set = catalogSet?.set;

  if (!catalogSet || !set?.cards?.length) {
    return null;
  }

  const filteredBriefs = filterTcgdexSetBriefsForSearch(
    set.cards,
    cleanQuery,
    collectorCode,
    set.name,
  );

  if (!filteredBriefs.length) {
    return null;
  }

  const cards = normalizeTcgdexSetBriefCards({
    briefs: filteredBriefs,
    set,
    englishSet: catalogSet.englishSet,
    language: "en",
  });
  const prepared = prepareSetBrowsePriceSortResults(
    cards.map((card) => ({
      card,
      score: 100,
      matchReason: cleanQuery ? "Live catalog match" : "Latest cards",
    })),
  );
  const sortedResults = applySearchResultSort(
    isPriceAwareSort(sort)
      ? await enrichResultsForSetPriceSort(prepared, "en")
      : prepared,
    sort,
  );
  const totalCount = sortedResults.length;
  const cacheKey = makeSetPriceSortCacheKey([
    isPriceAwareSort(sort) ? "english-set-price-sort" : "english-set-tcgdex-briefs",
    setFilter,
    cleanQuery,
    sort,
  ]);

  setCachedSetPriceSort(cacheKey, {
    sortedResults,
    totalCount,
    pageSize: SEARCH_PAGE_SIZE,
  });

  return {
    results: sortedResults.slice(
      (normalizedPage - 1) * SEARCH_PAGE_SIZE,
      normalizedPage * SEARCH_PAGE_SIZE,
    ),
    totalCount,
    page: normalizedPage,
    pageSize: SEARCH_PAGE_SIZE,
    hasNextPage: normalizedPage * SEARCH_PAGE_SIZE < totalCount,
    notice:
      "Loaded this English set from the public TCGdex catalog. Live market prices fill in as sources respond.",
  };
}

function applyLocalizedSearchPriceEstimate(results: SearchResult[]): SearchResult[] {
  return results;
}

function rarityBaselinePrice(card: TcgCard) {
  const rarityText = `${card.rarity} ${card.name}`;
  const matched = EARLY_MARKET_RARITY_BASELINES_USD.find(([pattern]) =>
    pattern.test(rarityText),
  )?.[1];

  if (matched !== undefined) {
    return matched;
  }

  // Localized catalog briefs often carry no rarity, so nothing matched above.
  // A card printed beyond the set's numbered slots is a secret/SAR-tier chase
  // card (e.g. trainer SARs like Giovanni's Charisma whose name carries no
  // rarity keyword); flooring it at the generic common baseline made those show
  // an absurd ~$0.25 estimate when the guide price couldn't be matched. Use a
  // special-rare baseline instead so the estimate is in the right ballpark.
  const printedTotal = card.setPrintedTotal ?? card.setTotal ?? 0;
  const number = collectorNumberSortValue(card.collectorNumber);

  if (printedTotal > 0 && number > printedTotal) {
    return 18;
  }

  return 0.18;
}

function isPremiumGuidePriceCard(card: TcgCard) {
  const identity = `${card.name} ${card.englishName ?? ""} ${card.localizedName ?? ""}`;

  return (
    SET_SORT_GUIDE_RARITY_PATTERN.test(card.rarity) ||
    /ex|vstar|vmax|gx|\bsar\b|\bsir\b|\bar\b/i.test(identity)
  );
}

function isSuspiciouslyHighGuidePrice(card: TcgCard, guidePriceUsd: number) {
  if (!(guidePriceUsd > 0)) {
    return false;
  }

  if (
    card.language !== "en" &&
    (card.language === "ja" ||
      card.language === "zh-cn" ||
      card.language === "zh-tw" ||
      Boolean(getLocalizedSetMarketProfile(card.setCode)))
  ) {
    return guidePriceUsd > 20_000;
  }

  const baseline = rarityBaselinePrice(card);
  const printedTotal = card.setPrintedTotal ?? card.setTotal ?? 0;
  const number = collectorNumberSortValue(card.collectorNumber);
  const isSecretSlot = printedTotal > 0 && number > printedTotal;

  if (isPremiumGuidePriceCard(card) || isSecretSlot) {
    return guidePriceUsd > Math.max(baseline * 80, 20_000);
  }

  return guidePriceUsd > Math.max(baseline * 15, 150);
}

function shouldAcceptGuidePrice(card: TcgCard, guidePriceUsd: number) {
  if (!(guidePriceUsd > 0)) {
    return false;
  }

  if (isSuspiciouslyHighGuidePrice(card, guidePriceUsd)) {
    return false;
  }

  // Do NOT reuse isSuspiciouslyLowCatalogPrice here. That helper flags TCGdex
  // chase-card catalog lows (<$25) so enrichment can upgrade them — applying it
  // to PriceCharting guides rejected every common JP ex under $25 (e.g. M4
  // Beedrill ex at $1.73) and left official-catalog set browse at $0.
  return true;
}

function deterministicUnitInterval(input: string) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function collectorNumberMultiplier(card: TcgCard) {
  const numberMatch = card.collectorNumber.match(/\d+/);
  const numericNumber = numberMatch ? Number.parseInt(numberMatch[0], 10) : null;
  const printedTotal =
    typeof card.setPrintedTotal === "number" && card.setPrintedTotal > 0
      ? card.setPrintedTotal
      : typeof card.setTotal === "number" && card.setTotal > 0
        ? card.setTotal
        : null;

  if (!numericNumber || !printedTotal) {
    return 1;
  }

  if (numericNumber > printedTotal) {
    return 1.28;
  }

  const position = Math.max(0, Math.min(1, numericNumber / printedTotal));
  return 0.92 + position * 0.18;
}

function characterDemandMultiplier(card: TcgCard) {
  const text = normalizeSearchText(`${card.name} ${card.englishName ?? ""} ${card.localizedName ?? ""}`);
  const demandSignals: Array<[RegExp, number]> = [
    [/charizard/, 1.35],
    [/umbreon/, 1.28],
    [/pikachu/, 1.22],
    [/rayquaza/, 1.2],
    [/mewtwo/, 1.16],
    [/lugia/, 1.15],
    [/gengar/, 1.14],
    [/\bmew\b/, 1.12],
    [/eevee|sylveon|leafeon|glaceon|espeon|vaporeon|jolteon|flareon/, 1.1],
    [/trainer|supporter/, 1.04],
  ];

  return demandSignals.find(([pattern]) => pattern.test(text))?.[1] ?? 1;
}

function cardAdjustedEstimate(
  card: TcgCard,
  basePrice: number,
  variation: "narrow" | "wide",
) {
  if (!(basePrice > 0)) {
    return 0;
  }

  const unit = deterministicUnitInterval(
    [
      card.id,
      card.name,
      card.localizedName ?? "",
      card.setCode,
      card.collectorNumber,
      card.rarity,
    ].join("|"),
  );
  const spread = variation === "wide" ? 0.16 : 0.06;
  const randomMultiplier = 1 - spread + unit * spread * 2;
  const adjusted =
    basePrice *
    randomMultiplier *
    collectorNumberMultiplier(card) *
    characterDemandMultiplier(card);

  return Math.max(0.05, Math.round(adjusted * 100) / 100);
}

/**
 * Generic placeholder "rarities" attached to localized/official-catalog cards
 * that carry no true rarity. They must never be used to group cards for peer
 * pricing — every card in a localized set shares the same placeholder, which
 * would lump unrelated cards (cheap trainers and $300 SARs) into one bucket.
 */
const PLACEHOLDER_RARITY_PATTERN =
  /^(localized release|official\s+\w+\s+release|unknown.*|type pending|[-—–])$/i;

function hasMeaningfulRarity(rarity?: string | null): boolean {
  const normalized = (rarity ?? "").trim();
  return normalized.length > 0 && !PLACEHOLDER_RARITY_PATTERN.test(normalized);
}

function applyEarlyMarketSearchEstimates(results: SearchResult[]): SearchResult[] {
  const setPrices = new Map<string, number[]>();
  const setRarityPrices = new Map<string, number[]>();

  for (const result of results) {
    if (!(result.card.marketPriceUsd > 0)) {
      continue;
    }

    const setKey = result.card.setCode?.toLowerCase();

    if (!setKey) {
      continue;
    }
    setPrices.set(setKey, [...(setPrices.get(setKey) ?? []), result.card.marketPriceUsd]);

    // Only bucket by rarity when the card carries a real rarity. Localized brief
    // cards all share a generic placeholder ("Localized release") instead of a
    // true rarity, so bucketing by it lumped every card together and made
    // unpriced cards (e.g. trainer SARs whose JP names don't resolve to an
    // English price) inherit the median of the priced chase cards — a ~$40
    // trainer showing ~$144 next to the $200+ Pokémon SARs.
    if (!hasMeaningfulRarity(result.card.rarity)) {
      continue;
    }

    const rarityKey = `${setKey}|${normalizeSearchText(result.card.rarity)}`;
    setRarityPrices.set(rarityKey, [
      ...(setRarityPrices.get(rarityKey) ?? []),
      result.card.marketPriceUsd,
    ]);
  }

  return results.map((result) => {
    if (result.card.marketPriceUsd > 0) {
      return result;
    }

    if (result.card.language !== "en") {
      return result;
    }

    const setKey = result.card.setCode?.toLowerCase();

    if (!setKey) {
      return result;
    }

    const rarityKey = `${setKey}|${normalizeSearchText(result.card.rarity)}`;
    const rarityPeers = setRarityPrices.get(rarityKey) ?? [];
    const setPeers = setPrices.get(setKey) ?? [];
    const rarityBaseline = rarityBaselinePrice(result.card);
    const estimateBase =
      rarityPeers.length >= 2
        ? robustPrice(rarityPeers)
        : rarityBaseline > 0
          ? rarityBaseline
          : setPeers.length >= 4
            ? Math.max(0.1, robustPrice(setPeers) * 0.55)
            : 0.18;
    const estimatedPrice = cardAdjustedEstimate(
      result.card,
      estimateBase,
      rarityPeers.length >= 2 || setPeers.length >= 4 ? "narrow" : "wide",
    );

    if (!(estimatedPrice > 0)) {
      return result;
    }

    return { ...result, card: applyEarlyMarketEstimateToCard(result.card, estimatedPrice) };
  });
}

function buildSearchQueryClause(cleanQuery: string) {
  const terms = cleanQuery
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (!terms.length) {
    return "";
  }

  if (terms.length === 1) {
    const escapedQuery = terms[0].replace(/"/g, '\\"');
    const queryClauses = [
      `name:"*${escapedQuery}*"`,
      `number:"${escapedQuery}"`,
      `set.name:"*${escapedQuery}*"`,
      `artist:"*${escapedQuery}*"`,
    ];
    const collectorBase = terms[0].split("/")[0]?.trim();

    if (collectorBase && collectorBase !== terms[0]) {
      const escapedCollectorBase = collectorBase.replace(/"/g, '\\"');
      queryClauses.push(`number:"${escapedCollectorBase}"`);
    }

    return `(${queryClauses.join(" OR ")})`;
  }

  const termClauses = terms.map((term) => {
    const escaped = term.replace(/"/g, '\\"');
    return `(name:"*${escaped}*" OR set.name:"*${escaped}*" OR number:"${escaped}")`;
  });

  return `(${termClauses.join(" AND ")})`;
}

function buildCollectorNumberLuceneClause(collectorCode: CollectorCodeQuery) {
  const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
  const escapedNum = collectorCode.number.replace(/"/g, '\\"');
  const padded3 = collectorCode.number.padStart(3, "0");
  const padded4 = collectorCode.number.padStart(4, "0");
  const rawEscaped = rawNumber.replace(/"/g, '\\"');

  return `(number:"${escapedNum}" OR number:"${padded3}" OR number:"${padded4}" OR number:"${rawEscaped}")`;
}

function buildFullCollectorCodeLuceneClause(
  collectorCode: CollectorCodeQuery & { printedTotal: number },
) {
  const numberClause = buildCollectorNumberLuceneClause(collectorCode);

  if (!collectorCodeConstrainsPrintedTotal(collectorCode)) {
    return numberClause;
  }

  const total = collectorCode.printedTotal;
  return `${numberClause} AND (set.printedTotal:${total} OR set.total:${total})`;
}

function collectorSetLuceneClause(setCode?: string) {
  if (!setCode?.trim()) {
    return null;
  }

  const keys = collectorSetCodeSearchKeys(setCode);
  const clauses = keys.map((key) => `set.id:${key.toLowerCase()}`);
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
}

async function buildIndexCollectorSearchResults(
  collectorCode: CollectorCodeQuery,
  language: CardLanguageFilter,
  nameQuery = "",
  localizedNameAliases: string[] = [],
): Promise<SearchResult[]> {
  const printedTotal = collectorCodeConstrainsPrintedTotal(collectorCode)
    ? collectorCode.printedTotal
    : undefined;
  const indexCards = (await lookupCardsInIndexByCollector(
    language,
    collectorCode.rawNumber ?? collectorCode.number,
    printedTotal,
    24,
  )).filter((card) => collectorCardMatchesNameHint(card, nameQuery, localizedNameAliases));

  return indexCards.map((card) => ({
    card,
    score: collectorCodeSearchScore(card, card.language),
    matchReason: isFullCollectorCode(collectorCode)
      ? `Indexed collector code ${collectorCodeLabel(collectorCode)}`
      : `Indexed collector number #${collectorCode.rawNumber ?? collectorCode.number}`,
  }));
}

function instantOfficialJapaneseCollectorSearchResults(
  collectorCode: CollectorCodeQuery,
  nameQuery = "",
  localizedNameAliases: string[] = [],
): SearchResult[] {
  const card = buildOfficialJapaneseFallbackSearchCard(collectorCode);

  if (!card || !collectorCardMatchesNameHint(card, nameQuery, localizedNameAliases)) {
    return [];
  }

  const exactCode = isFullCollectorCode(collectorCode)
    ? collectorCodeLabel(collectorCode)
    : collectorCodeDisplayLabel(collectorCode);

  return [
    {
      card,
      score: 180,
      matchReason: `Official Japanese exact collector code ${exactCode}`,
    },
  ];
}

async function collectorIdentitySeedResults(
  collectorCode: CollectorCodeQuery,
  language: CardLanguageFilter,
  nameQuery = "",
  localizedNameAliases: string[] = [],
): Promise<SearchResult[]> {
  const instant = instantOfficialJapaneseCollectorSearchResults(
    collectorCode,
    nameQuery,
    localizedNameAliases,
  );
  const chinese = simplifiedChineseCatalogSearchResults({
    collectorCode,
    query: nameQuery,
    language,
  });

  return prependSearchResults(instant, chinese);
}

function pageCollectorIdentityResponse(
  results: SearchResult[],
  page: number,
  pageSize: number,
  sort: SearchSortOption,
  notice?: string,
): LiveSearchResponse {
  const start = Math.max(0, (page - 1) * pageSize);
  const sorted =
    sort === "relevance"
      ? sortCollectorCodeSearchResults(results)
      : applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort);

  return makeSearchResponse({
    results: sorted.slice(start, start + pageSize),
    totalCount: sorted.length,
    page,
    pageSize,
    hasNextPage: start + pageSize < sorted.length,
    notice,
  });
}

async function buildIndexNameSetSearchResults(
  nameQuery: string,
  setFilter: string,
  language: CardLanguageFilter = "en",
): Promise<SearchResult[]> {
  const indexCards = await lookupCardsInIndexByNameAndSet(nameQuery, setFilter, language, 24);

  return indexCards.map((card) => ({
    card,
    score: 108,
    matchReason: `Indexed ${nameQuery.trim()} in ${setFilter.toUpperCase()}`,
  }));
}

function prioritizeTrainerGalleryCollectorResults(results: SearchResult[]) {
  return results.slice().sort((left, right) => {
    const leftTrainerGallery = /trainer gallery/i.test(
      `${left.card.setName} ${left.card.setEnglishName ?? ""}`,
    );
    const rightTrainerGallery = /trainer gallery/i.test(
      `${right.card.setName} ${right.card.setEnglishName ?? ""}`,
    );

    if (leftTrainerGallery !== rightTrainerGallery) {
      return Number(rightTrainerGallery) - Number(leftTrainerGallery);
    }

    return right.score - left.score;
  });
}

function normalizeCard(card: PokemonTcgCardApiResponse["data"][number]): TcgCard {
  const marketPriceUsd = getUsdMarketPrice(card);
  const fetchedAt =
    card.tcgplayer?.updatedAt ?? card.cardmarket?.updatedAt ?? new Date().toISOString();

  return attachFinishMarketsToCard({
    id: card.id,
    slug: card.id,
    language: "en",
    languageLabel: LANGUAGE_LABELS.en,
    name: card.name,
    localizedName: card.name,
    englishName: card.name,
    collectorNumber: card.number,
    rarity: card.rarity ?? "Unknown",
    supertype: card.supertype ?? "Pokemon",
    hp: card.hp ?? "-",
    types: card.types ?? [],
    setId: card.set.id,
    setCode: normalizeSetCode(card.set.id),
    setName: card.set.name,
    setLocalizedName: card.set.name,
    setEnglishName: card.set.name,
    setPrintedTotal: card.set.printedTotal,
    setTotal: card.set.total,
    image: card.images?.large ?? card.images?.small ?? "/icon.svg",
    artist: card.artist ?? "Unknown",
    marketPriceUsd,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "PSA population report",
      fetchedAt: null,
      note: "PSA pop counts are not wired yet. The model reserves official PSA-by-grade data instead of a generic population placeholder.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: buildPriceHistory(card),
    gradedPrices: [
      {
        grade: "Ungraded",
        value: marketPriceUsd,
        populationCount: 0,
      },
    ],
    recentSales: [],
    priceConsensus: {
      finalEstimateUsd: marketPriceUsd,
      confidence: "medium",
      confidenceScore: 0.64,
      sourceCount: marketPriceUsd > 0 ? 1 : 0,
      sampleCount: 0,
      methodology:
        "Catalog-only estimate. Live sold comps and grading-market sources can overwrite this with a broader consensus.",
      sources:
        marketPriceUsd > 0
          ? [
              {
                source: "PokemonTCG public catalog",
                value: marketPriceUsd,
                confidence: "medium",
                confidenceScore: 0.64,
                evidenceType: "catalog",
                note:
                  "Catalog market estimate blended from live marketplace fields exposed through PokemonTCG.",
              },
            ]
          : [],
    },
    sources: [
      {
        source: "PokemonTCG public catalog",
        status: "verified",
        fetchedAt,
        confidence: 0.82,
        note: "Live no-key catalog and marketplace snapshot. Sold comps and official PSA pop counts are not wired yet.",
      },
    ],
  }, { priceMap: card.tcgplayer?.prices });
}

function prependSearchResults(preferred: SearchResult[], rest: SearchResult[]) {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  for (const result of [...preferred, ...rest]) {
    const key = result.card.slug.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(result);
  }

  return merged;
}

function isExcludedPokemonTcgPocketSetFilter(setFilter?: string | null) {
  const value = setFilter?.trim();
  if (!value) {
    return false;
  }

  return isPokemonTcgPocketSet({ id: value, code: value, name: value });
}

function makeSearchResponse({
  results,
  totalCount = null,
  page,
  pageSize,
  hasNextPage,
  notice,
}: {
  results: SearchResult[];
  totalCount?: number | null;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  notice?: string;
}): LiveSearchResponse {
  const physical = results
    .filter((result) => !isPokemonTcgPocketPrint(result.card))
    .map((result) => ({
      ...result,
      card: withDerivedEnglishPrintImage(result.card),
    }));
  const expanded = expandSearchResultEditions(sanitizeSearchResultPrices(physical));
  return {
    results: expanded,
    totalCount:
      totalCount == null ? null : Math.max(totalCount, expanded.length),
    page,
    pageSize,
    hasNextPage,
    notice,
  };
}

function staticTrendingFallback(sort: SearchSortOption = DEFAULT_SEARCH_SORT): LiveSearchResponse {
  const response = getStaticTrendingSearchResponse();

  if (sort === "relevance" || response.results.length <= 1) {
    return response;
  }

  return {
    ...response,
    results: applySearchResultSort(response.results, sort),
  };
}

function compareTcgdexBriefNumber(left: TcgdexCardBrief, right: TcgdexCardBrief) {
  return (
    collectorNumberSortValue(left.localId) -
      collectorNumberSortValue(right.localId) ||
    left.localId.localeCompare(right.localId) ||
    left.name.localeCompare(right.name)
  );
}

function sortTcgdexBriefs(
  cards: TcgdexCardBrief[],
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
) {
  if (sort !== "number-asc" && sort !== "number-desc") {
    return cards;
  }

  return cards
    .slice()
    .sort((left, right) =>
      sort === "number-desc"
        ? compareTcgdexBriefNumber(right, left)
        : compareTcgdexBriefNumber(left, right),
    );
}

function englishOrderByForSort(sort: SearchSortOption) {
  switch (sort) {
    case "price-desc":
      return "-cardmarket.prices.trendPrice";
    case "price-asc":
      return "cardmarket.prices.trendPrice";
    case "number-desc":
      return "-number";
    case "number-asc":
      return "number";
    default:
      return "-set.releaseDate,number";
  }
}

function englishTrendingOrderByForSort(sort: SearchSortOption) {
  switch (sort) {
    case "price-asc":
      return "cardmarket.prices.trendPrice";
    case "price-desc":
      return "-cardmarket.prices.trendPrice";
    case "number-desc":
      return "-number";
    case "number-asc":
      return "number";
    default:
      return "-cardmarket.prices.trendPrice";
  }
}

async function fetchEnglishTrendingCatalog(sort: SearchSortOption) {
  const orderBy = englishTrendingOrderByForSort(sort);
  const attempts: Array<{ query: string; orderBy: string }> = [
    { query: TRENDING_CATALOG_QUERY, orderBy },
  ];

  if (orderBy !== "-cardmarket.prices.trendPrice") {
    attempts.push({
      query: TRENDING_CATALOG_QUERY,
      orderBy: "-cardmarket.prices.trendPrice",
    });
  }

  attempts.push({
    query: TRENDING_CATALOG_QUERY_FALLBACK,
    orderBy: "-cardmarket.prices.trendPrice",
  });

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      return await fetchCardSearchPage(
        [attempt.query],
        1,
        TRENDING_POOL_SIZE,
        attempt.orderBy,
      );
    } catch (error) {
      lastError = error;
      if (!(error instanceof PokemonTcgApiError)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function finalizeEnglishTrendingResults(
  results: SearchResult[],
  sort: SearchSortOption,
  page: number,
): LiveSearchResponse {
  const unique = collapseSearchResultEditions(results);
  const ranked =
    sort === "relevance"
      ? rankSearchResultsByTrending(unique)
      : applySearchResultSort(unique, sort);

  return {
    ...pageTrendingSearchResults(ranked, page, SEARCH_PAGE_SIZE),
  };
}

function normalizeTcgdexCard(
  card: TcgdexCardResponse,
  language: CardLanguageCode,
  companion: TcgdexEnglishCompanion = {},
): TcgCard {
  const localizedMarketPriceUsd = getTcgdexMarketPrice(card, { language });
  const hasLocalizedMarketPrice = localizedMarketPriceUsd > 0;
  const marketPriceUsd = hasLocalizedMarketPrice ? localizedMarketPriceUsd : 0;
  const fetchedAt = card.updated ?? new Date().toISOString();
  const localizedName = card.name;
  const englishName = companion.name;
  const localizedSetName = card.set.name;
  const englishSetName = getLocalizedSetEnglishName(card.set.id, companion.setName);
  const derivedAssetBase = tryDeriveLocalizedTcgdexAsset(card, language);
  let image = getTcgdexCardImage({ card, companion, derivedAssetBase });
  let imageStatus = getTcgdexImageStatus(
    card.image ?? derivedAssetBase,
    companion.image,
  );

  // SM-era and other JA briefs often omit artwork and the derived TCGdex asset 404s.
  // Prefer the official pokemon-card.com browse-seed thumbnail instead.
  if (
    language === "ja" &&
    (!image ||
      image === "/icon.svg" ||
      /assets\.tcgdex\.net\/ja\//i.test(image))
  ) {
    const officialImage = resolveOfficialJapaneseBrowseImageUrl({
      setCode: card.set.id,
      name: card.name,
      collectorNumber: card.localId,
      preferSecretRare: /character|secret|chr|csr|sr/i.test(card.rarity ?? ""),
    });
    if (officialImage) {
      image = officialImage;
      imageStatus = "official";
    }
  }

  return attachFinishMarketsToCard({
    id: card.id,
    slug: buildLocalizedSlug(language, card.id),
    language,
    languageLabel: LANGUAGE_LABELS[language],
    name: formatBilingualName(localizedName, englishName),
    localizedName,
    englishName,
    collectorNumber: card.localId,
    rarity: card.rarity ?? "Localized release",
    supertype: card.category ?? "Pokemon",
    hp: card.hp ? String(card.hp) : "-",
    types: card.types ?? [],
    setId: card.set.id,
    setCode: normalizeSetCode(card.set.id),
    setName: formatBilingualName(localizedSetName, englishSetName),
    setLocalizedName: localizedSetName,
    setEnglishName: englishSetName,
    image,
    artist: card.illustrator ?? "Unknown",
    stage: card.stage,
    dexIds: card.dexId ?? [],
    retreatCost: card.retreat ?? null,
    legalities: card.legal,
    setPrintedTotal: card.set.cardCount?.official,
    setTotal: card.set.cardCount?.total,
    attacks: card.attacks ?? [],
    imageStatus,
    marketPriceUsd,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Localized catalog import",
      fetchedAt: null,
      note: "Localized card records are available, but PSA and sold-comp enrichment is not yet wired for every non-English release.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [
      { date: isoDaysAgo(30), value: marketPriceUsd },
      { date: isoDaysAgo(14), value: marketPriceUsd },
      { date: isoDaysAgo(7), value: marketPriceUsd },
      { date: isoDaysAgo(1), value: marketPriceUsd },
      { date: isoDaysAgo(0), value: marketPriceUsd },
    ],
    gradedPrices: [
      {
        grade: "Ungraded",
        value: marketPriceUsd,
        populationCount: 0,
      },
    ],
    recentSales: [],
    priceConsensus: {
      finalEstimateUsd: marketPriceUsd,
      confidence: hasLocalizedMarketPrice ? "medium" : "low",
      confidenceScore: hasLocalizedMarketPrice ? 0.58 : 0,
      sourceCount: hasLocalizedMarketPrice ? 1 : 0,
      sampleCount: 0,
      methodology: hasLocalizedMarketPrice
        ? "Localized catalog-only estimate. Multilingual releases can diverge until live sold comps and grading-market sources are merged."
        : "Localized catalog identity only. Market price requires a localized guide or sold-comp source.",
      sources: hasLocalizedMarketPrice
        ? [
            {
              source: `TCGdex ${LANGUAGE_LABELS[language]} catalog`,
              value: marketPriceUsd,
              confidence: "medium",
              confidenceScore: 0.58,
              evidenceType: "catalog",
              note:
                "Localized catalog estimate derived from public marketplace fields mirrored through TCGdex.",
            },
          ]
        : [],
    },
    sources: [
      {
        source: `TCGdex ${LANGUAGE_LABELS[language]} catalog`,
        status: "verified",
        fetchedAt,
        confidence: 0.77,
        note: "Localized multilingual catalog record. Pricing, sold history, and grading data vary by language and release.",
      },
    ],
  }, {
    priceMap: card.pricing?.tcgplayer,
    variantIds: extractFinishIdsFromTcgdexVariants(card.variants),
  });
}

async function fetchJson<T>(
  url: string,
  options: { revalidate?: number; timeoutMs?: number } = {},
  attempt = 0,
): Promise<T> {
  let response: Response;
  const timeoutMs = options.timeoutMs ?? POKEMON_TCG_API_TIMEOUT_MS;

  try {
    response = await fetch(url, {
      next: { revalidate: options.revalidate ?? LIVE_CATALOG_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const aborted =
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError");

    // Timeouts are not transient — retrying a 12s hang doubles card-detail wait.
    if (attempt === 0 && !aborted) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return fetchJson(url, options, 1);
    }

    throw new PokemonTcgApiError(
      aborted
        ? `Pokemon TCG API request timed out after ${timeoutMs}ms`
        : "Pokemon TCG API request failed before a response was received",
      0,
      url,
    );
  }

  if (!response.ok) {
    if (attempt === 0 && (response.status >= 500 || response.status === 429)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return fetchJson(url, options, 1);
    }

    throw new PokemonTcgApiError(
      `Pokemon TCG API request failed: ${response.status}`,
      response.status,
      url,
    );
  }

  return (await response.json()) as T;
}

async function fetchPokeApiJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: 604800 },
  });

  if (!response.ok) {
    throw new Error(`PokeAPI request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function inferLocalizedSetIdFromEnglishCatalog(
  language: CardLanguageCode,
  englishStyleId: string,
): Promise<string | null> {
  const normalized = englishStyleId.trim().toLowerCase();
  const alias = LOCALIZED_SET_ID_ALIASES[language]?.[normalized];

  if (alias) {
    return alias;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/sets/${encodeURIComponent(normalized)}`, {
      next: { revalidate: LIVE_SET_REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: {
        releaseDate?: string;
        printedTotal?: number;
        total?: number;
      };
    };
    const englishSet = payload.data;

    if (!englishSet?.releaseDate) {
      return null;
    }

    const englishRelease = new Date(englishSet.releaseDate.replace(/\//g, "-")).getTime();
    const targetTotal = englishSet.printedTotal ?? englishSet.total ?? 0;
    const apiLanguage = resolveTcgdexApiLanguage(language);
    const localizedSets = await fetchTcgdexJson<TcgdexSetBrief[]>(
      `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets`,
      { revalidate: LIVE_SET_REVALIDATE_SECONDS },
    );
    const matches = localizedSets
      .map((set) => {
        const releaseDate = set.releaseDate ? new Date(set.releaseDate).getTime() : Number.NaN;
        const officialCount = set.cardCount?.official ?? set.cardCount?.total ?? 0;
        const releaseDeltaDays = Number.isFinite(releaseDate)
          ? Math.abs(releaseDate - englishRelease) / 86_400_000
          : Number.POSITIVE_INFINITY;
        const countDelta = Math.abs(officialCount - targetTotal);

        return {
          id: set.id,
          releaseDeltaDays,
          countDelta,
        };
      })
      .filter(
        (candidate) =>
          candidate.releaseDeltaDays <= 21 && candidate.countDelta <= Math.max(12, targetTotal * 0.2),
      )
      .sort((left, right) => {
        if (left.releaseDeltaDays !== right.releaseDeltaDays) {
          return left.releaseDeltaDays - right.releaseDeltaDays;
        }

        return left.countDelta - right.countDelta;
      });

    return matches[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveLocalizedSetIdCandidates(
  language: CardLanguageCode,
  setFilter: string,
) {
  const candidates = buildLocalizedSetIdCandidates(language, setFilter);

  if (language !== "en") {
    const inferred = await inferLocalizedSetIdFromEnglishCatalog(language, setFilter).catch(
      () => null,
    );

    if (inferred) {
      candidates.unshift(inferred);
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function fetchTcgdexLocalizedSet(
  language: CardLanguageCode,
  setFilter: string,
  options: { timeoutMs?: number } = {},
): Promise<{ set: TcgdexSetResponse; englishSet: TcgdexSetResponse | null; setId: string } | null> {
  if (isExcludedPokemonTcgPocketSetFilter(setFilter)) {
    return null;
  }

  const apiLanguages = tcgdexApiLanguageFallbacks(language);
  const candidates = await resolveLocalizedSetIdCandidates(language, setFilter);
  const budgetMs = options.timeoutMs ?? 2_000;
  const startedAt = Date.now();

  for (const apiLanguage of apiLanguages) {
    for (const candidate of candidates) {
      const remainingMs = budgetMs - (Date.now() - startedAt);

      if (remainingMs < 250) {
        break;
      }

      try {
        const englishCandidate = resolveEnglishCompanionSetId(candidate) ?? candidate;
        const [set, englishSet] = await Promise.all([
          fetchTcgdexJson<TcgdexSetResponse>(
            `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets/${encodeURIComponent(candidate)}`,
            { timeoutMs: remainingMs },
          ),
          fetchTcgdexJson<TcgdexSetResponse>(
            `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(englishCandidate)}`,
            { timeoutMs: remainingMs },
          ).catch(() => null),
        ]);

        if (set?.id) {
          // If the English companion id differs from the localized id and the
          // first attempt missed, retry with the id mapped from the resolved set.
          const resolvedEnglish =
            englishSet ??
            (resolveEnglishCompanionSetId(set.id) &&
            resolveEnglishCompanionSetId(set.id) !== englishCandidate
              ? await fetchTcgdexJson<TcgdexSetResponse>(
                  `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(
                    resolveEnglishCompanionSetId(set.id) as string,
                  )}`,
                  { timeoutMs: Math.max(250, budgetMs - (Date.now() - startedAt)) },
                ).catch(() => null)
              : null);

          return { set, englishSet: resolvedEnglish, setId: set.id };
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function tryEnrichOfficialJapaneseDetail(
  detail: PokemonCardJpDetail,
  language: CardLanguageCode,
): Promise<TcgCard> {
  const skipTcgdex = shouldSkipTcgdexOfficialJapaneseEnrichment(detail);
  const englishName =
    (await resolveOfficialJapaneseEnglishName(detail)) ??
    (await resolveJapaneseCardIdentity({
      jpName: detail.name,
      setCode: detail.setCode,
      collectorNumber: detail.collectorNumber,
      cardId: detail.cardID,
      skipTcgdex,
    }));

  if (skipTcgdex) {
    return normalizeOfficialJapaneseCard(detail, englishName);
  }

  const apiLanguage = resolveTcgdexApiLanguage(language);
  const paddedLocalId = padTcgdexLocalId(detail.collectorNumber);
  const tcgCandidates = [
    `${detail.setCode}-${paddedLocalId}`,
    `${detail.setCode}-${detail.collectorNumber}`,
    `${detail.setCode}-${detail.collectorNumber.replace(/^0+(?=\d)/, "")}`,
  ];

  for (const candidateId of [...new Set(tcgCandidates)]) {
    const tcgCard = await fetchTcgdexJson<TcgdexCardResponse>(
      `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${encodeURIComponent(candidateId)}`,
    ).catch(() => null);

    if (!tcgCard) {
      continue;
    }

    const [normalizedCard] = await normalizeTcgdexCards([tcgCard], language);
    return normalizedCard;
  }

  return normalizeOfficialJapaneseCard(detail, englishName);
}

async function fetchOfficialJapaneseSetCardsForBrowseCode({
  setCode,
  setMeta,
  page,
  pageSize,
  cleanQuery,
  collectorCode,
  localizedNameQueries,
  lightweightCards = false,
}: {
  setCode: string;
  setMeta?: {
    setName?: string;
    englishSetName?: string;
    printedTotal?: number;
    total?: number;
  };
  page: number;
  pageSize: number;
  cleanQuery?: string;
  collectorCode?: ReturnType<typeof parseCollectorCodeQuery> | null;
  localizedNameQueries?: string[];
  lightweightCards?: boolean;
}): Promise<{ cards: TcgCard[]; totalCount: number }> {
  const japaneseScrapeStartedAt = Date.now();
  const logJapaneseScrapeDuration = () => {
    console.info(`JapaneseScrape: ${((Date.now() - japaneseScrapeStartedAt) / 1000).toFixed(3)}s`);
  };
  const allBrowse = await fetchOfficialJapaneseSetBrowseAllItems(setCode).catch(() => null);
  const firstPage: PokemonCardJpSearchResponse | null = allBrowse?.items.length
    ? {
        result: 1,
        hitCnt: allBrowse.hitCnt,
        thisPage: 1,
        maxPage: 1,
        cardList: allBrowse.items,
      }
    : await fetchOfficialJapaneseSetBrowsePage(setCode, 1).catch(() => null);

  if (!firstPage?.cardList?.length) {
    logJapaneseScrapeDuration();
    return { cards: [], totalCount: 0 };
  }

  const officialPageSize = firstPage.cardList.length || 50;
  const knownTotal = setMeta?.total ?? setMeta?.printedTotal ?? firstPage.hitCnt;
  const maxPagesByKnownTotal =
    typeof knownTotal === "number" && knownTotal > 0
      ? Math.ceil(knownTotal / officialPageSize) + 1
      : Number.POSITIVE_INFINITY;
  const maxPages = Math.min(20, Math.max(1, maxPagesByKnownTotal));
  const pages: PokemonCardJpSearchResponse[] = [firstPage];
  const seenPageCardIds = new Set((firstPage.cardList ?? []).map((item) => item.cardID));

  if (!allBrowse?.items.length) {
  for (let nextPage = 2; nextPage <= maxPages; nextPage += 1) {
    const nextPayload = await fetchOfficialJapaneseSetBrowsePage(setCode, nextPage).catch(
      () => null,
    );
    const nextItems = nextPayload?.cardList ?? [];

    if (!nextPayload || !nextItems.length) {
      break;
    }

    const newItems = nextItems.filter((item) => !seenPageCardIds.has(item.cardID));

    if (!newItems.length) {
      break;
    }

    for (const item of newItems) {
      seenPageCardIds.add(item.cardID);
    }

    pages.push(nextPayload);

    if (
      (typeof knownTotal === "number" && knownTotal > 0 && seenPageCardIds.size >= knownTotal) ||
      nextItems.length < officialPageSize
    ) {
      break;
    }
  }
  }

  const allItems = pages
    .filter((payload): payload is PokemonCardJpSearchResponse => Boolean(payload))
    .flatMap((payload) => payload.cardList ?? []);
  const uniqueItems = allItems.filter(
    (item, index, items) => items.findIndex((candidate) => candidate.cardID === item.cardID) === index,
  );
  if (!uniqueItems.length) {
    logJapaneseScrapeDuration();
    return { cards: [], totalCount: 0 };
  }
  const filteredItems = uniqueItems.filter((item) => {
    if (!cleanQuery) {
      return true;
    }

    const searchableName = item.cardNameAltText || item.cardNameViewText || "";

    if (collectorCode) {
      if (isFullCollectorCode(collectorCode)) {
        const needles = collectorCodeLabelVariants(collectorCode).flatMap((label) => {
          const [numberPart = "", totalPart = ""] = label.split("/");
          return [label, numberPart, numberPart.padStart(3, "0"), `${numberPart}/${totalPart}`];
        });

        return needles.some((needle) => needle && searchableName.includes(needle));
      }

      const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
      const partialNeedles = [
        rawNumber,
        collectorCode.number,
        rawNumber.padStart(3, "0"),
        `#${rawNumber}`,
      ];

      return partialNeedles.some((needle) => needle && searchableName.includes(needle));
    }

    return (
      textMatchesQuery(searchableName, cleanQuery) ||
      (localizedNameQueries ?? []).some((alias) => textMatchesQuery(searchableName, alias))
    );
  });
  const startIndex = (page - 1) * pageSize;
  const pageItems = filteredItems.slice(startIndex, startIndex + pageSize);
  const indexByCardId = new Map(
    uniqueItems.map((item, index) => [item.cardID, index] as const),
  );
  const printedTotal = setMeta?.printedTotal ?? firstPage.hitCnt ?? uniqueItems.length;

  // The browse API already returns card id, name, and image. Build cards from
  // that payload directly so set browse stays fast and reliable even when
  // pokemon-card.com throttles per-card detail pages.
  const decorateCard = (card: TcgCard): TcgCard => ({
    ...card,
    setName: formatBilingualName(
      setMeta?.setName ?? card.setLocalizedName ?? card.setName,
      setMeta?.englishSetName ?? card.setEnglishName,
    ),
    setLocalizedName: setMeta?.setName ?? card.setLocalizedName ?? card.setName,
    setEnglishName: setMeta?.englishSetName ?? card.setEnglishName,
    setPrintedTotal: setMeta?.printedTotal ?? card.setPrintedTotal,
    setTotal: setMeta?.total ?? card.setTotal,
  });

  // Enrich per card, but never let one failure empty the whole page: the browse
  // payload already carries id/name/image, so a rejected enrichment falls back to
  // a card built directly from it. allSettled (not all) keeps siblings alive.
  // Price-sort bulk loads skip per-card detail enrichment — the browse payload is
  // enough for identity and a dedicated price pass runs next.
  const cards = lightweightCards
    ? (
        await Promise.all(
          pageItems.map(async (item) => {
            const browseDetail = buildOfficialJapaneseDetailFromBrowseItem(
              item,
              indexByCardId.get(item.cardID) ?? 0,
              setCode,
              printedTotal,
            );
            const englishName = await resolveOfficialJapaneseEnglishName(browseDetail);

            return decorateCard(normalizeOfficialJapaneseCard(browseDetail, englishName));
          }),
        )
      ).filter((card) => Boolean(card.name?.trim()))
    : (
        await mapWithConcurrency(
          pageItems,
          OFFICIAL_JP_DETAIL_CONCURRENCY,
          async (item) => {
            const browseDetail = buildOfficialJapaneseDetailFromBrowseItem(
              item,
              indexByCardId.get(item.cardID) ?? 0,
              setCode,
              printedTotal,
            );
            // Never let one slow/failed card stall or empty the page: the browse
            // payload already carries id/name/image, so a timed-out or rejected
            // enrichment falls back to a card built directly from it.
            const fallback = () => decorateCard(normalizeOfficialJapaneseCard(browseDetail));

            try {
              const enriched = await Promise.race([
                fetchOfficialJapaneseCardDetail(item.cardID, item)
                  .catch(() => null)
                  .then((detail) => tryEnrichOfficialJapaneseDetail(detail ?? browseDetail, "ja"))
                  .then(decorateCard),
                new Promise<null>((resolve) => {
                  setTimeout(() => resolve(null), OFFICIAL_JP_DETAIL_CARD_TIMEOUT_MS);
                }),
              ]);

              return enriched ?? fallback();
            } catch {
              return fallback();
            }
          },
        )
      ).filter((card) => Boolean(card.name?.trim()));

  logJapaneseScrapeDuration();

  return {
    cards,
    totalCount: firstPage.hitCnt ?? filteredItems.length,
  };
}

async function fetchOfficialJapaneseSetCards({
  setCode,
  setCodes,
  setMeta,
  page,
  pageSize,
  cleanQuery,
  collectorCode,
  localizedNameQueries,
  lightweightCards = false,
}: {
  setCode?: string;
  setCodes?: string[];
  setMeta?: {
    setName?: string;
    englishSetName?: string;
    printedTotal?: number;
    total?: number;
  };
  page: number;
  pageSize: number;
  cleanQuery?: string;
  collectorCode?: ReturnType<typeof parseCollectorCodeQuery> | null;
  localizedNameQueries?: string[];
  lightweightCards?: boolean;
}): Promise<{ cards: TcgCard[]; totalCount: number }> {
  const browseCodes = resolveOfficialJapaneseBrowseCodes(...(setCodes ?? []), setCode);

  for (const browseCode of browseCodes) {
    const result = await fetchOfficialJapaneseSetCardsForBrowseCode({
      setCode: browseCode,
      setMeta,
      page,
      pageSize,
      cleanQuery,
      collectorCode,
      localizedNameQueries,
      lightweightCards,
    }).catch(() => null);

    if (result?.cards.length) {
      return result;
    }
  }

  return { cards: [], totalCount: 0 };
}

async function fetchOfficialJapaneseSearchCards({
  aliases,
  page,
  pageSize,
  deadlineMs = SEARCH_OFFICIAL_JP_NAME_BUDGET_MS,
}: {
  aliases: string[];
  page: number;
  pageSize: number;
  deadlineMs?: number;
}): Promise<{ cards: TcgCard[]; totalCount: number | null }> {
  const keyword = pickJapaneseCatalogSearchKeyword(aliases);

  const seedFallback = searchOfficialJapaneseBrowseSeed({ aliases, page, pageSize });
  const toLightweightCard = (
    item: OfficialJapaneseBrowseSeedMatch["item"],
    setIndex: number,
    setCode: string,
    hitCnt: number,
  ) => {
    const browseDetail = buildOfficialJapaneseDetailFromBrowseItem(
      item,
      setIndex,
      setCode,
      hitCnt,
    );
    return applyOfficialJapaneseBrowseArtworkToCard(
      normalizeOfficialJapaneseCard(browseDetail),
    );
  };

  if (keyword) {
    const live = await withSearchBudget(
      fetchOfficialJapaneseKeywordSearchItems(keyword, page, pageSize),
      deadlineMs,
      null,
    );

    if (live?.items.length) {
      const startIndex = (page - 1) * pageSize;
      return {
        cards: live.items.map((item, index) => {
          const seeded = findOfficialJapaneseBrowseSeedByCardId(item.cardID);
          const setCode =
            seeded?.setCode ||
            setCodeFromOfficialJapaneseThumb(item.cardThumbFile) ||
            "";
          return toLightweightCard(
            item,
            seeded?.setIndex ?? startIndex + index,
            setCode,
            live.totalCount,
          );
        }),
        totalCount: Math.max(live.totalCount, seedFallback.totalCount),
      };
    }
  }

  if (seedFallback.matches.length) {
    return {
      cards: seedFallback.matches.map((match) =>
        toLightweightCard(match.item, match.setIndex, match.setCode, match.hitCnt),
      ),
      totalCount: seedFallback.totalCount,
    };
  }

  return { cards: [], totalCount: keyword ? 0 : null };
}

async function fetchJapaneseSetsWithPrintedTotal(printedTotal: number) {
  const sets = await fetchTcgdexJson<TcgdexSetBrief[]>(
    `${TCGDEX_API_BASE_URL}/ja/sets`,
    { revalidate: LIVE_SET_REVALIDATE_SECONDS },
  ).catch(() => [] as TcgdexSetBrief[]);

  return sets.filter((set) => {
    const official = set.cardCount?.official ?? 0;
    const total = set.cardCount?.total ?? 0;
    return official === printedTotal || total === printedTotal;
  });
}

async function fetchOfficialJapaneseCardsByCollectorCodeViaSetBrowse(
  collectorCode: CollectorCodeQuery & { printedTotal: number },
): Promise<PokemonCardJpDetail[]> {
  const matchingSets = await fetchJapaneseSetsWithPrintedTotal(collectorCode.printedTotal);
  const detailById = new Map<string, PokemonCardJpDetail>();

  await mapWithConcurrency(matchingSets, 3, async (setBrief) => {
    const tcgSet = await fetchTcgdexJson<TcgdexSetResponse>(
      `${TCGDEX_API_BASE_URL}/ja/sets/${encodeURIComponent(setBrief.id)}`,
    ).catch(() => null);

    if (tcgSet?.cards?.length) {
      return;
    }

    const browse = await fetchOfficialJapaneseSetBrowsePage(setBrief.id, 1).catch(() => null);

    if (!browse?.cardList?.length) {
      return;
    }

    const details = await mapWithConcurrency(browse.cardList.slice(0, 120), 8, async (item) =>
      fetchOfficialJapaneseCardDetail(item.cardID, item).catch(() => null),
    );

    for (const detail of details) {
      if (detail && collectorDetailMatchesCode(detail, collectorCode)) {
        detailById.set(detail.cardID, detail);
      }
    }
  });

  return [...detailById.values()];
}

function lookupCollectorMarketFallback(
  collectorCode: CollectorCodeQuery,
  language: CardLanguageCode,
  nameQuery = "",
) {
  const normalizedName = normalizeSearchText(nameQuery);

  return COLLECTOR_MARKET_FALLBACKS.find((fallback) => {
    const languageMatches =
      fallback.language === language ||
      ((language === "zh-cn" || language === "zh-tw") &&
        (fallback.language === "zh-cn" || fallback.language === "zh-tw"));

    if (!languageMatches) {
      return false;
    }

    if (fallback.printedTotal !== collectorCode.printedTotal) {
      return false;
    }

    const numberMatches = fallback.numbers.some((candidate) =>
      collectorNumberMatchesCode(candidate, collectorCode),
    );

    if (!numberMatches) {
      return false;
    }

    if (!normalizedName) {
      return true;
    }

    const searchable = [fallback.englishCardName, fallback.localizedName].filter(Boolean).join(" ");

    return textMatchesQuery(searchable, nameQuery);
  });
}

function buildCollectorCodeMarketFallbackBaseCard(
  collectorCode: CollectorCodeQuery,
  language: CardLanguageCode,
  fallback: CollectorMarketFallback,
): TcgCard {
  const profile = getLocalizedSetMarketProfile(fallback.setCode);
  const cardId = `market-fallback-${fallback.setCode}-${collectorCode.rawNumber ?? collectorCode.number}`;

  return {
    id: cardId,
    slug: buildLocalizedSlug(language, cardId),
    language,
    languageLabel: LANGUAGE_LABELS[language],
    name: formatBilingualName(fallback.localizedName ?? fallback.englishCardName, fallback.englishCardName),
    localizedName: fallback.localizedName ?? fallback.englishCardName,
    englishName: fallback.englishCardName,
    collectorNumber: collectorCode.rawNumber ?? collectorCode.number,
    rarity: "Art Rare",
    supertype: "Pokemon",
    hp: "-",
    types: ["Darkness"],
    setId: fallback.setCode,
    setCode: normalizeSetCode(fallback.setCode),
    setName: formatBilingualName(fallback.setEnglishName, fallback.setEnglishName),
    setLocalizedName: fallback.setEnglishName,
    setEnglishName: profile?.englishName ?? fallback.setEnglishName,
    setPrintedTotal: collectorCode.printedTotal,
    setTotal: collectorCode.printedTotal,
    image: "/icon.svg",
    artist: "Unknown",
    imageStatus: "placeholder",
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Collector code market fallback",
      fetchedAt: null,
      note: "Population data is resolved from public market sources when available.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [
      { date: isoDaysAgo(30), value: 0 },
      { date: isoDaysAgo(14), value: 0 },
      { date: isoDaysAgo(7), value: 0 },
      { date: isoDaysAgo(1), value: 0 },
      { date: isoDaysAgo(0), value: 0 },
    ],
    gradedPrices: [{ grade: "Ungraded", value: 0, populationCount: 0 }],
    recentSales: [],
    priceConsensus: {
      finalEstimateUsd: 0,
      confidence: "low",
      confidenceScore: 0,
      sourceCount: 0,
      sampleCount: 0,
      methodology: "Collector code market fallback",
      sources: [],
    },
    sources: [
      {
        source: "Collector code market fallback",
        status: "verified",
        fetchedAt: new Date().toISOString(),
        confidence: 0.55,
        note: "Matched a known localized collector code to public market guide pricing.",
      },
    ],
  };
}

function collectorCodeSearchScore(card: TcgCard, language: CardLanguageCode) {
  if (isSimplifiedChineseCatalogCardId(card.id)) {
    return 210;
  }

  if (card.id.startsWith("official-") || card.id.includes("official-")) {
    return language === "ja" ? 220 : 200;
  }

  if (card.id.startsWith("market-fallback-")) {
    return 195;
  }

  return language === "ja" ? 170 : 160;
}

function sortCollectorCodeSearchResults(results: SearchResult[]) {
  return applyEarlyMarketSearchEstimates(results).sort((left, right) => {
    const scoreDiff = right.score - left.score;

    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const priceDiff =
      getHeadlineMarketPriceUsd(right.card) - getHeadlineMarketPriceUsd(left.card);

    if (priceDiff !== 0) {
      return priceDiff;
    }

    return left.card.name.localeCompare(right.card.name);
  });
}

async function buildCollectorCodeGuideFallbackCard(
  collectorCode: CollectorCodeQuery,
  language: CardLanguageCode,
  fallback: CollectorMarketFallback,
): Promise<TcgCard | null> {
  const profile = getLocalizedSetMarketProfile(fallback.setCode);
  const lookupOptions = {
    setCode: fallback.setCode,
    isJapanese: false,
    language,
    englishCardName: fallback.englishCardName,
  };
  const [guide, imageUrl] = await Promise.all([
    fetchQuickLocalizedGuidePrice(
      profile?.englishName ?? fallback.setEnglishName,
      fallback.englishCardName,
      collectorCode.number,
      collectorCode.printedTotal,
      lookupOptions,
    ).catch(() => null),
    fetchPriceChartingProductImageUrl(
      profile?.englishName ?? fallback.setEnglishName,
      fallback.englishCardName,
      collectorCode.number,
      collectorCode.printedTotal,
      lookupOptions,
    ).catch(() => null),
  ]);

  if (!guide?.ungradedUsd) {
    return null;
  }

  const baseCard = buildCollectorCodeMarketFallbackBaseCard(collectorCode, language, fallback);

  return applyOfficialJapaneseGuidePrice(
    imageUrl
      ? {
          ...baseCard,
          image: imageUrl,
          imageStatus: "official",
        }
      : baseCard,
    fallback.englishCardName,
    guide,
  );
}

async function fetchCollectorMarketFallbackCardBySlug(
  slug: string,
  options: { includePublicPriceFallback?: boolean } = {},
): Promise<TcgCard | null> {
  const { language, id } = parseLocalizedSlug(slug);

  if (!id.startsWith("market-fallback-")) {
    return null;
  }

  const payload = id.replace(/^market-fallback-/, "");
  const separatorIndex = payload.lastIndexOf("-");

  if (separatorIndex <= 0) {
    return null;
  }

  const setCode = payload.slice(0, separatorIndex);
  const rawNumber = payload.slice(separatorIndex + 1);
  const marketFallback = COLLECTOR_MARKET_FALLBACKS.find((fallback) => {
    const languageMatches =
      fallback.language === language ||
      ((language === "zh-cn" || language === "zh-tw") &&
        (fallback.language === "zh-cn" || fallback.language === "zh-tw"));

    return (
      languageMatches &&
      fallback.setCode.toUpperCase() === setCode.toUpperCase() &&
      fallback.numbers.some((candidate) => collectorNumberMatchesCode(candidate, {
        rawNumber,
        number: rawNumber.replace(/^0+(?=\d)/, "") || rawNumber,
        printedTotal: fallback.printedTotal,
      }))
    );
  });

  if (!marketFallback) {
    return null;
  }

  const resolvedCollectorCode = {
    rawNumber,
    number: rawNumber.replace(/^0+(?=\d)/, "") || rawNumber,
    printedTotal: marketFallback.printedTotal,
  };

  const card = await buildCollectorCodeGuideFallbackCard(
    resolvedCollectorCode,
    language,
    marketFallback,
  );

  if (!card) {
    return null;
  }

  return options.includePublicPriceFallback ? applyPublicPriceFallback(card) : card;
}

async function officialJapaneseDetailsToSearchCards(details: PokemonCardJpDetail[]) {
  return Promise.all(
    details.map(async (detail) => {
      const englishName =
        (await resolveOfficialJapaneseEnglishName(detail)) ??
        (await resolveJapaneseCardIdentity({
          jpName: detail.name,
          setCode: detail.setCode,
          collectorNumber: detail.collectorNumber,
          cardId: detail.cardID,
          skipTcgdex: true,
        }));
      const enriched = await tryEnrichOfficialJapaneseDetail(detail, "ja");
      return {
        ...enriched,
        englishName: enriched.englishName ?? englishName,
        name: formatBilingualName(detail.name, enriched.englishName ?? englishName),
      };
    }),
  );
}

function officialJapaneseSearchPageItemsForCollector(
  items: PokemonCardJpSearchResponse["cardList"],
  collectorCode: CollectorCodeQuery,
  nameQuery: string,
) {
  const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
  const needles = [
    rawNumber,
    collectorCode.number,
    rawNumber.padStart(3, "0"),
    isFullCollectorCode(collectorCode) ? collectorCodeLabel(collectorCode) : "",
    collectorCode.setCode,
  ]
    .filter(Boolean)
    .map((value) => value!.toUpperCase());
  const nameHint = nameQuery.trim();

  const filtered = items.filter((item) => {
    const searchable = `${item.cardNameAltText || ""} ${item.cardNameViewText || ""}`;
    const searchableUpper = searchable.toUpperCase();
    const needleHit = needles.some((needle) => searchableUpper.includes(needle));
    const nameHit =
      !nameHint ||
      textMatchesQuery(searchable, nameHint);

    return (needleHit || !needles.length) && nameHit;
  });

  const ranked = (filtered.length ? filtered : items).slice();

  if (nameHint) {
    ranked.sort((left, right) => {
      const leftText = `${left.cardNameAltText || ""} ${left.cardNameViewText || ""}`;
      const rightText = `${right.cardNameAltText || ""} ${right.cardNameViewText || ""}`;
      return Number(textMatchesQuery(rightText, nameHint)) - Number(textMatchesQuery(leftText, nameHint));
    });
  }

  return ranked.slice(0, SEARCH_OFFICIAL_JP_MAX_DETAILS);
}

function officialJapaneseDetailMatchesCollector(
  detail: PokemonCardJpDetail,
  collectorCode: CollectorCodeQuery,
) {
  const collectorMatches = isFullCollectorCode(collectorCode)
    ? collectorDetailMatchesCode(detail, collectorCode) ||
      (isTrainerGalleryCollectorCode(collectorCode) &&
        collectorNumberMatchesCode(detail.collectorNumber, collectorCode))
    : collectorNumberMatchesCode(detail.collectorNumber, collectorCode);
  const setMatches =
    !collectorCode.setCode ||
    collectorSetCodeSearchKeys(collectorCode.setCode).some(
      (key) => key.toUpperCase() === detail.setCode?.trim().toUpperCase(),
    );

  return collectorMatches && setMatches;
}

async function detailOfficialJapaneseCollectorCandidates(
  items: PokemonCardJpSearchResponse["cardList"],
  collectorCode: CollectorCodeQuery,
  maxDetails: number,
): Promise<PokemonCardJpDetail[]> {
  const matches = new Map<string, PokemonCardJpDetail>();

  await mapWithConcurrencyUntil(
    items.slice(0, maxDetails),
    Math.min(OFFICIAL_JP_DETAIL_CONCURRENCY, 8),
    async (item) =>
      fetchOfficialJapaneseCardDetail(item.cardID, item, {
        timeoutMs: SEARCH_OFFICIAL_JP_COLLECTOR_DETAIL_TIMEOUT_MS,
      }).catch(() => null),
    (results) => {
      for (const detail of results) {
        if (!detail || matches.has(detail.cardID)) {
          continue;
        }

        if (officialJapaneseDetailMatchesCollector(detail, collectorCode)) {
          matches.set(detail.cardID, detail);
        }
      }

      return matches.size > 0;
    },
  );

  return [...matches.values()];
}

async function fetchOfficialJapaneseCardsBySetCollector(
  collectorCode: CollectorCodeQuery,
): Promise<TcgCard[]> {
  const setCode = collectorCode.setCode?.trim();
  if (!setCode) {
    return [];
  }

  const first = await fetchPokemonCardJpSearchPage("", 1, { pg: setCode }).catch(() => null);
  if (!first?.cardList?.length) {
    return [];
  }

  const pages = [first];
  const numeric = Number.parseInt(collectorCode.number, 10);
  if (first.maxPage > 1 && Number.isFinite(numeric) && numeric < 80) {
    const last = await fetchPokemonCardJpSearchPage("", first.maxPage, { pg: setCode }).catch(
      () => null,
    );
    if (last?.cardList?.length) {
      pages.push(last);
    }
  }

  const items = pages.flatMap((page) => page.cardList);
  const details = await detailOfficialJapaneseCollectorCandidates(
    items,
    collectorCode,
    SEARCH_OFFICIAL_JP_SET_BROWSE_MAX_DETAILS,
  );
  return details.length ? officialJapaneseDetailsToSearchCards(details) : [];
}

async function fetchOfficialJapaneseCardsByNameThenCollector(
  collectorCode: CollectorCodeQuery,
  nameQuery: string,
  aliases: string[],
): Promise<TcgCard[]> {
  const keywords = [...new Set([nameQuery, ...aliases].map((value) => value.trim()).filter(Boolean))];

  for (const keyword of keywords.slice(0, 3)) {
    const first = await fetchPokemonCardJpSearchPage(keyword, 1, {
      pg: collectorCode.setCode ?? "",
    }).catch(() => null);

    if (!first?.cardList?.length) {
      continue;
    }

    const pages = [first];
    if (first.maxPage > 1) {
      const extraPageIndexes = [...new Set([2, first.maxPage])].filter(
        (page) => page > 1 && page <= first.maxPage,
      );
      const extraPages = await Promise.all(
        extraPageIndexes.map((page) =>
          fetchPokemonCardJpSearchPage(keyword, page, {
            pg: collectorCode.setCode ?? "",
          }).catch(() => null),
        ),
      );
      for (const extra of extraPages) {
        if (extra?.cardList?.length) {
          pages.push(extra);
        }
      }
    }

    // Later catalog pages first. Vintage DPs-B Dialga 071/092 is on page 2 of
    // ディアルガ (48 hits); a page-1 cap of 39 never detailed it.
    const laterPagesFirst = [...pages.flatMap((page) => page.cardList)].reverse();
    const details = await detailOfficialJapaneseCollectorCandidates(
      laterPagesFirst,
      collectorCode,
      SEARCH_OFFICIAL_JP_NAME_COLLECTOR_MAX_DETAILS,
    );

    if (details.length) {
      return officialJapaneseDetailsToSearchCards(details);
    }
  }

  return [];
}

async function fetchOfficialJapaneseCardsByCollectorCode(
  collectorCode: CollectorCodeQuery,
  nameQuery = "",
): Promise<TcgCard[]> {
  if (!isFullCollectorCode(collectorCode)) {
    const partialMatch = lookupOfficialJapanesePartialCollectorFallback(
      collectorCode,
      nameQuery,
    );

    if (partialMatch) {
      return fetchOfficialJapaneseCardsByCollectorCode(partialMatch.fullCode, nameQuery);
    }
  }

  if (collectorCode.setCode) {
    const setCards = await fetchOfficialJapaneseCardsBySetCollector(collectorCode);
    if (setCards.length) {
      return setCards;
    }
  }

  if (nameQuery.trim()) {
    const aliases = isLikelyEnglishCatalogQuery(nameQuery)
      ? await fetchLocalizedPokemonNameAliases(nameQuery, "ja")
      : [];
    const namedCards = await fetchOfficialJapaneseCardsByNameThenCollector(
      collectorCode,
      nameQuery,
      aliases,
    );
    if (namedCards.length) {
      return namedCards;
    }

    if (isFullCollectorCode(collectorCode)) {
      const fallbackDetail = await fetchOfficialJapaneseFallbackDetailForCollectorCode(
        collectorCode,
      ).catch(() => null);
      if (
        fallbackDetail &&
        officialJapaneseDetailMatchesCollector(fallbackDetail, collectorCode)
      ) {
        return officialJapaneseDetailsToSearchCards([fallbackDetail]);
      }
    }

    // Name+number already scanned official name hits. Random #071 pages will not
    // recover a missing Dialga 071.
    return [];
  }

  const detailById = new Map<string, PokemonCardJpDetail>();

  if (isFullCollectorCode(collectorCode)) {
    const fallbackDetail = await fetchOfficialJapaneseFallbackDetailForCollectorCode(
      collectorCode,
    );

    if (fallbackDetail) {
      detailById.set(fallbackDetail.cardID, fallbackDetail);
    }
  }

  const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
  const keywords = isFullCollectorCode(collectorCode)
    ? [
        `${rawNumber}/${String(collectorCode.printedTotal).padStart(3, "0")}`,
        `${collectorCode.number}/${String(collectorCode.printedTotal).padStart(3, "0")}`,
        collectorCode.setCode ? `${rawNumber} ${collectorCode.setCode}` : "",
        rawNumber,
      ]
    : [rawNumber, collectorCode.number, rawNumber.padStart(3, "0")];

  for (const keyword of [...new Set(keywords.filter(Boolean))]) {
    if (detailById.size >= SEARCH_OFFICIAL_JP_MAX_DETAILS) {
      break;
    }

    const page = await fetchPokemonCardJpSearchPage(keyword, 1, {
      pg: collectorCode.setCode ?? "",
    }).catch(() => null);

    if (!page?.cardList?.length) {
      continue;
    }

    const pageItems = officialJapaneseSearchPageItemsForCollector(
      page.cardList,
      collectorCode,
      nameQuery,
    );
    const details = await mapWithConcurrency(
      pageItems,
      Math.min(OFFICIAL_JP_DETAIL_CONCURRENCY, 4),
      (item) =>
        fetchOfficialJapaneseCardDetail(item.cardID, item, {
          timeoutMs: SEARCH_OFFICIAL_JP_COLLECTOR_DETAIL_TIMEOUT_MS,
        }).catch(() => null),
    );

    for (const detail of details) {
      if (!detail) {
        continue;
      }

      if (officialJapaneseDetailMatchesCollector(detail, collectorCode)) {
        detailById.set(detail.cardID, detail);
      }
    }

    if (detailById.size) {
      break;
    }
  }

  return officialJapaneseDetailsToSearchCards([...detailById.values()]);
}

async function fetchCardSearchPage(
  filters: string[],
  page: number,
  pageSize: number,
  orderBy = POKEMON_TCG_DEFAULT_CARD_ORDER,
  timeoutMs = POKEMON_TCG_SEARCH_TIMEOUT_MS,
) {
  const searchParams = new URLSearchParams({
    pageSize: pageSize.toString(),
    page: page.toString(),
    orderBy,
  });

  if (filters.length) {
    searchParams.set("q", filters.join(" AND "));
  }

  const buildUrl = () => `${API_BASE_URL}/cards?${searchParams.toString()}`;

  try {
    return await fetchJson<PokemonTcgCardApiResponse>(buildUrl(), { timeoutMs });
  } catch (error) {
    if (
      error instanceof PokemonTcgApiError &&
      error.status === 404 &&
      orderBy.includes("cardmarket.prices.trendPrice")
    ) {
      searchParams.set("orderBy", POKEMON_TCG_DEFAULT_CARD_ORDER);
      return fetchJson<PokemonTcgCardApiResponse>(buildUrl(), { timeoutMs });
    }

    throw error;
  }
}

async function searchEnglishPartialCollector(
  collectorCode: CollectorCodeQuery,
  nameQuery: string,
  page: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const cleanName = nameQuery.trim();
  const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
  const numberClause = buildCollectorNumberLuceneClause(collectorCode);
  const setClause = collectorSetLuceneClause(collectorCode.setCode);
  const filters = [
    numberClause,
    cleanName ? buildSearchQueryClause(cleanName) : null,
    setClause,
  ].filter((clause): clause is string => Boolean(clause));
  const payload = await fetchCardSearchPage(
    filters,
    normalizedPage,
    SEARCH_PAGE_SIZE,
    englishOrderByForSort(sort),
  );
  let results = payload.data.map((card) => ({
    card: normalizeCard(card),
    score: cleanName ? 140 : 120,
    matchReason: cleanName
      ? `Collector #${rawNumber} with name match for ${cleanName}`
      : `Collector number #${rawNumber}`,
  }));

  results = results.filter((result) =>
    collectorNumberMatchesCode(result.card.collectorNumber, collectorCode) &&
    collectorCardMatchesNameHint(result.card, cleanName) &&
    (!collectorCode.setCode ||
      collectorSetCodeSearchKeys(collectorCode.setCode).some((key) =>
        collectorCodeMatchesSetFilter(result.card, key),
      )),
  );

  if (!results.length) {
    results = await buildIndexCollectorSearchResults(collectorCode, "en", cleanName);
  }

  if (isTrainerGalleryCollectorCode(collectorCode)) {
    results = prioritizeTrainerGalleryCollectorResults(results);
  }

  const pricedResults = isTrainerGalleryCollectorCode(collectorCode)
    ? results
    : await enrichSearchResultsWithPublicPriceFallback(results, {
        maxCandidates: Math.max(1, results.length),
      });

  results = applySearchResultSort(applyEarlyMarketSearchEstimates(pricedResults), sort);

  return makeSearchResponse({
    results,
    totalCount: results.length || payload.totalCount,
    page: payload.page,
    pageSize: payload.pageSize,
    hasNextPage: payload.page * payload.pageSize < payload.totalCount,
    notice: results.length
      ? undefined
      : `No English card matched #${rawNumber}${cleanName ? ` for ${cleanName}` : ""}. Try All languages or Japanese for import prints.`,
  });
}

async function searchTrainerGalleryNumber(
  collectorCode: CollectorCodeQuery,
  page: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const live = await withSearchBudget(
    searchEnglishPartialCollector(collectorCode, "", normalizedPage, sort),
    1_400,
    null as LiveSearchResponse | null,
  );

  if (live?.results.length) {
    return live;
  }

  const local = applySearchResultSort(
    await buildIndexCollectorSearchResults(collectorCode, "en"),
    sort,
  );

  if (!local.length) {
    return live ?? emptyNameSearchResponse(normalizedPage, SEARCH_PAGE_SIZE);
  }

  return makeSearchResponse({
    results: local,
    totalCount: local.length,
    page: normalizedPage,
    pageSize: SEARCH_PAGE_SIZE,
    hasNextPage: false,
  });
}

async function searchPartialCollectorAllLanguages(
  page: number,
  collectorCode: CollectorCodeQuery,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
  options: {
    nameQuery?: string;
    localizedNameAliases?: string[];
  } = {},
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;
  const nameQuery = options.nameQuery?.trim() ?? "";
  const localizedNameAliases = options.localizedNameAliases ?? [];
  const partialLabel = collectorCodeDisplayLabel(collectorCode);

  if (isTrainerGalleryCollectorCode(collectorCode)) {
    return searchTrainerGalleryNumber(collectorCode, normalizedPage, sort);
  }

  const [englishResponse, ...localizedResponses] = await Promise.all([
    searchEnglishPartialCollector(collectorCode, nameQuery, normalizedPage, sort).catch(
      (): LiveSearchResponse => ({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: SEARCH_PAGE_SIZE,
        hasNextPage: false,
      }),
    ),
    ...DEX_QUERY_LOCALIZED_CODES.map((code) =>
      searchLocalizedCollectorCodeResults(collectorCode, code, {
        nameQuery,
        localizedNameAliases,
        page: 1,
        pageSize: SEARCH_PAGE_SIZE,
        sort: "relevance",
      }).catch(
        (): LiveSearchResponse => ({
          results: [],
          totalCount: 0,
          page: 1,
          pageSize: SEARCH_PAGE_SIZE,
          hasNextPage: false,
        }),
      ),
    ),
  ]);

  const seenSlugs = new Set<string>();
  const merged = prependSearchResults(
    simplifiedChineseCatalogSearchResults({
      collectorCode,
      query: nameQuery,
      language: "all",
    }),
    [
      ...englishResponse.results,
      ...localizedResponses.flatMap((response) => response.results),
    ],
  ).filter((result) => {
    if (seenSlugs.has(result.card.slug)) {
      return false;
    }

    seenSlugs.add(result.card.slug);
    return true;
  });
  const sorted = applySearchResultSort(applyEarlyMarketSearchEstimates(merged), sort);
  const ranked = isTrainerGalleryCollectorCode(collectorCode)
    ? prioritizeTrainerGalleryCollectorResults(sorted)
    : sorted;
  const start = (normalizedPage - 1) * pageSize;

  return makeSearchResponse({
    results: ranked.slice(start, start + pageSize),
    totalCount: ranked.length,
    page: normalizedPage,
    pageSize,
    hasNextPage: start + pageSize < ranked.length,
    notice: ranked.length
      ? `Matched collector ${partialLabel}${nameQuery ? ` with ${nameQuery}` : ""} across catalogs.`
      : `No card matched collector ${partialLabel}${nameQuery ? ` with ${nameQuery}` : ""}.`,
  });
}

async function searchEnglishCollectorCode(
  collectorCode: CollectorCodeQuery & { printedTotal: number },
  page: number,
): Promise<LiveSearchResponse> {
  const exactPayload = await fetchCardSearchPage(
    [buildFullCollectorCodeLuceneClause(collectorCode)],
    page,
    SEARCH_PAGE_SIZE,
    "-set.releaseDate,number",
  ).catch(
    (): PokemonTcgCardApiResponse => ({
      data: [],
      totalCount: 0,
      page,
      pageSize: SEARCH_PAGE_SIZE,
    }),
  );
  let exactResults = exactPayload.data
    .map((card) => ({
      card: normalizeCard(card),
      score: 150,
      matchReason: `Exact collector code ${collectorCode.number}/${collectorCode.printedTotal}`,
    }))
    .filter((result) =>
      collectorNumberMatchesCode(result.card.collectorNumber, collectorCode),
    );

  if (!exactResults.length) {
    exactResults = await buildIndexCollectorSearchResults(collectorCode, "en");
  }

  if (exactResults.length) {
    const enrichedResults = applyEarlyMarketSearchEstimates(
      await enrichSearchResultsWithPublicPriceFallback(exactResults),
    );
    return makeSearchResponse({
      results: enrichedResults,
      totalCount: exactPayload.totalCount || enrichedResults.length,
      page: exactPayload.page,
      pageSize: exactPayload.pageSize,
      hasNextPage: exactPayload.page * exactPayload.pageSize < exactPayload.totalCount,
    });
  }

  return makeSearchResponse({
    results: [],
    totalCount: 0,
    page,
    pageSize: SEARCH_PAGE_SIZE,
    hasNextPage: false,
    notice: `No English card matched #${collectorCode.number} in sets sized ${collectorCode.printedTotal}. Many imports (for example Japanese TAG TEAM / SR prints) only exist under another language—choose that language above or a specific set.`,
  });
}

async function searchCollectorHeuristicEnglish(
  collectorCode: { number: string; printedTotal: number },
  page: number,
): Promise<LiveSearchResponse | null> {
  const hint = collectorHeuristicLookup(collectorCode);
  if (!hint) {
    return null;
  }

  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const payload = await fetchCardSearchPage(
    [hint.lucene],
    normalizedPage,
    SEARCH_PAGE_SIZE,
    "-set.releaseDate,number",
  ).catch((): PokemonTcgCardApiResponse | null => null);

  if (!payload?.data?.length) {
    return null;
  }

  const codeLabel = `${collectorCode.number}/${String(collectorCode.printedTotal).padStart(3, "0")}`;

  const heuristicResults: SearchResult[] = payload.data.map((card) => ({
    card: normalizeCard(card),
    score: 130,
    matchReason: `Expansion match (JP ${codeLabel} \u2192 English sm12)`,
  }));

  return makeSearchResponse({
    results: applyEarlyMarketSearchEstimates(
      await enrichSearchResultsWithPublicPriceFallback(heuristicResults),
    ),
    totalCount: payload.totalCount,
    page: payload.page,
    pageSize: payload.pageSize,
    hasNextPage: payload.page * payload.pageSize < payload.totalCount,
    notice: hint.notice,
  });
}

function tcgdexBriefMatchesCollectorSet(brief: TcgdexCardBrief, setKeys: string[]) {
  if (!setKeys.length) {
    return true;
  }

  const id = brief.id.toUpperCase();
  return setKeys.some(
    (key) => id === key || id.startsWith(`${key}-`) || id.includes(`-${key}-`) || id.includes(key),
  );
}

function tcgdexBriefMatchesCollectorName(
  brief: TcgdexCardBrief,
  nameQuery: string,
  aliases: string[],
) {
  if (!nameQuery.trim()) {
    return true;
  }

  const searchable = brief.name ?? "";
  return (
    textMatchesQuery(searchable, nameQuery) ||
    aliases.some((alias) => alias.trim() && textMatchesQuery(searchable, alias))
  );
}

async function fetchLocalizedCardsByCollectorCode(
  collectorCode: CollectorCodeQuery,
  language: CardLanguageCode,
  options: {
    nameQuery?: string;
    localizedNameAliases?: string[];
  } = {},
): Promise<TcgdexCardResponse[]> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const nameQuery = options.nameQuery?.trim() ?? "";
  const aliases = options.localizedNameAliases ?? [];
  const normalizedNum = collectorCode.number.replace(/^0+(?=\d)/, "");
  const rawNumber = collectorCode.rawNumber ?? normalizedNum;
  const variants = [
    ...new Set(
      [normalizedNum, normalizedNum.padStart(3, "0"), rawNumber.toUpperCase()].filter(Boolean),
    ),
  ].slice(0, 2);
  const briefLists = await Promise.all(
    variants.map((localId) =>
      fetchTcgdexJson<TcgdexCardBrief[]>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards?pagination:page=1&pagination:itemsPerPage=${TCGDEX_COLLECTOR_PAGE_SIZE}&localId=${encodeURIComponent(localId)}`,
        { timeoutMs: TCGDEX_COLLECTOR_TIMEOUT_MS },
      ).catch(() => [] as TcgdexCardBrief[]),
    ),
  );
  const uniqueBriefs = briefLists
    .flat()
    .filter((brief, index, items) => items.findIndex((item) => item.id === brief.id) === index);

  if (!uniqueBriefs.length) {
    return [];
  }

  const setKeys = collectorCode.setCode
    ? collectorSetCodeSearchKeys(collectorCode.setCode).map((key) => key.toUpperCase())
    : [];
  const scored = uniqueBriefs.map((brief, index) => {
    const setMatch = tcgdexBriefMatchesCollectorSet(brief, setKeys);
    const nameMatch = tcgdexBriefMatchesCollectorName(brief, nameQuery, aliases);
    const numberMatch = collectorNumberMatchesCode(brief.localId, collectorCode);
    const score =
      (nameMatch && nameQuery ? 16 : 0) + (setMatch && setKeys.length ? 8 : 0) + (numberMatch ? 4 : 0);
    return { brief, index, setMatch, nameMatch, score };
  });
  scored.sort((left, right) => right.score - left.score || left.index - right.index);

  let preferred = scored;
  if (nameQuery) {
    preferred = scored.filter((item) => item.nameMatch);
  } else if (setKeys.length) {
    preferred = scored.filter((item) => item.setMatch);
  }

  // Name/set misses should not spend the budget detailing the first unrelated 071/288.
  if ((nameQuery || setKeys.length) && !preferred.length) {
    return [];
  }

  const briefsToDetail = (preferred.length ? preferred : scored)
    .slice(0, TCGDEX_COLLECTOR_DETAIL_LIMIT)
    .map((item) => item.brief);

  const detailed = await Promise.all(
    briefsToDetail.map((brief) =>
      fetchTcgdexJson<TcgdexCardResponse>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
        { timeoutMs: TCGDEX_COLLECTOR_TIMEOUT_MS },
      ).catch(() => null),
    ),
  );

  return detailed.filter((card): card is TcgdexCardResponse => {
    if (!card) {
      return false;
    }

    if (!collectorNumberMatchesCode(card.localId, collectorCode)) {
      return false;
    }

    if (setKeys.length) {
      const setId = card.set.id.trim().toUpperCase();
      const setCode = (card.set.id ?? "").trim().toUpperCase();
      if (!setKeys.some((key) => setId === key || setCode === key || setId.includes(key))) {
        return false;
      }
    }

    if (!collectorCodeConstrainsPrintedTotal(collectorCode)) {
      return true;
    }

    const official = card.set.cardCount?.official;
    const setTotal = card.set.cardCount?.total;
    return (
      official === collectorCode.printedTotal || setTotal === collectorCode.printedTotal
    );
  });
}

async function searchLocalizedCollectorCodeResults(
  collectorCode: CollectorCodeQuery,
  language: CardLanguageCode,
  options: {
    nameQuery?: string;
    localizedNameAliases?: string[];
    page: number;
    pageSize: number;
    sort: SearchSortOption;
  },
): Promise<LiveSearchResponse> {
  const exactCode = collectorCodeDisplayLabel(collectorCode);
  const nameQuery = options.nameQuery?.trim() ?? "";
  const startIndex = (options.page - 1) * options.pageSize;
  const [tcgdexMatches, officialJapaneseCardsRaw, marketFallback] = await Promise.all([
    fetchLocalizedCardsByCollectorCode(collectorCode, language, {
      nameQuery,
      localizedNameAliases: options.localizedNameAliases,
    }),
    language === "ja"
      ? fetchOfficialJapaneseCardsByCollectorCode(collectorCode, nameQuery).catch(
          () => [] as TcgCard[],
        )
      : Promise.resolve([] as TcgCard[]),
    (async () => {
      const fallback = lookupCollectorMarketFallback(collectorCode, language, nameQuery);
      return fallback
        ? buildCollectorCodeGuideFallbackCard(collectorCode, language, fallback).catch(() => null)
        : null;
    })(),
  ]);

  const officialJapaneseCards = officialJapaneseCardsRaw;
  const chineseCatalogCards = simplifiedChineseCatalogSearchResults({
    collectorCode,
    query: nameQuery,
    language,
  }).map((result) => result.card);
  const normalizedTcgdexCards = tcgdexMatches.length
    ? await normalizeTcgdexCardsForSearch(tcgdexMatches, language, {
        preserveDetailedCards: true,
      })
    : [];
  const mergedCards = [...chineseCatalogCards, ...officialJapaneseCards, ...normalizedTcgdexCards];
  const seenIds = new Set<string>();

  for (const card of mergedCards) {
    seenIds.add(card.id.trim().toLowerCase());
  }

  if (marketFallback && !seenIds.has(marketFallback.id.trim().toLowerCase())) {
    mergedCards.push(marketFallback);
  }

  const filteredCards = mergedCards.filter((card) => {
    const collectorMatches = collectorNumberMatchesCode(card.collectorNumber, collectorCode);
    const printedTotalMatches =
      !collectorCodeConstrainsPrintedTotal(collectorCode) ||
      card.setPrintedTotal === collectorCode.printedTotal ||
      card.setTotal === collectorCode.printedTotal ||
      !card.setPrintedTotal;
    const setMatches =
      !collectorCode.setCode ||
      collectorSetCodeSearchKeys(collectorCode.setCode).some((key) =>
        collectorCodeMatchesSetFilter(card, key),
      );

    return (
      collectorMatches &&
      printedTotalMatches &&
      setMatches &&
      collectorCardMatchesNameHint(card, nameQuery, options.localizedNameAliases ?? [])
    );
  });
  const enrichedResults = await enrichSearchResultsWithPublicPriceFallback(
    filteredCards.map((card) => ({
      card,
      score: collectorCodeSearchScore(card, language),
      matchReason: nameQuery
        ? `${LANGUAGE_LABELS[language]} collector code ${exactCode} with name match`
        : `Exact collector code ${exactCode}`,
    })),
    { maxCandidates: Math.max(1, filteredCards.length) },
  );
  const searchResults =
    options.sort === "relevance"
      ? sortCollectorCodeSearchResults(enrichedResults)
      : applySearchResultSort(enrichedResults, options.sort);

  if (!searchResults.length) {
    return makeSearchResponse({
      results: [],
      totalCount: 0,
      page: options.page,
      pageSize: options.pageSize,
      hasNextPage: false,
      notice: nameQuery
        ? `No ${LANGUAGE_LABELS[language]} card matched ${nameQuery} at collector code ${exactCode}.`
        : `No ${LANGUAGE_LABELS[language]} card matched exact code ${exactCode} (number + set size on card). Try All languages if you need an English catalog crosswalk.`,
    });
  }

  return makeSearchResponse({
    results: searchResults.slice(startIndex, startIndex + options.pageSize),
    totalCount: searchResults.length,
    page: options.page,
    pageSize: options.pageSize,
    hasNextPage: startIndex + options.pageSize < searchResults.length,
    notice:
      officialJapaneseCards.length && normalizedTcgdexCards.length
        ? `Merged official Japanese catalog and TCGdex matches for collector code ${exactCode}.`
        : marketFallback
          ? `Matched collector code ${exactCode} from public market guide data because this print is not in TCGdex yet.`
          : undefined,
  });
}

async function searchOfficialJapaneseCollectorCode(
  collectorCode: CollectorCodeQuery & { printedTotal: number },
  page: number,
  pageSize: number,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const cards = await fetchOfficialJapaneseCardsByCollectorCode(collectorCode);
  const exactCode = collectorCodeLabel(collectorCode);
  const start = (normalizedPage - 1) * pageSize;
  const results = cards.map((card) => ({
    card,
    score: 175,
    matchReason: `Official Japanese exact collector code ${exactCode}`,
  }));

  const enrichedResults = applyEarlyMarketSearchEstimates(
    await enrichSearchResultsWithPublicPriceFallback(
      results.slice(start, start + pageSize),
      { maxCandidates: Math.max(1, results.length) },
    ),
  );

  return makeSearchResponse({
    results: enrichedResults,
    totalCount: results.length,
    page: normalizedPage,
    pageSize,
    hasNextPage: start + pageSize < results.length,
  });
}

async function searchCollectorCodeAllLanguages(
  page: number,
  collectorCode: CollectorCodeQuery & { printedTotal: number },
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
  options: {
    nameQuery?: string;
    localizedNameAliases?: string[];
  } = {},
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;
  const nameQuery = options.nameQuery?.trim() ?? "";
  const localizedNameAliases = options.localizedNameAliases ?? [];

  if (isTrainerGalleryCollectorCode(collectorCode)) {
    return searchTrainerGalleryNumber(collectorCode, normalizedPage, sort);
  }

  const exactCode = collectorCodeLabel(collectorCode);

  const [englishPayload, ...localizedResponses] = await Promise.all([
    fetchCardSearchPage(
      [
        buildFullCollectorCodeLuceneClause(collectorCode),
        collectorSetLuceneClause(collectorCode.setCode),
      ].filter((clause): clause is string => Boolean(clause)),
      1,
      SEARCH_PAGE_SIZE,
      "-set.releaseDate,number",
    ).catch((): PokemonTcgCardApiResponse => ({
      data: [],
      totalCount: 0,
      page: 1,
      pageSize: SEARCH_PAGE_SIZE,
    })),
    ...DEX_QUERY_LOCALIZED_CODES.map((code) =>
      searchLocalizedCollectorCodeResults(collectorCode, code, {
        nameQuery,
        localizedNameAliases,
        page: 1,
        pageSize: SEARCH_PAGE_SIZE,
        sort: "relevance",
      }).catch(
        (): LiveSearchResponse => ({
          results: [],
          totalCount: 0,
          page: 1,
          pageSize: SEARCH_PAGE_SIZE,
          hasNextPage: false,
        }),
      ),
    ),
  ]);

  const englishResults: SearchResult[] = englishPayload.data
    .map((card) => ({
      card: normalizeCard(card),
      score: 120,
      matchReason: `Exact collector code ${collectorCode.number}/${collectorCode.printedTotal}`,
    }))
    .filter(
      (result) =>
        collectorNumberMatchesCode(result.card.collectorNumber, collectorCode) &&
        collectorCardMatchesNameHint(result.card, nameQuery, localizedNameAliases),
    );

  const localizedResults = localizedResponses.flatMap((response) => response.results);
  let merged = prependSearchResults(
    simplifiedChineseCatalogSearchResults({
      collectorCode,
      query: nameQuery,
      language: "all",
    }),
    [...localizedResults, ...englishResults],
  );

  if (!merged.length) {
    merged = await buildIndexCollectorSearchResults(
      collectorCode,
      "all",
      nameQuery,
      localizedNameAliases,
    );
  }

  const seenCatalogIds = new Set<string>();
  const deduped = merged.filter((result) => {
    const catalogKey = result.card.id.trim().toLowerCase();
    if (seenCatalogIds.has(catalogKey)) {
      return false;
    }
    seenCatalogIds.add(catalogKey);
    return true;
  });

  const enrichedDeduped = await enrichSearchResultsWithPublicPriceFallback(deduped, {
    maxCandidates: searchFallbackBudget({
      cleanQuery: exactCode,
      sort,
      resultCount: deduped.length,
    }),
  });

  const start = (normalizedPage - 1) * pageSize;
  const sorted =
    sort === "relevance"
      ? sortCollectorCodeSearchResults(enrichedDeduped)
      : applySearchResultSort(applyEarlyMarketSearchEstimates(enrichedDeduped), sort);
  const pageItems = sorted.slice(start, start + pageSize);

  if (!deduped.length) {
    const officialJapanese = await searchOfficialJapaneseCollectorCode(
      collectorCode,
      normalizedPage,
      pageSize,
    ).catch(() => null);

    if (officialJapanese?.results.length) {
      return officialJapanese;
    }

    const cachedCards = (await lookupCachedCardsByCollectorCode("all", collectorCode)).filter((card) =>
      collectorCardMatchesNameHint(card, nameQuery, localizedNameAliases),
    );

    if (cachedCards.length) {
      const cachedResults = await enrichSearchResultsWithPublicPriceFallback(
        cachedCards.map((card) => ({
          card,
          score: collectorCodeSearchScore(card, card.language),
          matchReason: `Cached collector code ${exactCode} from prior searches`,
        })),
        { maxCandidates: Math.max(1, cachedCards.length) },
      );
      const sortedCached =
        sort === "relevance"
          ? sortCollectorCodeSearchResults(cachedResults)
          : applySearchResultSort(applyEarlyMarketSearchEstimates(cachedResults), sort);
      const start = (normalizedPage - 1) * pageSize;

      return makeSearchResponse({
        results: sortedCached.slice(start, start + pageSize),
        totalCount: sortedCached.length,
        page: normalizedPage,
        pageSize,
        hasNextPage: start + pageSize < sortedCached.length,
        notice: `Matched collector code ${exactCode} from the local search cache because live catalogs were unavailable.`,
      });
    }

    const heuristic = await searchCollectorHeuristicEnglish(collectorCode, normalizedPage);
    if (heuristic) {
      return heuristic;
    }
    return makeSearchResponse({
      results: [],
      totalCount: 0,
      page: normalizedPage,
      pageSize,
      hasNextPage: false,
      notice: `No card matched exact collector code ${collectorCode.number}/${collectorCode.printedTotal} across scanned languages. Choose Japanese (or the region that printed the card) in the language filter, or narrow by set.`,
    });
  }

  return makeSearchResponse({
    results: pageItems,
    totalCount: sorted.length,
    page: normalizedPage,
    pageSize,
    hasNextPage: start + pageSize < sorted.length,
    notice: localizedResults.length
      ? `Showing localized exact collector-code matches for ${exactCode} first. English expansion matches only appear after exact localized records.`
      : undefined,
  });
}

export async function fetchLiveSets(): Promise<TcgSet[]> {
  const payload = await fetchJson<PokemonTcgSetApiResponse>(`${API_BASE_URL}/sets`, {
    revalidate: LIVE_SET_REVALIDATE_SECONDS,
  });

  return sortTcgSetsForDisplay(
    uniqueTcgSetsById(
      payload.data.map((set) => ({
        id: set.id,
        name: set.name,
        code: normalizeSetCode(set.id),
        series: set.series,
        releaseDate: set.releaseDate,
        language: "en" as CardLanguageCode,
        languageLabel: LANGUAGE_LABELS.en,
        printedTotal: set.printedTotal,
        total: set.total,
      })),
    ),
  );
}

function uniqueTcgSetsById(sets: TcgSet[]) {
  const seen = new Set<string>();

  return sets.filter((set) => {
    if (isPokemonTcgPocketSet(set)) {
      return false;
    }

    const key = `${set.language}:${set.id.trim().toLowerCase()}`;

    if (!set.id.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function fetchLocalizedSets(language: CardLanguageCode): Promise<TcgSet[]> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const [sets, englishSets] = await Promise.all([
    fetchTcgdexJson<TcgdexSetBrief[]>(`${TCGDEX_API_BASE_URL}/${apiLanguage}/sets`, {
      revalidate: LIVE_SET_REVALIDATE_SECONDS,
    }),
    fetchTcgdexJson<TcgdexSetBrief[]>(`${TCGDEX_API_BASE_URL}/en/sets`, {
      revalidate: LIVE_SET_REVALIDATE_SECONDS,
    }).catch(
      () => [] as TcgdexSetBrief[],
    ),
  ]);
  const englishSetNames = new Map(englishSets.map((set) => [set.id, set.name]));

  const mapped = uniqueTcgSetsById(
    sets
      .filter((set) => !isPokemonTcgPocketSet({ id: set.id, name: set.name }))
      .map((set) => {
      const englishName = getLocalizedSetEnglishName(set.id, englishSetNames.get(set.id));

      return {
        id: set.id,
        name: formatBilingualName(set.name, englishName),
        localizedName: set.name,
        englishName,
        code: normalizeSetCode(set.id),
        series: LANGUAGE_LABELS[language],
        releaseDate: set.releaseDate ?? "",
        language,
        languageLabel: LANGUAGE_LABELS[language],
        printedTotal: set.cardCount?.official,
        total: set.cardCount?.total,
      };
    }),
  );
  const withJapanese =
    language === "ja" ? mergeOfficialJapaneseSetSupplements(mapped) : mapped;

  return sortTcgSetsForDisplay(mergeSimplifiedChineseSetSupplements(withJapanese, language));
}

async function fetchTcgdexEnglishCompanion(
  card: TcgdexCardResponse,
  language: CardLanguageCode = "ja",
): Promise<TcgdexEnglishCompanion> {
  const companionSetId =
    resolveEnglishCompanionSetId(card.set.id) ?? card.set.id;

  try {
    const englishCard = await fetchTcgdexJson<TcgdexCardResponse>(
      `${TCGDEX_API_BASE_URL}/en/cards/${card.id}`,
    );

    const acceptCompanion =
      language !== "ja" || tcgdexEnglishCompanionNameAgrees(card.name, englishCard.name);

    return {
      name: acceptCompanion
        ? englishCard.name
        : inferEnglishNameFromTcgdexLocalizedName(card.name),
      setName: englishCard.set?.name,
      image: acceptCompanion ? englishCard.image : undefined,
      // Never copy EN market prices onto JP prints — names/images only.
      marketPriceUsd: undefined,
    };
  } catch {
    const fallback: TcgdexEnglishCompanion = {
      setName: getLocalizedSetEnglishName(card.set.id),
    };

    try {
      const englishSet = await fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(companionSetId)}`,
      );
      const normalizedLocalId = card.localId.replace(/^0+(?=\d)/, "");
      const matchingBrief = englishSet.cards?.find(
        (brief) => brief.localId.replace(/^0+(?=\d)/, "") === normalizedLocalId,
      );
      const matchingCard = matchingBrief
        ? await fetchTcgdexJson<TcgdexCardResponse>(
            `${TCGDEX_API_BASE_URL}/en/cards/${matchingBrief.id}`,
          ).catch(() => null)
        : null;

      const companionName = matchingCard?.name ?? matchingBrief?.name;
      const acceptCompanion =
        language !== "ja" || tcgdexEnglishCompanionNameAgrees(card.name, companionName);

      return {
        name: acceptCompanion
          ? companionName
          : inferEnglishNameFromTcgdexLocalizedName(card.name),
        setName: englishSet.name,
        image: acceptCompanion ? matchingCard?.image ?? matchingBrief?.image : undefined,
        marketPriceUsd: undefined,
      };
    } catch {
      return fallback;
    }
  }
}

async function normalizeTcgdexCards(
  cards: TcgdexCardResponse[],
  language: CardLanguageCode,
): Promise<TcgCard[]> {
  if (language === "en") {
    return cards.map((card) =>
      normalizeTcgdexCard(card, language, {
        name: card.name,
        setName: card.set.name,
      }),
    );
  }

  const companions = await Promise.all(
    cards.map((card) => fetchTcgdexEnglishCompanion(card, language)),
  );

  return cards.map((card, index) =>
    normalizeTcgdexCard(card, language, companions[index]),
  );
}

function normalizeTcgdexSetBriefCards({
  briefs,
  set,
  englishSet,
  language,
}: {
  briefs: TcgdexCardBrief[];
  set: TcgdexSetResponse;
  englishSet?: TcgdexSetResponse | null;
  language: CardLanguageCode;
}): TcgCard[] {
  const englishBriefByLocalId = new Map(
    (englishSet?.cards ?? []).map((card) => [
      card.localId.replace(/^0+(?=\d)/, ""),
      card,
    ]),
  );
  const englishBriefById = new Map((englishSet?.cards ?? []).map((card) => [card.id, card]));
  const englishSetName = getLocalizedSetEnglishName(set.id, englishSet?.name);

  return briefs.map((brief) => {
    const englishBrief =
      englishBriefById.get(brief.id) ??
      englishBriefByLocalId.get(brief.localId.replace(/^0+(?=\d)/, ""));
    const acceptCompanion =
      language !== "ja" ||
      tcgdexEnglishCompanionNameAgrees(brief.name, englishBrief?.name);
    const inferredEnglishName =
      language === "ja" ? inferEnglishNameFromTcgdexLocalizedName(brief.name) : undefined;
    const card: TcgdexCardResponse = {
      id: brief.id,
      localId: brief.localId,
      name: brief.name,
      image: brief.image,
      category: "Pokemon",
      set: {
        id: set.id,
        name: set.name,
        cardCount: set.cardCount,
      },
    };

    return normalizeTcgdexCard(card, language, {
      name: acceptCompanion ? englishBrief?.name : inferredEnglishName,
      setName: englishSetName,
      image: acceptCompanion ? englishBrief?.image : undefined,
    });
  });
}

async function normalizeTcgdexCardsForSearch(
  cards: TcgdexCardResponse[],
  language: CardLanguageCode,
  options: NormalizeTcgdexCardsForSearchOptions = {},
): Promise<TcgCard[]> {
  if (!cards.length) {
    return [];
  }

  if (language === "en" || options.preserveDetailedCards) {
    const normalized = cards
      .filter(
        (card) =>
          !isPokemonTcgPocketPrint({
            id: card.id,
            setId: card.set.id,
            setName: card.set.name,
            rarity: card.rarity,
            image: card.image,
          }),
      )
      .map((card) =>
        normalizeTcgdexCard(card, language, {
          name:
            language === "en"
              ? card.name
              : inferEnglishNameFromTcgdexLocalizedName(card.name),
          setName: getLocalizedSetEnglishName(card.set.id, card.set.name),
        }),
      );

    if (language === "ja" && !options.skipEnglishNameEnrichment) {
      return enrichJapaneseEnglishNames(normalized, { skipTcgdex: true });
    }

    return normalized;
  }

  const apiLanguage = resolveTcgdexApiLanguage(language);
  const cardsBySet = new Map<string, TcgdexCardResponse[]>();

  for (const card of cards) {
    if (
      isPokemonTcgPocketPrint({
        id: card.id,
        setId: card.set.id,
        setName: card.set.name,
        rarity: card.rarity,
        image: card.image,
      })
    ) {
      continue;
    }

    const existing = cardsBySet.get(card.set.id) ?? [];
    existing.push(card);
    cardsBySet.set(card.set.id, existing);
  }

  const normalizedById = new Map<string, TcgCard>();

  await mapWithConcurrency([...cardsBySet.entries()], 4, async ([setId, setCards]) => {
    const englishSetId = resolveEnglishCompanionSetId(setId) ?? setId;
    const [localizedSet, englishSet] = await Promise.all([
      fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets/${encodeURIComponent(setId)}`,
      ).catch(() => null),
      fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(englishSetId)}`,
      ).catch(() => null),
    ]);

    if (!localizedSet) {
      const fallbackCards = await normalizeTcgdexCards(setCards, language);
      for (const card of fallbackCards) {
        normalizedById.set(card.id, card);
      }
      return;
    }

    const briefs = setCards.map((card) => ({
      id: card.id,
      localId: card.localId,
      name: card.name,
      image: card.image,
    }));
    const normalizedCards = normalizeTcgdexSetBriefCards({
      briefs,
      set: localizedSet,
      englishSet,
      language,
    });

    for (const card of normalizedCards) {
      normalizedById.set(card.id, card);
    }
  });

  const normalized = cards
    .map((card) => normalizedById.get(card.id))
    .filter((card): card is TcgCard => Boolean(card));

  // Do not enrich localized search rows with English companion market prices.
  // Japanese and Chinese chase cards often diverge dramatically from English
  // equivalents, so an empty price is safer than a convincing but wrong number.

  if (language === "ja" && !options.skipEnglishNameEnrichment) {
    return enrichJapaneseEnglishNames(normalized, { skipTcgdex: true });
  }

  return normalized;
}

function polishJapaneseNameSearchCard(card: TcgCard): TcgCard {
  const polished = applyJapaneseMarketSetLabels(applyOfficialJapaneseBrowseArtworkToCard(card));
  if (polished.language !== "ja" || polished.englishName?.trim()) {
    return polished;
  }

  const englishName = resolveJapanesePrintedNameToEnglishSync(
    polished.localizedName ?? polished.name,
  );
  if (!englishName) {
    return polished;
  }

  return {
    ...polished,
    englishName,
    name: formatBilingualName(polished.localizedName ?? polished.name, englishName),
  };
}

async function searchLocalizedCardsByEnglishQuery(
  query: string,
  page: number,
  language: CardLanguageCode,
  itemsPerPage = LOCALIZED_SEARCH_PAGE_SIZE,
  includeOfficialJapanese = true,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
  options: { deadlineMs?: number; skipPriceHydrate?: boolean } = {},
): Promise<LiveSearchResponse> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    return makeSearchResponse({
      results: [],
      totalCount: 0,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage: false,
    });
  }

  const catalogTimeoutMs = Math.min(800, options.deadlineMs ?? 800);
  const japaneseCardAliases =
    language === "ja"
      ? await findJapaneseCardNameSearchAliases(cleanQuery).catch(() => [] as string[])
      : [];
  const hasCjkAlias = japaneseCardAliases.some((alias) =>
    /[\u3040-\u30ff\u3400-\u9fff]/.test(alias),
  );
  const localizedNameAliases =
    language === "ja" && hasCjkAlias
      ? []
      : await fetchLocalizedPokemonNameAliases(cleanQuery, language);
  const mergedNameAliases = [...new Set([...localizedNameAliases, ...japaneseCardAliases])];
  const localizedNameQueries = localizedNameSearchVariants(
    mergedNameAliases,
    cleanQuery,
    language,
  );
  const officialBudgetMs = Math.min(
    SEARCH_OFFICIAL_JP_NAME_BUDGET_MS,
    options.deadlineMs ?? SEARCH_OFFICIAL_JP_NAME_BUDGET_MS,
  );
  const officialJapanese =
    language === "ja" && includeOfficialJapanese
      ? await fetchOfficialJapaneseSearchCards({
          aliases: mergedNameAliases,
          page: normalizedPage,
          pageSize: itemsPerPage,
          deadlineMs: officialBudgetMs,
        }).catch(() => ({ cards: [] as TcgCard[], totalCount: null as number | null }))
      : { cards: [] as TcgCard[], totalCount: null as number | null };
  const officialResults: SearchResult[] = officialJapanese.cards
    .map((card) => ({
      card: polishJapaneseNameSearchCard(card),
      score: 138,
      matchReason: "Official Japanese catalog match",
    }))
    .filter((result) =>
      localizedCardMatchesNameQuery(result.card, cleanQuery, mergedNameAliases),
    );
  const haveOfficialPage = officialResults.length >= Math.min(8, itemsPerPage);

  if (haveOfficialPage) {
    const mergedCards = await withSearchBudget(
      enrichJapaneseEnglishNames(
        officialResults.map((result) => result.card),
        { skipTcgdex: true },
      ),
      200,
      officialResults.map((result) => result.card),
    );
    const results = applyEarlyMarketSearchEstimates(
      officialResults.map((result, index) => ({
        ...result,
        card: polishJapaneseNameSearchCard(mergedCards[index] ?? result.card),
      })),
    );

    return makeSearchResponse({
      results: applySearchResultSort(results, sort),
      totalCount:
        typeof officialJapanese.totalCount === "number"
          ? Math.max(officialJapanese.totalCount, results.length)
          : results.length,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage:
        typeof officialJapanese.totalCount === "number"
          ? normalizedPage * itemsPerPage < officialJapanese.totalCount
          : false,
      notice: `Matched "${cleanQuery}" against English card names and localized Pokémon names, then opened matching ${LANGUAGE_LABELS[language]} prints.`,
    });
  }

  const [englishBriefs, localizedAliasBriefs, indexedCards] = await Promise.all([
    language === "ja"
      ? Promise.resolve([] as TcgdexCardBrief[])
      : fetchTcgdexJson<TcgdexCardBrief[]>(
          `${TCGDEX_API_BASE_URL}/en/cards?${new URLSearchParams({
            "pagination:page": normalizedPage.toString(),
            "pagination:itemsPerPage": String(Math.min(itemsPerPage + 8, 64)),
            name: cleanQuery,
          }).toString()}`,
          { timeoutMs: catalogTimeoutMs },
        ).catch(() => [] as TcgdexCardBrief[]),
    Promise.all(
      localizedNameQueries.map((alias) =>
        fetchTcgdexJson<TcgdexCardBrief[]>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards?${new URLSearchParams({
            "pagination:page": normalizedPage.toString(),
            "pagination:itemsPerPage": String(itemsPerPage),
            name: alias,
          }).toString()}`,
          { timeoutMs: catalogTimeoutMs },
        ).catch(() => [] as TcgdexCardBrief[]),
      ),
    ).then((groups) => dedupeTcgdexBriefs(groups.flat()).slice(0, LOCALIZED_ALIAS_BRIEF_LIMIT)),
    language === "ja"
      ? withSearchBudget(
          lookupCardsInIndexByName(cleanQuery, "ja", itemsPerPage).catch(() => [] as TcgCard[]),
          250,
          [] as TcgCard[],
        )
      : Promise.resolve([] as TcgCard[]),
  ]);
  const chineseResults = simplifiedChineseCatalogSearchResults({
    query: cleanQuery,
    language,
  });

  if (
    !englishBriefs.length &&
    !localizedAliasBriefs.length &&
    !officialResults.length &&
    !indexedCards.length &&
    !chineseResults.length
  ) {
    return makeSearchResponse({
      results: [],
      totalCount: 0,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage: false,
    });
  }

  const aliasCards = await fetchTcgdexDetailCardsFromBriefs(
    localizedAliasBriefs.slice(0, itemsPerPage + 4),
    language,
    {
      deadlineMs: Math.min(800, options.deadlineMs ?? 800),
      perCardTimeoutMs: Math.min(300, options.deadlineMs ?? 300),
    },
  );
  const localizedHits = aliasCards.length + officialResults.length + indexedCards.length;
  const crosswalkCards =
    language === "ja" || localizedHits > 0
      ? []
      : (
          await mapWithConcurrency(
            englishBriefs.slice(0, itemsPerPage + 6),
            6,
            (brief) => fetchLocalizedCardFromEnglishBrief(brief, language),
          )
        ).filter((card): card is TcgdexCardResponse =>
          Boolean(
            card &&
              localizedCardMatchesNameQuery(
                { name: card.name, localizedName: card.name, englishName: undefined },
                cleanQuery,
                mergedNameAliases,
              ),
          ),
        );
  const uniqueCards = [...aliasCards, ...crosswalkCards].filter(
    (card, index, cards) => cards.findIndex((item) => item.id === card.id) === index,
  );
  const normalizedCards = await normalizeTcgdexCardsForSearch(
    uniqueCards.slice(0, itemsPerPage),
    language,
    { preserveDetailedCards: true },
  );
  const hydratedCards =
    language === "ja" && !options.skipPriceHydrate
      ? await hydrateJapaneseTcgdexListPrices(normalizedCards, {
          budgetMs: Math.min(400, options.deadlineMs ?? 400),
          maxHeadFetches: 6,
        })
      : normalizedCards;
  const indexedResults: SearchResult[] = indexedCards.map((card) => ({
    card: polishJapaneseNameSearchCard(card),
    score: 112,
    matchReason: "Indexed Japanese catalog match",
  }));
  const officialIdentityKeys = new Set(
    officialResults.map((result) =>
      [
        result.card.setCode,
        result.card.collectorNumber.replace(/^0+(?=\d)/, ""),
        normalizeSearchText(result.card.localizedName ?? result.card.name),
      ].join("|"),
    ),
  );
  const tcgdexResults = hydratedCards
    .map((card) => ({
      card: polishJapaneseNameSearchCard(card),
      score: 118,
      matchReason: `English-name match in ${LANGUAGE_LABELS[language]}`,
    }))
    .filter(
      (result) =>
        !officialIdentityKeys.has(
          [
            result.card.setCode,
            result.card.collectorNumber.replace(/^0+(?=\d)/, ""),
            normalizeSearchText(result.card.localizedName ?? result.card.name),
          ].join("|"),
        ),
    );
  const mergedResults = prependSearchResults(chineseResults, [
    ...officialResults,
    ...tcgdexResults,
    ...indexedResults,
  ]).filter(
    (result, index, items) =>
      items.findIndex((candidate) => candidate.card.id === result.card.id) === index,
  );
  const speciesMatched = mergedResults.filter((result) =>
    localizedCardMatchesNameQuery(result.card, cleanQuery, mergedNameAliases),
  );
  const mergedCards = await enrichJapaneseEnglishNames(
    speciesMatched.map((result) => result.card),
    { skipTcgdex: true },
  );
  const mergedWithEnglishNames = speciesMatched.map((result, index) => ({
    ...result,
    card: polishJapaneseNameSearchCard(mergedCards[index] ?? result.card),
  })).filter((result) =>
    localizedCardMatchesNameQuery(result.card, cleanQuery, mergedNameAliases),
  );
  const results = applyEarlyMarketSearchEstimates(
    applyLocalizedSearchPriceEstimate(
      await enrichSearchResultsWithPublicPriceFallback(mergedWithEnglishNames, {
        maxCandidates: 6,
      }),
    ),
  );

  return makeSearchResponse({
    results: applySearchResultSort(results, sort),
    totalCount:
      typeof officialJapanese.totalCount === "number"
        ? Math.max(officialJapanese.totalCount, results.length)
        : results.length,
    page: normalizedPage,
    pageSize: itemsPerPage,
    hasNextPage:
      (typeof officialJapanese.totalCount === "number"
        ? normalizedPage * itemsPerPage < officialJapanese.totalCount
        : false) ||
      englishBriefs.length === itemsPerPage * 4 ||
      localizedAliasBriefs.length >= itemsPerPage * 2,
    notice: results.length
      ? `Matched "${cleanQuery}" against English card names and localized Pokémon names, then opened matching ${LANGUAGE_LABELS[language]} prints.`
      : undefined,
  });
}

const searchSetsCache = new Map<
  CardLanguageFilter,
  { expiresAt: number; promise: Promise<TcgSet[]> }
>();

async function fetchAllLanguageSearchSets(): Promise<TcgSet[]> {
  const setLists = await Promise.all(
    SUPPORTED_CARD_LANGUAGES.map(({ code: language }) =>
      (language === "en" ? fetchLiveSets() : fetchLocalizedSets(language)).catch(
        () => [] as TcgSet[],
      ),
    ),
  );

  return uniqueTcgSetsByCatalogId(setLists.flat()).sort((left, right) => {
    if (left.releaseDate || right.releaseDate) {
      return right.releaseDate.localeCompare(left.releaseDate);
    }

    return left.name.localeCompare(right.name);
  });
}

function uniqueTcgSetsByCatalogId(sets: TcgSet[]) {
  const byId = new Map<string, TcgSet>();

  for (const set of sets) {
    const key = set.id.trim().toLowerCase();

    if (!key) {
      continue;
    }

    const existing = byId.get(key);
    if (
      !existing ||
      set.language === "en" ||
      (!existing.releaseDate && set.releaseDate)
    ) {
      byId.set(key, set);
    }
  }

  return [...byId.values()];
}

function rememberLiveSearchSets(language: CardLanguageFilter): Promise<TcgSet[]> {
  const now = Date.now();
  const cachedSets = searchSetsCache.get(language);

  if (cachedSets && cachedSets.expiresAt > now) {
    return cachedSets.promise;
  }

  const setsPromise =
    language === "all"
      ? fetchAllLanguageSearchSets()
      : language === "en"
        ? fetchLiveSets()
        : fetchLocalizedSets(language);

  searchSetsCache.set(language, {
    expiresAt: now + SEARCH_SET_MEMORY_TTL_MS,
    promise: setsPromise.catch((error) => {
      searchSetsCache.delete(language);
      throw error;
    }),
  });

  return setsPromise;
}

function firstResolved<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);
    timer.unref?.();
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      },
    );
  });
}

export async function fetchSearchSets(
  language: CardLanguageFilter = "all",
  query = "",
): Promise<TcgSet[]> {
  const trimmedQuery = query.trim();
  const livePromise = rememberLiveSearchSets(language);
  const local = trimmedQuery
    ? await searchSetsInDatabase(trimmedQuery, language)
    : await getSetsFromDatabase(language);
  const liveWaitMs = local?.length ? 450 : 1_600;
  const liveReady = await firstResolved(livePromise, liveWaitMs);
  const liveMatches =
    liveReady && trimmedQuery
      ? liveReady.filter((set) => setMatchesSearchQuery(set, trimmedQuery))
      : liveReady;
  const merged = mergeSetCatalogs(local, liveMatches);

  if (merged.length) {
    return trimmedQuery ? merged.slice(0, 80) : merged;
  }

  const liveFallback = await livePromise.catch(() => [] as TcgSet[]);
  const liveFiltered = trimmedQuery
    ? liveFallback.filter((set) => setMatchesSearchQuery(set, trimmedQuery))
    : liveFallback;
  return mergeSetCatalogs(local, liveFiltered);
}

async function searchLocalizedCards(
  query: string,
  page: number,
  language: CardLanguageCode,
  itemsPerPage = LOCALIZED_SEARCH_PAGE_SIZE,
  setFilter?: string,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const cleanQuery = query.trim();
  const normalizedSetFilter = resolveLocalizedSetFilterId(language, setFilter);
  if (
    isExcludedPokemonTcgPocketSetFilter(normalizedSetFilter) ||
    isExcludedPokemonTcgPocketSetFilter(setFilter)
  ) {
    return emptyNameSearchResponse(normalizedPage, itemsPerPage);
  }
  const { collectorCode, nameQuery } = await extractSearchQueryParts(cleanQuery);
  const localizedNameAliases =
    nameQuery &&
    isLikelyEnglishCatalogQuery(nameQuery) &&
    !(language === "ja" && isSimpleNameSearchQuery(nameQuery))
      ? await fetchLocalizedPokemonNameAliases(nameQuery, language)
      : [];
  const localizedNameQueries = localizedNameSearchVariants(
    localizedNameAliases,
    nameQuery,
    language,
  );

  if (normalizedSetFilter) {
    try {
    const startIndex = (normalizedPage - 1) * itemsPerPage;
    const resultScore = cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery) ? 125 : 100;
    const matchReason =
      cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery)
        ? `English-name match in ${LANGUAGE_LABELS[language]} set`
        : cleanQuery
          ? `${LANGUAGE_LABELS[language]} set match`
          : `${LANGUAGE_LABELS[language]} set browse`;
    const setGuidePrefetch = isPriceAwareSort(sort)
      ? fetchPriceChartingSetGuideForSet({
          language,
          setCode: normalizedSetFilter,
          setName: setFilter ?? normalizedSetFilter,
        }).catch(() => null)
      : null;
    void setGuidePrefetch;
    const chineseSetResults = simplifiedChineseCatalogSearchResults({
      query: cleanQuery,
      setFilter: setFilter ?? normalizedSetFilter,
      collectorCode,
      language,
    });
    if (
      chineseSetResults.length &&
      isSimplifiedChineseCatalogSetFilter(setFilter ?? normalizedSetFilter, language)
    ) {
      const sortedChinese = applySearchResultSort(chineseSetResults, sort);
      return makeSearchResponse({
        results: sortedChinese.slice(startIndex, startIndex + itemsPerPage),
        totalCount: sortedChinese.length,
        page: normalizedPage,
        pageSize: itemsPerPage,
        hasNextPage: startIndex + itemsPerPage < sortedChinese.length,
        notice: "Loaded from the Simplified Chinese promo catalog.",
      });
    }
    const catalogSet = await fetchTcgdexLocalizedSet(language, setFilter ?? normalizedSetFilter);
    const set = catalogSet?.set;
    const englishSet = catalogSet?.englishSet ?? null;
    const englishSetName = set
      ? getLocalizedSetEnglishName(set.id, englishSet?.name)
      : undefined;
    const tcgdexCards = Array.isArray(set?.cards) ? set.cards : [];
    const supplementSet =
      language === "ja"
        ? getOfficialJapaneseSetSupplementById(normalizedSetFilter) ??
          (setFilter ? getOfficialJapaneseSetSupplementById(setFilter) : null)
        : language === "zh-cn"
          ? getSimplifiedChineseSetById(normalizedSetFilter) ??
            (setFilter ? getSimplifiedChineseSetById(setFilter) : null)
          : null;
    const shouldUseOfficialJapaneseCatalog =
      language === "ja" && tcgdexCards.length < itemsPerPage;
    const jaSetRecord =
      language === "ja"
        ? (await getSetFromDatabase(normalizedSetFilter, "ja")) ??
          (setFilter ? await getSetFromDatabase(setFilter, "ja") : null) ??
          supplementSet
        : null;
    const setMeta = set
      ? {
          setName: set.name,
          englishSetName,
          printedTotal: set.cardCount?.official,
          total: set.cardCount?.total,
        }
      : jaSetRecord
        ? {
            setName: jaSetRecord.localizedName ?? jaSetRecord.name,
            englishSetName: jaSetRecord.englishName,
            printedTotal: jaSetRecord.printedTotal,
            total: jaSetRecord.total,
          }
        : undefined;

    if (language === "ja" && (!set || shouldUseOfficialJapaneseCatalog)) {
      const officialSetCacheKey = makeOfficialJapaneseFullSetCacheKey(
        "",
        normalizedSetFilter || setFilter,
        language,
      );
      const officialSetNotice =
        "This Japanese set is loaded from the official Pokemon Card catalog because TCGdex has not published card records for it yet.";
      const officialSetCodes = [
        catalogSet?.setId,
        normalizedSetFilter,
        setFilter,
        set?.id,
        jaSetRecord?.id,
        jaSetRecord?.code,
      ].filter((value): value is string => Boolean(value?.trim()));

      const officialBrowsePageSize = Math.max(
        itemsPerPage,
        setMeta?.total ?? setMeta?.printedTotal ?? LOCALIZED_PRICE_SORT_MAX_CARDS,
      );
      const shouldUseLightweightOfficialBrowse =
        isPriceAwareSort(sort) || (!cleanQuery && !collectorCode);

      let officialBrowse = await fetchOfficialJapaneseSetCards({
        setCodes: officialSetCodes,
        setMeta,
        page: 1,
        pageSize: officialBrowsePageSize,
        cleanQuery,
        collectorCode,
        localizedNameQueries,
        lightweightCards: shouldUseLightweightOfficialBrowse,
      }).catch(() => null);

      // Resilience for sorted official browses: this path pulls the whole set
      // (many catalog pages) in one request, which can come back empty under
      // load even when the lighter relevance-style fetch succeeds. Rather than
      // surface "No cards found", retry with the smaller, proven fetch (page 1,
      // standard page size) and sort that — the same fetch the relevance sort
      // uses successfully.
      if (!officialBrowse?.cards.length) {
        officialBrowse = await fetchOfficialJapaneseSetCards({
          setCodes: officialSetCodes,
          setMeta,
          page: 1,
          pageSize: itemsPerPage,
          cleanQuery,
          collectorCode,
          localizedNameQueries,
          lightweightCards: shouldUseLightweightOfficialBrowse,
        }).catch(() => null);
      }

      if (officialBrowse?.cards.length) {
        // The official catalog only lists the base print run (no SAR/UR slots).
        // Supplement the missing secret rares from the PriceCharting set guide
        // so the browse — and especially a price-desc sort — shows the real set.
        // Full-set browses only: a query/collector search filters upstream and
        // must not have unfiltered guide rows appended to its results.
        const officialBrowseCards =
          !cleanQuery && !collectorCode
            ? await appendOfficialJapaneseSecretRaresFromSetGuide(
                officialBrowse.cards,
                setMeta,
              ).catch(() => officialBrowse!.cards)
            : officialBrowse.cards;
        // Price-sort must enrich chase cards server-side before paging. The client
        // only re-sorts the current page, so leaving everything at $0 put commons
        // on page 1 (~MYR 7) while $40+ SARs sat on later pages never fetched.
        // The set-level PriceCharting guide (applied while appending secret rares)
        // is enough when chase prints already have real prices.
        const shouldEnrichOfficialPrices = isPriceAwareSort(sort);
        const enrichedOfficialCards =
          shouldEnrichOfficialPrices && !officialJapaneseSetHasPricedChase(officialBrowseCards)
            ? await enrichOfficialJapaneseSetBrowsePrices(officialBrowseCards, {
                maxCards: OFFICIAL_JP_SET_PRICE_SORT_MAX_CARDS,
              })
            : officialBrowseCards.map(stripOfficialJapaneseCatalogFallbackPrice);
        const browseResults = enrichedOfficialCards.map((card) => ({
          card: stripOfficialJapaneseCatalogFallbackPrice(card),
          score: resultScore,
          matchReason: `${LANGUAGE_LABELS[language]} official catalog set browse`,
        }));
        const preparedBrowseResults = shouldEnrichOfficialPrices
          ? prepareSetBrowsePriceSortResults(browseResults)
          : prepareSetBrowseSortResults(browseResults);
        const fullSetResponse: LiveSearchResponse = {
          results: preparedBrowseResults,
          totalCount: preparedBrowseResults.length || officialBrowse.totalCount,
          page: 1,
          pageSize: itemsPerPage,
          hasNextPage: preparedBrowseResults.length > itemsPerPage,
          notice: officialSetNotice,
        };

        if (officialSetCacheKey) {
          setCachedSearchResult(officialSetCacheKey, fullSetResponse);
          try {
            await writePersistedSearchResult(officialSetCacheKey, fullSetResponse, {
              query: "",
              setFilter: normalizedSetFilter || setFilter,
              page: 0,
              language,
              sort: "official-full-set",
              resultCount: preparedBrowseResults.length,
            });
          } catch {
            // Best-effort full-set persistence; never block the response.
          }
        }

        const sortedResults = applySearchResultSort(preparedBrowseResults, sort);
        const pagedResults = sortedResults.slice(startIndex, startIndex + itemsPerPage);
        // Include the guide-supplemented secret rares in the count, or the last
        // page of a set browse silently drops them.
        const browseTotalCount = Math.max(
          officialBrowse.totalCount,
          preparedBrowseResults.length,
        );

        return {
          results: pagedResults,
          totalCount: browseTotalCount,
          page: normalizedPage,
          pageSize: itemsPerPage,
          hasNextPage: startIndex + itemsPerPage < browseTotalCount,
          notice: officialSetNotice,
        };
      }
    }

    if (!set) {
      if (chineseSetResults.length) {
        const sortedChinese = applySearchResultSort(chineseSetResults, sort);
        return makeSearchResponse({
          results: sortedChinese.slice(startIndex, startIndex + itemsPerPage),
          totalCount: sortedChinese.length,
          page: normalizedPage,
          pageSize: itemsPerPage,
          hasNextPage: startIndex + itemsPerPage < sortedChinese.length,
          notice: "Loaded from the Simplified Chinese promo catalog.",
        });
      }

      return makeSearchResponse({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: itemsPerPage,
        hasNextPage: false,
        notice: supplementSet
          ? `Could not load cards for ${supplementSet.localizedName ?? supplementSet.name}. The official catalog may be temporarily unavailable — try again shortly.`
          : `No ${LANGUAGE_LABELS[language]} set matched "${setFilter}". Try switching language to Japanese and selecting the set again.`,
      });
    }

    const englishBriefByLocalId = new Map(
      (englishSet?.cards ?? []).map((card) => [
        card.localId.replace(/^0+(?=\d)/, ""),
        card,
      ]),
    );
    const englishBriefById = new Map((englishSet?.cards ?? []).map((card) => [card.id, card]));
    const filteredCards = tcgdexCards.filter((card) => {
      if (!cleanQuery) {
        return true;
      }

      if (collectorCode) {
        const localId = card.localId.replace(/^0+(?=\d)/, "").toUpperCase();
        const rawId = card.localId.toUpperCase();
        const targetNumber = collectorCode.number.toUpperCase();
        const targetRaw = (collectorCode.rawNumber ?? collectorCode.number).toUpperCase();

        return (
          localId === targetNumber ||
          rawId === targetRaw ||
          rawId === targetNumber.padStart(3, "0")
        );
      }

      const englishBrief =
        englishBriefById.get(card.id) ??
        englishBriefByLocalId.get(card.localId.replace(/^0+(?=\d)/, ""));
      const searchableText = [
        card.name,
        card.localId,
        englishBrief?.name,
        set.name,
        englishSet?.name,
        englishSetName,
      ]
        .filter(Boolean)
        .join(" ");

      return (
        textMatchesQuery(searchableText, cleanQuery) ||
        localizedNameQueries.some((alias) => textMatchesQuery(card.name, alias))
      );
    });
    let results: SearchResult[];

    if (isPriceAwareSort(sort)) {
      const cacheKey = makeSetPriceSortCacheKey([
        "localized-set-price-sort",
        language,
        normalizedSetFilter,
        cleanQuery,
        sort,
      ]);
      const cached = getCachedSetPriceSort(cacheKey);

      if (cached) {
        return pageCachedSetPriceSort(cached, normalizedPage, itemsPerPage);
      }

      const priceSortBriefs = filteredCards;
      // One PriceCharting set-guide page prices the set. Per-card TCGdex details
      // used to spend the whole 4s Dex budget and then return an empty page.
      const normalizedCards = await enrichJapaneseEnglishNames(
        normalizeTcgdexSetBriefCards({
          briefs: priceSortBriefs,
          set,
          englishSet,
          language,
        }),
        { skipTcgdex: true },
      );
      let sortedResults: SearchResult[];

      try {
        sortedResults = applySearchResultSort(
          await enrichResultsForSetPriceSort(
            normalizedCards.map((card) => ({
              card,
              score: resultScore,
              matchReason,
            })),
            language,
          ),
          sort,
        );
      } catch {
        sortedResults = applySearchResultSort(
          prepareSetBrowseSortResults(
            normalizedCards.map((card) => ({
              card,
              score: resultScore,
              matchReason,
            })),
          ),
          sort,
        );
      }
      const totalCount = filteredCards.length;

      setCachedSetPriceSort(cacheKey, {
        sortedResults,
        totalCount,
        pageSize: itemsPerPage,
        notice:
          collectorCode && !filteredCards.length
            ? `No exact ${LANGUAGE_LABELS[language]} card found for ${collectorCode.number}/${collectorCode.printedTotal} in this set.`
            : undefined,
      });

      results = sortedResults.slice(startIndex, startIndex + itemsPerPage);
    } else {
      const sortedCards = sortTcgdexBriefs(filteredCards, sort);
      const pageCards = sortedCards.slice(startIndex, startIndex + itemsPerPage);
      // Resolve English names DB-only (skipTcgdex) — fast, no per-card network
      // fetch. The English name is what lets the client-side price hydration
      // look the card up in /api/price; without it the row would fall
      // back to the Japanese name and never resolve a real price.
      const normalizedCards = await enrichJapaneseEnglishNames(
        normalizeTcgdexSetBriefCards({
          briefs: pageCards,
          set,
          englishSet,
          language,
        }),
        { skipTcgdex: true },
      );
      // Render the page instantly with rarity-baseline estimates only — no live
      // PriceCharting fetches on the server. Resolving real prices for a whole
      // page server-side was slow and, under production latency, timed out and
      // fell back to estimates anyway. Instead the client hydrates each visible
      // row's real price from /api/price (cache-first catalog/API routing), so
      // the list appears
      // immediately and the accurate prices fill in. Rarity baselines (not
      // sibling/peer copying) keep the placeholder values sane.
      results = applySearchResultSort(
        prepareSetBrowsePriceSortResults(
          normalizedCards.map((card) => ({
            card,
            score: resultScore,
            matchReason,
          })),
        ),
        sort,
      );
    }

    if (collectorCode && !filteredCards.length && language === "ja") {
      const officialJapanese = isFullCollectorCode(collectorCode)
        ? await searchOfficialJapaneseCollectorCode(
            collectorCode,
            normalizedPage,
            itemsPerPage,
          ).catch(() => null)
        : await (async () => {
            const cards = await fetchOfficialJapaneseCardsByCollectorCode(
              collectorCode,
              nameQuery,
            ).catch(() => [] as TcgCard[]);
            const start = (normalizedPage - 1) * itemsPerPage;

            return makeSearchResponse({
              results: cards.slice(start, start + itemsPerPage).map((card) => ({
                card,
                score: 165,
                matchReason: `${LANGUAGE_LABELS.ja} collector #${collectorCodeDisplayLabel(collectorCode)} match`,
              })),
              totalCount: cards.length,
              page: normalizedPage,
              pageSize: itemsPerPage,
              hasNextPage: start + itemsPerPage < cards.length,
            });
          })();
      const setKey = (setFilter ?? normalizedSetFilter).trim().toUpperCase();
      const officialMatches = (officialJapanese?.results ?? []).filter((result) =>
        collectorCodeMatchesSetFilter(result.card, setKey),
      );

      if (officialMatches.length) {
        return makeSearchResponse({
          results: officialMatches,
          totalCount: officialMatches.length,
          page: normalizedPage,
          pageSize: itemsPerPage,
          hasNextPage: false,
          notice:
            "Matched this Japanese collector code from the official Pokemon Card catalog for the selected set.",
        });
      }
    }

    return {
      results,
      totalCount: filteredCards.length,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage: startIndex + itemsPerPage < filteredCards.length,
      notice:
        collectorCode && !filteredCards.length
          ? `No exact ${LANGUAGE_LABELS[language]} card found for ${collectorCodeDisplayLabel(collectorCode)} in this set.`
          : undefined,
    };
    } catch (error) {
      console.error("localized set browse failed", {
        language,
        setFilter: setFilter ?? normalizedSetFilter,
        error: describeUnknownError(error),
      });

      // Safety net: if the primary (TCGdex) path threw — a per-card detail
      // fetch timing out under a price-aware sort is the common production
      // case — fall back to the bundled official Japanese catalog seed rather
      // than surfacing "No cards found". Enrichment is skipped here so the
      // fallback can't throw again; cards keep their catalog/estimate price.
      if (language === "ja") {
        const fallbackBrowse = await fetchOfficialJapaneseSetCards({
          setCodes: [normalizedSetFilter, setFilter].filter(
            (value): value is string => Boolean(value?.trim()),
          ),
          page: 1,
          pageSize: LOCALIZED_PRICE_SORT_MAX_CARDS,
          cleanQuery,
          collectorCode,
          localizedNameQueries,
          lightweightCards: true,
        }).catch(() => null);

        if (fallbackBrowse?.cards.length) {
          const fallbackResults = applySearchResultSort(
            prepareSetBrowseSortResults(
              fallbackBrowse.cards.map((card) => ({
                card,
                score: 100,
                matchReason: `${LANGUAGE_LABELS.ja} official catalog set browse`,
              })),
            ),
            sort,
          );
          const startIndex = (normalizedPage - 1) * itemsPerPage;

          return makeSearchResponse({
            results: fallbackResults.slice(startIndex, startIndex + itemsPerPage),
            totalCount: fallbackBrowse.totalCount,
            page: normalizedPage,
            pageSize: itemsPerPage,
            hasNextPage: startIndex + itemsPerPage < fallbackBrowse.totalCount,
            notice:
              "Loaded from the official Pokemon Card catalog after the primary source was unavailable.",
          });
        }
      }

      const chineseFallback = simplifiedChineseCatalogSearchResults({
        query: cleanQuery,
        setFilter: setFilter ?? normalizedSetFilter,
        collectorCode,
        language,
      });
      if (chineseFallback.length) {
        const start = (normalizedPage - 1) * itemsPerPage;
        const sortedChinese = applySearchResultSort(chineseFallback, sort);
        return makeSearchResponse({
          results: sortedChinese.slice(start, start + itemsPerPage),
          totalCount: sortedChinese.length,
          page: normalizedPage,
          pageSize: itemsPerPage,
          hasNextPage: start + itemsPerPage < sortedChinese.length,
          notice: "Loaded from the Simplified Chinese promo catalog after the live catalog failed.",
        });
      }

      return makeSearchResponse({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: itemsPerPage,
        hasNextPage: false,
        notice: `Could not load ${LANGUAGE_LABELS[language]} set "${setFilter ?? normalizedSetFilter}". Try again or pick another set.`,
      });
    }
  }

  if (collectorCode && !normalizedSetFilter) {
    return searchLocalizedCollectorCodeResults(collectorCode, language, {
      nameQuery,
      localizedNameAliases,
      page: normalizedPage,
      pageSize: itemsPerPage,
      sort,
    });
  }

  if (cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery)) {
    const englishNameMatches = await searchLocalizedCardsByEnglishQuery(
      cleanQuery,
      normalizedPage,
      language,
      itemsPerPage,
      true,
      sort,
    );

    if (englishNameMatches.results.length) {
      return englishNameMatches;
    }
  }

  if (cleanQuery && !isLikelyEnglishCatalogQuery(cleanQuery)) {
    const englishTerms = await resolveLocalizedQueryToEnglishTerms(cleanQuery);

    for (const englishTerm of englishTerms.slice(0, 3)) {
      const englishNameMatches = await searchLocalizedCardsByEnglishQuery(
        englishTerm,
        normalizedPage,
        language,
        itemsPerPage,
        true,
        sort,
      );

      if (englishNameMatches.results.length) {
        return englishNameMatches;
      }
    }
  }

  const browseLimit = cleanQuery ? itemsPerPage : itemsPerPage;
  const baseParams = new URLSearchParams({
    "pagination:page": normalizedPage.toString(),
    "pagination:itemsPerPage": browseLimit.toString(),
  });

  const [nameMatches, idMatches] = await Promise.all([
    fetchTcgdexJson<TcgdexCardBrief[]>(
      `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards?${new URLSearchParams({
        ...Object.fromEntries(baseParams),
        ...(cleanQuery ? { name: cleanQuery } : {}),
      }).toString()}`,
    ),
    cleanQuery
      ? fetchTcgdexJson<TcgdexCardBrief[]>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards?pagination:page=1&pagination:itemsPerPage=${LOCALIZED_SEARCH_PAGE_SIZE}&localId=${encodeURIComponent(cleanQuery)}`,
        ).catch(() => [])
      : Promise.resolve([] as TcgdexCardBrief[]),
  ]);

  const uniqueBriefs = [...nameMatches, ...idMatches].filter(
    (brief, index, items) => items.findIndex((item) => item.id === brief.id) === index,
  );
  const detailedCards = await fetchTcgdexDetailCardsFromBriefs(
    uniqueBriefs.slice(0, browseLimit),
    language,
  );
  const normalizedCards = await normalizeTcgdexCardsForSearch(detailedCards, language, {
    preserveDetailedCards: true,
  });
  const pricedCards =
    language === "ja"
      ? await hydrateJapaneseTcgdexListPrices(normalizedCards)
      : normalizedCards;
  const displayCards = cleanQuery
    ? pricedCards
    : [
        ...pricedCards.filter((card) => card.imageStatus !== "placeholder"),
        ...pricedCards.filter((card) => card.imageStatus === "placeholder"),
      ].slice(0, itemsPerPage);

  const results = applySearchResultSort(
    applyEarlyMarketSearchEstimates(
      applyLocalizedSearchPriceEstimate(
        await enrichSearchResultsWithPublicPriceFallback(
          displayCards.map((card) => ({
            card,
            score: 100,
            matchReason: cleanQuery
              ? `${LANGUAGE_LABELS[language]} catalog match`
              : `${LANGUAGE_LABELS[language]} browse`,
          })),
          {
            maxCandidates: searchFallbackBudget({
              cleanQuery,
              sort,
              resultCount: displayCards.length,
            }),
          },
        ),
      ),
    ),
    sort,
  );

  const sortedResults = applySearchResultSort(
    applyEarlyMarketSearchEstimates(
      prependSearchResults(
        simplifiedChineseCatalogSearchResults({
          query: cleanQuery,
          language,
        }),
        results,
      ),
    ),
    sort,
  );

  if (!sortedResults.length && cleanQuery) {
    const learned = await buildLearnedSearchResults(cleanQuery, language);

    if (learned.length) {
      return makeSearchResponse({
        results: learned.slice(0, itemsPerPage),
        totalCount: learned.length,
        page: normalizedPage,
        pageSize: itemsPerPage,
        hasNextPage: false,
        notice:
          "Showing cards learned from prior searches while live catalogs had no match for this query.",
      });
    }
  }

  return makeSearchResponse({
    results: sortedResults,
    totalCount: null,
    page: normalizedPage,
    pageSize: itemsPerPage,
    hasNextPage: sortedResults.length === itemsPerPage,
  });
}

async function searchAllLanguageSetPriceSort(
  trimmedQuery: string,
  effectiveSetFilter: string,
  normalizedPage: number,
  sort: SearchSortOption,
): Promise<LiveSearchResponse> {
  const cacheKey = makeSetPriceSortCacheKey([
    "all-language-set-price-sort",
    effectiveSetFilter,
    trimmedQuery,
    sort,
  ]);
  const cached = getCachedSetPriceSort(cacheKey);
  if (cached) {
    return pageCachedSetPriceSort(cached, normalizedPage, SEARCH_PAGE_SIZE);
  }

  const localizedLanguages = await localizedLanguagesForSetSearch(effectiveSetFilter);
  const localizedEmpty = (): LiveSearchResponse => ({
    results: [],
    totalCount: null,
    page: 1,
    pageSize: LOCALIZED_SEARCH_PAGE_SIZE,
    hasNextPage: false,
  });
  const [englishResponse, localizedResponses] = await Promise.all([
    searchLiveCardsUncached(trimmedQuery, effectiveSetFilter, 1, "en", sort).catch(
      (): LiveSearchResponse => ({
        results: [],
        totalCount: 0,
        page: 1,
        pageSize: SEARCH_PAGE_SIZE,
        hasNextPage: false,
      }),
    ),
    localizedLanguages.length
      ? withSearchBudget(
          mapWithConcurrency(
            localizedLanguages,
            ALL_LANGUAGE_SEARCH_CONCURRENCY,
            (language) =>
              searchLocalizedCards(
                trimmedQuery,
                1,
                language,
                LOCALIZED_SEARCH_PAGE_SIZE,
                effectiveSetFilter,
                sort,
              ).catch(localizedEmpty),
          ),
          ALL_LANGUAGE_SET_PRICE_SORT_BUDGET_MS,
          [] as LiveSearchResponse[],
        )
      : Promise.resolve([] as LiveSearchResponse[]),
  ]);

  const englishResults =
    getCachedSetPriceSort(
      makeSetPriceSortCacheKey([
        "english-set-price-sort",
        effectiveSetFilter,
        trimmedQuery,
        sort,
      ]),
    )?.sortedResults ?? englishResponse.results;

  const localizedResults = localizedLanguages.flatMap((language, index) => {
    const normalizedSetFilter =
      resolveLocalizedSetFilterId(language, effectiveSetFilter) ?? effectiveSetFilter;
    return (
      getCachedSetPriceSort(
        makeSetPriceSortCacheKey([
          "localized-set-price-sort",
          language,
          normalizedSetFilter,
          trimmedQuery,
          sort,
        ]),
      )?.sortedResults ??
      localizedResponses[index]?.results ??
      []
    );
  });

  const seenSlugs = new Set<string>();
  const merged = [...englishResults, ...localizedResults]
    .filter((result) => searchResultMatchesSetFilter(result.card, effectiveSetFilter))
    .filter((result) => {
      if (seenSlugs.has(result.card.slug)) {
        return false;
      }
      seenSlugs.add(result.card.slug);
      return true;
    });

  const pricedShare =
    merged.filter((result) => result.card.marketPriceUsd > 0).length / Math.max(1, merged.length);
  const guideHydratedCards =
    pricedShare >= 0.5
      ? merged.map((result) => result.card)
      : await hydrateCardsFromPriceChartingSetGuides(
          merged.map((result) => result.card),
          { budgetMs: 800 },
        ).catch(() => merged.map((result) => result.card));
  const needsEnglishTcgdexFill = guideHydratedCards.some(
    (card) =>
      card.language === "en" &&
      !(card.marketPriceUsd > 0) &&
      collectorNumberSortValue(card.collectorNumber) >= 150,
  );
  const hydratedCards = needsEnglishTcgdexFill
    ? await fillUnpricedCardsFromTcgdexDetails(guideHydratedCards, "en", {
        budgetMs: 800,
        maxCards: SET_PRICE_SORT_TCGDEX_FILL_MAX_CARDS,
      })
    : guideHydratedCards;
  const sortedResults = applySearchResultSort(
    prepareSetBrowsePriceSortResults(withHydratedSearchResults(merged, hydratedCards)),
    sort,
  );
  const localizedExtraCount = localizedResponses.reduce(
    (sum, response) =>
      sum + (typeof response.totalCount === "number" ? response.totalCount : 0),
    0,
  );
  const totalCount = Math.max(
    sortedResults.length,
    typeof englishResponse.totalCount === "number"
      ? englishResponse.totalCount + localizedExtraCount
      : sortedResults.length,
  );

  setCachedSetPriceSort(cacheKey, {
    sortedResults,
    totalCount,
    pageSize: SEARCH_PAGE_SIZE,
    notice: "Searched English + localized catalogs for this set.",
  });

  return pageCachedSetPriceSort(
    {
      sortedResults,
      totalCount,
      pageSize: SEARCH_PAGE_SIZE,
      notice: "Searched English + localized catalogs for this set.",
    },
    normalizedPage,
    SEARCH_PAGE_SIZE,
  );
}

async function searchAllLanguageCards(
  query: string,
  setFilter: string | undefined,
  page: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  let trimmedQuery = query.trim();
  let effectiveSetFilter = setFilter;

  if (!effectiveSetFilter && trimmedQuery) {
    const setContext = await extractSetContextFromQuery(trimmedQuery, "all");

    if (setContext.setFilter) {
      effectiveSetFilter = setContext.setFilter;
      trimmedQuery = setContext.nameQuery;
    }
  }

  if (effectiveSetFilter) {
    if (isExcludedPokemonTcgPocketSetFilter(effectiveSetFilter)) {
      return emptyNameSearchResponse(normalizedPage, SEARCH_PAGE_SIZE);
    }

    if (isTrainerGallerySetFilter(effectiveSetFilter)) {
      return searchTrainerGalleryNameQuery(trimmedQuery, normalizedPage, "all", sort);
    }

    const { collectorCode: collectorCodeInSet, nameQuery: collectorNameQuery } =
      await extractSearchQueryParts(trimmedQuery);

    if (collectorCodeInSet && isFullCollectorCode(collectorCodeInSet)) {
      const collectorMatches = await searchCollectorCodeAllLanguages(
        normalizedPage,
        collectorCodeInSet,
        sort,
        { nameQuery: collectorNameQuery },
      );
      const setMatches = collectorMatches.results.filter((result) =>
        collectorCodeMatchesSetFilter(result.card, effectiveSetFilter!),
      );

      if (setMatches.length) {
        return {
          ...collectorMatches,
          results: setMatches,
          totalCount: setMatches.length,
          page: normalizedPage,
          pageSize: SEARCH_PAGE_SIZE,
          hasNextPage: false,
          notice: `Matched exact collector code ${collectorCodeLabel(collectorCodeInSet)} in ${effectiveSetFilter.toUpperCase()}.`,
        };
      }
    }

    if (isPriceAwareSort(sort)) {
      return searchAllLanguageSetPriceSort(
        trimmedQuery,
        effectiveSetFilter,
        normalizedPage,
        sort,
      );
    }

    const localizedSetPageSize = LOCALIZED_SEARCH_PAGE_SIZE;
    const localizedLanguages = await localizedLanguagesForSetSearch(effectiveSetFilter);
    const localizedEmpty = (): LiveSearchResponse => ({
      results: [],
      totalCount: null,
      page: normalizedPage,
      pageSize: localizedSetPageSize,
      hasNextPage: false,
    });
    const [englishResponse, localizedResponses] = await Promise.all([
      searchLiveCardsUncached(trimmedQuery, effectiveSetFilter, normalizedPage, "en", sort).catch(
        (): LiveSearchResponse => ({
          results: [],
          totalCount: 0,
          page: normalizedPage,
          pageSize: SEARCH_PAGE_SIZE,
          hasNextPage: false,
        }),
      ),
      localizedLanguages.length
        ? withSearchBudget(
            mapWithConcurrency(
              localizedLanguages,
              ALL_LANGUAGE_SEARCH_CONCURRENCY,
              (language) =>
                searchLocalizedCards(
                  trimmedQuery,
                  normalizedPage,
                  language,
                  localizedSetPageSize,
                  effectiveSetFilter,
                  sort,
                ).catch(localizedEmpty),
            ),
            SEARCH_LOCALIZED_PREVIEW_BUDGET_MS,
            [] as LiveSearchResponse[],
          )
        : Promise.resolve([] as LiveSearchResponse[]),
    ]);
    const seenSlugs = new Set<string>();
    const results = [
      ...englishResponse.results.slice(0, SEARCH_PAGE_SIZE),
      ...localizedResponses.flatMap((response) => response.results),
    ]
      .filter((result) => searchResultMatchesSetFilter(result.card, effectiveSetFilter!))
      .filter((result) => {
      if (seenSlugs.has(result.card.slug)) {
        return false;
      }

      seenSlugs.add(result.card.slug);
      return true;
    });

    const localizedExtraCount = localizedResponses.reduce(
      (sum, response) =>
        sum + (typeof response.totalCount === "number" ? response.totalCount : 0),
      0,
    );
    const mergedTotalCount =
      typeof englishResponse.totalCount === "number"
        ? englishResponse.totalCount + localizedExtraCount
        : null;

    return {
      results: isPriceAwareSort(sort)
        ? applySearchResultSort(results, sort)
        : applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort),
      totalCount: mergedTotalCount,
      page: normalizedPage,
      pageSize: SEARCH_PAGE_SIZE,
      hasNextPage:
        englishResponse.hasNextPage ||
        localizedResponses.some((response) => response.hasNextPage),
      notice: "Searched English + localized catalogs for this set.",
    };
  }

  const { collectorCode, nameQuery } = await extractSearchQueryParts(trimmedQuery);
  if (collectorCode) {
    if (isTrainerGalleryCollectorCode(collectorCode)) {
      return searchTrainerGalleryNumber(collectorCode, normalizedPage, sort);
    }

    const localizedNameAliases =
      nameQuery && isLikelyEnglishCatalogQuery(nameQuery)
        ? await fetchLocalizedPokemonNameAliases(nameQuery, "ja")
        : [];

    if (isFullCollectorCode(collectorCode)) {
      return searchCollectorCodeAllLanguages(normalizedPage, collectorCode, sort, {
        nameQuery,
        localizedNameAliases,
      });
    }

    return searchPartialCollectorAllLanguages(normalizedPage, collectorCode, sort, {
      nameQuery: nameQuery.trim(),
      localizedNameAliases,
    });
  }

  if (!trimmedQuery) {
    return searchLiveCardsUncached("", undefined, normalizedPage, "en", sort);
  }

  if (isLikelyEnglishCatalogQuery(trimmedQuery)) {
    return searchEnglishNameAllLanguages(trimmedQuery, normalizedPage, sort);
  }

  const localizedEnglishTerms = await resolveLocalizedQueryToEnglishTerms(trimmedQuery);

  if (localizedEnglishTerms.length) {
    const termResponses = await Promise.all(
      localizedEnglishTerms.slice(0, 4).map((term) =>
        searchEnglishNameAllLanguages(term, normalizedPage, sort),
      ),
    );

    for (const response of termResponses) {
      if (response.results.length) {
        return await mergeLearnedSearchResults(response, query, "all", sort);
      }
    }

    const learnedOnly = await buildLearnedSearchResults(trimmedQuery, "all");

    if (learnedOnly.length) {
      return {
        results: learnedOnly.slice(0, SEARCH_PAGE_SIZE),
        totalCount: learnedOnly.length,
        page: normalizedPage,
        pageSize: SEARCH_PAGE_SIZE,
        hasNextPage: false,
        notice:
          "Showing cards learned from prior searches while live catalogs had no match for this query.",
      };
    }
  }

  const [englishResponse, localizedResponses] = await Promise.all([
    searchLiveCardsUncached(query, undefined, normalizedPage, "en", sort).catch(
      (): LiveSearchResponse => ({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: SEARCH_PAGE_SIZE,
        hasNextPage: false,
      }),
    ),
    mapWithConcurrency(
      DEX_QUERY_LOCALIZED_CODES,
      ALL_LANGUAGE_SEARCH_CONCURRENCY,
      (language) =>
        searchLocalizedCards(
          query,
          normalizedPage,
          language,
          ALL_LANGUAGE_PREVIEW_PER_LANGUAGE,
          undefined,
          sort,
        ).catch(
          (): LiveSearchResponse => ({
            results: [],
            totalCount: null,
            page: normalizedPage,
            pageSize: ALL_LANGUAGE_PREVIEW_PER_LANGUAGE,
            hasNextPage: false,
          }),
        ),
    ),
  ]);

  const seenSlugs = new Set<string>();
  const results = [
    ...englishResponse.results.slice(0, SEARCH_PAGE_SIZE),
    ...localizedResponses.flatMap((response) => response.results),
  ].filter((result) => {
    if (seenSlugs.has(result.card.slug)) {
      return false;
    }

    seenSlugs.add(result.card.slug);
    return true;
  });

  const enrichedResults = await enrichSearchResultsWithPublicPriceFallback(results, {
    maxCandidates: SEARCH_PRICE_FALLBACK_MAX_RESULTS,
  });

  return {
    results: applySearchResultSort(applyEarlyMarketSearchEstimates(enrichedResults), sort),
    totalCount: null,
    page: normalizedPage,
    pageSize: enrichedResults.length,
    hasNextPage:
      englishResponse.hasNextPage ||
      localizedResponses.some((response) => response.hasNextPage),
    notice:
      "All-language search scans English plus every supported localized catalog. Regional sold-comp queries are used when catalog prices are missing.",
  };
}

async function searchLiveCardsUncached(
  query: string,
  setFilter: string | undefined,
  page: number,
  language: CardLanguageFilter,
  sort: SearchSortOption,
): Promise<LiveSearchResponse> {
  if (language === "all") {
    return searchAllLanguageCards(query, setFilter, page, sort);
  }

  let localizedQuery = query.trim();
  let effectiveSetFilter = setFilter;
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  if (!effectiveSetFilter && localizedQuery) {
    const setContext = await extractSetContextFromQuery(localizedQuery, language);

    if (setContext.setFilter) {
      effectiveSetFilter = setContext.setFilter;
      localizedQuery = setContext.nameQuery;
    }
  }

  if (isTrainerGallerySetFilter(effectiveSetFilter)) {
    return searchTrainerGalleryNameQuery(localizedQuery, normalizedPage, language, sort);
  }

  if (isExcludedPokemonTcgPocketSetFilter(effectiveSetFilter)) {
    return emptyNameSearchResponse(normalizedPage, SEARCH_PAGE_SIZE);
  }

  if (language !== "en") {
    if (!localizedQuery && !effectiveSetFilter) {
      return staticTrendingFallback(sort);
    }

    return searchLocalizedCards(
      localizedQuery,
      page,
      language,
      LOCALIZED_SEARCH_PAGE_SIZE,
      effectiveSetFilter,
      sort,
    );
  }

  const filters: string[] = [];
  const cleanQuery = localizedQuery;
  const { collectorCode, nameQuery } = await extractSearchQueryParts(cleanQuery);

  if (effectiveSetFilter) {
    const englishCatalogSetFilter =
      resolveEnglishCatalogSetFilterId(effectiveSetFilter) ?? effectiveSetFilter;
    filters.push(`set.id:${englishCatalogSetFilter.toLowerCase()}`);
  }

  if (collectorCode && !effectiveSetFilter) {
    if (isFullCollectorCode(collectorCode)) {
      const englishCollector = await searchEnglishCollectorCode(collectorCode, normalizedPage);

      if (englishCollector.results.length) {
        return englishCollector;
      }

      const localizedNameAliases =
        nameQuery && isLikelyEnglishCatalogQuery(nameQuery)
          ? await fetchLocalizedPokemonNameAliases(nameQuery, "ja")
          : [];
      const allLanguages = await searchCollectorCodeAllLanguages(
        normalizedPage,
        collectorCode,
        sort,
        { nameQuery, localizedNameAliases },
      );

      if (allLanguages.results.length) {
        return allLanguages;
      }

      const heuristic = await searchCollectorHeuristicEnglish(collectorCode, normalizedPage);
      return heuristic ?? englishCollector;
    }

    return searchEnglishPartialCollector(
      collectorCode,
      nameQuery.trim(),
      normalizedPage,
      sort,
    );
  }

  if (cleanQuery) {
    filters.push(
      collectorCode && isFullCollectorCode(collectorCode)
        ? buildCollectorNumberLuceneClause(collectorCode)
        : buildSearchQueryClause(cleanQuery),
    );
  }

  if (!cleanQuery && !effectiveSetFilter) {
    try {
      const payload = await Promise.race([
        fetchEnglishTrendingCatalog(sort),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), TRENDING_UPSTREAM_DEADLINE_MS);
        }),
      ]);
      const pricedResults = payload
        ? payload.data
            .map((card) => ({
              card: normalizeCard(card),
              score: 100,
              matchReason: "Trending & Hot",
            }))
            .filter((result) => result.card.marketPriceUsd > 0)
        : [];

      if (pricedResults.length) {
        return finalizeEnglishTrendingResults(pricedResults, sort, normalizedPage);
      }
    } catch (error) {
      logSearchDegradation("english trending catalog failed", error, {
        query: cleanQuery,
        setFilter: effectiveSetFilter,
        page: normalizedPage,
        language: "en",
        sort,
      });
    }

    return staticTrendingFallback(sort);
  }

  if (cleanQuery && !effectiveSetFilter) {
    const indexCards = await lookupCardsInIndexByName(
      cleanQuery,
      "en",
      SEARCH_PAGE_SIZE,
    ).catch(() => [] as TcgCard[]);
    const bundledCards = indexCards.length
      ? []
      : searchBundledCards({
          query: cleanQuery,
          language: "en",
          limit: SEARCH_PAGE_SIZE,
        });
    const seedCards = indexCards.length ? indexCards : bundledCards;

    if (seedCards.length) {
      return makeSearchResponse({
        results: applySearchResultSort(
          seedCards.map((card) => ({
            card,
            score: indexCards.length ? 96 : 70,
            matchReason: indexCards.length
              ? "Local catalog name match"
              : "Bundled catalog index",
          })),
          sort,
        ),
        totalCount: seedCards.length,
        page: normalizedPage,
        pageSize: SEARCH_PAGE_SIZE,
        hasNextPage: seedCards.length >= SEARCH_PAGE_SIZE,
      });
    }
  }

  const shouldSortEnglishSetLocally = Boolean(
    effectiveSetFilter && shouldMaterializeFullEnglishSet(sort),
  );
  const englishSetPriceSortCacheKey = shouldSortEnglishSetLocally
    ? makeSetPriceSortCacheKey(["english-set-price-sort", effectiveSetFilter, cleanQuery, sort])
    : "";

  if (englishSetPriceSortCacheKey) {
    const cached = getCachedSetPriceSort(englishSetPriceSortCacheKey);

    if (cached) {
      return pageCachedSetPriceSort(cached, normalizedPage, SEARCH_PAGE_SIZE);
    }
  }

  let payload: Awaited<ReturnType<typeof fetchCardSearchPage>> | null = null;
  const emptyEnglishSetResponse: LiveSearchResponse = {
    results: [],
    totalCount: 0,
    page: normalizedPage,
    pageSize: SEARCH_PAGE_SIZE,
    hasNextPage: false,
  };

  if (effectiveSetFilter) {
    const pokemonTcgSetSearch = (async (): Promise<LiveSearchResponse> => {
      let setPayload: Awaited<ReturnType<typeof fetchCardSearchPage>> | null = null;
      try {
        setPayload = await Promise.race([
          shouldSortEnglishSetLocally
            ? fetchEnglishSetCardsForPriceSort(filters)
            : fetchCardSearchPage(
                filters,
                normalizedPage,
                SEARCH_PAGE_SIZE,
                englishOrderByForSort(sort),
              ),
          new Promise<null>((resolve) => {
            setTimeout(
              () => resolve(null),
              isPriceAwareSort(sort)
                ? SET_PRICE_SORT_POKEMON_TCG_DEADLINE_MS
                : ENGLISH_SET_POKEMON_TCG_DEADLINE_MS,
            );
          }),
        ]);
      } catch {
        setPayload = null;
      }

      if (!setPayload?.data.length || !setPayload.totalCount) {
        return emptyEnglishSetResponse;
      }

      payload = setPayload;
      return finalizeEnglishSetSearchPayload({
        payload: setPayload,
        cleanQuery,
        effectiveSetFilter,
        sort,
        normalizedPage,
        shouldSortEnglishSetLocally,
        englishSetPriceSortCacheKey,
      });
    })();

    const raced = await firstSuccessfulSearch(
      [
        pokemonTcgSetSearch,
        searchEnglishSetViaTcgdexBriefs(
          effectiveSetFilter,
          cleanQuery,
          collectorCode,
          sort,
          normalizedPage,
        )
          .then((response) => response ?? emptyEnglishSetResponse)
          .catch(() => emptyEnglishSetResponse),
      ],
      Math.min(
        isPriceAwareSort(sort) ? SET_PRICE_SORT_ENGLISH_RACE_MS : ENGLISH_SET_TCGDEX_DEADLINE_MS,
        isPriceAwareSort(sort) ? SET_PRICE_SORT_ENGLISH_RACE_MS : SET_BROWSE_PRIMARY_TIMEOUT_MS - 100,
      ),
      emptyEnglishSetResponse,
    );

    if (raced.results.length) {
      return raced;
    }
  } else {
    try {
      payload = await Promise.race([
        fetchCardSearchPage(
          filters,
          normalizedPage,
          SEARCH_PAGE_SIZE,
          englishOrderByForSort(sort),
        ),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), ENGLISH_SET_POKEMON_TCG_DEADLINE_MS);
        }),
      ]);
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    throw new PokemonTcgApiError(
      "Pokemon TCG API request failed before a response was received",
      0,
      `${API_BASE_URL}/cards`,
    );
  }

  return finalizeEnglishSetSearchPayload({
    payload,
    cleanQuery,
    effectiveSetFilter,
    sort,
    normalizedPage,
    shouldSortEnglishSetLocally,
    englishSetPriceSortCacheKey,
  });
}

async function finalizeEnglishSetSearchPayload({
  payload,
  cleanQuery,
  effectiveSetFilter,
  sort,
  normalizedPage,
  shouldSortEnglishSetLocally,
  englishSetPriceSortCacheKey,
}: {
  payload: Awaited<ReturnType<typeof fetchCardSearchPage>>;
  cleanQuery: string;
  effectiveSetFilter: string | undefined;
  sort: SearchSortOption;
  normalizedPage: number;
  shouldSortEnglishSetLocally: boolean;
  englishSetPriceSortCacheKey: string;
}): Promise<LiveSearchResponse> {
  let results = dedupeSearchResultsByCardId(
    payload.data.map((card) => ({
      card: normalizeCard(card),
      score: 100,
      matchReason: cleanQuery ? "Live catalog match" : "Latest cards",
    })),
  );

  if (!results.length && effectiveSetFilter && cleanQuery) {
    const indexFallback = await buildIndexNameSetSearchResults(cleanQuery, effectiveSetFilter, "en");

    if (indexFallback.length) {
      results = indexFallback;
    }
  }

  if (isPriceAwareSort(sort)) {
    results = await enrichResultsForSetPriceSort(results, "en");
  } else if (!shouldSortEnglishSetLocally) {
    results = await enrichSearchResultsWithPublicPriceFallback(results, {
      maxCandidates: searchFallbackBudget({
        cleanQuery,
        setFilter: effectiveSetFilter,
        sort,
        resultCount: results.length,
      }),
    });
    results = applyEarlyMarketSearchEstimates(results);
  }
  results = applySearchResultSort(results, sort);
  const pagedResults = shouldSortEnglishSetLocally
    ? results.slice((normalizedPage - 1) * SEARCH_PAGE_SIZE, normalizedPage * SEARCH_PAGE_SIZE)
    : results;
  const sortableTotalCount = shouldSortEnglishSetLocally
    ? Math.max(results.length, Math.min(payload.totalCount, ENGLISH_SET_PRICE_SORT_MAX_CARDS))
    : payload.totalCount;

  if (englishSetPriceSortCacheKey) {
    setCachedSetPriceSort(englishSetPriceSortCacheKey, {
      sortedResults: results,
      totalCount: sortableTotalCount,
      pageSize: SEARCH_PAGE_SIZE,
    });
  }

  return {
    results: pagedResults,
    totalCount: sortableTotalCount,
    page: normalizedPage,
    pageSize: SEARCH_PAGE_SIZE,
    hasNextPage: normalizedPage * SEARCH_PAGE_SIZE < sortableTotalCount,
  };
}

const LOCAL_CATALOG_FALLBACK_NOTICE =
  "Live catalog is unreachable right now, so these results come from the local card index. Prices refresh as sources recover.";

function bundledCatalogFallbackResponse(
  query: string,
  setFilter: string | undefined,
  page: number,
  language: CardLanguageFilter,
  sort: SearchSortOption,
  pageSize: number,
): LiveSearchResponse | null {
  const cards = searchBundledCards({
    query,
    setFilter,
    language,
    limit: 0,
  });

  if (!cards.length) {
    return null;
  }

  const sorted = applySearchResultSort(
    cards.map((card) => ({
      card,
      score: 70,
      matchReason: "Bundled catalog index",
    })),
    sort,
  );
  const start = Math.max(0, (page - 1) * pageSize);
  const paged = sorted.slice(start, start + pageSize);

  return makeSearchResponse({
    results: paged.length ? paged : sorted.slice(0, pageSize),
    totalCount: sorted.length,
    page,
    pageSize,
    hasNextPage: start + pageSize < sorted.length,
    notice: LOCAL_CATALOG_FALLBACK_NOTICE,
  });
}

async function buildOfficialJapaneseNameSearchFallback(
  query: string,
  page: number,
  pageSize: number,
  sort: SearchSortOption,
): Promise<LiveSearchResponse | null> {
  const aliases = await findJapaneseCardNameSearchAliases(query).catch(() => [query]);
  const seed = searchOfficialJapaneseBrowseSeed({
    aliases,
    page,
    pageSize,
  });

  if (!seed.matches.length) {
    return null;
  }

  const results = seed.matches
    .map((match) => {
      const browseDetail = buildOfficialJapaneseDetailFromBrowseItem(
        match.item,
        match.setIndex,
        match.setCode,
        match.hitCnt,
      );
      return {
        card: polishJapaneseNameSearchCard(normalizeOfficialJapaneseCard(browseDetail)),
        score: 138,
        matchReason: "Official Japanese catalog match",
      };
    })
    .filter((result) => localizedCardMatchesNameQuery(result.card, query, aliases));

  if (!results.length) {
    return null;
  }

  const withEnglishNames = await withSearchBudget(
    enrichJapaneseEnglishNames(
      results.map((result) => result.card),
      { skipTcgdex: true },
    ),
    200,
    results.map((result) => result.card),
  );

  return makeSearchResponse({
    results: applySearchResultSort(
      applyEarlyMarketSearchEstimates(
        results.map((result, index) => ({
          ...result,
          card: polishJapaneseNameSearchCard(withEnglishNames[index] ?? result.card),
        })),
      ),
      sort,
    ),
    totalCount: Math.max(seed.totalCount, results.length),
    page,
    pageSize,
    hasNextPage: page * pageSize < seed.totalCount,
    notice: `Matched "${query}" against English card names and localized Pokémon names, then opened matching Japanese prints.`,
  });
}

/**
 * Offline answer for a failed live search: set browses page straight out of
 * the Supabase cards catalog, name queries fall back to the trigram index
 * (with a set) or the learning cache (without). Returns null when the local
 * catalog has nothing, so the caller can show the outage notice instead.
 */
async function buildLocalCatalogFallbackResponse(
  query: string,
  setFilter: string | undefined,
  page: number,
  language: CardLanguageFilter,
  sort: SearchSortOption,
): Promise<LiveSearchResponse | null> {
  const pageSize = language === "all" ? SEARCH_PAGE_SIZE : LOCALIZED_SEARCH_PAGE_SIZE;
  const trimmedQuery = query.trim();
  const trimmedSet = setFilter?.trim();

  if ((language === "ja" || language === "all") && trimmedQuery && !trimmedSet) {
    const officialNameFallback = await buildOfficialJapaneseNameSearchFallback(
      trimmedQuery,
      page,
      pageSize,
      sort,
    );
    if (officialNameFallback?.results.length) {
      return officialNameFallback;
    }
  }

  if (trimmedSet && trimmedQuery) {
    const results = await buildIndexNameSetSearchResults(trimmedQuery, trimmedSet, language);

    if (results.length) {
      const response = makeSearchResponse({
        results: applySearchResultSort(results, sort),
        totalCount: results.length,
        page: 1,
        pageSize,
        hasNextPage: false,
        notice: LOCAL_CATALOG_FALLBACK_NOTICE,
      });
      return overlayCachedSearchResponsePrices(response).catch(() => response);
    }
  }

  if (trimmedSet) {
    // The local fallback must sort the complete set before paging. Sorting an
    // already-paged slice reproduces the old #1..#50 result for number-desc.
    const browse = await lookupCardsInIndexBySet(
      trimmedSet,
      language,
      isEnglishSetLocalSort(sort) || isPriceAwareSort(sort)
        ? ENGLISH_SET_PRICE_SORT_MAX_CARDS
        : pageSize,
      isEnglishSetLocalSort(sort) || isPriceAwareSort(sort) ? 1 : page,
    );

    if (browse.cards.length) {
      const sorted = applySearchResultSort(
        browse.cards.map((card) => ({
          card,
          score: 80,
          matchReason: `Local catalog for ${trimmedSet.toUpperCase()}`,
        })),
        sort,
      );
      const paged =
        isEnglishSetLocalSort(sort) || isPriceAwareSort(sort)
          ? sorted.slice((page - 1) * pageSize, page * pageSize)
          : sorted;
      const response = makeSearchResponse({
        results: paged,
        totalCount: browse.totalCount,
        page,
        pageSize,
        hasNextPage: page * pageSize < browse.totalCount,
        notice: LOCAL_CATALOG_FALLBACK_NOTICE,
      });
      return overlayCachedSearchResponsePrices(response).catch(() => response);
    }

    return bundledCatalogFallbackResponse(query, setFilter, page, language, sort, pageSize);
  }

  if (trimmedQuery) {
    const { collectorCode, nameQuery } = await extractSearchQueryParts(trimmedQuery);
    if (collectorCode) {
      const collectorResults = applySearchResultSort(
        await collectorIdentitySeedResults(collectorCode, language, nameQuery),
        sort,
      );
      if (collectorResults.length) {
        const start = Math.max(0, (page - 1) * pageSize);
        const response = makeSearchResponse({
          results: collectorResults.slice(start, start + pageSize),
          totalCount: collectorResults.length,
          page,
          pageSize,
          hasNextPage: start + pageSize < collectorResults.length,
          notice: LOCAL_CATALOG_FALLBACK_NOTICE,
        });
        return overlayCachedSearchResponsePrices(response).catch(() => response);
      }
    }

    const merged = await mergeLearnedSearchResults(
      makeSearchResponse({
        results: [],
        totalCount: 0,
        page,
        pageSize,
        hasNextPage: false,
        notice: LOCAL_CATALOG_FALLBACK_NOTICE,
      }),
      query,
      language,
      sort,
    );

    if (merged.results.length) {
      return merged;
    }

    const catalogCards = await lookupCatalogCardsByFuzzyQuery(trimmedQuery, language, pageSize);

    if (catalogCards.length) {
      const response = makeSearchResponse({
        results: catalogCards.map((card) => ({
          card,
          score: 70,
          matchReason: "Local catalog fuzzy match",
        })),
        totalCount: catalogCards.length,
        page,
        pageSize,
        hasNextPage: false,
        notice: LOCAL_CATALOG_FALLBACK_NOTICE,
      });
      return overlayCachedSearchResponsePrices(response).catch(() => response);
    }

    return bundledCatalogFallbackResponse(query, setFilter, page, language, sort, pageSize);
  }

  if (isEmptyLandingSearch(query, setFilter, page)) {
    return staticTrendingFallback(sort);
  }

  return bundledCatalogFallbackResponse(query, setFilter, page, language, sort, pageSize);
}

function searchShouldHydrateJapanesePrices(language: CardLanguageFilter) {
  return language === "ja" || language === "all";
}

async function hydrateJapaneseSearchResponse(
  response: LiveSearchResponse,
  options: { maxHeadFetches?: number; budgetMs?: number } = {},
): Promise<LiveSearchResponse> {
  if (!response.results.some((result) => result.card.language === "ja")) {
    return response;
  }

  const hydrated = await hydrateJapaneseTcgdexListPrices(
    response.results.map((result) => result.card),
    {
      ...options,
      fullGuide: response.results.filter((result) => result.card.language === "ja").length <= 8,
    },
  );
  const byId = new Map(hydrated.map((card) => [card.id, card]));
  const results = expandSearchResultEditions(
    response.results.map((result) => ({
      ...result,
      card: byId.get(result.card.id) ?? result.card,
    })),
  );

  return {
    ...response,
    results,
    totalCount: Math.max(response.totalCount ?? 0, results.length),
  };
}

function hydrateSearchFinishPrices(
  response: LiveSearchResponse,
  options: { budgetMs: number; headOnly?: boolean },
): Promise<LiveSearchResponse> {
  if (!response.results.length) {
    return Promise.resolve(response);
  }

  return hydrateCardsFromPriceChartingSetGuides(
    response.results.map((result) => result.card),
    options,
  ).then((cards) => {
    const byId = new Map(cards.map((card) => [card.id, card]));
    return {
      ...response,
      results: response.results.map((result) => ({
        ...result,
        card: byId.get(result.card.id) ?? result.card,
      })),
    };
  });
}

export async function searchLiveCards(
  query: string,
  setFilter?: string,
  page = 1,
  language: CardLanguageFilter = "all",
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  if (shouldCommitStaticDexLanding({ query, setFilter, page, sort })) {
    return staticTrendingFallback(sort);
  }

  const startedAt = Date.now();
  const cacheKey = `${makeSearchResultCacheKey(query, setFilter, page, language, sort)}|editions`;
  const cachedFinal = getCachedSearchResult(cacheKey);
  if (cachedFinal?.results.length) {
    return overlayCachedSearchResponsePrices(cachedFinal, { budgetMs: 80 }).catch(
      () => cachedFinal,
    );
  }

  const unfinalized = await searchLiveCardsUnfinalized(query, setFilter, page, language, sort);
  const isSetScoped = Boolean(setFilter?.trim());
  const isCollectorQuery = Boolean(parseCollectorCodeQuery(query.trim()));
  const isNameQuery = Boolean(query.trim()) && !isSetScoped && !isCollectorQuery;
  const isLanding = isEmptyLandingSearch(query, setFilter, page);
  const remainingMs = remainingSearchBudget(startedAt, SEARCH_RESPONSE_BUDGET_MS);
  const editionized = isLanding
    ? collapseSearchResponseEditions(unfinalized)
    : expandSearchResponseEditions(unfinalized);
  let withGuides = editionized;

  // Name searches paint identities immediately. Japanese name pages then get
  // a few PriceCharting set-guide head fetches so mapped sets can show market;
  // remaining tiles lazy-load from /api/price.
  if (language === "ja" && isNameQuery) {
    withGuides = await hydrateJapaneseSearchResponse(editionized, {
      budgetMs: SEARCH_PRICE_HYDRATE_TIMEOUT_MS,
      maxHeadFetches: 12,
    }).catch(() => editionized);
  } else if (!isNameQuery && !isCollectorQuery && remainingMs > 250) {
    const pricedShare =
      unfinalized.results.filter((result) => result.card.marketPriceUsd > 0).length /
      Math.max(1, unfinalized.results.length);
    const hydrateBudget = Math.min(
      remainingMs - SEARCH_OVERLAY_BUDGET_MS,
      isSetScoped
        ? isPriceAwareSort(sort) && pricedShare >= 0.5
          ? 700
          : 1_000
        : 400,
    );
    withGuides = await hydrateSearchFinishPrices(editionized, {
      budgetMs: hydrateBudget,
      headOnly: !isSetScoped,
    }).catch(() => editionized);
  }

  const overlaid = await overlayCachedSearchResponsePrices(withGuides, {
    budgetMs: Math.min(SEARCH_OVERLAY_BUDGET_MS, remainingSearchBudget(startedAt, SEARCH_RESPONSE_BUDGET_MS)),
  }).catch(() => withGuides);
  const priced =
    sort !== "relevance" && overlaid.results.length > 1
      ? { ...overlaid, results: applySearchResultSort(overlaid.results, sort) }
      : isLanding && sort === "relevance" && overlaid.results.length > 1
        ? { ...overlaid, results: rankSearchResultsByTrending(overlaid.results) }
        : overlaid;
  if (priced.results.length) {
    setCachedSearchResult(cacheKey, priced);
  }
  return priced;
}

async function searchLiveCardsUnfinalized(
  query: string,
  setFilter?: string,
  page = 1,
  language: CardLanguageFilter = "all",
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  if (isEmptyLandingSearch(query, setFilter, normalizedPage) && language !== "en" && language !== "all") {
    return staticTrendingFallback(sort);
  }
  const cacheKey = makeSearchResultCacheKey(query, setFilter, normalizedPage, language, sort);
  const collectorQuery = parseCollectorCodeQuery(query.trim());
  if (collectorQuery && isFullCollectorCode(collectorQuery) && !setFilter?.trim()) {
    const identitySeed = await collectorIdentitySeedResults(collectorQuery, language, "");
    if (identitySeed.length) {
      const response = pageCollectorIdentityResponse(
        identitySeed,
        normalizedPage,
        language === "all" ? SEARCH_PAGE_SIZE : LOCALIZED_SEARCH_PAGE_SIZE,
        sort,
        `Matched collector code ${collectorCodeLabel(collectorQuery)} from the local catalog while live listings finish loading.`,
      );
      setCachedSearchResult(cacheKey, response);
      return response;
    }
  }

  const officialJapaneseFullSetCacheKey = makeOfficialJapaneseFullSetCacheKey(
    query,
    setFilter,
    language,
  );

  if (officialJapaneseFullSetCacheKey) {
    const cachedFullSet =
      getCachedSearchResult(officialJapaneseFullSetCacheKey) ??
      await withSearchBudget(
        readPersistedSearchResult<LiveSearchResponse>(
          officialJapaneseFullSetCacheKey,
          SEARCH_RESULT_PERSIST_TTL_MS,
        ),
        SEARCH_PERSIST_READ_BUDGET_MS,
        null,
      );

    if (cachedFullSet?.results?.length) {
      let hydratedFullSet = sanitizeLiveSearchResponsePrices(cachedFullSet);
      hydratedFullSet = await overlayCachedSearchResponsePrices(hydratedFullSet);

      // Older cached full-set snapshots predate the secret-rare supplement and
      // only hold the official catalog's base print run. Top the snapshot up
      // from the PriceCharting set guide (cheap: file-cached per set) so the
      // $300+ SAR/UR slots exist in the browse regardless of cache age.
      // Previously-injected supplements are ALWAYS rebuilt (dropped, then
      // re-appended) so snapshots that cached imageless entries or legacy
      // product-id slugs migrate to the current image + deterministic-slug form.
      const baseResults = hydratedFullSet.results.filter(
        (result) => !result.card.id.startsWith("official-pc-"),
      );
      const cachedCards = baseResults.map((result) => result.card);
      const supplementedCards = await appendOfficialJapaneseSecretRaresFromSetGuide(
        cachedCards,
      ).catch(() => null);

      if (supplementedCards && supplementedCards.length > cachedCards.length) {
        const sampleResult = hydratedFullSet.results[0];
        hydratedFullSet = {
          ...hydratedFullSet,
          results: [
            ...baseResults,
            ...supplementedCards.slice(cachedCards.length).map((card) => ({
              card,
              score: sampleResult.score,
              matchReason: "PriceCharting set guide secret-rare supplement",
            })),
          ],
          totalCount: Math.max(hydratedFullSet.totalCount ?? 0, supplementedCards.length),
        };
      }

      // Full-set cache is shared across sorts. A relevance browse often has $0
      // everywhere; price-desc must enrich chase cards before paging or page 1
      // is only commons (~$1.50 / MYR 7) while $40+ SARs sit on later pages.
      if (
        isPriceAwareSort(sort) &&
        !officialJapaneseSetHasPricedChase(hydratedFullSet.results.map((result) => result.card))
      ) {
        // Recover printed collector numbers for chase/official cards (browse
        // index ≠ printed #). Cheap when identity mappings are warm.
        const cardsWithPrinted = await hydrateOfficialJapanesePrintedCollectorNumbers(
          selectOfficialJapanesePriceSortCandidates(
            hydratedFullSet.results.map((result) => result.card),
            OFFICIAL_JP_SET_PRICE_SORT_MAX_CARDS,
          ),
        );
        const printedById = new Map(cardsWithPrinted.map((card) => [card.id, card]));
        hydratedFullSet = {
          ...hydratedFullSet,
          results: hydratedFullSet.results.map((result) => ({
            ...result,
            card: printedById.get(result.card.id) ?? result.card,
          })),
        };

        const pricedCards = hydratedFullSet.results
          .map((result) => result.card.marketPriceUsd)
          .filter((price) => price > 0);
        const pricedCount = pricedCards.length;
        const maxPriced = pricedCards.length ? Math.max(...pricedCards) : 0;
        const chaseMissingPrice = hydratedFullSet.results.some(
          (result) =>
            isOfficialJapaneseChaseIdentity(result.card) &&
            !(result.card.marketPriceUsd > 0),
        );
        // Re-enrich whenever chase prints are still $0 or the "top" price looks
        // like main-set commons only. Skipping after pricedCount>=8 left M5/M4
        // stuck with ~$2–3 page-1 ceilings while SARs never got guides.
        const needsChaseEnrichment =
          pricedCount < 8 || maxPriced < 20 || chaseMissingPrice;

        if (needsChaseEnrichment) {
          const enrichedCards = await enrichOfficialJapaneseSetBrowsePrices(
            hydratedFullSet.results.map((result) => result.card),
            { maxCards: OFFICIAL_JP_SET_PRICE_SORT_MAX_CARDS },
          );
          const byId = new Map(enrichedCards.map((card) => [card.id, card]));
          hydratedFullSet = {
            ...hydratedFullSet,
            results: prepareSetBrowsePriceSortResults(
              hydratedFullSet.results.map((result) => ({
                ...result,
                card: stripOfficialJapaneseCatalogFallbackPrice(
                  byId.get(result.card.id) ?? result.card,
                ),
              })),
            ),
          };
        }
      }

      setCachedSearchResult(officialJapaneseFullSetCacheKey, hydratedFullSet);
      return pageFullSetSearchResponse(
        hydratedFullSet,
        normalizedPage,
        LOCALIZED_SEARCH_PAGE_SIZE,
        sort,
      );
    }
  }

  const cached = officialJapaneseFullSetCacheKey ? null : getCachedSearchResult(cacheKey);

  if (cached) {
    const repairedCached = searchShouldHydrateJapanesePrices(language)
      ? await hydrateJapaneseSearchResponse(cached, { maxHeadFetches: 0 })
      : cached;
    if (searchShouldHydrateJapanesePrices(language)) {
      setCachedSearchResult(cacheKey, repairedCached);
    }
    const overlaidCached = await overlayCachedSearchResponsePrices(repairedCached);

    if (sort !== "relevance" && overlaidCached.results.length > 1) {
      const sortedCached = {
        ...overlaidCached,
        results: applySearchResultSort(overlaidCached.results, sort),
      };

      if (
        shouldReplaceWithStaticTrending({
          query,
          setFilter,
          page: normalizedPage,
          resultsLength: sortedCached.results.length,
          notice: sortedCached.notice,
        })
      ) {
        return staticTrendingFallback(sort);
      }

      return sortedCached;
    }

    if (
      shouldReplaceWithStaticTrending({
        query,
        setFilter,
        page: normalizedPage,
        resultsLength: overlaidCached.results.length,
        notice: overlaidCached.notice,
      })
    ) {
      return staticTrendingFallback(sort);
    }

    return overlaidCached;
  }

  // Persistent cold-start accelerator: a previously-gathered (or seeded) browse
  // is served from disk in ~ms instead of re-gathering live for tens of seconds.
  const persisted = officialJapaneseFullSetCacheKey
    ? null
    : await withSearchBudget(
        readPersistedSearchResult<LiveSearchResponse>(
          cacheKey,
          SEARCH_RESULT_PERSIST_TTL_MS,
        ),
        SEARCH_PERSIST_READ_BUDGET_MS,
        null,
      );

  if (persisted && persisted.results?.length) {
    let sanitizedPersisted = sanitizeLiveSearchResponsePrices(persisted);
    if (searchShouldHydrateJapanesePrices(language)) {
      sanitizedPersisted = await hydrateJapaneseSearchResponse(sanitizedPersisted, {
        maxHeadFetches: 1,
      });
    }
    sanitizedPersisted = await overlayCachedSearchResponsePrices(sanitizedPersisted);

    if (sort !== "relevance" && sanitizedPersisted.results.length > 1) {
      sanitizedPersisted = {
        ...sanitizedPersisted,
        results: applySearchResultSort(sanitizedPersisted.results, sort),
      };
    }

    setCachedSearchResult(cacheKey, sanitizedPersisted);
    return sanitizedPersisted;
  }

  const inFlight = searchResultInFlight.get(cacheKey);

  if (inFlight) {
    return inFlight;
  }

  const searchPromise = (async () => {
    const isSetBrowse = Boolean(setFilter?.trim() && !query.trim());
    const isPriceSort = sort === "price-desc" || sort === "price-asc";
    const searchStartedAt = Date.now();
    const wallMs = isSetBrowse && isPriceSort ? SET_PRICE_SORT_WALL_MS : Number.POSITIVE_INFINITY;
    const remainingWall = () => remainingSearchBudget(searchStartedAt, wallMs);
    const collectorOnlyQuery = Boolean(parseCollectorCodeQuery(query.trim()));
    const localFallbackPromise =
      language === "ja" && query.trim() && !setFilter?.trim() && !collectorOnlyQuery
        ? buildOfficialJapaneseNameSearchFallback(
            query.trim(),
            normalizedPage,
            LOCALIZED_SEARCH_PAGE_SIZE,
            sort,
          ).catch(() => null)
        : buildLocalCatalogFallbackResponse(
            query,
            setFilter,
            normalizedPage,
            language,
            sort,
          ).catch(() => null);

    try {
      const primaryTimeoutMs =
        isSetBrowse || isEmptyLandingSearch(query, setFilter, normalizedPage)
          ? isPriceSort
            ? SET_PRICE_SORT_PRIMARY_TIMEOUT_MS
            : SET_BROWSE_PRIMARY_TIMEOUT_MS
          : SEARCH_PRIMARY_TIMEOUT_MS;
      const startedAt = Date.now();
      let response = await withSearchTimeout(
        (async () => {
          const inferredSetFilter = !setFilter?.trim() && query.trim()
            ? (await extractSetContextFromQuery(query.trim(), language)).setFilter
            : undefined;

          let liveResponse = await searchLiveCardsUncached(
            query,
            setFilter,
            normalizedPage,
            language,
            sort,
          );
          const hasOfficialJapaneseHits = liveResponse.results.some(
            (result) => result.matchReason === "Official Japanese catalog match",
          );
          if (liveResponse.results.length < SEARCH_PAGE_SIZE && !hasOfficialJapaneseHits) {
            liveResponse = await withSearchBudget(
              mergeLearnedSearchResults(liveResponse, query, language, sort, {
                setFilter: setFilter ?? inferredSetFilter,
              }),
              SEARCH_LEARNED_MERGE_BUDGET_MS,
              liveResponse,
            );
          }
          liveResponse = sanitizeLiveSearchResponsePrices(liveResponse);
          liveResponse = {
            ...liveResponse,
            results: liveResponse.results.map((result) =>
              result.card.language === "ja"
                ? { ...result, card: polishJapaneseNameSearchCard(result.card) }
                : result,
            ),
          };
          const remainingMs = remainingSearchBudget(startedAt, primaryTimeoutMs);
          const isNameQuery = Boolean(query.trim()) && !setFilter?.trim();
          if (language === "ja" && !isSetBrowse && !isNameQuery && remainingMs > 200) {
            liveResponse = await hydrateJapaneseSearchResponse(liveResponse, {
              budgetMs: Math.min(SEARCH_PRICE_HYDRATE_TIMEOUT_MS, remainingMs),
              maxHeadFetches: 2,
            });
          }
          const skipLandingOverlay =
            isEmptyLandingSearch(query, setFilter, normalizedPage) &&
            liveResponse.results.every((result) => result.matchReason === "Trending & Hot");
          if (!skipLandingOverlay && !(language === "ja" && isNameQuery)) {
            liveResponse = await overlayCachedSearchResponsePrices(liveResponse, {
              budgetMs: Math.min(SEARCH_OVERLAY_BUDGET_MS, remainingSearchBudget(startedAt, primaryTimeoutMs)),
            }).catch(() => liveResponse);
          }

          if (sort === "relevance") {
            liveResponse = {
              ...liveResponse,
              results: liveResponse.results.map((result) => ({
                ...result,
                card: stripUnverifiedSearchEstimates(result.card),
              })),
            };
          }

          // Final guarantee: the visible order must match the headline price/metric
          // shown on each card. Upstream catalogs order by their own field (e.g.
          // cardmarket trendPrice) and TCGdex/Japanese results arrive in set order,
          // so re-rank the page by the same value the UI displays.
          if (sort !== "relevance" && liveResponse.results.length > 1) {
            try {
              liveResponse = {
                ...liveResponse,
                results: applySearchResultSort(
                  isPriceAwareSort(sort)
                    ? liveResponse.results
                    : applyEarlyMarketSearchEstimates(liveResponse.results),
                  sort,
                ),
              };
            } catch {
              // Keep the upstream order if the final re-rank fails.
            }
          }

          return sanitizeLiveSearchResponsePrices(liveResponse);
        })(),
        primaryTimeoutMs,
        "live search primary pipeline",
      );

      if (
        isSearchUnavailableNotice(response.notice) ||
        (!response.results.length && (query.trim() || setFilter?.trim()))
      ) {
        const fallbackBudget = Math.min(SEARCH_FALLBACK_TIMEOUT_MS, remainingWall());
        const fallback =
          fallbackBudget < 80
            ? null
            : await withSearchTimeout(
          localFallbackPromise ??
            buildLocalCatalogFallbackResponse(
              query,
              setFilter,
              normalizedPage,
              language,
              sort,
            ),
          fallbackBudget,
          "live search empty-result local fallback",
        ).catch((fallbackError) => {
          logSearchDegradation("live-search local fallback failed after empty primary response", fallbackError, {
            query,
            setFilter,
            page: normalizedPage,
            language,
            sort,
          });
          return null;
        });

        if (
          fallback &&
          !isIncompleteSetBrowseFallback({
            setFilter,
            resultCount: fallback.results.length,
            totalCount: fallback.totalCount,
            notice: fallback.notice,
          })
        ) {
          response = fallback;
        }
      }

      if (
        !response.results.length &&
        setFilter?.trim() &&
        sort !== "relevance" &&
        remainingWall() >= 200
      ) {
        const identityFallback = await withSearchTimeout(
          searchLiveCardsUncached(query, setFilter, normalizedPage, language, "relevance"),
          Math.min(SET_BROWSE_PRIMARY_TIMEOUT_MS, remainingWall()),
          "set browse identity fallback after empty sorted primary",
        ).catch(() => null);

        if (identityFallback?.results.length) {
          response = {
            ...identityFallback,
            results: applySearchResultSort(
              isPriceAwareSort(sort)
                ? identityFallback.results
                : applyEarlyMarketSearchEstimates(identityFallback.results),
              sort,
            ),
            notice:
              identityFallback.notice ??
              "Showing the full set while live prices finish loading.",
          };
        }
      }

      if (
        shouldReplaceWithStaticTrending({
          query,
          setFilter,
          page: normalizedPage,
          resultsLength: response.results.length,
          notice: response.notice,
        })
      ) {
        response = staticTrendingFallback(sort);
      }

      if (response.results.length) {
        const persistable = response.results.filter(
          (result) => !result.matchReason.startsWith("Learned"),
        );
        if (persistable.length && !isLearnedOnlySearchResponse(response)) {
          void persistSearchResultCards(
            persistable.map((result) => result.card),
            query,
          ).catch(() => undefined);
        }
      }

      if (query.trim()) {
        void import("@/lib/card-learning.server").then(({ scheduleLearningRefreshQueue }) =>
          scheduleLearningRefreshQueue(3),
        );
      }

      if (!officialJapaneseFullSetCacheKey) {
        setCachedSearchResult(cacheKey, response);
      }

      if (response.results.length && !officialJapaneseFullSetCacheKey && !isThinFallbackSearchResponse(response) && !isLearnedOnlySearchResponse(response)) {
        void writePersistedSearchResult(cacheKey, response, {
          query,
          setFilter,
          page: normalizedPage,
          language,
          sort,
          resultCount: response.results.length,
        }).catch(() => undefined);
      }

      return response;
    } catch (error) {
      logSearchDegradation("searchLiveCards failed", error, {
        query,
        setFilter,
        page: normalizedPage,
        language,
        sort,
      });

      // Upstream (api.pokemontcg.io / localized catalogs) failed or timed out.
      // Answer from the local Supabase catalog instead of an empty response so
      // the user still gets results; prices refresh lazily client-side.
      const fallback = remainingWall() < 80
        ? null
        : await withSearchTimeout(
        localFallbackPromise ??
          buildLocalCatalogFallbackResponse(
            query,
            setFilter,
            normalizedPage,
            language,
            sort,
          ),
        Math.min(SEARCH_FALLBACK_TIMEOUT_MS, remainingWall()),
        "live search local fallback",
      ).catch((fallbackError) => {
        logSearchDegradation("live search local fallback failed", fallbackError, {
          query,
          setFilter,
          page: normalizedPage,
          language,
          sort,
        });
        return null;
      });

      if (
        fallback &&
        !isIncompleteSetBrowseFallback({
          setFilter,
          resultCount: fallback.results.length,
          totalCount: fallback.totalCount,
          notice: fallback.notice,
        })
      ) {
        return fallback;
      }

      if (isEmptyLandingSearch(query, setFilter, normalizedPage)) {
        return staticTrendingFallback(sort);
      }

      if (setFilter?.trim() && sort !== "relevance" && remainingWall() >= 200) {
        const identityFallback = await withSearchTimeout(
          searchLiveCardsUncached(query, setFilter, normalizedPage, language, "relevance"),
          Math.min(SET_BROWSE_PRIMARY_TIMEOUT_MS, remainingWall()),
          "set browse identity fallback after timed-out sort",
        ).catch(() => null);

        if (identityFallback?.results.length) {
          return {
            ...identityFallback,
            results: applySearchResultSort(
              isPriceAwareSort(sort)
                ? identityFallback.results
                : applyEarlyMarketSearchEstimates(identityFallback.results),
              sort,
            ),
            notice:
              identityFallback.notice ??
              "Showing the full set while live prices finish loading.",
          };
        }
      }

      if (
        setFilter?.trim() &&
        (language === "en" || language === "all") &&
        remainingWall() >= 200
      ) {
        const tcgdxFallback = await withSearchTimeout(
          searchEnglishSetViaTcgdexBriefs(
            setFilter,
            query.trim(),
            parseCollectorCodeQuery(query.trim()),
            sort,
            normalizedPage,
          ),
          Math.min(1_500, remainingWall()),
          "english set tcgdex fallback",
        ).catch(() => null);

        if (tcgdxFallback?.results.length) {
          return tcgdxFallback;
        }
      }

      return makeSearchResponse({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: language === "all" ? SEARCH_PAGE_SIZE : LOCALIZED_SEARCH_PAGE_SIZE,
        hasNextPage: false,
        notice:
          setFilter?.trim() && isPriceAwareSort(sort)
            ? "Price sorting took too long for this set. Try again in a moment, or switch to Relevance while prices load."
            : SEARCH_UNAVAILABLE_NOTICE,
      });
    }
  })();

  searchResultInFlight.set(
    cacheKey,
    searchPromise.finally(() => {
      searchResultInFlight.delete(cacheKey);
    }),
  );

  return searchPromise;
}

async function mergeLearnedSearchResults(
  response: LiveSearchResponse,
  query: string,
  language: CardLanguageFilter,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
  options: { setFilter?: string } = {},
): Promise<LiveSearchResponse> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery || options.setFilter?.trim()) {
    return response;
  }

  const learned = await buildLearnedSearchResults(trimmedQuery, language);

  if (!learned.length) {
    return response;
  }

  const seen = new Set(response.results.map((result) => result.card.slug));
  const merged = [...response.results];

  for (const result of learned) {
    if (seen.has(result.card.slug)) {
      continue;
    }

    seen.add(result.card.slug);
    merged.push(result);
  }

  const sorted = applySearchResultSort(applyEarlyMarketSearchEstimates(merged), sort);
  const pageSize = response.pageSize || SEARCH_PAGE_SIZE;

  if (!response.results.length) {
    return {
      ...response,
      results: sorted.slice(0, pageSize),
      totalCount: sorted.length,
      notice:
        "Showing cards the database learned from prior searches. Live catalogs are still being checked in the background.",
    };
  }

  if (merged.length > response.results.length) {
    return {
      ...response,
      results: sorted.slice(0, Math.max(pageSize, sorted.length)),
      totalCount:
        typeof response.totalCount === "number"
          ? Math.max(response.totalCount, sorted.length)
          : sorted.length,
      notice:
        response.notice ??
        "Blended live catalog matches with learned community matches ranked by relevance and trust.",
    };
  }

  return response;
}

async function fetchEnglishPokemonTcgCardByIdCandidates(idCandidates: string[]) {
  for (const candidateId of idCandidates) {
    const payload = await fetchJson<PokemonTcgCardApiResponse>(
      `${API_BASE_URL}/cards?q=id:${encodeURIComponent(candidateId)}&pageSize=1`,
      { timeoutMs: ENGLISH_POKEMON_TCG_IDENTITY_TIMEOUT_MS },
    ).catch(() => null);

    if (payload?.data?.[0]) {
      return normalizeCard(payload.data[0]);
    }
  }

  return null;
}

function mergeEnglishLiveIdentityCards(
  slug: string,
  pokemonCard: TcgCard | null,
  tcgdxCard: TcgCard | null,
): TcgCard | null {
  if (pokemonCard && tcgdxCard) {
    const pokemonAttackCount = pokemonCard.attacks?.length ?? 0;
    const tcgdxAttackCount = tcgdxCard.attacks?.length ?? 0;

    return {
      ...tcgdxCard,
      ...pokemonCard,
      id: pokemonCard.id,
      slug: buildLocalizedSlug("en", pokemonCard.id),
      marketPriceUsd:
        pokemonCard.marketPriceUsd > 0 ? pokemonCard.marketPriceUsd : tcgdxCard.marketPriceUsd,
      attacks: tcgdxAttackCount > pokemonAttackCount ? tcgdxCard.attacks : pokemonCard.attacks,
      rarity:
        pokemonCard.rarity && pokemonCard.rarity !== "Unknown"
          ? pokemonCard.rarity
          : tcgdxCard.rarity,
      image: pokemonCard.image || tcgdxCard.image,
      gradedPrices:
        pokemonCard.marketPriceUsd > 0 ? pokemonCard.gradedPrices : tcgdxCard.gradedPrices,
      priceConsensus:
        pokemonCard.marketPriceUsd > 0 ? pokemonCard.priceConsensus : tcgdxCard.priceConsensus,
      sources: [...pokemonCard.sources, ...tcgdxCard.sources].filter(
        (source, index, sources) =>
          sources.findIndex((entry) => entry.source === source.source) === index,
      ),
    };
  }

  if (tcgdxCard && !pokemonCard) {
    return { ...tcgdxCard, slug };
  }

  return pokemonCard;
}

async function fetchEnglishLiveCardIdentity(slug: string, id: string): Promise<TcgCard | null> {
  const idCandidates = buildEnglishCardIdCandidates(id);
  let pokemonCard: TcgCard | null = null;
  let tcgdxCard: TcgCard | null = null;

  const pokemonPromise = fetchEnglishPokemonTcgCardByIdCandidates(idCandidates).then((card) => {
    pokemonCard = card;
    return card;
  });
  const tcgdexPromise = fetchEnglishTcgdexCardByIdCandidates(idCandidates).then((card) => {
    tcgdxCard = card;
    return card;
  });

  const firstUsable = Promise.race([
    pokemonPromise.then((card) => (card ? ("ptcg" as const) : new Promise<never>(() => {}))),
    tcgdexPromise.then((card) => (card ? ("dex" as const) : new Promise<never>(() => {}))),
  ]);

  await Promise.race([
    firstUsable,
    Promise.allSettled([pokemonPromise, tcgdexPromise]),
    new Promise<void>((resolve) => {
      setTimeout(resolve, ENGLISH_LIVE_IDENTITY_BUDGET_MS);
    }),
  ]);

  return mergeEnglishLiveIdentityCards(slug, pokemonCard, tcgdxCard);
}

export async function fetchLiveCardBySlug(
  slug: string,
  options: { includePublicPriceFallback?: boolean } = {},
): Promise<TcgCard | null> {
  const { includePublicPriceFallback = true } = options;
  const { language, id } = parseLocalizedSlug(slug);
  const { baseId, finish: slugFinish } = splitEditionCardId(id);

  if (
    isPokemonTcgPocketPrint({
      id: baseId,
      slug,
    })
  ) {
    return null;
  }

  if (language !== "en") {
    const apiLanguage = resolveTcgdexApiLanguage(language);

    if (id.startsWith("market-fallback-")) {
      return fetchCollectorMarketFallbackCardBySlug(slug, {
        includePublicPriceFallback,
      });
    }

    const chineseCatalogCard = lookupSimplifiedChineseCardBySlug(slug);
    if (chineseCatalogCard) {
      return finalizeLiveCardLookup(chineseCatalogCard, includePublicPriceFallback);
    }

    if (language === "ja" && id.startsWith("official-")) {
      const { officialCardId: cardId, finish: slugFinish } = splitOfficialJapaneseCardSlugId(id);
      const withSlugFinish = async (card: TcgCard | null) => {
        if (!card) {
          return null;
        }
        const finalized = await finalizeLiveCardLookup(card, includePublicPriceFallback);
        if (!finalized) {
          return null;
        }
        return slugFinish ? applyEditionFinish(finalized, slugFinish) : finalized;
      };

      if (!/^\d+$/.test(cardId)) {
        const tcgCard = await fetchTcgdexJson<TcgdexCardResponse>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${encodeURIComponent(cardId)}`,
        ).catch(() => null);

        if (tcgCard) {
          const [baseCard] = await normalizeTcgdexCards([tcgCard], language);
          const [normalizedCard] = await enrichJapaneseEnglishNames([baseCard]);
          return withSlugFinish(normalizedCard);
        }
      }

      const fallbackEntry = findOfficialJapaneseCollectorFallbackByCardId(cardId);
      const seedMatch = findOfficialJapaneseBrowseSeedByCardId(cardId);

      if (seedMatch && (process.env.VERCEL || process.env.VERCEL_ENV)) {
        const seedDetail = buildOfficialJapaneseDetailFromBrowseItem(
          seedMatch.item,
          seedMatch.setIndex,
          seedMatch.setCode,
          seedMatch.hitCnt,
        );
        const card = await tryEnrichOfficialJapaneseDetail(seedDetail, language);
        return withSlugFinish(card);
      }

      const detail = await fetchOfficialJapaneseCardDetail(cardId).catch(() => null);

      if (detail) {
        const card = await tryEnrichOfficialJapaneseDetail(detail, language);
        return withSlugFinish(card);
      }

      if (seedMatch) {
        const seedDetail = buildOfficialJapaneseDetailFromBrowseItem(
          seedMatch.item,
          seedMatch.setIndex,
          seedMatch.setCode,
          seedMatch.hitCnt,
        );
        const card = await tryEnrichOfficialJapaneseDetail(seedDetail, language);
        return withSlugFinish(card);
      }

      if (fallbackEntry) {
        const [label, fallback] = fallbackEntry;
        const collectorCode = parseCollectorCodeQuery(label);

        if (collectorCode) {
          const card = normalizeOfficialJapaneseCard(
            buildOfficialJapaneseFallbackDetail(collectorCode, fallback),
            fallback.englishName,
          );
          return withSlugFinish(card);
        }
      }

      return null;
    }

    try {
      const card = await fetchTcgdexJson<TcgdexCardResponse>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${id}`,
      );
      const [baseCard] = await normalizeTcgdexCards([card], language);
      const [normalizedCard] =
        language === "ja" ? await enrichJapaneseEnglishNames([baseCard]) : [baseCard];
      return finalizeLiveCardLookup(normalizedCard, includePublicPriceFallback);
    } catch {
      const indexed = await lookupCardInIndexBySlug(slug);

      if (indexed) {
        return finalizeLiveCardLookup(indexed, includePublicPriceFallback);
      }

      return null;
    }
  }

  const englishSlug = slugFinish ? baseId : slug;
  const withEnglishEdition = async (card: TcgCard | null) => {
    if (!card) {
      return null;
    }
    const finalized = await finalizeLiveCardLookup(card, includePublicPriceFallback);
    if (!finalized) {
      return null;
    }
    return slugFinish ? applyEditionFinish(finalized, slugFinish) : finalized;
  };

  const normalizedCard = await fetchEnglishLiveCardIdentity(englishSlug, baseId);

  if (!normalizedCard) {
    const indexed = await lookupCardInIndexBySlug(englishSlug);
    return withEnglishEdition(indexed);
  }

  return withEnglishEdition(normalizedCard);
}

// Build a single results page that guarantees localized cards a share of the
// slots instead of appending them after a full page of English and slicing them
// away. Localized cards are spread through the page (weighted round-robin) so
// they read as first-class results rather than a trailing afterthought.
function interleaveLocalizedSearchResults(
  englishResults: SearchResult[],
  localizedResults: SearchResult[],
  pageSize: number,
): SearchResult[] {
  if (!localizedResults.length) {
    return englishResults.slice(0, pageSize);
  }
  if (!englishResults.length) {
    return localizedResults.slice(0, pageSize);
  }

  const localizedQuota = Math.min(
    localizedResults.length,
    Math.max(1, Math.round(pageSize * ALL_LANGUAGE_LOCALIZED_PAGE_SHARE)),
  );
  const englishQuota = Math.max(0, pageSize - localizedQuota);
  const english = englishResults.slice(0, englishQuota);
  const localized = localizedResults.slice(0, localizedQuota);

  const merged: SearchResult[] = [];
  let englishTaken = 0;
  let localizedTaken = 0;

  while (englishTaken < english.length || localizedTaken < localized.length) {
    const takeEnglish =
      localizedTaken >= localized.length ||
      (englishTaken < english.length &&
        englishTaken / english.length <= localizedTaken / localized.length);

    if (takeEnglish) {
      merged.push(english[englishTaken]);
      englishTaken += 1;
    } else {
      merged.push(localized[localizedTaken]);
      localizedTaken += 1;
    }
  }

  return merged;
}

async function emptyNameSearchResponse(
  page: number,
  pageSize: number,
): Promise<LiveSearchResponse> {
  return {
    results: [],
    totalCount: 0,
    page,
    pageSize,
    hasNextPage: false,
  };
}

async function searchEnglishNameViaTcgdex(
  query: string,
  page: number,
  pageSize: number,
): Promise<LiveSearchResponse> {
  const briefs = await fetchTcgdexJson<TcgdexCardBrief[]>(
    `${TCGDEX_API_BASE_URL}/en/cards?${new URLSearchParams({
      "pagination:page": String(page),
      "pagination:itemsPerPage": String(Math.min(pageSize * 2, 48)),
      name: query,
    }).toString()}`,
    { timeoutMs: 800 },
  ).catch(() => [] as TcgdexCardBrief[]);

  const physicalBriefs = briefs.filter(
    (brief) =>
      !isPokemonTcgPocketPrint({
        id: brief.id,
        image: brief.image,
      }),
  );

  if (!physicalBriefs.length) {
    return emptyNameSearchResponse(page, pageSize);
  }

  const detailed = await fetchTcgdexDetailCardsFromBriefs(
    physicalBriefs.slice(0, pageSize),
    "en",
    {
      deadlineMs: 700,
      perCardTimeoutMs: 350,
    },
  );
  if (!detailed.length) {
    return emptyNameSearchResponse(page, pageSize);
  }

  const cards = await normalizeTcgdexCardsForSearch(detailed, "en", {
    preserveDetailedCards: true,
  });

  return makeSearchResponse({
    results: cards.map((card) => ({
      card,
      score: 110,
      matchReason: "TCGdex English catalog",
    })),
    totalCount: Math.max(cards.length, briefs.length),
    page,
    pageSize,
    hasNextPage: briefs.length >= pageSize,
  });
}

async function searchEnglishNameAllLanguages(
  query: string,
  page: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;
  const localizedPreviewSize = Math.max(4, Math.floor(pageSize / 4));
  const emptyEnglish = {
    results: [] as SearchResult[],
    totalCount: 0,
    page: normalizedPage,
    pageSize,
    hasNextPage: false,
  };
  const [englishResponse, localizedResponses] = await Promise.all([
    firstSuccessfulSearch(
      [
        searchLiveCardsUncached(query, undefined, normalizedPage, "en", sort).catch(
          () => emptyEnglish,
        ),
        searchEnglishNameViaTcgdex(query, normalizedPage, pageSize).catch(() => emptyEnglish),
      ],
      1_600,
      emptyEnglish,
    ),
    withSearchBudget(
      mapWithConcurrency(
        DEX_QUERY_LOCALIZED_CODES,
        ALL_LANGUAGE_SEARCH_CONCURRENCY,
        (language) =>
          searchLocalizedCardsByEnglishQuery(
            query,
            normalizedPage,
            language,
            localizedPreviewSize,
            false,
            sort,
            { deadlineMs: SEARCH_LOCALIZED_PREVIEW_BUDGET_MS, skipPriceHydrate: true },
          ).catch(
            (): LiveSearchResponse => ({
              results: [],
              totalCount: null,
              page: normalizedPage,
              pageSize: localizedPreviewSize,
              hasNextPage: false,
            }),
          ),
      ),
      SEARCH_LOCALIZED_PREVIEW_BUDGET_MS,
      [] as LiveSearchResponse[],
    ),
  ]);
  let resolvedEnglish = englishResponse;
  if (!resolvedEnglish.results.length) {
    const localEnglish = await withSearchBudget(
      buildLocalCatalogFallbackResponse(query, undefined, normalizedPage, "en", sort),
      SEARCH_FALLBACK_TIMEOUT_MS,
      null,
    );
    if (localEnglish?.results.length) {
      resolvedEnglish = localEnglish;
    }
  }
  const seenSlugs = new Set<string>();
  const dedupe = (result: SearchResult) => {
    if (seenSlugs.has(result.card.slug)) {
      return false;
    }

    seenSlugs.add(result.card.slug);
    return true;
  };
  const chineseResults = simplifiedChineseCatalogSearchResults({
    query,
    language: "all",
  });
  const dedupedEnglish = resolvedEnglish.results.filter(dedupe);
  const dedupedLocalized = [...chineseResults, ...localizedResponses.flatMap((response) => response.results)].filter(
    dedupe,
  );
  // Reserve part of the page for localized cards so a popular Pokemon's English
  // catalog can't crowd every Japanese/Korean/etc. result off the page.
  const merged = interleaveLocalizedSearchResults(
    dedupedEnglish,
    dedupedLocalized,
    pageSize,
  );
  const results = applySearchResultSort(
    applyEarlyMarketSearchEstimates(
      await enrichSearchResultsWithPublicPriceFallback(merged, {
        maxCandidates: SEARCH_PRICE_FALLBACK_MAX_RESULTS,
      }),
    ),
    sort,
  );

  return {
    results,
    totalCount: Math.max(results.length, resolvedEnglish.totalCount ?? 0),
    page: normalizedPage,
    pageSize,
    hasNextPage:
      resolvedEnglish.hasNextPage ||
      localizedResponses.some((response) => response.hasNextPage),
    notice:
      "All-language English-name search scans English plus every supported localized catalog. Prices use regional sold-comp queries when catalog fields are missing.",
  };
}
