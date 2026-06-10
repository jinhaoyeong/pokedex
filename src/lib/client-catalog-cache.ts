import type { CardLanguageFilter, LiveSearchResponse, TcgCard, TcgSet } from "@/types/pokemon";

const SET_CACHE_TTL_MS = 30 * 60 * 1000;
const BOOT_SESSION_KEY = "pokedex_boot_ready_v2";
const BOOT_PREVIEW_KEY = "pokedex_boot_preview_v2";
const BOOT_SETS_KEY = "pokedex_boot_sets_v2";
const BOOT_HOT_SEARCH_KEY = "pokedex_boot_hot_v2";
const PREVIEW_LIMIT = 6;

const clientSetCache = new Map<
  CardLanguageFilter,
  { expiresAt: number; sets: TcgSet[] }
>();

const clientHotSearchCache = new Map<
  CardLanguageFilter,
  { expiresAt: number; response: LiveSearchResponse }
>();

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
