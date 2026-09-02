import { isUsableMarketPriceUsd } from "@/lib/market/pokedex-market-guide";

export type PokedexMarketContribution = {
  slug: string;
  grade?: string;
  priceUsd: number;
  kind: "sold" | "paid";
  setCode?: string;
  collectorNumber?: string;
  language?: string;
  name?: string;
};

/**
 * Best-effort first-party market report. Binder add/sale must not wait on
 * this, and a missing database must not break local portfolio writes.
 */
export function contributePokedexMarket(input: PokedexMarketContribution) {
  if (typeof window === "undefined") {
    return;
  }

  if (!input.slug.trim() || !isUsableMarketPriceUsd(input.priceUsd)) {
    return;
  }

  void fetch("/api/pokedex-market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      slug: input.slug,
      grade: input.grade,
      priceUsd: input.priceUsd,
      kind: input.kind,
      setCode: input.setCode,
      collectorNumber: input.collectorNumber,
      language: input.language,
      name: input.name,
    }),
  }).catch(() => undefined);
}

export function contributeHoldingMarket(
  item: {
    slug: string;
    grade?: string;
    setCode?: string;
    collectorNumber?: string;
    language?: string;
    name?: string;
  },
  priceUsd: number,
  kind: "sold" | "paid",
) {
  contributePokedexMarket({
    slug: item.slug,
    grade: item.grade,
    priceUsd,
    kind,
    setCode: item.setCode,
    collectorNumber: item.collectorNumber,
    language: item.language,
    name: item.name,
  });
}
