import type { CardLanguageFilter, TcgCard, TcgSet } from "@/types/pokemon";

const SET_CACHE_TTL_MS = 30 * 60 * 1000;
const BOOT_SESSION_KEY = "pokedex_boot_ready_v1";
const BOOT_PREVIEW_KEY = "pokedex_boot_preview_v1";
const BOOT_SETS_KEY = "pokedex_boot_sets_v1";

const clientSetCache = new Map<
  CardLanguageFilter,
  { expiresAt: number; sets: TcgSet[] }
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

  const bootSets = readSessionJson<TcgSet[]>(BOOT_SETS_KEY);

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
  writeSessionJson(BOOT_SETS_KEY, normalized);
  return normalized;
}

export function getBootPreviewCards() {
  return readSessionJson<TcgCard[]>(BOOT_PREVIEW_KEY);
}

export function warmBootPreviewCards(cards: TcgCard[]) {
  writeSessionJson(BOOT_PREVIEW_KEY, cards.slice(0, 6));

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pokedex-boot-preview"));
  }
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
