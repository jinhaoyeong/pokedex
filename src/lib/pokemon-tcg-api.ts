import {
  fetchGradingMarketData,
  fetchQuickLocalizedGuidePrice,
  mergeCatalogAndLiveGradedPrices,
} from "@/lib/grading-market";
import {
  getHeadlineMarketPriceUsd,
  getLocalizedSetMarketProfile,
  resolveLocalizedSetEnglishName,
  SHARED_POKEMON_TCG_SET_IDS,
  shouldUseEnglishCompanionMarketPrice,
} from "@/lib/localized-set-market";
import {
  CARD_LANGUAGE_FILTERS,
  DEFAULT_SEARCH_SORT,
  LANGUAGE_LABELS,
  SUPPORTED_CARD_LANGUAGES,
} from "@/lib/search-constants";
import type {
  CardLanguageFilter,
  CardLanguageCode,
  LiveSearchResponse,
  SearchResult,
  SearchSortOption,
  TcgCard,
  TcgSet,
} from "@/types/pokemon";

export { CARD_LANGUAGE_FILTERS, DEFAULT_SEARCH_SORT, SUPPORTED_CARD_LANGUAGES };

const API_BASE_URL = "https://api.pokemontcg.io/v2";
const TCGDEX_API_BASE_URL = "https://api.tcgdex.net/v2";
const POKEAPI_BASE_URL = "https://pokeapi.co/api/v2";
const POKEMON_CARD_JP_BASE_URL = "https://www.pokemon-card.com";
const PUBLIC_HTML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

interface PokemonTcgSetApiResponse {
  data: Array<{
    id: string;
    name: string;
    series: string;
    releaseDate: string;
    printedTotal?: number;
    total?: number;
  }>;
}

interface PokemonTcgCardApiPriceBucket {
  low?: number;
  market?: number;
  mid?: number;
}

interface PokemonTcgCardApiResponse {
  page: number;
  pageSize: number;
  totalCount: number;
  data: Array<{
    id: string;
    name: string;
    supertype?: string;
    hp?: string;
    types?: string[];
    number: string;
    rarity?: string;
    artist?: string;
    images?: {
      small?: string;
      large?: string;
    };
    set: {
      id: string;
      name: string;
      series: string;
      releaseDate: string;
      printedTotal?: number;
      total?: number;
    };
    tcgplayer?: {
      updatedAt?: string;
      prices?: Record<string, PokemonTcgCardApiPriceBucket>;
    };
    cardmarket?: {
      updatedAt?: string;
      prices?: {
        averageSellPrice?: number;
        lowPrice?: number;
        lowPriceExPlus?: number;
        avg1?: number;
        avg7?: number;
        avg30?: number;
        trendPrice?: number;
      };
    };
  }>;
}

interface TcgdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

interface TcgdexSetBrief {
  id: string;
  name: string;
  releaseDate?: string;
  cardCount?: {
    official?: number;
    total?: number;
  };
}

interface TcgdexSetResponse {
  id: string;
  name: string;
  releaseDate?: string;
  cardCount?: {
    official?: number;
    total?: number;
  };
  serie?: {
    id: string;
    name: string;
  };
  cards?: TcgdexCardBrief[];
}

interface TcgdexCardResponse {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  illustrator?: string;
  rarity?: string;
  hp?: string | number | null;
  types?: string[];
  stage?: string;
  dexId?: number[];
  attacks?: Array<{
    cost?: string[];
    name: string;
    effect?: string;
    damage?: string | number;
  }>;
  retreat?: number | null;
  legal?: {
    standard?: boolean;
    expanded?: boolean;
  };
  variants?: Record<string, boolean>;
  set: {
    id: string;
    name: string;
    cardCount?: {
      official?: number;
      total?: number;
    };
  };
  pricing?: {
    tcgplayer?: Record<string, { market?: number; low?: number; mid?: number }>;
    cardmarket?: {
      averageSellPrice?: number;
      lowPrice?: number;
      lowPriceExPlus?: number;
      avg1?: number;
      avg7?: number;
      avg30?: number;
      trendPrice?: number;
    };
  };
  updated?: string;
}

interface TcgdexEnglishCompanion {
  name?: string;
  setName?: string;
  image?: string;
  marketPriceUsd?: number;
}

interface PokemonCardJpSearchItem {
  cardID: string;
  cardThumbFile: string;
  cardNameAltText: string;
  cardNameViewText: string;
}

interface PokemonCardJpSearchResponse {
  result: number;
  hitCnt: number;
  thisPage: number;
  maxPage: number;
  cardList: PokemonCardJpSearchItem[];
}

interface PokemonCardJpDetail {
  cardID: string;
  name: string;
  image: string;
  setCode: string;
  collectorNumber: string;
  printedTotal?: number;
  rarity: string;
  hp: string;
  types: string[];
  stage?: string;
  artist: string;
}

interface PublicUngradedPriceFallback {
  priceUsd: number;
  sampleCount: number;
  matchTier: "strict" | "loose";
  query: string;
}

interface PokeApiPokemonSpeciesResponse {
  names: Array<{
    name: string;
    language: {
      name: string;
    };
  }>;
}

function normalizeSetCode(setId: string) {
  return setId.toUpperCase();
}

const EUR_TO_USD = 1 / 0.93;
const SEARCH_PAGE_SIZE = 50;
const LOCALIZED_SEARCH_PAGE_SIZE = 50;
const ALL_LANGUAGE_PREVIEW_PER_LANGUAGE = 8;
const LIVE_CATALOG_REVALIDATE_SECONDS = 3600;
const LIVE_SET_REVALIDATE_SECONDS = 1800;
const PUBLIC_SOLD_COMP_REVALIDATE_SECONDS = 21600;
const SEARCH_SET_MEMORY_TTL_MS = LIVE_SET_REVALIDATE_SECONDS * 1000;
const LATINISH_NAME_QUERY_MAX = 256;
const POKEMON_NAME_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "card",
  "ex",
  "forme",
  "form",
  "gx",
  "mega",
  "origin",
  "pokemon",
  "radiant",
  "star",
  "tag",
  "team",
  "the",
  "v",
  "vmax",
  "vstar",
]);

const GRADED_KEYWORDS = /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|GRADED|SLAB|BLACK LABEL|PRISTINE|GEM MINT)\b/i;

type CollectorHeuristicFallback = {
  number: string;
  printedTotal: number;
  lucene: string;
  notice: string;
};

const COLLECTOR_HEURISTIC_FALLBACKS: CollectorHeuristicFallback[] = [
  {
    number: "100",
    printedTotal: 95,
    lucene: 'set.id:sm12 AND name:"Arceus & Dialga & Palkia"',
    notice:
      "Japanese Alter Genesis (SM12) lists 100/095 on the card; English Cosmic Eclipse uses the same Pok\u00e9mon TCG set id (sm12) with different card numbers. These listings are the same TAG TEAM trio\u2014pick the art that matches your copy.",
  },
];

function collectorHeuristicLookup(code: {
  number: string;
  printedTotal: number;
}): CollectorHeuristicFallback | undefined {
  return COLLECTOR_HEURISTIC_FALLBACKS.find(
    (item) => item.number === code.number && item.printedTotal === code.printedTotal,
  );
}

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

const IMPORT_MARKET_LABELS: Partial<Record<CardLanguageCode, string>> = {
  ja: "Japanese",
  ko: "Korean",
  "zh-tw": "Chinese",
  "zh-cn": "Chinese",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  "pt-br": "Portuguese",
  "pt-pt": "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  id: "Indonesian",
  th: "Thai",
};

const OFFICIAL_JP_RARITY_LABELS: Record<string, string> = {
  a: "Amazing Rare",
  ar: "Art Rare",
  c: "Common",
  chr: "Character Rare",
  csr: "Character Super Rare",
  hr: "Hyper Rare",
  k: "Amazing Rare",
  r: "Rare",
  rr: "Double Rare",
  rrr: "Triple Rare",
  sar: "Special Art Rare",
  sr: "Super Rare",
  tr: "Trainer Rare",
  u: "Uncommon",
  ur: "Ultra Rare",
};

const OFFICIAL_JP_TYPE_LABELS: Record<string, string> = {
  colorless: "Colorless",
  darkness: "Darkness",
  dragon: "Dragon",
  fairy: "Fairy",
  fighting: "Fighting",
  fire: "Fire",
  grass: "Grass",
  lightning: "Lightning",
  metal: "Metal",
  psychic: "Psychic",
  steel: "Metal",
  water: "Water",
};

const OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS: Record<
  string,
  {
    cardId: string;
    englishName?: string;
    imagePath: string;
    jpName: string;
    rarity: string;
    setCode: string;
  }
> = {
  "100/095": {
    cardId: "37382",
    englishName: "Arceus & Dialga & Palkia GX",
    imagePath: "/assets/images/card_images/large/SM12/037382_P_ARUSEUSUDEIARUGAPARUKIAGX.jpg",
    jpName: "アルセウス&ディアルガ&パルキアGX",
    rarity: "Super Rare",
    setCode: "SM12",
  },
  "017/027": {
    cardId: "31109",
    englishName: "Dialga",
    imagePath: "/assets/images/card_images/large/CP2/031109_P_DEIARUGA.jpg",
    jpName: "ディアルガ",
    rarity: "Rare Holo",
    setCode: "CP2",
  },
};

const OFFICIAL_JP_STAGE_LABELS: Record<string, string> = {
  "1進化": "Stage 1",
  "2進化": "Stage 2",
  たね: "Basic",
};

const PREFERRED_PRICE_BUCKET_ORDER = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "1stEditionHolofoil",
  "1stEditionNormal",
];

const LOCALIZED_SET_ID_ALIASES: Partial<Record<CardLanguageCode, Record<string, string>>> = {
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

const LOCALIZED_SERIES_ASSET_ALIASES: Record<string, string> = {};

function parseCollectorCodeQuery(query: string) {
  const compact = query.trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^([A-Z]*\d+[A-Z]*)\/0*(\d{1,4})(?:[A-Z]+)?$/);

  if (!match) {
    return null;
  }

  return {
    rawNumber: match[1],
    number: match[1].replace(/^0+(?=\d)/, ""),
    printedTotal: Number.parseInt(match[2], 10),
  };
}

function collectorCodeLabel(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
) {
  return `${collectorCode.rawNumber ?? collectorCode.number}/${String(collectorCode.printedTotal).padStart(3, "0")}`;
}

function collectorCodeLabelVariants(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
) {
  const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
  const paddedNumber = rawNumber.padStart(3, "0");
  const paddedTotal = String(collectorCode.printedTotal).padStart(3, "0");
  const plainTotal = String(collectorCode.printedTotal);

  return [
    collectorCodeLabel(collectorCode),
    `${rawNumber}/${paddedTotal}`,
    `${paddedNumber}/${paddedTotal}`,
    `${collectorCode.number}/${paddedTotal}`,
    `${collectorCode.number}/${plainTotal}`,
    `${paddedNumber}/${plainTotal}`,
    `${rawNumber}/${plainTotal}`,
  ];
}

function lookupOfficialJpCollectorFallback(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
) {
  for (const label of collectorCodeLabelVariants(collectorCode)) {
    const fallback = OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS[label];

    if (fallback) {
      return fallback;
    }
  }

  return null;
}

function collectorCodeMatchesSetFilter(
  card: TcgCard,
  setFilter: string,
) {
  const setKey = setFilter.trim().toUpperCase();
  const candidates = [
    card.setCode,
    card.setId,
    card.setEnglishName,
    card.setName,
    card.setLocalizedName,
  ]
    .filter(Boolean)
    .map((value) => value!.trim().toUpperCase());

  return candidates.some(
    (candidate) =>
      candidate === setKey ||
      candidate.includes(setKey) ||
      setKey.includes(candidate),
  );
}

function isLikelyEnglishCatalogQuery(query: string): boolean {
  const q = query.trim();
  if (!q || q.length > LATINISH_NAME_QUERY_MAX) {
    return false;
  }
  if (parseCollectorCodeQuery(q)) {
    return false;
  }
  return !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/.test(q);
}

function normalizeSearchText(value: string) {
  return normalizeWhitespace(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "");
}

function textMatchesQuery(text: string, query: string) {
  const normalizedText = normalizeSearchText(text);
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);

  return terms.length > 0 && terms.every((term) => normalizedText.includes(term));
}

function localizedNameSearchVariants(
  aliases: string[],
  query: string,
  language: CardLanguageCode,
) {
  const variants = new Set(aliases);

  if (language !== "ja") {
    return [...variants].slice(0, LOCALIZED_ALIAS_QUERY_LIMIT);
  }

  const normalizedQuery = normalizeSearchText(query);
  const suffixes = ["ex", "EX", "GX", "V", "VMAX", "VSTAR"];

  for (const alias of aliases.slice(0, 3)) {
    for (const suffix of suffixes) {
      variants.add(`${alias}${suffix}`);
    }

    if (normalizedQuery.includes("origin")) {
      variants.add(`オリジン${alias}`);
      variants.add(`オリジン${alias}V`);
      variants.add(`オリジン${alias}VSTAR`);
    }
  }

  return [...variants].slice(0, LOCALIZED_ALIAS_QUERY_LIMIT);
}

function pokemonSpeciesQueryTerms(query: string) {
  return [
    ...new Set(
      normalizeSearchText(query)
        .replace(/&/g, " ")
        .replace(/[^a-z0-9\s-]+/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(
          (term) =>
            term.length > 1 &&
            !POKEMON_NAME_QUERY_STOP_WORDS.has(term) &&
            !/^\d+$/.test(term),
        ),
    ),
  ].slice(0, 6);
}

async function fetchLocalizedPokemonNameAliases(
  query: string,
  language: CardLanguageCode,
) {
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

function buildLocalizedSlug(language: CardLanguageCode, id: string) {
  return language === "en" ? id : `${language}--${id}`;
}

function parseLocalizedSlug(slug: string) {
  const separatorIndex = slug.indexOf("--");

  if (separatorIndex === -1) {
    return { language: "en" as CardLanguageCode, id: slug };
  }

  const language = slug.slice(0, separatorIndex) as CardLanguageCode;
  const id = slug.slice(separatorIndex + 2);

  if (!(language in LANGUAGE_LABELS) || !id) {
    return { language: "en" as CardLanguageCode, id: slug };
  }

  return { language, id };
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

function convertCardmarketToUsd(value?: number) {
  if (typeof value !== "number" || value <= 0) {
    return null;
  }

  return value * EUR_TO_USD;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function normalizeWhitespace(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function stripHtml(value: string) {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function absolutePokemonCardJpUrl(path?: string | null) {
  if (!path) {
    return "";
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${POKEMON_CARD_JP_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Magery search pages often mix multiple numbers from the same set/name.
 * Only trust sold rows whose title clearly references this card's collector number.
 */
function classifyListingTitleMatch(title: string, card: TcgCard): "strict" | "loose" | "none" {
  const num = card.collectorNumber.trim();
  if (!num) {
    return "none";
  }

  const numBare = num.replace(/^0+(?=\d)/, "") || "0";
  const printed =
    typeof card.setPrintedTotal === "number" && card.setPrintedTotal > 0
      ? card.setPrintedTotal
      : typeof card.setTotal === "number" && card.setTotal > 0
        ? card.setTotal
        : null;

  const t = title.replace(/\s+/g, " ");

  if (printed !== null) {
    const strictRe = new RegExp(
      `\\b0*${escapeRegex(numBare)}\\s*/\\s*0*${escapeRegex(String(printed))}\\b`,
      "i",
    );
    if (strictRe.test(t)) {
      return "strict";
    }
    return "none";
  }

  const looseRe = new RegExp(
    `\\b0*${escapeRegex(numBare)}\\s*/\\s*\\d{2,4}\\b`,
    "i",
  );
  return looseRe.test(t) ? "loose" : "none";
}

function formatBilingualName(localizedName: string, englishName?: string | null) {
  const cleanLocalizedName = normalizeWhitespace(localizedName);
  const cleanEnglishName = englishName ? normalizeWhitespace(englishName) : "";

  if (
    !cleanEnglishName ||
    cleanEnglishName.toLowerCase() === cleanLocalizedName.toLowerCase()
  ) {
    return cleanLocalizedName;
  }

  return `${cleanLocalizedName} (${cleanEnglishName})`;
}

function normalizeTcgdexImageUrl(image?: string, quality: "high" | "low" = "high") {
  if (!image) {
    return null;
  }

  let cleanImage = image
    .trim()
    .replace(
      /^https:\/\/assets\.tcgdex\.net\/zh-cn\//i,
      "https://assets.tcgdex.net/zh-tw/",
    );

  if (!cleanImage) {
    return null;
  }

  if (/\.(png|webp|jpe?g)$/i.test(cleanImage)) {
    return cleanImage;
  }

  return `${cleanImage.replace(/\/$/, "")}/${quality}.webp`;
}

function getTcgdexImageStatus(image?: string, companionImage?: string) {
  if (image) {
    return "official" as const;
  }

  if (companionImage) {
    return "derived" as const;
  }

  return "placeholder" as const;
}

function getLocalizedSetEnglishName(setId: string, englishName?: string | null) {
  return resolveLocalizedSetEnglishName(setId, englishName ? normalizeWhitespace(englishName) : undefined);
}

function buildTcgdexSetAssetPath({
  language,
  setId,
  serieId,
  localId,
}: {
  language: CardLanguageCode;
  setId: string;
  serieId?: string;
  localId: string;
}) {
  if (!serieId) {
    return null;
  }

  const assetSerieId = LOCALIZED_SERIES_ASSET_ALIASES[serieId] ?? serieId;

  return `https://assets.tcgdex.net/${language}/${assetSerieId}/${setId}/${localId}`;
}

function resolveTcgdexAssetLanguage(language: CardLanguageCode): CardLanguageCode {
  if (language === "zh-cn") {
    return "zh-tw";
  }

  return language;
}

function resolveTcgdexApiLanguage(language: CardLanguageCode): CardLanguageCode {
  if (language === "pt" || language === "pt-pt") {
    return "pt-br";
  }

  if (language === "zh-cn") {
    return "zh-tw";
  }

  return language;
}

function resolveLocalizedSetFilterId(
  language: CardLanguageCode,
  setFilter?: string,
) {
  const clean = setFilter?.trim();

  if (!clean) {
    return "";
  }

  const alias = LOCALIZED_SET_ID_ALIASES[language]?.[clean.toLowerCase()];

  if (alias) {
    return alias;
  }

  if (language === "ja" && /^[a-z0-9.]+$/.test(clean) && clean === clean.toLowerCase()) {
    return clean.toUpperCase();
  }

  return clean;
}

function buildLocalizedSetIdCandidates(
  language: CardLanguageCode,
  setFilter: string,
) {
  const resolved = resolveLocalizedSetFilterId(language, setFilter);
  const candidates = new Set<string>([
    resolved,
    resolved.toUpperCase(),
    resolved.toLowerCase(),
    setFilter.trim(),
    setFilter.trim().toUpperCase(),
    setFilter.trim().toLowerCase(),
  ]);

  return [...candidates].filter(Boolean);
}

function shouldDeriveTcgdexAsset(language: CardLanguageCode, serieId?: string | null) {
  if (!serieId) {
    return false;
  }

  const assetLanguage = resolveTcgdexAssetLanguage(language);
  const assetSerieId = LOCALIZED_SERIES_ASSET_ALIASES[serieId] ?? serieId;

  if (assetLanguage === "ja") {
    return ["SV", "S", "SM", "XY", "BW", "SWSH"].includes(assetSerieId);
  }

  if (assetLanguage === "zh-tw") {
    return assetSerieId === "SV" || assetSerieId === "SM";
  }

  return false;
}

function inferTcgdexSerieIdForAssets(setId: string): string | null {
  const id = setId.trim();
  const upper = id.toUpperCase();
  if (upper.startsWith("SM")) {
    return "SM";
  }
  if (upper.startsWith("DP")) {
    return "DP";
  }
  if (upper.startsWith("PL")) {
    return "PL";
  }
  if (upper.startsWith("BW")) {
    return "BW";
  }
  if (upper.startsWith("SVD")) {
    return "SV";
  }
  if (upper.startsWith("SV")) {
    return "SV";
  }
  if (/^S\d|^S[A-Z]/.test(upper)) {
    return "S";
  }
  if (/^M\d|^M[A-Z]/.test(upper)) {
    return "M";
  }
  if (/^swsh/i.test(id) || upper.startsWith("SWSH")) {
    return "SWSH";
  }
  if (upper.startsWith("XY")) {
    return "XY";
  }
  return null;
}

function tryDeriveLocalizedTcgdexAsset(
  card: TcgdexCardResponse,
  language: CardLanguageCode,
): string | undefined {
  if (language === "en" || card.image) {
    return undefined;
  }
  const serieId = inferTcgdexSerieIdForAssets(card.set.id);
  if (!shouldDeriveTcgdexAsset(language, serieId)) {
    return undefined;
  }
  return (
    buildTcgdexSetAssetPath({
      language: resolveTcgdexAssetLanguage(language),
      setId: card.set.id,
      serieId: serieId ?? undefined,
      localId: card.localId,
    }) ?? undefined
  );
}

function mergeTcgdexBriefIntoDetail(
  card: TcgdexCardResponse,
  brief?: TcgdexCardBrief,
  set?: TcgdexSetResponse | null,
  language?: CardLanguageCode,
): TcgdexCardResponse {
  const serieId = set?.serie?.id;
  const derivedImage =
    !card.image && set && language && shouldDeriveTcgdexAsset(language, serieId)
      ? buildTcgdexSetAssetPath({
          language: resolveTcgdexAssetLanguage(language),
          setId: set.id,
          serieId: serieId ?? undefined,
          localId: card.localId,
        })
      : undefined;
  const image = card.image ?? brief?.image ?? derivedImage ?? undefined;

  return {
    ...card,
    image,
    set: {
      ...card.set,
      cardCount: card.set.cardCount ?? set?.cardCount,
      name: card.set.name || set?.name || card.set.id,
    },
  };
}

function getSetIdFromTcgdexCardId(cardId: string, localId?: string) {
  if (localId && cardId.endsWith(`-${localId}`)) {
    return cardId.slice(0, -(localId.length + 1));
  }

  const separatorIndex = cardId.lastIndexOf("-");
  return separatorIndex > 0 ? cardId.slice(0, separatorIndex) : "";
}

async function fetchLocalizedCardFromEnglishBrief(
  brief: TcgdexCardBrief,
  language: CardLanguageCode,
): Promise<TcgdexCardResponse | null> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const direct = await fetchTcgdexJson<TcgdexCardResponse>(
    `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
  ).catch(() => null);

  if (direct) {
    return direct;
  }

  const setId = getSetIdFromTcgdexCardId(brief.id, brief.localId);

  if (!setId) {
    return null;
  }

  const localizedSet = await fetchTcgdexJson<TcgdexSetResponse>(
    `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets/${encodeURIComponent(setId)}`,
  ).catch(() => null);
  const localizedBrief = localizedSet?.cards?.find(
    (card) => card.localId.replace(/^0+(?=\d)/, "") === brief.localId.replace(/^0+(?=\d)/, ""),
  );

  if (!localizedBrief) {
    return null;
  }

  return fetchTcgdexJson<TcgdexCardResponse>(
    `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${localizedBrief.id}`,
  )
    .then((card) => mergeTcgdexBriefIntoDetail(card, localizedBrief, localizedSet, language))
    .catch(() => null);
}

function getTcgdexCardImage({
  card,
  language,
  companion,
  derivedAssetBase,
}: {
  card: TcgdexCardResponse;
  language: CardLanguageCode;
  companion: TcgdexEnglishCompanion;
  derivedAssetBase?: string | null;
}) {
  const officialImage = normalizeTcgdexImageUrl(card.image ?? derivedAssetBase ?? undefined);

  if (officialImage) {
    return officialImage;
  }

  const companionImage = normalizeTcgdexImageUrl(companion.image);

  if (companionImage) {
    return companionImage;
  }

  return "/icon.svg";
}

function parseUsd(value: string) {
  return Number.parseFloat(value.replace(/[^0-9.]/g, ""));
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
  const tcgMarketPrices = priceBuckets.map((bucket) => positivePrice(bucket.market));
  const allCatalogPrices = [
    ...priceBuckets.flatMap((bucket) => [
      positivePrice(bucket.market),
      positivePrice(bucket.mid),
      positivePrice(bucket.low),
    ]),
    convertCardmarketToUsd(card.cardmarket?.prices?.trendPrice),
    convertCardmarketToUsd(card.cardmarket?.prices?.avg7),
    convertCardmarketToUsd(card.cardmarket?.prices?.avg30),
    convertCardmarketToUsd(card.cardmarket?.prices?.avg1),
    convertCardmarketToUsd(card.cardmarket?.prices?.averageSellPrice),
    convertCardmarketToUsd(card.cardmarket?.prices?.lowPriceExPlus),
    convertCardmarketToUsd(card.cardmarket?.prices?.lowPrice),
  ];
  const robustCatalogPrice = robustPrice(allCatalogPrices);

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

function getTcgdexMarketPrice(card: TcgdexCardResponse) {
  const tcgplayerBuckets = Object.values(card.pricing?.tcgplayer ?? {});
  const tcgMarketPrices = tcgplayerBuckets.map((bucket) => positivePrice(bucket.market));
  const cardmarket = card.pricing?.cardmarket;
  const robustCatalogPrice = robustPrice([
    ...tcgplayerBuckets.flatMap((bucket) => [
      positivePrice(bucket.market),
      positivePrice(bucket.mid),
      positivePrice(bucket.low),
    ]),
    convertCardmarketToUsd(cardmarket?.trendPrice),
    convertCardmarketToUsd(cardmarket?.avg7),
    convertCardmarketToUsd(cardmarket?.avg30),
    convertCardmarketToUsd(cardmarket?.avg1),
    convertCardmarketToUsd(cardmarket?.averageSellPrice),
    convertCardmarketToUsd(cardmarket?.lowPriceExPlus),
    convertCardmarketToUsd(cardmarket?.lowPrice),
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

function buildPublicUngradedPriceQueries(card: TcgCard) {
  const rarityBit =
    card.rarity && card.rarity !== "Unknown" ? ` ${card.rarity}` : "";
  const lookupName =
    card.language !== "en" && card.englishName?.trim()
      ? card.englishName.trim()
      : card.name;
  const lookupSetName =
    card.language !== "en" && card.setEnglishName?.trim()
      ? card.setEnglishName.trim()
      : card.setName;
  const printedTotal =
    typeof card.setPrintedTotal === "number" && card.setPrintedTotal > 0
      ? card.setPrintedTotal
      : typeof card.setTotal === "number" && card.setTotal > 0
        ? card.setTotal
        : null;
  const collectorCode = printedTotal
    ? `${card.collectorNumber}/${String(printedTotal).padStart(3, "0")}`
    : `#${card.collectorNumber}`;

  const importLabel = IMPORT_MARKET_LABELS[card.language];
  const regionalQueries = importLabel
    ? [
        `Pokemon ${importLabel} ${lookupName} ${card.setCode} ${collectorCode} ${lookupSetName}${rarityBit}`,
        `Pokemon ${importLabel} ${card.setCode} ${collectorCode}`,
        `Pokemon ${importLabel} ${lookupName} ${collectorCode}`,
        `Pokemon ${importLabel} ${lookupName} ${collectorCode} ${lookupSetName}`,
      ]
    : [];

  return [
    ...regionalQueries,
    `Pokemon ${lookupName} ${collectorCode} ${lookupSetName}${rarityBit}`,
    `Pokemon ${lookupName} ${card.setCode} ${collectorCode}`,
    `Pokemon ${lookupName} ${collectorCode}`,
    `Pokemon ${lookupSetName} ${card.collectorNumber} ${lookupName}`,
  ].filter((query, index, queries) => query.trim() && queries.indexOf(query) === index);
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit & { next?: { revalidate?: number } } = {},
  timeoutMs = PUBLIC_PRICE_FALLBACK_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMageryUngradedPriceForQuery(
  query: string,
  card: TcgCard,
): Promise<PublicUngradedPriceFallback | null> {
  const html = await fetchTextWithTimeout(
    `https://magery.com/w?q=${encodeURIComponent(query)}`,
    {
      headers: PUBLIC_HTML_HEADERS,
      next: { revalidate: PUBLIC_SOLD_COMP_REVALIDATE_SECONDS },
    },
  );

  if (!html) {
    return null;
  }

  const saleRegex =
    /data-item-id="[^"]+"[\s\S]*?<div class="card-title"[^>]*><a href="[^"]+">([\s\S]*?)<\/a><\/div>[\s\S]*?<span class="card-status status-sold">Sold<\/span>[\s\S]*?<div class="card-price sold">\$([^<]+)<\/div>/g;

  const strictPrices: number[] = [];
  const loosePrices: number[] = [];

  for (const match of html.matchAll(saleRegex)) {
    const title = normalizeWhitespace(match[1]);

    if (GRADED_KEYWORDS.test(title)) {
      continue;
    }

    const tier = classifyListingTitleMatch(title, card);
    if (tier === "none") {
      continue;
    }

    const price = parseUsd(match[2]);

    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }

    if (tier === "strict") {
      strictPrices.push(price);
    } else {
      loosePrices.push(price);
    }
  }

  const pool =
    strictPrices.length > 0
      ? strictPrices
      : loosePrices.length >= 2
        ? loosePrices
        : [];

  if (!pool.length) {
    return null;
  }

  const sorted = [...pool].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const priceUsd =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    priceUsd,
    sampleCount: pool.length,
    matchTier: strictPrices.length > 0 ? "strict" : "loose",
    query,
  };
}

function pickBestPublicUngradedFallback(pool: PublicUngradedPriceFallback[]) {
  return [...pool].sort((left, right) => {
    const sampleDelta = (right.sampleCount ?? 0) - (left.sampleCount ?? 0);
    if (sampleDelta !== 0) {
      return sampleDelta;
    }

    return right.priceUsd - left.priceUsd;
  })[0];
}

async function fetchPublicUngradedPriceFallback(
  card: TcgCard,
): Promise<PublicUngradedPriceFallback | null> {
  const queries = buildPublicUngradedPriceQueries(card);
  const strictOutcomes: PublicUngradedPriceFallback[] = [];
  const looseOutcomes: PublicUngradedPriceFallback[] = [];

  for (let index = 0; index < queries.length; index += MAGERY_QUERY_BATCH_SIZE) {
    const batch = queries.slice(index, index + MAGERY_QUERY_BATCH_SIZE);
    const outcomes = await Promise.all(
      batch.map((query) => fetchMageryUngradedPriceForQuery(query, card)),
    );

    for (const outcome of outcomes) {
      if (!outcome) {
        continue;
      }

      if (outcome.matchTier === "strict") {
        strictOutcomes.push(outcome);
      } else {
        looseOutcomes.push(outcome);
      }
    }

    const multiSampleStrict = strictOutcomes.filter((outcome) => (outcome.sampleCount ?? 0) >= 2);
    if (multiSampleStrict.length) {
      return pickBestPublicUngradedFallback(multiSampleStrict);
    }
  }

  if (strictOutcomes.length) {
    const bestStrict = pickBestPublicUngradedFallback(strictOutcomes);
    const bestLoose = looseOutcomes.length ? pickBestPublicUngradedFallback(looseOutcomes) : null;

    if (
      bestLoose &&
      (bestLoose.sampleCount ?? 0) >= 2 &&
      bestStrict.priceUsd < bestLoose.priceUsd * 0.45
    ) {
      return bestLoose;
    }

    return bestStrict;
  }

  return looseOutcomes.length ? pickBestPublicUngradedFallback(looseOutcomes) : null;
}

function applyRarityEstimateFloor(card: TcgCard): TcgCard {
  if (card.marketPriceUsd > 0) {
    return card;
  }

  const estimate = cardAdjustedEstimate(card, rarityBaselinePrice(card), "wide");

  if (!(estimate > 0)) {
    return card;
  }

  return {
    ...card,
    marketPriceUsd: estimate,
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: estimate,
            source: "Card-adjusted rarity estimate",
            confidence: "low" as const,
            confidenceScore: 0.26,
            warning:
              "No public price was exposed for this print; this is a low-confidence estimate from rarity and card identity.",
          }
        : price,
    ),
    priceConsensus: card.priceConsensus ?? {
      finalEstimateUsd: estimate,
      confidence: "low",
      confidenceScore: 0.26,
      sourceCount: 1,
      sampleCount: 0,
      methodology:
        "Low-confidence estimate from rarity and card identity because no public price fields were available for this print.",
      sources: [
        {
          source: "Rarity estimate",
          value: estimate,
          confidence: "low",
          confidenceScore: 0.26,
          evidenceType: "catalog",
          note: "Fallback estimate so localized prints do not display a zero market value.",
        },
      ],
    },
  };
}

async function applyPublicPriceFallback(card: TcgCard): Promise<TcgCard> {
  try {
    const fallback = await fetchPublicUngradedPriceFallback(card);
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
      const rarityFloor = applyRarityEstimateFloor(card);
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
    return await enrichLocalizedSearchGuidePrice(applyRarityEstimateFloor(card));
  }
}

function isRarityDerivedMarketPrice(card: TcgCard) {
  const ungraded = card.gradedPrices.find((price) => price.grade === "Ungraded");

  if (ungraded?.source?.toLowerCase().includes("rarity")) {
    return true;
  }

  if (ungraded?.source === "Early market estimate") {
    return true;
  }

  if (card.priceConsensus?.sources?.some((source) => source.source === "Rarity estimate")) {
    return true;
  }

  if (card.priceConsensus?.sources?.some((source) => source.source === "Early market estimate")) {
    return true;
  }

  return card.sources.some(
    (source) =>
      source.source === "Localized search group estimate" ||
      source.source === "Early market estimate",
  );
}

function isLowConfidenceSearchMarketPrice(card: TcgCard) {
  if (isRarityDerivedMarketPrice(card)) {
    return true;
  }

  return (
    card.priceConsensus?.confidence === "low" &&
    (card.priceConsensus.confidenceScore ?? 1) < 0.4
  );
}

async function enrichLocalizedSearchGuidePrice(card: TcgCard): Promise<TcgCard> {
  if (card.language === "en" || !getLocalizedSetMarketProfile(card.setCode)) {
    return card;
  }

  const headline = getHeadlineMarketPriceUsd(card);
  if (headline >= 40 && !isRarityDerivedMarketPrice(card)) {
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
    const [guide, marketData] = await Promise.all([
      fetchQuickLocalizedGuidePrice(
        lookupSetName,
        lookupCardName,
        card.collectorNumber,
        card.setPrintedTotal ?? card.setTotal,
        lookupOptions,
      ),
      Promise.race([
        fetchGradingMarketData(
          lookupSetName,
          lookupCardName,
          card.collectorNumber,
          0,
          card.setPrintedTotal ?? card.setTotal,
          card.rarity,
          lookupOptions,
        ),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 30_000);
        }),
      ]),
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

    if (!(nextPrice > headline * 1.05)) {
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

const JAPANESE_CARD_NAME_OVERRIDES: Record<string, string> = {
  "なみのりピカチュウV": "Surfing Pikachu V",
  "なみのりピカチュウVMAX": "Surfing Pikachu VMAX",
  "そらをとぶピカチュウV": "Flying Pikachu V",
  "そらをとぶピカチュウVMAX": "Flying Pikachu VMAX",
  "ピカチュウV-UNION": "Pikachu V-UNION",
  "博士の研究": "Professor's Research",
  "基本草エネルギー": "Grass Energy [Holo]",
  "基本炎エネルギー": "Fire Energy [Holo]",
  "基本水エネルギー": "Water Energy [Holo]",
  "基本雷エネルギー": "Lightning Energy [Holo]",
  "基本超エネルギー": "Psychic Energy [Holo]",
  "基本闘エネルギー": "Fighting Energy [Holo]",
  "基本悪エネルギー": "Darkness Energy [Holo]",
  "基本鋼エネルギー": "Metal Energy [Holo]",
};

const OFFICIAL_JP_SET_BROWSE_PRICE_CONCURRENCY = 6;
const JAPANESE_SPECIES_MAP_CONCURRENCY = 30;

let japaneseSpeciesEnglishMapPromise: Promise<Map<string, string>> | null = null;
const japaneseCardEnglishNameCache = new Map<string, string | undefined>();

function parseJapaneseCardNameSuffix(jpName: string): { base: string; englishSuffix: string } {
  const trimmed = jpName.trim();
  const rules: Array<[RegExp, string]> = [
    [/^(.*)V-UNION$/i, " V-UNION"],
    [/^(.*)VMAX$/i, " VMAX"],
    [/^(.*)VSTAR$/i, " VSTAR"],
    [/^(.*)GX$/i, " GX"],
    [/^(.*)ex$/i, " ex"],
    [/^(.*)V$/i, " V"],
  ];

  for (const [pattern, englishSuffix] of rules) {
    const match = trimmed.match(pattern);

    if (match?.[1]) {
      return { base: match[1], englishSuffix };
    }
  }

  return { base: trimmed, englishSuffix: "" };
}

async function buildJapaneseSpeciesEnglishMap(): Promise<Map<string, string>> {
  const list = await fetchPokeApiJson<{
    results: Array<{ url: string }>;
  }>(`${POKEAPI_BASE_URL}/pokemon-species?limit=2000`);
  const map = new Map<string, string>();

  await mapWithConcurrency(list.results, JAPANESE_SPECIES_MAP_CONCURRENCY, async (item) => {
    const species = await fetchPokeApiJson<PokeApiPokemonSpeciesResponse>(item.url).catch(() => null);

    if (!species) {
      return;
    }

    const englishName = species.names.find((entry) => entry.language.name === "en")?.name;

    if (!englishName) {
      return;
    }

    for (const entry of species.names) {
      if (entry.language.name === "ja") {
        map.set(entry.name, englishName);
      }
    }
  });

  return map;
}

function getJapaneseSpeciesEnglishMap(): Promise<Map<string, string>> {
  if (!japaneseSpeciesEnglishMapPromise) {
    japaneseSpeciesEnglishMapPromise = buildJapaneseSpeciesEnglishMap().catch((error) => {
      japaneseSpeciesEnglishMapPromise = null;
      throw error;
    });
  }

  return japaneseSpeciesEnglishMapPromise;
}

async function resolveJapaneseCardEnglishName(jpName: string): Promise<string | undefined> {
  const trimmed = jpName.trim();

  if (!trimmed) {
    return undefined;
  }

  if (japaneseCardEnglishNameCache.has(trimmed)) {
    return japaneseCardEnglishNameCache.get(trimmed);
  }

  const override = JAPANESE_CARD_NAME_OVERRIDES[trimmed];

  if (override) {
    japaneseCardEnglishNameCache.set(trimmed, override);
    return override;
  }

  const { base, englishSuffix } = parseJapaneseCardNameSuffix(trimmed);
  const baseOverride = JAPANESE_CARD_NAME_OVERRIDES[base];

  if (baseOverride) {
    const resolved = `${baseOverride}${englishSuffix}`;
    japaneseCardEnglishNameCache.set(trimmed, resolved);
    return resolved;
  }

  try {
    const speciesMap = await getJapaneseSpeciesEnglishMap();
    const englishBase = speciesMap.get(base);

    if (englishBase) {
      const resolved = `${englishBase}${englishSuffix}`;
      japaneseCardEnglishNameCache.set(trimmed, resolved);
      return resolved;
    }
  } catch {
    // Fall through to undefined.
  }

  japaneseCardEnglishNameCache.set(trimmed, undefined);
  return undefined;
}

async function fetchOfficialJapaneseGuidePrice(
  card: TcgCard,
  englishName: string,
): Promise<Awaited<ReturnType<typeof fetchQuickLocalizedGuidePrice>>> {
  const profile = getLocalizedSetMarketProfile(card.setCode);

  if (!profile) {
    return null;
  }

  const lookupOptions = {
    setCode: card.setCode,
    isJapanese: true,
    language: card.language,
    englishCardName: englishName,
  };
  const setTotal = card.setPrintedTotal ?? card.setTotal;
  const withNumber = await fetchQuickLocalizedGuidePrice(
    profile.englishName,
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
      profile.englishName,
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

async function enrichOfficialJapaneseSetBrowsePrices(cards: TcgCard[]): Promise<TcgCard[]> {
  const candidates = cards.filter(
    (card) =>
      card.language === "ja" &&
      Boolean(getLocalizedSetMarketProfile(card.setCode)) &&
      (card.marketPriceUsd <= 0 ||
        isRarityDerivedMarketPrice(card) ||
        isLowConfidenceSearchMarketPrice(card)),
  );

  if (!candidates.length) {
    return cards;
  }

  const uniqueJpNames = [
    ...new Set(candidates.map((card) => card.localizedName ?? card.name).filter(Boolean)),
  ];

  await mapWithConcurrency(uniqueJpNames, 8, async (jpName) => {
    await resolveJapaneseCardEnglishName(jpName);
  });

  const enrichedById = new Map<string, TcgCard>();

  await mapWithConcurrency(
    candidates,
    OFFICIAL_JP_SET_BROWSE_PRICE_CONCURRENCY,
    async (card) => {
      const jpName = card.localizedName ?? card.name;
      const englishName = card.englishName ?? (await resolveJapaneseCardEnglishName(jpName));

      if (!englishName) {
        enrichedById.set(card.id, card);
        return;
      }

      try {
        const guide = await fetchOfficialJapaneseGuidePrice(card, englishName);

        if (guide?.ungradedUsd) {
          enrichedById.set(card.id, applyOfficialJapaneseGuidePrice(card, englishName, guide));
          return;
        }

        enrichedById.set(card.id, {
          ...card,
          englishName,
          name: formatBilingualName(jpName, englishName),
        });
      } catch {
        enrichedById.set(card.id, {
          ...card,
          englishName,
          name: formatBilingualName(jpName, englishName),
        });
      }
    },
  );

  return cards.map((card) => enrichedById.get(card.id) ?? card);
}

/** Magery fallback is slow; cap parallelism to avoid hammering the public endpoint. */
const SEARCH_PRICE_FALLBACK_CONCURRENCY = 4;
const SEARCH_PRICE_FALLBACK_MAX_RESULTS = 6;
const SEARCH_PRICE_FALLBACK_MAX_SET_RESULTS = 8;
const SEARCH_RESULT_CACHE_TTL_MS = 15 * 60 * 1000;
const LOCALIZED_ALIAS_QUERY_LIMIT = 10;
const LOCALIZED_ALIAS_BRIEF_LIMIT = 56;
const ALL_LANGUAGE_SEARCH_CONCURRENCY = 4;
const PUBLIC_PRICE_FALLBACK_TIMEOUT_MS = 8000;
const MAGERY_QUERY_BATCH_SIZE = 2;
const ENGLISH_SET_PRICE_SORT_PAGE_SIZE = 250;
const ENGLISH_SET_PRICE_SORT_MAX_CARDS = 750;
const LOCALIZED_PRICE_SORT_MAX_CARDS = 300;
const SET_PRICE_SORT_CACHE_TTL_MS = 5 * 60 * 1000;

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

function makeSearchResultCacheKey(
  query: string,
  setFilter: string | undefined,
  page: number,
  language: CardLanguageFilter,
  sort: SearchSortOption,
) {
  return [
    query.trim().toLowerCase(),
    (setFilter ?? "").trim().toLowerCase(),
    page,
    language,
    sort,
  ].join("|");
}

function getCachedSearchResult(cacheKey: string) {
  const cached = searchResultCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) {
      searchResultCache.delete(cacheKey);
    }

    return null;
  }

  return structuredClone(cached.value);
}

function setCachedSearchResult(cacheKey: string, value: LiveSearchResponse) {
  if (!value.results.length) {
    return;
  }

  searchResultCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_RESULT_CACHE_TTL_MS,
    value: structuredClone(value),
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

function isPriceAwareSort(sort: SearchSortOption) {
  return (
    sort === "price-desc" ||
    sort === "price-asc" ||
    sort === "change-desc" ||
    sort === "change-asc"
  );
}

function makeSetPriceSortCacheKey(parts: Array<string | number | undefined>) {
  return parts.map((part) => String(part ?? "").trim().toLowerCase()).join("::");
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

  return applyRarityEstimateFloor(card);
}

async function enrichSearchResultsWithPublicPriceFallback(
  results: SearchResult[],
  options: { maxCandidates?: number } = {},
): Promise<SearchResult[]> {
  const maxCandidates = options.maxCandidates ?? SEARCH_PRICE_FALLBACK_MAX_RESULTS;

  if (maxCandidates <= 0) {
    return results;
  }

  const indices: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].card.marketPriceUsd <= 0) {
      indices.push(i);
      if (indices.length >= maxCandidates) {
        break;
      }
    }
  }

  if (!indices.length) {
    return results;
  }

  const next = results.slice();

  for (const idx of indices) {
    next[idx] = { ...next[idx], card: applySearchCardPriceSnapshot(results[idx].card) };
  }

  return next;
}

async function fetchEnglishSetCardsForPriceSort(filters: string[]) {
  const firstPayload = await fetchCardSearchPage(
    filters,
    1,
    ENGLISH_SET_PRICE_SORT_PAGE_SIZE,
    "number",
  );
  const totalToFetch = Math.min(firstPayload.totalCount, ENGLISH_SET_PRICE_SORT_MAX_CARDS);
  const totalPages = Math.max(1, Math.ceil(totalToFetch / ENGLISH_SET_PRICE_SORT_PAGE_SIZE));

  if (totalPages <= 1) {
    return firstPayload;
  }

  const pagePayloads = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      fetchCardSearchPage(
        filters,
        index + 2,
        ENGLISH_SET_PRICE_SORT_PAGE_SIZE,
        "number",
      ).catch(() => null),
    ),
  );
  const data = [
    ...firstPayload.data,
    ...pagePayloads.flatMap((payload) => payload?.data ?? []),
  ].slice(0, totalToFetch);

  return {
    ...firstPayload,
    data,
    page: 1,
    pageSize: data.length,
  };
}

function applyLocalizedSearchPriceEstimate(results: SearchResult[]): SearchResult[] {
  const priceGroups = new Map<string, number[]>();

  for (const result of results) {
    if (!(result.card.marketPriceUsd > 0)) {
      continue;
    }

    const key = [
      result.card.setCode,
      normalizeSearchText(result.card.localizedName ?? result.card.name),
      result.card.rarity,
    ].join("|");
    priceGroups.set(key, [...(priceGroups.get(key) ?? []), result.card.marketPriceUsd]);
  }

  return results.map((result) => {
    if (result.card.marketPriceUsd > 0) {
      return result;
    }

    const key = [
      result.card.setCode,
      normalizeSearchText(result.card.localizedName ?? result.card.name),
      result.card.rarity,
    ].join("|");
    const pricedValues = priceGroups.get(key) ?? [];
    const groupEstimate = pricedValues.length >= 2
      ? cardAdjustedEstimate(result.card, robustPrice(pricedValues), "narrow")
      : 0;

    if (!(groupEstimate > 0)) {
      return result;
    }

    const card = {
      ...result.card,
      marketPriceUsd: groupEstimate,
      priceHistory: result.card.priceHistory.map((point) => ({
        ...point,
        value: point.value > 0 ? point.value : groupEstimate,
      })),
      gradedPrices: result.card.gradedPrices.map((price) =>
        price.grade === "Ungraded"
          ? {
              ...price,
              value: groupEstimate,
              source: "Estimated from matching localized search results",
              confidence: "low" as const,
              warning:
                "No direct catalog or sold-comp price was available for this print; estimated from nearby matching localized results.",
            }
          : price,
      ),
      priceConsensus: {
        ...result.card.priceConsensus,
        finalEstimateUsd: groupEstimate,
        confidence: "low" as const,
        confidenceScore: 0.34,
        sourceCount: Math.max(1, result.card.priceConsensus?.sourceCount ?? 0),
        sampleCount: Math.max(pricedValues.length, result.card.priceConsensus?.sampleCount ?? 0),
        methodology:
          "Estimated from priced cards in the same localized search result group because this print has no direct public price fields.",
        sources: [
          ...(result.card.priceConsensus?.sources ?? []),
          {
            source: "Localized search group estimate",
            value: groupEstimate,
            confidence: "low" as const,
            confidenceScore: 0.34,
            evidenceType: "catalog" as const,
            note:
              "Fallback estimate from sibling localized search results with card-level adjustment. Use direct sold comps when available.",
          },
        ],
      },
      sources: [
        ...result.card.sources,
        {
          source: "Localized search group estimate",
          status: "estimated" as const,
          fetchedAt: new Date().toISOString(),
          confidence: 0.34,
          note:
            "No direct price was exposed for this print, so the search list used a card-adjusted median estimate from priced matching localized cards.",
        },
      ],
    };

    return { ...result, card };
  });
}

function rarityBaselinePrice(card: TcgCard) {
  const rarityText = `${card.rarity} ${card.name}`;
  return EARLY_MARKET_RARITY_BASELINES_USD.find(([pattern]) => pattern.test(rarityText))?.[1] ?? 0.18;
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

function applyEarlyMarketSearchEstimates(results: SearchResult[]): SearchResult[] {
  const setPrices = new Map<string, number[]>();
  const setRarityPrices = new Map<string, number[]>();

  for (const result of results) {
    if (!(result.card.marketPriceUsd > 0)) {
      continue;
    }

    const setKey = result.card.setCode.toLowerCase();
    const rarityKey = `${setKey}|${normalizeSearchText(result.card.rarity)}`;
    setPrices.set(setKey, [...(setPrices.get(setKey) ?? []), result.card.marketPriceUsd]);
    setRarityPrices.set(rarityKey, [
      ...(setRarityPrices.get(rarityKey) ?? []),
      result.card.marketPriceUsd,
    ]);
  }

  return results.map((result) => {
    if (result.card.marketPriceUsd > 0) {
      return result;
    }

    const setKey = result.card.setCode.toLowerCase();
    const rarityKey = `${setKey}|${normalizeSearchText(result.card.rarity)}`;
    const rarityPeers = setRarityPrices.get(rarityKey) ?? [];
    const setPeers = setPrices.get(setKey) ?? [];
    const estimateBase =
      rarityPeers.length >= 2
        ? robustPrice(rarityPeers)
        : setPeers.length >= 4
          ? Math.max(0.1, robustPrice(setPeers) * 0.55)
          : rarityBaselinePrice(result.card);
    const estimatedPrice = cardAdjustedEstimate(
      result.card,
      estimateBase,
      rarityPeers.length >= 2 || setPeers.length >= 4 ? "narrow" : "wide",
    );

    if (!(estimatedPrice > 0)) {
      return result;
    }

    const card: TcgCard = {
      ...result.card,
      marketPriceUsd: estimatedPrice,
      priceHistory: result.card.priceHistory.map((point) => ({
        ...point,
        value: point.value > 0 ? point.value : estimatedPrice,
        isProjected: point.value <= 0 ? true : point.isProjected,
      })),
      gradedPrices: result.card.gradedPrices.map((price) =>
        price.grade === "Ungraded"
          ? {
              ...price,
              value: estimatedPrice,
              source: "Early market estimate",
              confidence: "low" as const,
              confidenceScore: 0.28,
              warning:
                "No live public price was exposed yet for this new print; this is a low-confidence launch-window estimate.",
            }
          : price,
      ),
      priceConsensus: {
        ...result.card.priceConsensus,
        finalEstimateUsd: estimatedPrice,
        confidence: "low",
        confidenceScore: 0.28,
        sourceCount: Math.max(1, result.card.priceConsensus?.sourceCount ?? 0),
        sampleCount: result.card.priceConsensus?.sampleCount ?? 0,
        methodology:
          "Card-adjusted early market estimate used because public catalog and sold-comp sources have not exposed a usable price for this new print yet.",
        sources: [
          ...(result.card.priceConsensus?.sources ?? []),
          {
            source: "Early market estimate",
            value: estimatedPrice,
            confidence: "low" as const,
            confidenceScore: 0.28,
            evidenceType: "catalog" as const,
            note:
              "Temporary card-adjusted estimate from same-set pricing where available, otherwise from rarity, collector number, and card identity signals until live prices arrive.",
          },
        ],
      },
      sources: [
        ...result.card.sources,
        {
          source: "Early market estimate",
          status: "estimated" as const,
          fetchedAt: new Date().toISOString(),
          confidence: 0.28,
          note:
            "No live market price was available yet; search uses a low-confidence card-adjusted estimate so sorting and display remain usable without flattening every card to one price.",
        },
      ],
    };

    return { ...result, card };
  });
}

function buildSearchQueryClause(cleanQuery: string) {
  const escapedQuery = cleanQuery.replace(/"/g, '\\"');
  const queryClauses = [
    `name:"*${escapedQuery}*"`,
    `number:"${escapedQuery}"`,
    `set.name:"*${escapedQuery}*"`,
    `artist:"*${escapedQuery}*"`,
  ];
  const collectorBase = cleanQuery.split("/")[0]?.trim();

  if (collectorBase && collectorBase !== cleanQuery) {
    const escapedCollectorBase = collectorBase.replace(/"/g, '\\"');
    queryClauses.push(`number:"${escapedCollectorBase}"`);
  }

  return `(${queryClauses.join(" OR ")})`;
}

function normalizeCard(card: PokemonTcgCardApiResponse["data"][number]): TcgCard {
  const marketPriceUsd = getUsdMarketPrice(card);
  const fetchedAt =
    card.tcgplayer?.updatedAt ?? card.cardmarket?.updatedAt ?? new Date().toISOString();

  return {
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
  };
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
  return {
    results,
    totalCount,
    page,
    pageSize,
    hasNextPage,
    notice,
  };
}

function currentSearchPrice(card: TcgCard) {
  return card.marketPriceUsd > 0 ? card.marketPriceUsd : 0;
}

function currentSearchPriceForAscending(card: TcgCard) {
  return card.marketPriceUsd > 0 ? card.marketPriceUsd : Number.POSITIVE_INFINITY;
}

function searchPriceChange(card: TcgCard) {
  const values = card.priceHistory
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length < 2) {
    return 0;
  }

  return values[values.length - 1] - values[0];
}

function collectorNumberSortValue(value: string) {
  const match = value.trim().match(/\d+/);

  return match ? Number.parseInt(match[0], 10) : 0;
}

function compareSearchResultText(left: SearchResult, right: SearchResult) {
  return left.card.name.localeCompare(right.card.name);
}

function applySearchResultSort(
  results: SearchResult[],
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
) {
  if (sort === "relevance") {
    return results;
  }

  const next = results.slice();

  next.sort((left, right) => {
    switch (sort) {
      case "price-desc":
        return (
          currentSearchPrice(right.card) -
            currentSearchPrice(left.card) ||
          compareSearchResultText(left, right)
        );
      case "price-asc":
        return (
          currentSearchPriceForAscending(left.card) -
            currentSearchPriceForAscending(right.card) ||
          compareSearchResultText(left, right)
        );
      case "change-desc":
        return (
          searchPriceChange(right.card) -
            searchPriceChange(left.card) ||
          compareSearchResultText(left, right)
        );
      case "change-asc":
        return (
          searchPriceChange(left.card) -
            searchPriceChange(right.card) ||
          compareSearchResultText(left, right)
        );
      case "number-desc":
        return (
          collectorNumberSortValue(right.card.collectorNumber) -
            collectorNumberSortValue(left.card.collectorNumber) ||
          compareSearchResultText(left, right)
        );
      case "number-asc":
        return (
          collectorNumberSortValue(left.card.collectorNumber) -
            collectorNumberSortValue(right.card.collectorNumber) ||
          compareSearchResultText(left, right)
        );
      default:
        return 0;
    }
  });

  return next;
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

async function fetchTcgdexDetailCardsFromBriefs(
  briefs: TcgdexCardBrief[],
  language: CardLanguageCode,
) {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const detailConcurrency = 14;
  const detailed: TcgdexCardResponse[] = [];

  for (let i = 0; i < briefs.length; i += detailConcurrency) {
    const chunk = briefs.slice(i, i + detailConcurrency);
    detailed.push(
      ...(await Promise.all(
        chunk.map((brief) =>
          fetchTcgdexJson<TcgdexCardResponse>(
            `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
          )
            .then((card) => mergeTcgdexBriefIntoDetail(card, brief, null, language))
            .catch(() => null),
        ),
      )).filter((card): card is TcgdexCardResponse => Boolean(card)),
    );
  }

  return detailed;
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
    case "number-desc":
      return "-number";
    case "number-asc":
      return "number";
    default:
      return "-cardmarket.prices.trendPrice";
  }
}

function normalizeTcgdexCard(
  card: TcgdexCardResponse,
  language: CardLanguageCode,
  companion: TcgdexEnglishCompanion = {},
): TcgCard {
  const localizedMarketPriceUsd = getTcgdexMarketPrice(card);
  const companionPriceUsd = companion.marketPriceUsd ?? 0;
  const usingCompanionPrice =
    shouldUseEnglishCompanionMarketPrice(language, card.set.id, localizedMarketPriceUsd) &&
    companionPriceUsd > 0;
  const marketPriceUsd =
    localizedMarketPriceUsd > 0
      ? localizedMarketPriceUsd
      : usingCompanionPrice
        ? companionPriceUsd
        : 0;
  const fetchedAt = card.updated ?? new Date().toISOString();
  const localizedName = card.name;
  const englishName = companion.name;
  const localizedSetName = card.set.name;
  const englishSetName = getLocalizedSetEnglishName(card.set.id, companion.setName);
  const derivedAssetBase = tryDeriveLocalizedTcgdexAsset(card, language);
  const effectiveImageSource = card.image ?? derivedAssetBase;
  const imageStatus = getTcgdexImageStatus(
    effectiveImageSource,
    companion.image,
  );

  return {
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
    image: getTcgdexCardImage({ card, language, companion, derivedAssetBase }),
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
      confidence: usingCompanionPrice ? "low" : "medium",
      confidenceScore: usingCompanionPrice ? 0.38 : 0.58,
      sourceCount: marketPriceUsd > 0 ? 1 : 0,
      sampleCount: 0,
      methodology: usingCompanionPrice
        ? "English print catalog estimate used because the localized catalog had no price fields. Sold-comp enrichment may replace this."
        : "Catalog-only estimate. Multilingual releases can diverge until live sold comps and grading-market sources are merged.",
      sources:
        marketPriceUsd > 0
          ? [
              {
                source: `TCGdex ${LANGUAGE_LABELS[language]} catalog`,
                value: marketPriceUsd,
                confidence: usingCompanionPrice ? "low" : "medium",
                confidenceScore: localizedMarketPriceUsd > 0 ? 0.58 : 0.38,
                evidenceType: "catalog",
                note:
                  localizedMarketPriceUsd > 0
                    ? "Localized catalog estimate derived from public marketplace fields mirrored through TCGdex."
                    : "Estimated from the English companion print because the localized catalog did not expose price fields.",
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
  };
}

async function fetchJson<T>(
  url: string,
  options: { revalidate?: number } = {},
): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: options.revalidate ?? LIVE_CATALOG_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Pokemon TCG API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchTcgdexJson<T>(
  url: string,
  options: { revalidate?: number } = {},
): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: options.revalidate ?? LIVE_CATALOG_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`TCGdex request failed: ${response.status}`);
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

async function fetchPokemonCardJpSearchPage(
  keyword: string,
  page: number,
): Promise<PokemonCardJpSearchResponse | null> {
  const params = new URLSearchParams({
    keyword,
    regulation_sidebar_form: "all",
    pg: "",
    illust: "",
    sm_and_keyword: "true",
    page: String(page),
  });
  const response = await fetch(
    `${POKEMON_CARD_JP_BASE_URL}/card-search/resultAPI.php?${params.toString()}`,
    {
      headers: PUBLIC_HTML_HEADERS,
      next: { revalidate: 86400 },
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as PokemonCardJpSearchResponse;
  return payload.result === 1 ? payload : null;
}

async function fetchOfficialJapaneseSetBrowsePage(
  setCode: string,
  page: number,
): Promise<PokemonCardJpSearchResponse | null> {
  const params = new URLSearchParams({
    keyword: "",
    regulation_sidebar_form: "all",
    pg: setCode,
    illust: "",
    sm_and_keyword: "true",
    page: String(page),
  });
  const response = await fetch(
    `${POKEMON_CARD_JP_BASE_URL}/card-search/resultAPI.php?${params.toString()}`,
    {
      headers: PUBLIC_HTML_HEADERS,
      next: { revalidate: 86400 },
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as PokemonCardJpSearchResponse;
  return payload.result === 1 && payload.cardList?.length ? payload : null;
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
  const inferred = await inferLocalizedSetIdFromEnglishCatalog(language, setFilter).catch(
    () => null,
  );

  if (inferred) {
    candidates.unshift(inferred);
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function fetchTcgdexLocalizedSet(
  language: CardLanguageCode,
  setFilter: string,
): Promise<{ set: TcgdexSetResponse; englishSet: TcgdexSetResponse | null; setId: string } | null> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const candidates = await resolveLocalizedSetIdCandidates(language, setFilter);

  for (const candidate of candidates) {
    try {
      const [set, englishSet] = await Promise.all([
        fetchTcgdexJson<TcgdexSetResponse>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets/${encodeURIComponent(candidate)}`,
        ),
        fetchTcgdexJson<TcgdexSetResponse>(
          `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(candidate)}`,
        ).catch(() => null),
      ]);

      if (set?.id) {
        return { set, englishSet, setId: set.id };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function padTcgdexLocalId(localId: string) {
  const bare = localId.replace(/^0+(?=\d)/, "");
  return bare.length >= 3 ? bare.padStart(3, "0") : bare;
}

function officialJapaneseCollectorCodeKey(detail: PokemonCardJpDetail) {
  if (!(typeof detail.printedTotal === "number" && detail.printedTotal > 0)) {
    return null;
  }

  const number = detail.collectorNumber.replace(/^0+(?=\d)/, "") || detail.collectorNumber;
  return `${number}/${String(detail.printedTotal).padStart(3, "0")}`;
}

function resolveOfficialJapaneseEnglishName(detail: PokemonCardJpDetail): string | undefined {
  const override = JAPANESE_CARD_NAME_OVERRIDES[detail.name.trim()];

  if (override) {
    return override;
  }

  const collectorKey = officialJapaneseCollectorCodeKey(detail);
  const collectorFallback = collectorKey
    ? OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS[collectorKey]
    : undefined;

  if (collectorFallback?.englishName && collectorFallback.cardId === detail.cardID) {
    return collectorFallback.englishName;
  }

  for (const fallback of Object.values(OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS)) {
    if (fallback.cardId === detail.cardID && fallback.englishName) {
      return fallback.englishName;
    }
  }

  const { base, englishSuffix } = parseJapaneseCardNameSuffix(detail.name);
  const baseOverride = JAPANESE_CARD_NAME_OVERRIDES[base];

  if (baseOverride) {
    return `${baseOverride}${englishSuffix}`;
  }

  return japaneseCardEnglishNameCache.get(detail.name.trim());
}

function shouldSkipTcgdexOfficialJapaneseEnrichment(detail: PokemonCardJpDetail) {
  const setCode = detail.setCode?.trim().toLowerCase() ?? "";
  return (
    SHARED_POKEMON_TCG_SET_IDS.has(setCode) || Boolean(getLocalizedSetMarketProfile(detail.setCode))
  );
}

async function tryEnrichOfficialJapaneseDetail(
  detail: PokemonCardJpDetail,
  language: CardLanguageCode,
): Promise<TcgCard> {
  const englishName = resolveOfficialJapaneseEnglishName(detail);

  if (shouldSkipTcgdexOfficialJapaneseEnrichment(detail)) {
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

async function fetchOfficialJapaneseSetCards({
  setCode,
  setMeta,
  page,
  pageSize,
  cleanQuery,
  collectorCode,
  localizedNameQueries,
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
}): Promise<{ cards: TcgCard[]; totalCount: number }> {
  const firstPage = await fetchOfficialJapaneseSetBrowsePage(setCode, 1).catch(() => null);

  if (!firstPage?.cardList?.length) {
    return { cards: [], totalCount: 0 };
  }

  const officialPageSize = firstPage.cardList.length || 39;
  const targetEnd = page * pageSize;
  const officialPagesNeeded = Math.min(
    firstPage.maxPage,
    Math.max(1, Math.ceil(targetEnd / officialPageSize)),
  );
  const remainingPages =
    officialPagesNeeded > 1
      ? await Promise.all(
          Array.from({ length: officialPagesNeeded - 1 }, (_, index) =>
            fetchOfficialJapaneseSetBrowsePage(setCode, index + 2).catch(() => null),
          ),
        )
      : [];
  const allItems = [firstPage, ...remainingPages]
    .filter((payload): payload is PokemonCardJpSearchResponse => Boolean(payload))
    .flatMap((payload) => payload.cardList ?? []);
  const uniqueItems = allItems.filter(
    (item, index, items) => items.findIndex((candidate) => candidate.cardID === item.cardID) === index,
  );
  const filteredItems = uniqueItems.filter((item) => {
    if (!cleanQuery) {
      return true;
    }

    const searchableName = item.cardNameAltText || item.cardNameViewText || "";

    if (collectorCode) {
      const needles = collectorCodeLabelVariants(collectorCode).flatMap((label) => {
        const [numberPart = "", totalPart = ""] = label.split("/");
        return [label, numberPart, numberPart.padStart(3, "0"), `${numberPart}/${totalPart}`];
      });

      return needles.some((needle) => needle && searchableName.includes(needle));
    }

    return (
      textMatchesQuery(searchableName, cleanQuery) ||
      (localizedNameQueries ?? []).some((alias) => textMatchesQuery(searchableName, alias))
    );
  });
  const startIndex = (page - 1) * pageSize;
  const pageItems = filteredItems.slice(startIndex, startIndex + pageSize);
  const details: Array<PokemonCardJpDetail | null> = [];
  const detailConcurrency = 8;

  for (let i = 0; i < pageItems.length; i += detailConcurrency) {
    const chunk = pageItems.slice(i, i + detailConcurrency);
    details.push(
      ...(await Promise.all(
        chunk.map((item) =>
          fetchOfficialJapaneseCardDetail(item.cardID, item).catch(() => null),
        ),
      )),
    );
  }

  const cards = (
    await Promise.all(
      details
        .filter((detail): detail is PokemonCardJpDetail => Boolean(detail))
        .map((detail) => {
          const enrichedDetail = {
            ...detail,
            printedTotal: detail.printedTotal ?? setMeta?.printedTotal,
          };

          return tryEnrichOfficialJapaneseDetail(enrichedDetail, "ja");
        }),
    )
  ).map((card) => ({
    ...card,
    setName: formatBilingualName(
      setMeta?.setName ?? card.setLocalizedName ?? card.setName,
      setMeta?.englishSetName ?? card.setEnglishName,
    ),
    setLocalizedName: setMeta?.setName ?? card.setLocalizedName ?? card.setName,
    setEnglishName: setMeta?.englishSetName ?? card.setEnglishName,
    setPrintedTotal: setMeta?.printedTotal ?? card.setPrintedTotal,
    setTotal: setMeta?.total ?? card.setTotal,
  }));

  return {
    cards,
    totalCount: firstPage.hitCnt ?? filteredItems.length,
  };
}

function parseOfficialJapaneseCardDetail(
  cardID: string,
  html: string,
  fallback?: PokemonCardJpSearchItem,
): PokemonCardJpDetail {
  const name =
    stripHtml(html.match(/<h1[^>]*class="[^"]*Heading1[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ||
    fallback?.cardNameAltText ||
    fallback?.cardNameViewText ||
    "Japanese Pokemon card";
  const image =
    absolutePokemonCardJpUrl(
      html.match(/<img[^>]+class="fit"[^>]+src="([^"]+)"/i)?.[1] ??
        fallback?.cardThumbFile,
    ) || absolutePokemonCardJpUrl(fallback?.cardThumbFile);
  const imageSetCode = image.match(/\/large\/([^/]+)\//i)?.[1] ?? "";
  const subtextMatch = html.match(
    /class="img-regulation"[^>]+alt="([^"]+)"[^>]*>[\s\S]*?&nbsp;([^&<]+)&nbsp;\s*\/\s*&nbsp;([^&<]+)&nbsp;/i,
  );
  const setCode = normalizeWhitespace(subtextMatch?.[1] ?? imageSetCode);
  const collectorNumber = normalizeWhitespace(subtextMatch?.[2] ?? "");
  const printedTotalText = normalizeWhitespace(subtextMatch?.[3] ?? "");
  const printedTotal = Number.parseInt(printedTotalText.replace(/\D/g, ""), 10);
  const rarityCode = (
    html.match(/\/rarity\/ic_rare_([^".\/]+)\.(?:gif|png|webp)/i)?.[1] ?? ""
  )
    .split("_")[0]
    .toLowerCase();
  const topInfoHtml =
    html.match(/<div class="TopInfo[\s\S]*?<span class="hp-type">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i)?.[0] ??
    "";
  const typeCodes = [
    ...new Set(
      [...topInfoHtml.matchAll(/class="icon-([a-z-]+)\s+icon"/gi)]
        .map((match) => match[1].toLowerCase())
        .filter((code) => code !== "none"),
    ),
  ];
  const stageText = stripHtml(
    html.match(/<span class="type">([\s\S]*?)<\/span>/i)?.[1] ?? "",
  );

  return {
    cardID,
    name,
    image,
    setCode,
    collectorNumber,
    printedTotal: Number.isFinite(printedTotal) && printedTotal > 0 ? printedTotal : undefined,
    rarity: OFFICIAL_JP_RARITY_LABELS[rarityCode] ?? "Official Japanese release",
    hp: stripHtml(html.match(/<span class="hp-num">([\s\S]*?)<\/span>/i)?.[1] ?? "") || "-",
    types: typeCodes
      .map((code) => OFFICIAL_JP_TYPE_LABELS[code])
      .filter((type): type is string => Boolean(type)),
    stage: OFFICIAL_JP_STAGE_LABELS[stageText] ?? (stageText || undefined),
    artist:
      stripHtml(
        html.match(/<div class="author">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "",
      ) || "Unknown",
  };
}

async function fetchOfficialJapaneseCardDetail(
  cardID: string,
  fallback?: PokemonCardJpSearchItem,
): Promise<PokemonCardJpDetail | null> {
  const response = await fetch(
    `${POKEMON_CARD_JP_BASE_URL}/card-search/details.php/card/${encodeURIComponent(cardID)}/regu/all`,
    {
      headers: PUBLIC_HTML_HEADERS,
      next: { revalidate: 86400 },
    },
  );

  if (!response.ok) {
    return null;
  }

  return parseOfficialJapaneseCardDetail(cardID, await response.text(), fallback);
}

function normalizeOfficialJapaneseCard(
  detail: PokemonCardJpDetail,
  englishName?: string,
): TcgCard {
  const fetchedAt = new Date().toISOString();
  const setCode = detail.setCode || "Official Japanese catalog";
  const setEnglishName =
    getLocalizedSetEnglishName(setCode, undefined) ?? setCode;

  return {
    id: `official-${detail.cardID}`,
    slug: buildLocalizedSlug("ja", `official-${detail.cardID}`),
    language: "ja",
    languageLabel: LANGUAGE_LABELS.ja,
    name: formatBilingualName(detail.name, englishName),
    localizedName: detail.name,
    englishName,
    collectorNumber: detail.collectorNumber,
    rarity: detail.rarity,
    supertype: "Pokemon",
    hp: detail.hp,
    types: detail.types,
    setId: setCode,
    setCode: normalizeSetCode(setCode),
    setName: setCode,
    setLocalizedName: setCode,
    setEnglishName,
    image: detail.image,
    artist: detail.artist,
    stage: detail.stage,
    setPrintedTotal: detail.printedTotal,
    setTotal: detail.printedTotal,
    imageStatus: "official",
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Pokemon Card Japan official catalog",
      fetchedAt: null,
      note: "Official Japanese card identity is loaded. Population and market data are resolved from public market sources when available.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [
      { date: isoDaysAgo(30), value: 0 },
      { date: isoDaysAgo(14), value: 0 },
      { date: isoDaysAgo(7), value: 0 },
      { date: isoDaysAgo(1), value: 0 },
      { date: isoDaysAgo(0), value: 0 },
    ],
    gradedPrices: [
      {
        grade: "Ungraded",
        value: 0,
        populationCount: 0,
      },
    ],
    recentSales: [],
    priceConsensus: {
      finalEstimateUsd: 0,
      confidence: "low",
      confidenceScore: 0,
      sourceCount: 0,
      sampleCount: 0,
      methodology:
        "Official Japanese catalog identity only. Market value requires public sold-comps enrichment.",
      sources: [],
    },
    sources: [
      {
        source: "Pokemon Card Japan official catalog",
        status: "verified",
        fetchedAt,
        confidence: 0.92,
        note: "Official Japanese Pokemon Card catalog record used for identity and image coverage.",
      },
    ],
  };
}

function buildOfficialJapaneseFallbackDetail(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
  fallback: (typeof OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS)[string],
): PokemonCardJpDetail {
  return {
    cardID: fallback.cardId,
    name: fallback.jpName,
    image: absolutePokemonCardJpUrl(fallback.imagePath),
    setCode: fallback.setCode,
    collectorNumber: collectorCode.rawNumber ?? collectorCode.number,
    printedTotal: collectorCode.printedTotal,
    rarity: fallback.rarity,
    hp: "-",
    types: [],
    artist: "Unknown",
  };
}

async function fetchOfficialJapaneseSearchCards({
  aliases,
  englishName,
  page,
  pageSize,
}: {
  aliases: string[];
  englishName: string;
  page: number;
  pageSize: number;
}): Promise<{ cards: TcgCard[]; totalCount: number | null }> {
  const keyword = aliases.find((alias) => alias.trim())?.trim();

  if (!keyword) {
    return { cards: [], totalCount: null };
  }

  const firstPage = await fetchPokemonCardJpSearchPage(keyword, 1).catch(() => null);

  if (!firstPage?.cardList?.length) {
    return { cards: [], totalCount: 0 };
  }

  const targetEnd = page * pageSize;
  const officialPagesNeeded = Math.min(
    firstPage.maxPage,
    Math.max(1, Math.ceil(targetEnd / firstPage.cardList.length)),
  );
  const remainingPages =
    officialPagesNeeded > 1
      ? await Promise.all(
          Array.from({ length: officialPagesNeeded - 1 }, (_, index) =>
            fetchPokemonCardJpSearchPage(keyword, index + 2).catch(() => null),
          ),
        )
      : [];
  const allItems = [firstPage, ...remainingPages]
    .filter((payload): payload is PokemonCardJpSearchResponse => Boolean(payload))
    .flatMap((payload) => payload.cardList ?? []);
  const uniqueItems = allItems.filter(
    (item, index, items) => items.findIndex((candidate) => candidate.cardID === item.cardID) === index,
  );
  const startIndex = (page - 1) * pageSize;
  const pageItems = uniqueItems.slice(startIndex, startIndex + pageSize);
  const details: Array<PokemonCardJpDetail | null> = [];
  const detailConcurrency = 8;

  for (let i = 0; i < pageItems.length; i += detailConcurrency) {
    const chunk = pageItems.slice(i, i + detailConcurrency);
    details.push(
      ...(await Promise.all(
        chunk.map((item) =>
          fetchOfficialJapaneseCardDetail(item.cardID, item).catch(() => null),
        ),
      )),
    );
  }

  return {
    cards: details
      .filter((detail): detail is PokemonCardJpDetail => Boolean(detail))
      .map((detail) => normalizeOfficialJapaneseCard(detail, englishName)),
    totalCount: firstPage.hitCnt ?? uniqueItems.length,
  };
}

async function fetchOfficialJapaneseCardsByCollectorCode(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
): Promise<TcgCard[]> {
  const fallback = lookupOfficialJpCollectorFallback(collectorCode);

  if (fallback) {
    const detail = await fetchOfficialJapaneseCardDetail(fallback.cardId).catch(() => null);
    const numberMatches =
      detail?.collectorNumber.replace(/^0+(?=\d)/, "").toUpperCase() ===
      collectorCode.number.toUpperCase();
    const totalMatches = detail?.printedTotal === collectorCode.printedTotal;

    if (detail && numberMatches && totalMatches) {
      return [normalizeOfficialJapaneseCard(detail, fallback.englishName)];
    }

    return [
      normalizeOfficialJapaneseCard(
        buildOfficialJapaneseFallbackDetail(collectorCode, fallback),
        fallback.englishName,
      ),
    ];
  }

  const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
  const printedTotal = String(collectorCode.printedTotal).padStart(3, "0");
  const keywords = [
    `${rawNumber}/${printedTotal}`,
    `${collectorCode.number}/${printedTotal}`,
    rawNumber,
  ];
  const detailById = new Map<string, PokemonCardJpDetail>();

  for (const keyword of [...new Set(keywords)]) {
    const page = await fetchPokemonCardJpSearchPage(keyword, 1).catch(() => null);

    if (!page?.cardList?.length) {
      continue;
    }

    const details = await Promise.all(
      page.cardList.slice(0, 80).map((item) =>
        fetchOfficialJapaneseCardDetail(item.cardID, item).catch(() => null),
      ),
    );

    for (const detail of details) {
      if (!detail) {
        continue;
      }

      const numberMatches =
        detail.collectorNumber.replace(/^0+(?=\d)/, "").toUpperCase() ===
        collectorCode.number.toUpperCase();
      const totalMatches = detail.printedTotal === collectorCode.printedTotal;

      if (numberMatches && totalMatches) {
        detailById.set(detail.cardID, detail);
      }
    }

    if (detailById.size) {
      break;
    }
  }

  return [...detailById.values()].map((detail) => normalizeOfficialJapaneseCard(detail));
}

async function fetchCardSearchPage(
  filters: string[],
  page: number,
  pageSize: number,
  orderBy = "-set.releaseDate,number",
) {
  const searchParams = new URLSearchParams({
    pageSize: pageSize.toString(),
    page: page.toString(),
    orderBy,
  });

  if (filters.length) {
    searchParams.set("q", filters.join(" AND "));
  }

  const url = `${API_BASE_URL}/cards?${searchParams.toString()}`;
  return fetchJson<PokemonTcgCardApiResponse>(url);
}

async function searchEnglishCollectorCode(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
  page: number,
): Promise<LiveSearchResponse> {
  const escapedNum = collectorCode.number.replace(/"/g, '\\"');
  const total = collectorCode.printedTotal;
  const exactPayload = await fetchCardSearchPage(
    [
      `number:"${escapedNum}" AND (set.printedTotal:${total} OR set.total:${total})`,
    ],
    page,
    SEARCH_PAGE_SIZE,
    "-set.releaseDate,number",
  );
  const exactResults = exactPayload.data.map((card) => ({
    card: normalizeCard(card),
    score: 150,
    matchReason: `Exact collector code ${collectorCode.number}/${collectorCode.printedTotal}`,
  }));

  if (exactResults.length) {
    const enrichedResults = applyEarlyMarketSearchEstimates(
      await enrichSearchResultsWithPublicPriceFallback(exactResults),
    );
    return makeSearchResponse({
      results: enrichedResults,
      totalCount: exactPayload.totalCount,
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

async function fetchLocalizedCardsByCollectorCode(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
  language: CardLanguageCode,
): Promise<TcgdexCardResponse[]> {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  const normalizedNum = collectorCode.number.replace(/^0+(?=\d)/, "");
  const variants = [
    ...new Set([
      normalizedNum,
      normalizedNum.padStart(3, "0"),
      collectorCode.rawNumber ?? normalizedNum,
    ]),
  ];
  const briefLists = await Promise.all(
    variants.map((localId) =>
      fetchTcgdexJson<TcgdexCardBrief[]>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards?pagination:page=1&pagination:itemsPerPage=250&localId=${encodeURIComponent(localId)}`,
      ).catch(() => [] as TcgdexCardBrief[]),
    ),
  );
  const uniqueBriefs = briefLists.flat().filter(
    (brief, index, items) => items.findIndex((item) => item.id === brief.id) === index,
  );

  if (!uniqueBriefs.length) {
    return [];
  }

  const detailed = await Promise.all(
    uniqueBriefs.map((brief) =>
      fetchTcgdexJson<TcgdexCardResponse>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
      ).catch(() => null),
    ),
  );

  return detailed.filter((card): card is TcgdexCardResponse => {
    if (!card) {
      return false;
    }

    const idPart = card.localId.replace(/^0+(?=\d)/, "").toUpperCase();
    if (idPart !== collectorCode.number) {
      return false;
    }

    const official = card.set.cardCount?.official;
    const setTotal = card.set.cardCount?.total;
    return (
      official === collectorCode.printedTotal || setTotal === collectorCode.printedTotal
    );
  });
}

async function searchOfficialJapaneseCollectorCode(
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
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
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;

  const escapedNum = collectorCode.number.replace(/"/g, '\\"');
  const total = collectorCode.printedTotal;
  const exactCode = collectorCodeLabel(collectorCode);

  const [englishPayload, officialJapaneseResponse, ...localizedResponses] = await Promise.all([
    fetchCardSearchPage(
      [
        `number:"${escapedNum}" AND (set.printedTotal:${total} OR set.total:${total})`,
      ],
      1,
      250,
      "-set.releaseDate,number",
    ).catch((): PokemonTcgCardApiResponse => ({
      data: [],
      totalCount: 0,
      page: 1,
      pageSize: 250,
    })),
    searchOfficialJapaneseCollectorCode(collectorCode, 1, pageSize).catch(
      (): LiveSearchResponse => ({
        results: [],
        totalCount: 0,
        page: 1,
        pageSize,
        hasNextPage: false,
      }),
    ),
    ...SUPPORTED_CARD_LANGUAGES.filter((item) => item.code !== "en").map(
      async (item): Promise<LiveSearchResponse> => {
        try {
          const matches = await fetchLocalizedCardsByCollectorCode(collectorCode, item.code);
          if (!matches.length) {
            return {
              results: [],
              totalCount: 0,
              page: 1,
              pageSize,
              hasNextPage: false,
            };
          }
          const normalizedCards = await normalizeTcgdexCards(matches, item.code);
          return makeSearchResponse({
            results: normalizedCards.map((card) => ({
              card,
              score: item.code === "ja" ? 170 : 160,
              matchReason: `Exact collector code ${exactCode}`,
            })),
            totalCount: normalizedCards.length,
            page: 1,
            pageSize,
            hasNextPage: false,
          });
        } catch {
          return {
            results: [],
            totalCount: 0,
            page: 1,
            pageSize,
            hasNextPage: false,
          };
        }
      },
    ),
  ]);

  const englishResults: SearchResult[] = englishPayload.data.map((card) => ({
    card: normalizeCard(card),
    score: 120,
    matchReason: `Exact collector code ${collectorCode.number}/${collectorCode.printedTotal}`,
  }));

  const localizedResults = [
    ...officialJapaneseResponse.results,
    ...localizedResponses.flatMap((response) => response.results),
  ];
  const merged = [...localizedResults, ...englishResults];

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
      ? applyEarlyMarketSearchEstimates(enrichedDeduped).sort(
          (left, right) => right.score - left.score || left.card.name.localeCompare(right.card.name),
        )
      : applySearchResultSort(applyEarlyMarketSearchEstimates(enrichedDeduped), sort);
  const pageItems = sorted.slice(start, start + pageSize);

  if (!deduped.length) {
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

  return uniqueTcgSetsById(
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
  )
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

function uniqueTcgSetsById(sets: TcgSet[]) {
  const seen = new Set<string>();

  return sets.filter((set) => {
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

  return uniqueTcgSetsById(
    sets.map((set) => {
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
  )
    .sort((left, right) => {
      if (left.releaseDate || right.releaseDate) {
        return right.releaseDate.localeCompare(left.releaseDate);
      }

      return left.name.localeCompare(right.name);
    });
}

async function fetchTcgdexEnglishCompanion(
  card: TcgdexCardResponse,
): Promise<TcgdexEnglishCompanion> {
  try {
    const englishCard = await fetchTcgdexJson<TcgdexCardResponse>(
      `${TCGDEX_API_BASE_URL}/en/cards/${card.id}`,
    );

    return {
      name: englishCard.name,
      setName: englishCard.set?.name,
      image: englishCard.image,
      marketPriceUsd: getTcgdexMarketPrice(englishCard),
    };
  } catch {
    const fallback: TcgdexEnglishCompanion = {
      setName: getLocalizedSetEnglishName(card.set.id),
    };

    try {
      const englishSet = await fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(card.set.id)}`,
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

      return {
        name: matchingCard?.name ?? matchingBrief?.name,
        setName: englishSet.name,
        image: matchingCard?.image ?? matchingBrief?.image,
        marketPriceUsd: matchingCard ? getTcgdexMarketPrice(matchingCard) : undefined,
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

  const companions = await Promise.all(cards.map(fetchTcgdexEnglishCompanion));

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
      name: englishBrief?.name,
      setName: englishSetName,
      image: englishBrief?.image,
    });
  });
}

async function normalizeTcgdexCardsForSearch(
  cards: TcgdexCardResponse[],
  language: CardLanguageCode,
): Promise<TcgCard[]> {
  if (!cards.length) {
    return [];
  }

  if (language === "en") {
    return normalizeTcgdexCards(cards, language);
  }

  const apiLanguage = resolveTcgdexApiLanguage(language);
  const cardsBySet = new Map<string, TcgdexCardResponse[]>();

  for (const card of cards) {
    const existing = cardsBySet.get(card.set.id) ?? [];
    existing.push(card);
    cardsBySet.set(card.set.id, existing);
  }

  const normalizedById = new Map<string, TcgCard>();

  await mapWithConcurrency([...cardsBySet.entries()], 4, async ([setId, setCards]) => {
    const [localizedSet, englishSet] = await Promise.all([
      fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets/${encodeURIComponent(setId)}`,
      ).catch(() => null),
      fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(setId)}`,
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

  return cards
    .map((card) => normalizedById.get(card.id))
    .filter((card): card is TcgCard => Boolean(card));
}

function dedupeTcgdexBriefs(briefs: TcgdexCardBrief[]) {
  const seen = new Set<string>();

  return briefs.filter((brief) => {
    if (seen.has(brief.id)) {
      return false;
    }

    seen.add(brief.id);
    return true;
  });
}

async function searchLocalizedCardsByEnglishQuery(
  query: string,
  page: number,
  language: CardLanguageCode,
  itemsPerPage = LOCALIZED_SEARCH_PAGE_SIZE,
  includeOfficialJapanese = true,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
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

  const [englishBriefs, localizedNameAliases] = await Promise.all([
    fetchTcgdexJson<TcgdexCardBrief[]>(
      `${TCGDEX_API_BASE_URL}/en/cards?${new URLSearchParams({
        "pagination:page": normalizedPage.toString(),
        "pagination:itemsPerPage": String(Math.min(itemsPerPage + 8, 64)),
        name: cleanQuery,
      }).toString()}`,
    ).catch(() => [] as TcgdexCardBrief[]),
    fetchLocalizedPokemonNameAliases(cleanQuery, language),
  ]);
  const localizedNameQueries = localizedNameSearchVariants(
    localizedNameAliases,
    cleanQuery,
    language,
  );
  const [localizedAliasBriefs, officialJapanese] = await Promise.all([
    Promise.all(
      localizedNameQueries.map((alias) =>
        fetchTcgdexJson<TcgdexCardBrief[]>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards?${new URLSearchParams({
            "pagination:page": normalizedPage.toString(),
            "pagination:itemsPerPage": String(itemsPerPage),
            name: alias,
          }).toString()}`,
        ).catch(() => [] as TcgdexCardBrief[]),
      ),
    ).then((groups) => dedupeTcgdexBriefs(groups.flat()).slice(0, LOCALIZED_ALIAS_BRIEF_LIMIT)),
    language === "ja" && includeOfficialJapanese
      ? fetchOfficialJapaneseSearchCards({
          aliases: localizedNameAliases,
          englishName: cleanQuery,
          page: normalizedPage,
          pageSize: itemsPerPage,
        }).catch(() => ({ cards: [], totalCount: null as number | null }))
      : Promise.resolve({ cards: [] as TcgCard[], totalCount: null as number | null }),
  ]);

  if (!englishBriefs.length && !localizedAliasBriefs.length && !officialJapanese.cards.length) {
    return makeSearchResponse({
      results: [],
      totalCount: 0,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage: false,
    });
  }

  const crosswalkCards = (
    await mapWithConcurrency(
      englishBriefs.slice(0, itemsPerPage + 6),
      6,
      (brief) => fetchLocalizedCardFromEnglishBrief(brief, language),
    )
  ).filter((card): card is TcgdexCardResponse => Boolean(card));
  const aliasCards = await fetchTcgdexDetailCardsFromBriefs(
    localizedAliasBriefs.slice(0, itemsPerPage + 4),
    language,
  );
  const uniqueCards = [...aliasCards, ...crosswalkCards].filter(
    (card, index, cards) => cards.findIndex((item) => item.id === card.id) === index,
  );
  const normalizedCards = await normalizeTcgdexCardsForSearch(
    uniqueCards.slice(0, itemsPerPage),
    language,
  );
  const patchedCards = normalizedCards.map((card) => {
    if (card.englishName?.trim()) {
      return card;
    }

    return {
      ...card,
      englishName: cleanQuery,
      name: formatBilingualName(card.localizedName ?? card.name, cleanQuery),
    };
  });
  const officialResults: SearchResult[] = officialJapanese.cards.map((card) => ({
    card,
    score: 138,
    matchReason: "Official Japanese catalog match",
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
  const tcgdexResults = patchedCards
    .map((card) => ({
      card,
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
  const mergedResults = [
    ...officialResults,
    ...tcgdexResults,
  ].filter(
    (result, index, items) =>
      items.findIndex((candidate) => candidate.card.id === result.card.id) === index,
  );
  const results = applyEarlyMarketSearchEstimates(
    applyLocalizedSearchPriceEstimate(
      await enrichSearchResultsWithPublicPriceFallback(mergedResults, {
        maxCandidates: 6,
      }),
    ),
  );

  return makeSearchResponse({
    results: applySearchResultSort(results, sort),
    totalCount: officialJapanese.totalCount,
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

export async function fetchSearchSets(
  language: CardLanguageFilter = "all",
): Promise<TcgSet[]> {
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

  searchSetsCache.set(
    language,
    {
      expiresAt: now + SEARCH_SET_MEMORY_TTL_MS,
      promise: setsPromise.catch((error) => {
        searchSetsCache.delete(language);
        throw error;
      }),
    },
  );

  return setsPromise;
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
  const collectorCode = parseCollectorCodeQuery(cleanQuery);
  const localizedNameAliases =
    cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery)
      ? await fetchLocalizedPokemonNameAliases(cleanQuery, language)
      : [];
  const localizedNameQueries = localizedNameSearchVariants(
    localizedNameAliases,
    cleanQuery,
    language,
  );

  if (normalizedSetFilter) {
    const startIndex = (normalizedPage - 1) * itemsPerPage;
    const resultScore = cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery) ? 125 : 100;
    const matchReason =
      cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery)
        ? `English-name match in ${LANGUAGE_LABELS[language]} set`
        : cleanQuery
          ? `${LANGUAGE_LABELS[language]} set match`
          : `${LANGUAGE_LABELS[language]} set browse`;
    const catalogSet = await fetchTcgdexLocalizedSet(language, setFilter ?? normalizedSetFilter);
    const set = catalogSet?.set;
    const englishSet = catalogSet?.englishSet ?? null;
    const englishSetName = set
      ? getLocalizedSetEnglishName(set.id, englishSet?.name)
      : undefined;
    const setMeta = set
      ? {
          setName: set.name,
          englishSetName,
          printedTotal: set.cardCount?.official,
          total: set.cardCount?.total,
        }
      : undefined;
    const tcgdexCards = set?.cards ?? [];
    const expectedSetCount = set?.cardCount?.official ?? set?.cardCount?.total ?? 0;
    const shouldUseOfficialJapaneseCatalog =
      language === "ja" && !tcgdexCards.length && expectedSetCount > 0;

    if (language === "ja" && (!set || shouldUseOfficialJapaneseCatalog)) {
      const officialSetCodes = [
        catalogSet?.setId,
        normalizedSetFilter,
        setFilter,
        set?.id,
      ].filter((value): value is string => Boolean(value?.trim()));
      let officialBrowse: { cards: TcgCard[]; totalCount: number } | null = null;

      const officialFetchPage = isPriceAwareSort(sort) ? 1 : normalizedPage;
      const officialFetchPageSize = isPriceAwareSort(sort)
        ? LOCALIZED_PRICE_SORT_MAX_CARDS
        : itemsPerPage;

      for (const setCode of [...new Set(officialSetCodes)]) {
        officialBrowse = await fetchOfficialJapaneseSetCards({
          setCode,
          setMeta,
          page: officialFetchPage,
          pageSize: officialFetchPageSize,
          cleanQuery,
          collectorCode,
          localizedNameQueries,
        }).catch(() => null);

        if (officialBrowse?.cards.length) {
          break;
        }
      }

      if (officialBrowse?.cards.length) {
        const guidePricedCards = await enrichOfficialJapaneseSetBrowsePrices(officialBrowse.cards);
        const searchResults = applyEarlyMarketSearchEstimates(
          guidePricedCards.map((card) => ({
            card,
            score: resultScore,
            matchReason: `${LANGUAGE_LABELS[language]} official catalog set browse`,
          })),
        );
        const sortedResults = applySearchResultSort(searchResults, sort);
        const pagedResults = isPriceAwareSort(sort)
          ? sortedResults.slice(startIndex, startIndex + itemsPerPage)
          : sortedResults;

        return {
          results: pagedResults,
          totalCount: officialBrowse.totalCount,
          page: normalizedPage,
          pageSize: itemsPerPage,
          hasNextPage: startIndex + itemsPerPage < officialBrowse.totalCount,
          notice:
            "This Japanese set is loaded from the official Pokemon Card catalog because TCGdex has not published card records for it yet.",
        };
      }
    }

    if (!set) {
      return makeSearchResponse({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: itemsPerPage,
        hasNextPage: false,
        notice: `No ${LANGUAGE_LABELS[language]} set matched "${setFilter}". Try switching language to Japanese and selecting the set again.`,
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

      const normalizedCards = normalizeTcgdexSetBriefCards({
        briefs: filteredCards.slice(0, LOCALIZED_PRICE_SORT_MAX_CARDS),
        set,
        englishSet,
        language,
      });
      const sortedResults = applySearchResultSort(
        applyEarlyMarketSearchEstimates(
          applyLocalizedSearchPriceEstimate(
            await enrichSearchResultsWithPublicPriceFallback(
              normalizedCards.map((card) => ({
                card,
                score: resultScore,
                matchReason,
              })),
              {
                maxCandidates: searchFallbackBudget({
                  cleanQuery,
                  setFilter: normalizedSetFilter,
                  sort,
                  resultCount: normalizedCards.length,
                }),
              },
            ),
          ),
        ),
        sort,
      );
      const totalCount = Math.min(filteredCards.length, LOCALIZED_PRICE_SORT_MAX_CARDS);

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
      const normalizedCards = normalizeTcgdexSetBriefCards({
        briefs: pageCards,
        set,
        englishSet,
        language,
      });
      results = applySearchResultSort(
        applyEarlyMarketSearchEstimates(
          applyLocalizedSearchPriceEstimate(
            await enrichSearchResultsWithPublicPriceFallback(
              normalizedCards.map((card) => ({
                card,
                score: resultScore,
                matchReason,
              })),
              {
                maxCandidates: searchFallbackBudget({
                  cleanQuery,
                  setFilter: normalizedSetFilter,
                  sort,
                  resultCount: normalizedCards.length,
                }),
              },
            ),
          ),
        ),
        sort,
      );
    }

    if (collectorCode && !filteredCards.length && language === "ja") {
      const officialJapanese = await searchOfficialJapaneseCollectorCode(
        collectorCode,
        normalizedPage,
        itemsPerPage,
      ).catch(() => null);
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
      totalCount: isPriceAwareSort(sort)
        ? Math.min(filteredCards.length, LOCALIZED_PRICE_SORT_MAX_CARDS)
        : filteredCards.length,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage:
        startIndex + itemsPerPage <
        (isPriceAwareSort(sort)
          ? Math.min(filteredCards.length, LOCALIZED_PRICE_SORT_MAX_CARDS)
          : filteredCards.length),
      notice:
        collectorCode && !filteredCards.length
          ? `No exact ${LANGUAGE_LABELS[language]} card found for ${collectorCodeLabel(collectorCode)} in this set.`
          : undefined,
    };
  }

  if (collectorCode) {
    const matches = await fetchLocalizedCardsByCollectorCode(collectorCode, language);
    const exactCode = collectorCodeLabel(collectorCode);
    const startIndex = (normalizedPage - 1) * itemsPerPage;

    if (!matches.length) {
      if (language === "ja") {
        const officialJapanese = await searchOfficialJapaneseCollectorCode(
          collectorCode,
          normalizedPage,
          itemsPerPage,
        ).catch(() => null);

        if (officialJapanese?.results.length) {
          return {
            ...officialJapanese,
            results: await enrichSearchResultsWithPublicPriceFallback(
              officialJapanese.results,
              { maxCandidates: officialJapanese.results.length },
            ),
          };
        }
      }

      return makeSearchResponse({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: itemsPerPage,
        hasNextPage: false,
        notice: `No ${LANGUAGE_LABELS[language]} card matched exact code ${exactCode} (number + set size on card). Try All languages if you need an English catalog crosswalk.`,
      });
    }

    const normalizedCards = await normalizeTcgdexCardsForSearch(matches, language);
    const pageCards = applySearchResultSort(
      applyEarlyMarketSearchEstimates(
        applyLocalizedSearchPriceEstimate(
          await enrichSearchResultsWithPublicPriceFallback(
            normalizedCards.map((card) => ({
              card,
              score: 150,
              matchReason: `Exact collector code ${exactCode}`,
            })),
            {
              maxCandidates: searchFallbackBudget({
                cleanQuery: exactCode,
                sort,
                resultCount: normalizedCards.length,
              }),
            },
          ),
        ),
      ),
      sort,
    ).slice(startIndex, startIndex + itemsPerPage);

    return makeSearchResponse({
      results: pageCards,
      totalCount: normalizedCards.length,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage: startIndex + itemsPerPage < normalizedCards.length,
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
  const normalizedCards = await normalizeTcgdexCardsForSearch(detailedCards, language);
  const displayCards = cleanQuery
    ? normalizedCards
    : [
        ...normalizedCards.filter((card) => card.imageStatus !== "placeholder"),
        ...normalizedCards.filter((card) => card.imageStatus === "placeholder"),
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

  return {
    results: applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort),
    totalCount: null,
    page: normalizedPage,
    pageSize: itemsPerPage,
    hasNextPage: results.length === itemsPerPage,
  };
}

async function searchAllLanguageCards(
  query: string,
  setFilter: string | undefined,
  page: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const trimmedQuery = query.trim();

  if (setFilter) {
    const collectorCodeInSet = parseCollectorCodeQuery(trimmedQuery);

    if (collectorCodeInSet) {
      const collectorMatches = await searchCollectorCodeAllLanguages(
        normalizedPage,
        collectorCodeInSet,
        sort,
      );
      const setMatches = collectorMatches.results.filter((result) =>
        collectorCodeMatchesSetFilter(result.card, setFilter),
      );

      if (setMatches.length) {
        return {
          ...collectorMatches,
          results: setMatches,
          totalCount: setMatches.length,
          page: normalizedPage,
          pageSize: SEARCH_PAGE_SIZE,
          hasNextPage: false,
          notice: `Matched exact collector code ${collectorCodeLabel(collectorCodeInSet)} in ${setFilter.toUpperCase()}.`,
        };
      }
    }

    const localizedSetPageSize = LOCALIZED_SEARCH_PAGE_SIZE;
    const [englishResponse, localizedResponses] = await Promise.all([
      searchLiveCards(query, setFilter, normalizedPage, "en", sort),
      mapWithConcurrency(
        SUPPORTED_CARD_LANGUAGES.filter((language) => language.code !== "en"),
        ALL_LANGUAGE_SEARCH_CONCURRENCY,
        (language) =>
          searchLocalizedCards(
            query,
            normalizedPage,
            language.code,
            localizedSetPageSize,
            setFilter,
            sort,
          ).catch(
            (): LiveSearchResponse => ({
              results: [],
              totalCount: null,
              page: normalizedPage,
              pageSize: localizedSetPageSize,
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
      results: applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort),
      totalCount: mergedTotalCount,
      page: normalizedPage,
      pageSize: SEARCH_PAGE_SIZE,
      hasNextPage:
        englishResponse.hasNextPage ||
        localizedResponses.some((response) => response.hasNextPage),
      notice: "Searched English + localized catalogs for this set.",
    };
  }

  const collectorCode = parseCollectorCodeQuery(trimmedQuery);
  if (collectorCode) {
    return searchCollectorCodeAllLanguages(normalizedPage, collectorCode, sort);
  }

  if (!trimmedQuery) {
    return searchLiveCards("", undefined, normalizedPage, "en", sort);
  }

  if (isLikelyEnglishCatalogQuery(trimmedQuery)) {
    return searchEnglishNameAllLanguages(query, normalizedPage, sort);
  }

  const [englishResponse, localizedResponses] = await Promise.all([
    searchLiveCards(query, undefined, normalizedPage, "en", sort),
    mapWithConcurrency(
      SUPPORTED_CARD_LANGUAGES.filter((language) => language.code !== "en"),
      ALL_LANGUAGE_SEARCH_CONCURRENCY,
      (language) =>
        searchLocalizedCards(
          query,
          normalizedPage,
          language.code,
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

  if (language !== "en") {
    return searchLocalizedCards(
      query,
      page,
      language,
      LOCALIZED_SEARCH_PAGE_SIZE,
      setFilter,
      sort,
    );
  }

  const filters: string[] = [];
  const cleanQuery = query.trim();
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const collectorCode = parseCollectorCodeQuery(cleanQuery);

  if (setFilter) {
    filters.push(`set.id:${setFilter.toLowerCase()}`);
  }

  if (collectorCode && !setFilter) {
    const englishCollector = await searchEnglishCollectorCode(collectorCode, normalizedPage);
    if (englishCollector.results.length) {
      return englishCollector;
    }
    const heuristic = await searchCollectorHeuristicEnglish(collectorCode, normalizedPage);
    return heuristic ?? englishCollector;
  }

  if (cleanQuery) {
    filters.push(
      collectorCode
        ? `number:"${collectorCode.number}"`
        : buildSearchQueryClause(cleanQuery),
    );
  }

  if (!cleanQuery && !setFilter) {
    const trendingQuery =
      '(rarity:"Special Illustration Rare" OR rarity:"Illustration Rare" OR rarity:"Secret Rare" OR name:"Charizard" OR name:"Pikachu" OR name:"Umbreon" OR name:"Mewtwo" OR name:"Lugia" OR name:"Rayquaza" OR name:"Gengar")';

    const payload = await fetchCardSearchPage(
      [trendingQuery],
      normalizedPage,
      SEARCH_PAGE_SIZE,
      englishTrendingOrderByForSort(sort),
    );

    return {
      results: applySearchResultSort(
        payload.data
          .map((card) => ({
            card: normalizeCard(card),
            score: 100,
            matchReason: "Trending & Hot",
          }))
          .filter((result) => result.card.marketPriceUsd > 0),
        sort,
      ),
      totalCount: payload.totalCount,
      page: payload.page,
      pageSize: payload.pageSize,
      hasNextPage: payload.page * payload.pageSize < payload.totalCount,
    };
  }

  const shouldSortEnglishSetLocally = Boolean(setFilter && isPriceAwareSort(sort));
  const englishSetPriceSortCacheKey = shouldSortEnglishSetLocally
    ? makeSetPriceSortCacheKey(["english-set-price-sort", setFilter, cleanQuery, sort])
    : "";

  if (englishSetPriceSortCacheKey) {
    const cached = getCachedSetPriceSort(englishSetPriceSortCacheKey);

    if (cached) {
      return pageCachedSetPriceSort(cached, normalizedPage, SEARCH_PAGE_SIZE);
    }
  }

  const payload = shouldSortEnglishSetLocally
    ? await fetchEnglishSetCardsForPriceSort(filters)
    : await fetchCardSearchPage(
        filters,
        normalizedPage,
        SEARCH_PAGE_SIZE,
        englishOrderByForSort(sort),
      );

  let results = payload.data.map((card) => ({
    card: normalizeCard(card),
    score: 100,
    matchReason: cleanQuery ? "Live catalog match" : "Latest cards",
  }));

  results = await enrichSearchResultsWithPublicPriceFallback(results, {
    maxCandidates: searchFallbackBudget({
      cleanQuery,
      setFilter,
      sort,
      resultCount: results.length,
    }),
  });
  results = applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort);
  const pagedResults = shouldSortEnglishSetLocally
    ? results.slice((normalizedPage - 1) * SEARCH_PAGE_SIZE, normalizedPage * SEARCH_PAGE_SIZE)
    : results;
  const sortableTotalCount = shouldSortEnglishSetLocally
    ? Math.min(payload.totalCount, ENGLISH_SET_PRICE_SORT_MAX_CARDS)
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

export async function searchLiveCards(
  query: string,
  setFilter?: string,
  page = 1,
  language: CardLanguageFilter = "all",
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const cacheKey = makeSearchResultCacheKey(query, setFilter, normalizedPage, language, sort);
  const cached = getCachedSearchResult(cacheKey);

  if (cached) {
    return cached;
  }

  const response = await searchLiveCardsUncached(
    query,
    setFilter,
    normalizedPage,
    language,
    sort,
  );
  setCachedSearchResult(cacheKey, response);
  return response;
}

export async function fetchLiveCardBySlug(
  slug: string,
  options: { includePublicPriceFallback?: boolean } = {},
): Promise<TcgCard | null> {
  const { includePublicPriceFallback = true } = options;
  const { language, id } = parseLocalizedSlug(slug);

  if (language !== "en") {
    const apiLanguage = resolveTcgdexApiLanguage(language);

    if (language === "ja" && id.startsWith("official-")) {
      const detail = await fetchOfficialJapaneseCardDetail(id.replace(/^official-/, "")).catch(
        () => null,
      );

      if (!detail) {
        return null;
      }

      const card = await tryEnrichOfficialJapaneseDetail(detail, language);
      return includePublicPriceFallback ? applyPublicPriceFallback(card) : card;
    }

    try {
      const card = await fetchTcgdexJson<TcgdexCardResponse>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${id}`,
      );
      const [normalizedCard] = await normalizeTcgdexCards([card], language);
      return includePublicPriceFallback
        ? applyPublicPriceFallback(normalizedCard)
        : normalizedCard;
    } catch {
      return null;
    }
  }

  const payload = await fetchJson<PokemonTcgCardApiResponse>(
    `${API_BASE_URL}/cards?q=id:${encodeURIComponent(id)}&pageSize=1`,
  );

  const card = payload.data[0];
  if (!card) {
    return null;
  }

  const normalizedCard = normalizeCard(card);
  return includePublicPriceFallback
    ? applyPublicPriceFallback(normalizedCard)
    : normalizedCard;
}

async function fetchJapaneseEnglishQueryWindow(
  query: string,
  startIndex: number,
  itemsPerPage: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<{
  results: SearchResult[];
  totalCount: number | null;
  hasNextPage: boolean;
}> {
  const results: SearchResult[] = [];
  let totalCount: number | null = null;
  let hasNextPage = false;
  let nextIndex = Math.max(0, startIndex);

  while (results.length < itemsPerPage) {
    const page = Math.floor(nextIndex / itemsPerPage) + 1;
    const pageOffset = nextIndex % itemsPerPage;
    const response = await searchLocalizedCardsByEnglishQuery(
      query,
      page,
      "ja",
      itemsPerPage,
      false,
      sort,
    ).catch(
      (): LiveSearchResponse => ({
        results: [],
        totalCount: null,
        page,
        pageSize: itemsPerPage,
        hasNextPage: false,
      }),
    );

    totalCount = response.totalCount;
    hasNextPage = response.hasNextPage;

    const availableResults = response.results.slice(pageOffset);
    if (!availableResults.length) {
      break;
    }

    results.push(...availableResults.slice(0, itemsPerPage - results.length));

    if (results.length >= itemsPerPage || !response.hasNextPage) {
      break;
    }

    nextIndex = page * itemsPerPage;
  }

  return {
    results: applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort),
    totalCount,
    hasNextPage,
  };
}

async function searchEnglishNameAllLanguages(
  query: string,
  page: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;
  const localizedPreviewSize = Math.max(4, Math.floor(pageSize / 4));
  const [englishResponse, localizedResponses] = await Promise.all([
    searchLiveCards(query, undefined, normalizedPage, "en", sort),
    Promise.all(
      SUPPORTED_CARD_LANGUAGES.filter((language) => language.code !== "en").map((language) =>
        searchLocalizedCardsByEnglishQuery(
          query,
          normalizedPage,
          language.code,
          localizedPreviewSize,
          language.code !== "ja",
          sort,
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
    ),
  ]);
  const seenSlugs = new Set<string>();
  const merged = [
    ...englishResponse.results.slice(0, pageSize),
    ...localizedResponses.flatMap((response) => response.results),
  ].filter((result) => {
    if (seenSlugs.has(result.card.slug)) {
      return false;
    }

    seenSlugs.add(result.card.slug);
    return true;
  });
  const results = applySearchResultSort(
    applyEarlyMarketSearchEstimates(
      await enrichSearchResultsWithPublicPriceFallback(merged.slice(0, pageSize), {
        maxCandidates: SEARCH_PRICE_FALLBACK_MAX_RESULTS,
      }),
    ),
    sort,
  );

  return {
    results,
    totalCount: englishResponse.totalCount,
    page: normalizedPage,
    pageSize,
    hasNextPage:
      englishResponse.hasNextPage ||
      localizedResponses.some((response) => response.hasNextPage),
    notice:
      "All-language English-name search scans English plus every supported localized catalog. Prices use regional sold-comp queries when catalog fields are missing.",
  };
}
