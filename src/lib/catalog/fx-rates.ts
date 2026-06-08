import { readCatalogJson, writeCatalogJson } from "@/lib/catalog/file-store";

const DEFAULT_EUR_TO_USD = 1 / 0.93;
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type FxSnapshot = {
  base: string;
  quote: string;
  rate: number;
  source: string;
  fetchedAt: string;
};

let memoryFx: { expiresAt: number; eurToUsd: number; snapshot: FxSnapshot } | null = null;

async function fetchLiveEurUsd(): Promise<FxSnapshot | null> {
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
      next: { revalidate: 21_600 },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      rates?: { USD?: number };
    };
    const rate = payload.rates?.USD;

    if (typeof rate !== "number" || rate <= 0) {
      return null;
    }

    return {
      base: "EUR",
      quote: "USD",
      rate,
      source: "Frankfurter live FX",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getEurToUsdRate(): Promise<{ rate: number; snapshot: FxSnapshot }> {
  const now = Date.now();

  if (memoryFx && memoryFx.expiresAt > now) {
    return { rate: memoryFx.eurToUsd, snapshot: memoryFx.snapshot };
  }

  const cached = await readCatalogJson<FxSnapshot>("fx-rates.json");
  if (cached?.rate && cached.fetchedAt) {
    const age = now - new Date(cached.fetchedAt).getTime();
    if (age < FX_CACHE_TTL_MS) {
      memoryFx = {
        expiresAt: now + FX_CACHE_TTL_MS - age,
        eurToUsd: cached.rate,
        snapshot: cached,
      };
      return { rate: cached.rate, snapshot: cached };
    }
  }

  const live = await fetchLiveEurUsd();
  if (live) {
    await writeCatalogJson("fx-rates.json", live).catch(() => undefined);
    memoryFx = {
      expiresAt: now + FX_CACHE_TTL_MS,
      eurToUsd: live.rate,
      snapshot: live,
    };
    return { rate: live.rate, snapshot: live };
  }

  const fallback: FxSnapshot = {
    base: "EUR",
    quote: "USD",
    rate: DEFAULT_EUR_TO_USD,
    source: "Static fallback FX",
    fetchedAt: new Date().toISOString(),
  };

  return { rate: DEFAULT_EUR_TO_USD, snapshot: fallback };
}

export function convertEurToUsdSync(eur: number, eurToUsd: number) {
  if (!Number.isFinite(eur) || eur <= 0) {
    return 0;
  }

  return eur * eurToUsd;
}
