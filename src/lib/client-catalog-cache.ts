import { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";
import { makeSearchCacheKey } from "@/lib/search-href";
import { DEFAULT_SEARCH_SORT, LANGUAGE_LABELS } from "@/lib/search-constants";
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
const BOOT_SESSION_KEY = "pokedex_boot_ready_v2";
const BOOT_PREVIEW_KEY = "pokedex_boot_preview_v3";
const BOOT_SETS_KEY = "pokedex_boot_sets_v2";
const BOOT_HOT_SEARCH_KEY = "pokedex_boot_hot_v2";
const CARD_NAV_STASH_KEY = "pokedex_card_nav_v1";
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
) {
  if (!response.results.length) {
    return response;
  }

  clientSearchCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    response,
  });

  return response;
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

  if (cachedSearch) {
    return cachedSearch;
  }

  if (
    query.trim() ||
    setFilter.trim() ||
    page !== 1 ||
    sort !== "price-desc"
  ) {
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
    card,
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
    card,
  });
}

export function getCachedClientCard(slug: string) {
  const cached = clientCardCache.get(slug);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.card;
  }

  return null;
}

export async function warmClientCardCacheFromApi(slug: string, signal?: AbortSignal) {
  const cached = getCachedClientCard(slug);

  if (cached) {
    return cached;
  }

  const response = await fetch(`/api/cards/${encodeURIComponent(slug)}`, { signal });

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

  return cached.card;
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

  if (cached && cached.expiresAt > Date.now()) {
    return cached.sets;
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

export function clearBootSessionReady() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(BOOT_SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}
