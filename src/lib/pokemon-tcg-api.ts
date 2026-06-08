import type {
  CardLanguageFilter,
  CardLanguageCode,
  LiveSearchResponse,
  SearchResult,
  SearchSortOption,
  TcgCard,
  TcgSet,
} from "@/types/pokemon";

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
const ALL_LANGUAGE_PREVIEW_PER_LANGUAGE = 3;
const LIVE_CATALOG_REVALIDATE_SECONDS = 3600;
const LIVE_SET_REVALIDATE_SECONDS = 1800;
const PUBLIC_SOLD_COMP_REVALIDATE_SECONDS = 21600;
const SEARCH_SET_MEMORY_TTL_MS = LIVE_SET_REVALIDATE_SECONDS * 1000;
const LATINISH_NAME_QUERY_MAX = 256;
export const DEFAULT_SEARCH_SORT: SearchSortOption = "relevance";
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

const LANGUAGE_LABELS: Record<CardLanguageCode, string> = {
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

const OFFICIAL_JP_STAGE_LABELS: Record<string, string> = {
  "1進化": "Stage 1",
  "2進化": "Stage 2",
  たね: "Basic",
};

export const SUPPORTED_CARD_LANGUAGES = Object.entries(LANGUAGE_LABELS).map(
  ([code, label]) => ({
    code: code as CardLanguageCode,
    label,
  }),
);

export const CARD_LANGUAGE_FILTERS: Array<{
  code: CardLanguageFilter;
  label: string;
}> = [
  { code: "all", label: "All languages" },
  ...SUPPORTED_CARD_LANGUAGES,
];

const PREFERRED_PRICE_BUCKET_ORDER = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "1stEditionHolofoil",
  "1stEditionNormal",
];

const LOCALIZED_SET_ENGLISH_NAME_OVERRIDES: Record<string, string> = {
  PMCG1: "Expansion Pack",
  PMCG2: "Pokemon Jungle",
  PMCG3: "Mystery of the Fossils",
  PMCG4: "Rocket Gang",
  PMCG5: "Leaders' Stadium",
  PMCG6: "Challenge from the Darkness",
  SV1S: "Scarlet ex",
  SV1V: "Violet ex",
  SV2D: "Clay Burst",
  SV2P: "Snow Hazard",
  SV3: "Ruler of the Black Flame",
  SV3A: "Raging Surf",
  SV4K: "Ancient Roar",
  SV4M: "Future Flash",
  SV5K: "Wild Force",
  SV5M: "Cyber Judge",
  SV5A: "Crimson Haze",
  SV6: "Mask of Change",
  SV6A: "Night Wanderer",
  SV7: "Stellar Miracle",
  SV7A: "Paradise Dragona",
  SV8: "Super Electric Breaker",
  SV8A: "Terastal Festival ex",
  SV9: "Battle Partners",
  SV9A: "Heat Wave Arena",
  SV10: "The Glory of Team Rocket",
  CSM1C: "Gem Pack Vol. 1",
  CSM1A: "Brave Stars",
  CSM1B: "Fearless Terastal",
};

const LOCALIZED_SET_ID_ALIASES: Partial<Record<CardLanguageCode, Record<string, string>>> = {
  ja: {
    rsv10pt5: "SV11W",
    sv10: "SV10",
    sv9: "SV9",
    zsv10pt5: "SV11B",
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
    number: match[1].replace(/^0+(?=\d)/, ""),
    printedTotal: Number.parseInt(match[2], 10),
  };
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
    return [...variants];
  }

  const normalizedQuery = normalizeSearchText(query);
  const suffixes = ["ex", "EX", "GX", "V", "VMAX", "VSTAR", "LV.X", "Lv.X"];

  for (const alias of aliases) {
    for (const suffix of suffixes) {
      variants.add(`${alias}${suffix}`);
    }

    if (normalizedQuery.includes("origin")) {
      variants.add(`オリジン${alias}`);
      variants.add(`オリジン${alias}V`);
      variants.add(`オリジン${alias}VSTAR`);
    }
  }

  return [...variants];
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
  const cleanEnglishName = englishName ? normalizeWhitespace(englishName) : "";

  return cleanEnglishName || LOCALIZED_SET_ENGLISH_NAME_OVERRIDES[setId.toUpperCase()];
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

  return LOCALIZED_SET_ID_ALIASES[language]?.[clean.toLowerCase()] ?? clean;
}

function shouldDeriveTcgdexAsset(language: CardLanguageCode, serieId?: string | null) {
  if (!serieId) {
    return false;
  }

  const assetLanguage = resolveTcgdexAssetLanguage(language);
  const assetSerieId = LOCALIZED_SERIES_ASSET_ALIASES[serieId] ?? serieId;

  if (assetLanguage === "ja") {
    return assetSerieId === "SV";
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

  if (card.language === "ja") {
    return [
      `Pokemon Japanese ${lookupName} ${card.setCode} ${collectorCode} ${lookupSetName}${rarityBit}`,
      `Pokemon Japanese ${card.setCode} ${collectorCode}`,
      `Pokemon Japanese ${lookupName} ${collectorCode}`,
      `Pokemon ${lookupName} ${collectorCode} ${lookupSetName}`,
    ].filter((query, index, queries) => query.trim() && queries.indexOf(query) === index);
  }

  return [
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

async function fetchPublicUngradedPriceFallback(
  card: TcgCard,
): Promise<PublicUngradedPriceFallback | null> {
  const outcomes = await Promise.all(
    buildPublicUngradedPriceQueries(card).map((query) =>
      fetchMageryUngradedPriceForQuery(query, card),
    ),
  );

  return (
    outcomes.find((outcome) => outcome?.matchTier === "strict") ??
    outcomes.find((outcome) => outcome !== null) ??
    null
  );
}

async function applyPublicPriceFallback(card: TcgCard): Promise<TcgCard> {
  try {
    const fallback = await fetchPublicUngradedPriceFallback(card);
    const fallbackPrice = fallback?.priceUsd ?? 0;
    const catalogPrice = card.marketPriceUsd;
    const shouldUseFallback =
      fallbackPrice > 0 &&
      (card.language !== "en" ||
        !(catalogPrice > 0) ||
        fallbackPrice > catalogPrice * 4 ||
        catalogPrice > fallbackPrice * 4);

    if (!shouldUseFallback) {
      return card;
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
    return card;
  }
}

/** Magery fallback is slow; cap parallelism to avoid hammering the public endpoint. */
const SEARCH_PRICE_FALLBACK_CONCURRENCY = 6;
const SEARCH_PRICE_FALLBACK_MAX_RESULTS = 8;
const SEARCH_PRICE_FALLBACK_MAX_SET_RESULTS = 12;
const PUBLIC_PRICE_FALLBACK_TIMEOUT_MS = 3500;
const ENGLISH_SET_PRICE_SORT_PAGE_SIZE = 250;
const ENGLISH_SET_PRICE_SORT_MAX_CARDS = 750;
const LOCALIZED_PRICE_SORT_DETAIL_MIN_WINDOW = 24;
const LOCALIZED_PRICE_SORT_MAX_CARDS = 750;
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
    return 0;
  }

  if (isPriceAwareSort(sort)) {
    return Math.min(resultCount, SEARCH_PRICE_FALLBACK_MAX_SET_RESULTS);
  }

  if (cleanQuery || setFilter) {
    return Math.min(resultCount, SEARCH_PRICE_FALLBACK_MAX_RESULTS);
  }

  return 0;
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
    if (results[i].card.marketPriceUsd <= 0 || results[i].card.language !== "en") {
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

  for (let i = 0; i < indices.length; i += SEARCH_PRICE_FALLBACK_CONCURRENCY) {
    const chunk = indices.slice(i, i + SEARCH_PRICE_FALLBACK_CONCURRENCY);
    const enriched = await Promise.all(
      chunk.map((idx) => applyPublicPriceFallback(results[idx].card)),
    );
    chunk.forEach((idx, j) => {
      next[idx] = { ...next[idx], card: enriched[j] };
    });
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
  const detailConcurrency = 10;
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
  const marketPriceUsd =
    localizedMarketPriceUsd > 0 ? localizedMarketPriceUsd : companion.marketPriceUsd ?? 0;
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
      confidence: "medium",
      confidenceScore: 0.58,
      sourceCount: marketPriceUsd > 0 ? 1 : 0,
      sampleCount: 0,
      methodology:
        "Catalog-only estimate. Multilingual releases can diverge until live sold comps and grading-market sources are merged.",
      sources:
        marketPriceUsd > 0
          ? [
              {
                source: `TCGdex ${LANGUAGE_LABELS[language]} catalog`,
                value: marketPriceUsd,
                confidence: "medium",
                confidenceScore: localizedMarketPriceUsd > 0 ? 0.58 : 0.42,
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
  const setName = detail.setCode || "Official Japanese catalog";

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
    setId: detail.setCode,
    setCode: normalizeSetCode(detail.setCode),
    setName,
    setLocalizedName: setName,
    setEnglishName: setName,
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
  const variants = [...new Set([normalizedNum, normalizedNum.padStart(3, "0")])];
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

async function searchCollectorCodeAllLanguages(
  page: number,
  collectorCode: NonNullable<ReturnType<typeof parseCollectorCodeQuery>>,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;

  const escapedNum = collectorCode.number.replace(/"/g, '\\"');
  const total = collectorCode.printedTotal;

  const [englishPayload, ...localizedResponses] = await Promise.all([
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
          const exactCode = `${collectorCode.number}/${collectorCode.printedTotal}`;
          return makeSearchResponse({
            results: normalizedCards.map((card) => ({
              card,
              score: 150,
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
    score: 150,
    matchReason: `Exact collector code ${collectorCode.number}/${collectorCode.printedTotal}`,
  }));

  const localizedResults = localizedResponses.flatMap((response) => response.results);
  const merged = [...englishResults, ...localizedResults];

  const seenCatalogIds = new Set<string>();
  const deduped = merged.filter((result) => {
    const catalogKey = result.card.id.trim().toLowerCase();
    if (seenCatalogIds.has(catalogKey)) {
      return false;
    }
    seenCatalogIds.add(catalogKey);
    return true;
  });

  const start = (normalizedPage - 1) * pageSize;
  const sorted = applySearchResultSort(applyEarlyMarketSearchEstimates(deduped), sort);
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
      const matchingBrief = englishSet.cards?.find(
        (brief) => brief.localId === card.localId,
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

  const englishBriefs = await fetchTcgdexJson<TcgdexCardBrief[]>(
    `${TCGDEX_API_BASE_URL}/en/cards?${new URLSearchParams({
      "pagination:page": normalizedPage.toString(),
      "pagination:itemsPerPage": String(itemsPerPage * 4),
      name: cleanQuery,
    }).toString()}`,
  ).catch(() => [] as TcgdexCardBrief[]);
  const localizedNameAliases = await fetchLocalizedPokemonNameAliases(cleanQuery, language);
  const localizedNameQueries = localizedNameSearchVariants(
    localizedNameAliases,
    cleanQuery,
    language,
  );
  const localizedAliasBriefs = (
    await Promise.all(
      localizedNameQueries.map((alias) =>
        fetchTcgdexJson<TcgdexCardBrief[]>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards?${new URLSearchParams({
            "pagination:page": normalizedPage.toString(),
            "pagination:itemsPerPage": String(itemsPerPage * 2),
            name: alias,
          }).toString()}`,
        ).catch(() => [] as TcgdexCardBrief[]),
      ),
    )
  ).flat();
  const officialJapanese =
    language === "ja" && includeOfficialJapanese
      ? await fetchOfficialJapaneseSearchCards({
          aliases: localizedNameAliases,
          englishName: cleanQuery,
          page: normalizedPage,
          pageSize: itemsPerPage,
        }).catch(() => ({ cards: [], totalCount: null }))
      : { cards: [] as TcgCard[], totalCount: null as number | null };

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
    await Promise.all(
      englishBriefs.map((brief) => fetchLocalizedCardFromEnglishBrief(brief, language)),
    )
  ).filter((card): card is TcgdexCardResponse => Boolean(card));
  const aliasCards = (
    await Promise.all(
      localizedAliasBriefs.map((brief) =>
        fetchTcgdexJson<TcgdexCardResponse>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
        )
          .then((card) => mergeTcgdexBriefIntoDetail(card, brief, null, language))
          .catch(() => null),
      ),
    )
  ).filter((card): card is TcgdexCardResponse => Boolean(card));
  const uniqueCards = [...aliasCards, ...crosswalkCards].filter(
    (card, index, cards) => cards.findIndex((item) => item.id === card.id) === index,
  );
  const normalizedCards = await normalizeTcgdexCards(uniqueCards.slice(0, itemsPerPage), language);
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
    const [set, englishSet] = await Promise.all([
      fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/${apiLanguage}/sets/${encodeURIComponent(normalizedSetFilter)}`,
      ),
      fetchTcgdexJson<TcgdexSetResponse>(
        `${TCGDEX_API_BASE_URL}/en/sets/${encodeURIComponent(normalizedSetFilter)}`,
      ).catch(() => null),
    ]);
    const englishBriefByLocalId = new Map(
      (englishSet?.cards ?? []).map((card) => [
        card.localId.replace(/^0+(?=\d)/, ""),
        card,
      ]),
    );
    const englishBriefById = new Map((englishSet?.cards ?? []).map((card) => [card.id, card]));
    const filteredCards = (set.cards ?? []).filter((card) => {
      if (!cleanQuery) {
        return true;
      }

      if (collectorCode) {
        return card.localId.replace(/^0+(?=\d)/, "").toUpperCase() === collectorCode.number;
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
        getLocalizedSetEnglishName(set.id, englishSet?.name),
      ]
        .filter(Boolean)
        .join(" ");

      return (
        textMatchesQuery(searchableText, cleanQuery) ||
        localizedNameQueries.some((alias) => textMatchesQuery(card.name, alias))
      );
    });
    const startIndex = (normalizedPage - 1) * itemsPerPage;
    const resultScore = cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery) ? 125 : 100;
    const matchReason =
      cleanQuery && isLikelyEnglishCatalogQuery(cleanQuery)
        ? `English-name match in ${LANGUAGE_LABELS[language]} set`
        : cleanQuery
          ? `${LANGUAGE_LABELS[language]} set match`
          : `${LANGUAGE_LABELS[language]} set browse`;
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

      const detailWindowSize = Math.min(
        filteredCards.length,
        Math.max(LOCALIZED_PRICE_SORT_DETAIL_MIN_WINDOW, LOCALIZED_PRICE_SORT_MAX_CARDS),
      );
      const detailedCards = await fetchTcgdexDetailCardsFromBriefs(
        filteredCards.slice(0, detailWindowSize),
        language,
      );
      const normalizedCards = await normalizeTcgdexCards(detailedCards, language);
      const sortedResults = applySearchResultSort(
        applyEarlyMarketSearchEstimates(
          applyLocalizedSearchPriceEstimate(
            normalizedCards.map((card) => ({
              card,
              score: resultScore,
              matchReason,
            })),
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
      const summaryCards = normalizeTcgdexSetBriefCards({
        briefs: pageCards,
        set,
        englishSet,
        language,
      });
      results = applyEarlyMarketSearchEstimates(
        applyLocalizedSearchPriceEstimate(
          summaryCards.map((card) => ({
            card,
            score: resultScore,
            matchReason,
          })),
        ),
      );
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
          ? `No exact ${LANGUAGE_LABELS[language]} card found for ${collectorCode.number}/${collectorCode.printedTotal} in this set.`
          : undefined,
    };
  }

  if (collectorCode) {
    const matches = await fetchLocalizedCardsByCollectorCode(collectorCode, language);
    const exactCode = `${collectorCode.number}/${collectorCode.printedTotal}`;
    const startIndex = (normalizedPage - 1) * itemsPerPage;

    if (!matches.length) {
      return makeSearchResponse({
        results: [],
        totalCount: 0,
        page: normalizedPage,
        pageSize: itemsPerPage,
        hasNextPage: false,
        notice: `No ${LANGUAGE_LABELS[language]} card matched exact code ${exactCode} (number + set size on card). Try All languages if you need an English catalog crosswalk.`,
      });
    }

    const normalizedCards = await normalizeTcgdexCards(matches, language);
    const pageCards = applySearchResultSort(
      applyEarlyMarketSearchEstimates(
        applyLocalizedSearchPriceEstimate(
          normalizedCards.map((card) => ({
            card,
            score: 150,
            matchReason: `Exact collector code ${exactCode}`,
          })),
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

  const baseParams = new URLSearchParams({
    "pagination:page": normalizedPage.toString(),
    "pagination:itemsPerPage": (cleanQuery ? itemsPerPage : itemsPerPage * 4).toString(),
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
  const detailedCards = await Promise.all(
    uniqueBriefs
      .slice(0, cleanQuery ? itemsPerPage : itemsPerPage * 4)
      .map((brief) =>
        fetchTcgdexJson<TcgdexCardResponse>(
          `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${brief.id}`,
        ).then((card) => mergeTcgdexBriefIntoDetail(card, brief, null, language)),
      ),
  );
  const normalizedCards = await normalizeTcgdexCards(detailedCards, language);
  const displayCards = cleanQuery
    ? normalizedCards
    : [
        ...normalizedCards.filter((card) => card.imageStatus !== "placeholder"),
        ...normalizedCards.filter((card) => card.imageStatus === "placeholder"),
      ].slice(0, itemsPerPage);

  const results = applySearchResultSort(
    applyEarlyMarketSearchEstimates(
      applyLocalizedSearchPriceEstimate(
        displayCards.map((card) => ({
          card,
          score: 100,
          matchReason: cleanQuery
            ? `${LANGUAGE_LABELS[language]} catalog match`
            : `${LANGUAGE_LABELS[language]} browse`,
        })),
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
    const [englishResponse, localizedResponses] = await Promise.all([
      searchLiveCards(query, setFilter, normalizedPage, "en", sort),
      Promise.all(
        SUPPORTED_CARD_LANGUAGES.filter((language) => language.code !== "en").map((language) =>
          searchLocalizedCards(
            query,
            normalizedPage,
            language.code,
            ALL_LANGUAGE_PREVIEW_PER_LANGUAGE,
            setFilter,
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

    return {
      results: applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort),
      totalCount: null,
      page: normalizedPage,
      pageSize: results.length || SEARCH_PAGE_SIZE,
      hasNextPage:
        englishResponse.hasNextPage ||
        localizedResponses.some((response) => response.hasNextPage),
      notice:
        "Set filter searched English plus localized catalogs. Public price and grading lookups use the card's English name/set when available.",
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
    return searchEnglishAndJapaneseCards(query, normalizedPage, sort);
  }

  const [englishResponse, localizedResponses] = await Promise.all([
    searchLiveCards(query, undefined, normalizedPage, "en", sort),
    Promise.all(
      SUPPORTED_CARD_LANGUAGES.filter((language) => language.code !== "en").map((language) =>
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

  return {
    results: applySearchResultSort(applyEarlyMarketSearchEstimates(results), sort),
    totalCount: null,
    page: normalizedPage,
    pageSize: results.length,
    hasNextPage:
      englishResponse.hasNextPage ||
      localizedResponses.some((response) => response.hasNextPage),
  };
}

export async function searchLiveCards(
  query: string,
  setFilter?: string,
  page = 1,
  language: CardLanguageFilter = "all",
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
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

      return detail ? applyPublicPriceFallback(normalizeOfficialJapaneseCard(detail)) : null;
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

async function searchEnglishAndJapaneseCards(
  query: string,
  page: number,
  sort: SearchSortOption = DEFAULT_SEARCH_SORT,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageSize = SEARCH_PAGE_SIZE;
  const startIndex = (normalizedPage - 1) * pageSize;
  const englishPage = Math.floor(startIndex / pageSize) + 1;
  const englishPageOffset = startIndex % pageSize;
  const englishResponse = await searchLiveCards(query, undefined, englishPage, "en", sort);
  const englishTotal = englishResponse.totalCount;
  const englishResults =
    typeof englishTotal !== "number" || startIndex < englishTotal
      ? englishResponse.results.slice(englishPageOffset, pageSize)
      : [];
  const remainingSlots = pageSize - englishResults.length;
  const japaneseStartIndex =
    typeof englishTotal === "number"
      ? Math.max(0, startIndex - englishTotal)
      : englishResults.length
        ? 0
        : startIndex;
  const japaneseWindow =
    remainingSlots > 0
      ? await fetchJapaneseEnglishQueryWindow(
          query,
          japaneseStartIndex,
          remainingSlots,
          sort,
        )
      : { results: [] as SearchResult[], totalCount: null, hasNextPage: false };
  const seenSlugs = new Set<string>();
  const results = [...englishResults, ...japaneseWindow.results].filter((result) => {
    if (seenSlugs.has(result.card.slug)) {
      return false;
    }

    seenSlugs.add(result.card.slug);
    return true;
  });
  const totalCount =
    typeof englishTotal === "number" && typeof japaneseWindow.totalCount === "number"
      ? englishTotal + japaneseWindow.totalCount
      : null;

  return {
    results: applySearchResultSort(results, sort),
    totalCount,
    page: normalizedPage,
    pageSize,
    hasNextPage:
      typeof totalCount === "number"
        ? normalizedPage * pageSize < totalCount
        : englishResponse.hasNextPage || japaneseWindow.hasNextPage,
    notice: `All-language English-name search is paged at ${pageSize} results and includes English plus relevant Japanese catalog matches.`,
  };
}
