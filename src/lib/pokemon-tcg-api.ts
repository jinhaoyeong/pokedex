import type {
  CardLanguageFilter,
  CardLanguageCode,
  LiveSearchResponse,
  SearchResult,
  TcgCard,
  TcgSet,
} from "@/types/pokemon";

const API_BASE_URL = "https://api.pokemontcg.io/v2";
const TCGDEX_API_BASE_URL = "https://api.tcgdex.net/v2";
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
}

function normalizeSetCode(setId: string) {
  return setId.toUpperCase();
}

const EUR_TO_USD = 1 / 0.93;
const SEARCH_PAGE_SIZE = 48;
const LOCALIZED_SEARCH_PAGE_SIZE = 18;
const ALL_LANGUAGE_PREVIEW_PER_LANGUAGE = 3;
const LATINISH_NAME_QUERY_MAX = 256;

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

  let cleanImage = image.trim().replace(
    /^https:\/\/assets\.tcgdex\.net\/zh-(?:cn|tw)\//i,
    "https://assets.tcgdex.net/en/",
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
  if (language === "zh-cn" || language === "zh-tw") {
    return "en";
  }

  return language;
}

function inferTcgdexSerieIdForAssets(setId: string): string | null {
  const id = setId.trim();
  const upper = id.toUpperCase();
  if (upper.startsWith("SM")) {
    return "SM";
  }
  if (upper.startsWith("SVD")) {
    return "SV";
  }
  if (upper.startsWith("SV")) {
    return "SV";
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
  if (!serieId) {
    return undefined;
  }
  return (
    buildTcgdexSetAssetPath({
      language: resolveTcgdexAssetLanguage(language),
      setId: card.set.id,
      serieId,
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
  const shouldDeriveImage = serieId && ["SV", "SWSH", "SM", "XY"].includes(serieId);
  const derivedImage =
    !card.image && shouldDeriveImage && language
      ? buildTcgdexSetAssetPath({
          language: resolveTcgdexAssetLanguage(language),
          setId: set.id,
          serieId,
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

function buildPriceHistory(card: PokemonTcgCardApiResponse["data"][number]) {
  const currentValue = getUsdMarketPrice(card);
  const cardmarket = card.cardmarket?.prices;

  return [
    { date: "30d", value: convertCardmarketToUsd(cardmarket?.avg30) ?? currentValue },
    { date: "7d", value: convertCardmarketToUsd(cardmarket?.avg7) ?? currentValue },
    { date: "1d", value: convertCardmarketToUsd(cardmarket?.avg1) ?? currentValue },
    {
      date: "trend",
      value: convertCardmarketToUsd(cardmarket?.trendPrice) ?? currentValue,
    },
    { date: "now", value: currentValue },
  ];
}

async function fetchPublicUngradedPriceFallback(card: TcgCard) {
  const rarityBit =
    card.rarity && card.rarity !== "Unknown" ? ` ${card.rarity}` : "";
  const query = `Pokemon ${card.name} #${card.collectorNumber} ${card.setName}${rarityBit}`;
  const response = await fetch(`https://magery.com/w?q=${encodeURIComponent(query)}`, {
    headers: PUBLIC_HTML_HEADERS,
    next: { revalidate: 43200 },
  });

  if (!response.ok) {
    return 0;
  }

  const html = await response.text();
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
    return 0;
  }

  const sorted = [...pool].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

async function applyPublicPriceFallback(card: TcgCard): Promise<TcgCard> {
  try {
    const fallbackPrice = await fetchPublicUngradedPriceFallback(card);
    const catalogPrice = card.marketPriceUsd;
    const shouldUseFallback =
      fallbackPrice > 0 &&
      (!(catalogPrice > 0) || fallbackPrice > catalogPrice * 4 || catalogPrice > fallbackPrice * 4);

    if (!shouldUseFallback) {
      return card;
    }

    return {
      ...card,
      marketPriceUsd: fallbackPrice,
      priceHistory: card.priceHistory.map((point) => ({
        ...point,
        value: point.value > 0 ? point.value : fallbackPrice,
      })),
      gradedPrices: card.gradedPrices.map((price) =>
        price.grade === "Ungraded"
          ? {
              ...price,
              value: fallbackPrice,
              source: "Engineered from public sold comps",
            }
          : price,
      ),
      sources: [
        ...card.sources,
        {
          source: "Public sold comps fallback",
          status: "estimated",
          fetchedAt: new Date().toISOString(),
          confidence: 0.68,
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

async function enrichSearchResultsWithPublicPriceFallback(
  results: SearchResult[],
): Promise<SearchResult[]> {
  const indices: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].card.marketPriceUsd <= 0) {
      indices.push(i);
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

function normalizeTcgdexCard(
  card: TcgdexCardResponse,
  language: CardLanguageCode,
  companion: TcgdexEnglishCompanion = {},
): TcgCard {
  const marketPriceUsd = getTcgdexMarketPrice(card);
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
      { date: "30d", value: marketPriceUsd },
      { date: "7d", value: marketPriceUsd },
      { date: "1d", value: marketPriceUsd },
      { date: "trend", value: marketPriceUsd },
      { date: "now", value: marketPriceUsd },
    ],
    gradedPrices: [
      {
        grade: "Ungraded",
        value: marketPriceUsd,
        populationCount: 0,
      },
    ],
    recentSales: [],
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    throw new Error(`Pokemon TCG API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchTcgdexJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    throw new Error(`TCGdex request failed: ${response.status}`);
  }

  return (await response.json()) as T;
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
    const enrichedResults = await enrichSearchResultsWithPublicPriceFallback(exactResults);
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
    results: await enrichSearchResultsWithPublicPriceFallback(heuristicResults),
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
  const normalizedNum = collectorCode.number.replace(/^0+(?=\d)/, "");
  const variants = [...new Set([normalizedNum, normalizedNum.padStart(3, "0")])];
  const briefLists = await Promise.all(
    variants.map((localId) =>
      fetchTcgdexJson<TcgdexCardBrief[]>(
        `${TCGDEX_API_BASE_URL}/${language}/cards?pagination:page=1&pagination:itemsPerPage=250&localId=${encodeURIComponent(localId)}`,
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
        `${TCGDEX_API_BASE_URL}/${language}/cards/${brief.id}`,
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
  const pageItems = deduped.slice(start, start + pageSize);

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
    totalCount: deduped.length,
    page: normalizedPage,
    pageSize,
    hasNextPage: start + pageSize < deduped.length,
  });
}

export async function fetchLiveSets(): Promise<TcgSet[]> {
  const payload = await fetchJson<PokemonTcgSetApiResponse>(`${API_BASE_URL}/sets`);

  return payload.data
    .map((set) => ({
      id: set.id,
      name: set.name,
      code: normalizeSetCode(set.id),
      series: set.series,
      releaseDate: set.releaseDate,
      language: "en" as CardLanguageCode,
      languageLabel: LANGUAGE_LABELS.en,
      printedTotal: set.printedTotal,
      total: set.total,
    }))
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

async function fetchLocalizedSets(language: CardLanguageCode): Promise<TcgSet[]> {
  const [sets, englishSets] = await Promise.all([
    fetchTcgdexJson<TcgdexSetBrief[]>(`${TCGDEX_API_BASE_URL}/${language}/sets`),
    fetchTcgdexJson<TcgdexSetBrief[]>(`${TCGDEX_API_BASE_URL}/en/sets`).catch(
      () => [] as TcgdexSetBrief[],
    ),
  ]);
  const englishSetNames = new Map(englishSets.map((set) => [set.id, set.name]));

  return sets
    .map((set) => {
      const englishName = getLocalizedSetEnglishName(set.id, englishSetNames.get(set.id));

      return {
        id: set.id,
        name: formatBilingualName(set.name, englishName),
        localizedName: set.name,
        englishName,
        code: normalizeSetCode(set.id),
        series: LANGUAGE_LABELS[language],
        releaseDate: "",
        language,
        languageLabel: LANGUAGE_LABELS[language],
        printedTotal: set.cardCount?.official,
        total: set.cardCount?.total,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
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

      return {
        name: matchingBrief?.name,
        setName: englishSet.name,
        image: matchingBrief?.image,
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

export async function fetchSearchSets(
  language: CardLanguageFilter = "all",
): Promise<TcgSet[]> {
  if (language === "all") {
    return [];
  }

  if (language === "en") {
    return fetchLiveSets();
  }

  return fetchLocalizedSets(language);
}

async function searchLocalizedCards(
  query: string,
  page: number,
  language: CardLanguageCode,
  itemsPerPage = LOCALIZED_SEARCH_PAGE_SIZE,
  setFilter?: string,
): Promise<LiveSearchResponse> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const cleanQuery = query.trim();
  const normalizedSetFilter = setFilter?.trim();
  const collectorCode = parseCollectorCodeQuery(cleanQuery);

  if (normalizedSetFilter) {
    const set = await fetchTcgdexJson<TcgdexSetResponse>(
      `${TCGDEX_API_BASE_URL}/${language}/sets/${encodeURIComponent(normalizedSetFilter)}`,
    );
    const filteredCards = (set.cards ?? []).filter((card) => {
      if (!cleanQuery) {
        return true;
      }

      if (collectorCode) {
        return card.localId.replace(/^0+(?=\d)/, "").toUpperCase() === collectorCode.number;
      }

      const haystack = `${card.name} ${card.localId}`.toLowerCase();
      return haystack.includes(cleanQuery.toLowerCase());
    });
    const startIndex = (normalizedPage - 1) * itemsPerPage;
    const pageCards = filteredCards.slice(startIndex, startIndex + itemsPerPage);
    const detailedCards = await Promise.all(
      pageCards.map((brief) =>
        fetchTcgdexJson<TcgdexCardResponse>(
          `${TCGDEX_API_BASE_URL}/${language}/cards/${brief.id}`,
        ).then((card) => mergeTcgdexBriefIntoDetail(card, brief, set, language)),
      ),
    );
    const normalizedCards = await normalizeTcgdexCards(detailedCards, language);

    return {
      results: normalizedCards.map((card) => ({
        card,
        score: 120,
        matchReason: `${LANGUAGE_LABELS[language]} set match`,
      })),
      totalCount: filteredCards.length,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage: startIndex + itemsPerPage < filteredCards.length,
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
    const pageCards = normalizedCards.slice(startIndex, startIndex + itemsPerPage);

    return makeSearchResponse({
      results: pageCards.map((card) => ({
        card,
        score: 150,
        matchReason: `Exact collector code ${exactCode}`,
      })),
      totalCount: normalizedCards.length,
      page: normalizedPage,
      pageSize: itemsPerPage,
      hasNextPage: startIndex + itemsPerPage < normalizedCards.length,
    });
  }

  const baseParams = new URLSearchParams({
    "pagination:page": normalizedPage.toString(),
    "pagination:itemsPerPage": (cleanQuery ? itemsPerPage : itemsPerPage * 4).toString(),
  });

  const [nameMatches, idMatches] = await Promise.all([
    fetchTcgdexJson<TcgdexCardBrief[]>(
      `${TCGDEX_API_BASE_URL}/${language}/cards?${new URLSearchParams({
        ...Object.fromEntries(baseParams),
        ...(cleanQuery ? { name: cleanQuery } : {}),
      }).toString()}`,
    ),
    cleanQuery
      ? fetchTcgdexJson<TcgdexCardBrief[]>(
          `${TCGDEX_API_BASE_URL}/${language}/cards?pagination:page=1&pagination:itemsPerPage=${LOCALIZED_SEARCH_PAGE_SIZE}&localId=${encodeURIComponent(cleanQuery)}`,
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
          `${TCGDEX_API_BASE_URL}/${language}/cards/${brief.id}`,
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

  const results = displayCards.map((card) => ({
    card,
    score: 100,
    matchReason: cleanQuery
      ? `${LANGUAGE_LABELS[language]} catalog match`
      : `${LANGUAGE_LABELS[language]} browse`,
  }));

  return {
    results,
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
): Promise<LiveSearchResponse> {
  if (setFilter) {
    return searchLiveCards(query, setFilter, page, "en");
  }

  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const trimmedQuery = query.trim();
  const collectorCode = parseCollectorCodeQuery(trimmedQuery);
  if (collectorCode) {
    return searchCollectorCodeAllLanguages(normalizedPage, collectorCode);
  }

  if (!trimmedQuery) {
    return searchLiveCards("", undefined, normalizedPage, "en");
  }

  if (isLikelyEnglishCatalogQuery(trimmedQuery)) {
    return searchLiveCards(query, undefined, normalizedPage, "en");
  }

  const [englishResponse, localizedResponses] = await Promise.all([
    searchLiveCards(query, undefined, normalizedPage, "en"),
    Promise.all(
      SUPPORTED_CARD_LANGUAGES.filter((language) => language.code !== "en").map((language) =>
        searchLocalizedCards(
          query,
          normalizedPage,
          language.code,
          ALL_LANGUAGE_PREVIEW_PER_LANGUAGE,
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
    results,
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
): Promise<LiveSearchResponse> {
  if (language === "all") {
    return searchAllLanguageCards(query, setFilter, page);
  }

  if (language !== "en") {
    return searchLocalizedCards(query, page, language, LOCALIZED_SEARCH_PAGE_SIZE, setFilter);
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
      "-cardmarket.prices.trendPrice",
    );

    return {
      results: payload.data
        .map((card) => ({
          card: normalizeCard(card),
          score: 100,
          matchReason: "Trending & Hot",
        }))
        .filter((result) => result.card.marketPriceUsd > 0),
      totalCount: payload.totalCount,
      page: payload.page,
      pageSize: payload.pageSize,
      hasNextPage: payload.page * payload.pageSize < payload.totalCount,
    };
  }

  const payload = await fetchCardSearchPage(filters, normalizedPage, SEARCH_PAGE_SIZE);

  let results = payload.data.map((card) => ({
    card: normalizeCard(card),
    score: 100,
    matchReason: cleanQuery ? "Live catalog match" : "Latest cards",
  }));

  results = await enrichSearchResultsWithPublicPriceFallback(results);

  return {
    results,
    totalCount: payload.totalCount,
    page: payload.page,
    pageSize: payload.pageSize,
    hasNextPage: payload.page * payload.pageSize < payload.totalCount,
  };
}

export async function fetchLiveCardBySlug(slug: string): Promise<TcgCard | null> {
  const { language, id } = parseLocalizedSlug(slug);

  if (language !== "en") {
    try {
      const card = await fetchTcgdexJson<TcgdexCardResponse>(
        `${TCGDEX_API_BASE_URL}/${language}/cards/${id}`,
      );
      const [normalizedCard] = await normalizeTcgdexCards([card], language);
      return normalizedCard;
    } catch {
      return null;
    }
  }

  const payload = await fetchJson<PokemonTcgCardApiResponse>(
    `${API_BASE_URL}/cards?q=id:${encodeURIComponent(id)}&pageSize=1`,
  );

  const card = payload.data[0];
  return card ? applyPublicPriceFallback(normalizeCard(card)) : null;
}
