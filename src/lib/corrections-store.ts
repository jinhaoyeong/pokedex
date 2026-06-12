"use client";

export const CORRECTIONS_STORAGE_KEY = "pokedex_corrections_v1";
export const CORRECTIONS_STORAGE_EVENT = "pokedex-corrections-change";

export type UserCardCorrection = {
  slug: string;
  field: "price" | "identity";
  reportedValue?: string;
  note?: string;
  createdAt: string;
};

function readCorrections(): UserCardCorrection[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CORRECTIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as UserCardCorrection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listLocalCorrections(slug?: string) {
  const items = readCorrections();
  return slug ? items.filter((item) => item.slug === slug) : items;
}

export function addLocalCorrection(correction: UserCardCorrection) {
  if (typeof window === "undefined") {
    return;
  }

  const next = [correction, ...readCorrections()].slice(0, 200);
  window.localStorage.setItem(CORRECTIONS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CORRECTIONS_STORAGE_EVENT));
}

export function subscribeToCorrections(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => listener();
  window.addEventListener(CORRECTIONS_STORAGE_EVENT, handler);
  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener(CORRECTIONS_STORAGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
