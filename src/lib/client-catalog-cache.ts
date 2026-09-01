import { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";
import { sanitizePartialPreviewMarketCard } from "@/lib/grading-market-lookup";
import { buildLiveSearchApiParams, makeSearchCacheKey } from "@/lib/search-href";
import { LANGUAGE_LABELS } from "@/lib/search-constants";
import {
  isSearchUnavailableNotice,
  shouldUseBootHotSearchForRequest,
} from "@/lib/search-landing-fallback";
import type {
  CardLanguageFilter,
  CardLanguageCode,
  LiveSearchResponse,
  PortfolioItem,
  SearchSortOption,
  TcgCard,
  TcgSet,
} from "@/types/pokemon";

const SET_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_EMPTY_CACHE_TTL_MS = 90 * 1000;
const PRICE_DATA_CACHE_VERSION = "v20260826-edition";
export const BOOT_SESSION_KEY = `pokedex_boot_ready_${PRICE_DATA_CACHE_VERSION}`;
const BOOT_PREVIEW_KEY = `pokedex_boot_preview_${PRICE_DATA_CACHE_VERSION}`;
const BOOT_SETS_KEY = "pokedex_boot_sets_v2";
const BOOT_HOT_SEARCH_KEY = `pokedex_boot_hot_${PRICE_DATA_CACHE_VERSION}`;
const CARD_NAV_STASH_KEY = `pokedex_card_nav_${PRICE_DATA_CACHE_VERSION}`;
const CARD_NAV_STASH_TTL_MS = 10 * 60 * 1000;
const CARD_CACHE_TTL_MS = 30 * 60 * 1000;
const PREVIEW_LIMIT = MARKET_PICKS_LIMIT;

const clientSetCache = new Map<
  CardLanguageFilter,
  { expiresAt: number; sets: TcgSet[] }
>();

const clientHotSearchCache = new Map<
  CardLanguageFilter,
  { expiresAt: number; response: LiveSearchResponse }
>();

const clientSearchCache = new Map<
  string,
  { expiresAt: number; response: LiveSearchResponse }
>();

const clientSearchPrefetchInFlight = new Map<string, Promise<LiveSearchResponse | null>>();

const clientCardCache = new Map<string, { expiresAt: number; card: TcgCard }>();

export function makeClientSearchCacheKey(
  args: Parameters<typeof makeSearchCacheKey>[0],
) {
  return makeSearchCacheKey(args);
}

export function getCachedClientSearch(cacheKey: string) {
  const cached = clientSearchCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  return null;
}

export function warmClientSearchCache(
  cacheKey: string,
  response: LiveSearchResponse,
  options: { setFilter?: string } = {},
) {
  const isSetBrowse = Boolean(options.setFilter?.trim()) && response.results.length === 0;

  // A failed or timed-out set-browse prefetch must not pin "No cards found" for
  // 90s while the server render is still loading richer catalog data.
  if (isSetBrowse || (!response.results.length && isSearchUnavailableNotice(response.notice))) {
    clientSearchCache.delete(cacheKey);
    return response;
  }

  clientSearchCache.set(cacheKey, {
    expiresAt:
      Date.now() +
      (response.results.length ? SEARCH_CACHE_TTL_MS : SEARCH_EMPTY_CACHE_TTL_MS),
    response,
  });

  return response;
}

export function prefetchClientSearch(
  args: Parameters<typeof makeClientSearchCacheKey>[0],
  signal?: AbortSignal,
) {
  if (typeof window === "undefined") {
    return;
  }

  const cacheKey = makeClientSearchCacheKey(args);

  if (getCachedClientSearch(cacheKey) || clientSearchPrefetchInFlight.has(cacheKey)) {
    return;
  }

  const params = buildLiveSearchApiParams(args);
  const request = fetch(`/api/live-search?${params.toString()}`, {
    cache: "no-store",
    signal,
  })
    .then((response) => {
      if (!response.ok) {
        return null;
      }

      return response.json() as Promise<LiveSearchResponse>;
    })
    .then((payload) => {
      if (payload) {
        warmClientSearchCache(cacheKey, payload, { setFilter: args.setFilter });
      }

      return payload;
    })
    .catch(() => null)
    .finally(() => {
      clientSearchPrefetchInFlight.delete(cacheKey);
    });

  clientSearchPrefetchInFlight.set(cacheKey, request);
}

export function getBootHotSearchForRequest({
  query,
  setFilter,
  page,
  language,
  sort,
}: {
  query: string;
  setFilter: string;
  page: number;
  language: CardLanguageFilter;
  sort: SearchSortOption;
}) {
  const cacheKey = makeClientSearchCacheKey({
    query,
    setFilter,
    page,
    language,
    sort,
  });
  const cachedSearch = getCachedClientSearch(cacheKey);

  if (cachedSearch?.results.length) {
    return cachedSearch;
  }

  if (setFilter.trim() && cachedSearch) {
    return null;
  }

  if (!shouldUseBootHotSearchForRequest({ query, setFilter, page, sort })) {
    return null;
  }

  const bootHot = getBootHotSearch(language);
  if (!bootHot) {
    return null;
  }

  return warmClientSearchCache(cacheKey, bootHot);
}

function readSessionJson<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors in private browsing.
  }
}

export function stashCardForNavigation(card: TcgCard) {
  writeSessionJson(CARD_NAV_STASH_KEY, {
    slug: card.slug,
    card: sanitizePartialPreviewMarketCard(card),
    cachedAt: Date.now(),
  });
}

function buildPortfolioNavigationCard(
  item: PortfolioItem,
  liveCard?: TcgCard | null,
): TcgCard {
  if (liveCard?.slug === item.slug) {
    return liveCard;
  }

  const language: CardLanguageCode = item.language ?? "en";

  return {
    id: item.cardId,
    slug: item.slug,
    language,
    languageLabel: LANGUAGE_LABELS[language] ?? LANGUAGE_LABELS.en,
    name: item.name,
    englishName: item.englishName,
    collectorNumber: item.collectorNumber,
    rarity: item.rarity ?? "Tracked card",
    supertype: "Pokemon",
    hp: "-",
    types: [],
    setId: item.setCode ?? item.slug.split("-")[0] ?? item.slug,
    setCode: item.setCode ?? "",
    setName: item.setName,
    setEnglishName: item.setEnglishName,
    setPrintedTotal: item.setPrintedTotal,
    image: item.image,
    artist: "Unknown",
    marketPriceUsd: item.marketValueUsd ?? 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Portfolio binder",
      fetchedAt: null,
      note: "Card identity loaded from your binder while full catalog details refresh.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [],
    gradedPrices: [
      {
        grade: "Ungraded",
        value: item.marketValueUsd ?? 0,
        populationCount: 0,
      },
    ],
    recentSales: [],
    sources: [],
  };
}

export function stashPortfolioItemForNavigation(
  item: PortfolioItem,
  liveCard?: TcgCard | null,
) {
  stashCardForNavigation(buildPortfolioNavigationCard(item, liveCard));
}

export function warmClientCardCache(slug: string, card: TcgCard) {
  clientCardCache.set(slug, {
    expiresAt: Date.now() + CARD_CACHE_TTL_MS,
    card: sanitizePartialPreviewMarketCard(card),
  });
}

export function getCachedClientCard(slug: string) {
  const cached = clientCardCache.get(slug);

  if (cached && cached.expiresAt > Date.now()) {
    return sanitizePartialPreviewMarketCard(cached.card);
  }

  return null;
}

export async function warmClientCardCacheFromApi(slug: string, signal?: AbortSignal) {
  const cached = getCachedClientCard(slug);

  if (cached) {
    return cached;
  }

  const response = await fetch(`/api/cards/${encodeURIComponent(slug)}`, {
    cache: "default",
    signal,
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { card?: TcgCard };

  if (!payload.card) {
    return null;
  }

  warmClientCardCache(slug, payload.card);
  return payload.card;
}

export function getStashedCardForNavigation(slug: string): TcgCard | null {
  const cached = readSessionJson<{
    slug: string;
    card: TcgCard;
    cachedAt: number;
  }>(CARD_NAV_STASH_KEY);

  if (!cached || cached.slug !== slug) {
    return null;
  }

  if (Date.now() - cached.cachedAt > CARD_NAV_STASH_TTL_MS) {
    return null;
  }

  return sanitizePartialPreviewMarketCard(cached.card);
}

export function uniqueSetsById(sets: TcgSet[]) {
  const seen = new Set<string>();

  return sets.filter((set) => {
    const key = set.id.trim().toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getCachedClientSets(language: CardLanguageFilter) {
  const cached = clientSetCache.get(language);

  if (cached?.sets.length && cached.expiresAt > Date.now()) {
    return cached.sets;
  }

  if (cached) {
    clientSetCache.delete(language);
  }

  const bootSetsByLanguage = readSessionJson<Partial<Record<CardLanguageFilter, TcgSet[]>>>(
    BOOT_SETS_KEY,
  );
  const bootSets = bootSetsByLanguage?.[language] ?? bootSetsByLanguage?.all;

  if (bootSets?.length) {
    const sets = uniqueSetsById(bootSets);
    clientSetCache.set(language, {
      expiresAt: Date.now() + SET_CACHE_TTL_MS,
      sets,
    });
    return sets;
  }

  return null;
}

export function warmClientSetsCache(language: CardLanguageFilter, sets: TcgSet[]) {
  const normalized = uniqueSetsById(sets);

  if (!normalized.length) {
    clientSetCache.delete(language);
    return normalized;
  }

  clientSetCache.set(language, {
    expiresAt: Date.now() + SET_CACHE_TTL_MS,
    sets: normalized,
  });

  const existing =
    readSessionJson<Partial<Record<CardLanguageFilter, TcgSet[]>>>(BOOT_SETS_KEY) ?? {};
  writeSessionJson(BOOT_SETS_KEY, {
    ...existing,
    [language]: normalized,
  });

  return normalized;
}

export function warmBootSetsByLanguage(setsByLanguage: Partial<Record<CardLanguageFilter, TcgSet[]>>) {
  const stored: Partial<Record<CardLanguageFilter, TcgSet[]>> = {};

  for (const [language, sets] of Object.entries(setsByLanguage) as Array<
    [CardLanguageFilter, TcgSet[] | undefined]
  >) {
    if (!sets?.length) {
      continue;
    }

    const normalized = warmClientSetsCache(language, sets);
    stored[language] = normalized;
  }

  return stored;
}

export function getBootPreviewCards() {
  return readSessionJson<TcgCard[]>(BOOT_PREVIEW_KEY);
}

export function warmBootPreviewCards(cards: TcgCard[]) {
  writeSessionJson(BOOT_PREVIEW_KEY, cards.slice(0, PREVIEW_LIMIT));

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pokedex-boot-preview"));
  }
}

export function getBootHotSearch(language: CardLanguageFilter = "all") {
  const cached = clientHotSearchCache.get(language);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  const bootHot = readSessionJson<Partial<Record<CardLanguageFilter, LiveSearchResponse>>>(
    BOOT_HOT_SEARCH_KEY,
  );
  const response = bootHot?.[language] ?? bootHot?.all;

  if (response) {
    clientHotSearchCache.set(language, {
      expiresAt: Date.now() + SET_CACHE_TTL_MS,
      response,
    });
    return response;
  }

  return null;
}

export function warmBootHotSearchByLanguage(
  hotSearchByLanguage: Partial<Record<CardLanguageFilter, LiveSearchResponse>>,
) {
  const existing =
    readSessionJson<Partial<Record<CardLanguageFilter, LiveSearchResponse>>>(
      BOOT_HOT_SEARCH_KEY,
    ) ?? {};

  const merged = { ...existing, ...hotSearchByLanguage };
  writeSessionJson(BOOT_HOT_SEARCH_KEY, merged);

  for (const [language, response] of Object.entries(hotSearchByLanguage) as Array<
    [CardLanguageFilter, LiveSearchResponse | undefined]
  >) {
    if (response) {
      clientHotSearchCache.set(language, {
        expiresAt: Date.now() + SET_CACHE_TTL_MS,
        response,
      });

      warmClientSearchCache(
        makeClientSearchCacheKey({
          query: "",
          setFilter: "",
          page: 1,
          language,
          sort: "price-desc",
        }),
        response,
      );
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pokedex-boot-hot-search"));
  }

  return merged;
}

export function markBootSessionReady() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(BOOT_SESSION_KEY, String(Date.now()));
  } catch {
    // Ignore storage failures.
  }
}

export function hasBootSessionReady() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.sessionStorage.getItem(BOOT_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}
