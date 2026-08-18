import type {
  CardEditionFilter,
  CardFinishId,
  CardFinishMarket,
  LiveSearchResponse,
  SaleRecord,
  SearchResult,
  TcgCard,
} from "@/types/pokemon";

type PriceBucket = {
  market?: number | null;
  mid?: number | null;
  low?: number | null;
  marketPrice?: number | null;
  midPrice?: number | null;
  lowPrice?: number | null;
};

const FINISH_META: Record<CardFinishId, { label: string; shortLabel: string }> = {
  normal: { label: "Non-holo", shortLabel: "Non-holo" },
  holofoil: { label: "Holo", shortLabel: "Holo" },
  reverseHolofoil: { label: "Reverse holo", shortLabel: "Reverse" },
  unlimitedHolofoil: { label: "Unlimited holo", shortLabel: "Unlimited" },
  firstEditionHolofoil: { label: "1st Edition holo", shortLabel: "1st Ed holo" },
  firstEditionNormal: { label: "1st Edition non-holo", shortLabel: "1st Ed" },
};

const BUCKET_TO_FINISH: Record<string, CardFinishId> = {
  normal: "normal",
  unlimited: "normal",
  unlimitednormal: "normal",
  holofoil: "holofoil",
  holo: "holofoil",
  holofoilunlimited: "unlimitedHolofoil",
  unlimitedholofoil: "unlimitedHolofoil",
  reverseholofoil: "reverseHolofoil",
  reverse: "reverseHolofoil",
  reverseholo: "reverseHolofoil",
  "1steditionholofoil": "firstEditionHolofoil",
  firsteditionholofoil: "firstEditionHolofoil",
  "1stedition": "firstEditionHolofoil",
  firstedition: "firstEditionHolofoil",
  "1steditionnormal": "firstEditionNormal",
  firsteditionnormal: "firstEditionNormal",
};

const TCGDEX_VARIANT_TO_FINISH: Record<string, CardFinishId> = {
  normal: "normal",
  holo: "holofoil",
  reverse: "reverseHolofoil",
  firstedition: "firstEditionHolofoil",
};

const HOLO_RARITY =
  /\b(holo|holofoil|ultra rare|secret rare|illustration rare|special illustration|hyper rare|rainbow rare|gold rare|full art|alternate art|gx|vmax|vstar|\bv\b|ex|tag team)\b/i;

const INHERENT_HOLO_RARITY =
  /\b(secret rare|illustration rare|special illustration|hyper rare|rainbow rare|gold rare|full art|alternate art|ultra rare|gx|vmax|vstar|\bv\b|ex|tag team|mega hyper)\b/i;

const INHERENT_HOLO_NAME =
  /\b(ex|gx|vmax|vstar|v-union|\bv\b|mega|full art|illustration rare|special illustration|secret rare|hyper rare|rainbow rare|gold rare|alternate art|sir|sar|ur)\b/i;

const REVERSE_SALE = /\breverse(?:\s|-)?holo(?:foil)?\b|\breverse\s+h\b|\brh\b/i;
const HOLO_SALE = /\bholo(?:foil)?\b|\bfoil\b/i;
const FIRST_EDITION_SALE = /\b1st(?:\s|-)?ed(?:ition)?\b|\bfirst\s+edition\b/i;

export const CARD_FINISH_ORDER: CardFinishId[] = [
  "normal",
  "holofoil",
  "reverseHolofoil",
  "unlimitedHolofoil",
  "firstEditionHolofoil",
  "firstEditionNormal",
];

function positivePrice(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function bucketMarketUsd(bucket: PriceBucket) {
  return (
    positivePrice(bucket.market) ||
    positivePrice(bucket.marketPrice) ||
    positivePrice(bucket.mid) ||
    positivePrice(bucket.midPrice) ||
    positivePrice(bucket.low) ||
    positivePrice(bucket.lowPrice)
  );
}

function normalizeBucketKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function finishLabel(id: CardFinishId) {
  return FINISH_META[id].label;
}

export function finishShortLabel(id: CardFinishId) {
  return FINISH_META[id].shortLabel;
}

export function parseCardFinishId(value?: string | null): CardFinishId | null {
  if (!value) {
    return null;
  }

  if (value in FINISH_META) {
    return value as CardFinishId;
  }

  return BUCKET_TO_FINISH[normalizeBucketKey(value)] ?? null;
}

export function finishContextText(rarity?: string | null, name?: string | null) {
  return [rarity, name].filter(Boolean).join(" ");
}

export function isInherentHoloPrint(rarity?: string | null, name?: string | null) {
  return INHERENT_HOLO_RARITY.test(rarity ?? "") || INHERENT_HOLO_NAME.test(name ?? "");
}

export function standardFinishesForRarity(
  rarity?: string | null,
  name?: string | null,
): CardFinishId[] {
  const text = finishContextText(rarity, name);

  if (/\b1st(?:\s|-)?ed/i.test(text) || /\bfirst edition\b/i.test(text)) {
    return HOLO_RARITY.test(text) || INHERENT_HOLO_NAME.test(name ?? "")
      ? ["firstEditionHolofoil"]
      : ["firstEditionNormal", "firstEditionHolofoil"];
  }

  if (isInherentHoloPrint(rarity, name) || /\bpromo\b/i.test(text)) {
    return ["holofoil"];
  }

  if (/rare holo/i.test(text) || HOLO_RARITY.test(text) || /\brare\b/i.test(text)) {
    return ["holofoil", "reverseHolofoil"];
  }

  if (/\b(common|uncommon)\b/i.test(text)) {
    return ["normal", "reverseHolofoil"];
  }

  return ["normal", "holofoil", "reverseHolofoil"];
}

export function inferPrimaryFinish(
  rarity?: string | null,
  available: CardFinishId[] = [],
  name?: string | null,
): CardFinishId {
  const unique = [...new Set(available)];

  if (unique.length === 1) {
    return unique[0];
  }

  const has = (id: CardFinishId) => unique.includes(id);

  if (/\b1st(?:\s|-)?ed/i.test(rarity ?? "") || /\bfirst edition\b/i.test(rarity ?? "")) {
    if (has("firstEditionHolofoil")) return "firstEditionHolofoil";
    if (has("firstEditionNormal")) return "firstEditionNormal";
  }

  if (isInherentHoloPrint(rarity, name)) {
    if (has("holofoil")) return "holofoil";
    if (has("unlimitedHolofoil")) return "unlimitedHolofoil";
    if (!unique.length) return "holofoil";
  }

  if (has("normal")) return "normal";
  if (has("holofoil")) return "holofoil";
  if (unique[0]) return unique[0];
  if (/\b(common|uncommon)\b/i.test(rarity ?? "")) return "normal";
  return "holofoil";
}

export function shouldShowFinishSwitcher(card: Pick<TcgCard, "finishMarkets" | "rarity" | "name" | "englishName">) {
  if (isInherentHoloPrint(card.rarity, card.englishName ?? card.name)) {
    return false;
  }

  return (card.finishMarkets?.length ?? 0) > 1;
}

export function extractFinishMarketsFromPriceMap(
  priceMap?: Record<string, PriceBucket | null | undefined> | null,
): CardFinishMarket[] {
  if (!priceMap) {
    return [];
  }

  const byFinish = new Map<CardFinishId, number>();

  for (const [key, bucket] of Object.entries(priceMap)) {
    if (!bucket || typeof bucket !== "object") {
      continue;
    }

    const finish = BUCKET_TO_FINISH[normalizeBucketKey(key)];
    if (!finish) {
      continue;
    }

    const value = bucketMarketUsd(bucket);
    const current = byFinish.get(finish) ?? 0;
    if (value > current) {
      byFinish.set(finish, value);
    } else if (!byFinish.has(finish)) {
      byFinish.set(finish, 0);
    }
  }

  return CARD_FINISH_ORDER.filter((id) => byFinish.has(id)).map((id) => ({
    id,
    ...FINISH_META[id],
    ungradedUsd: byFinish.get(id) ?? 0,
  }));
}

export function extractFinishIdsFromTcgdexVariants(
  variants?: Record<string, boolean> | null,
): CardFinishId[] {
  if (!variants) {
    return [];
  }

  return Object.entries(variants)
    .filter(([, enabled]) => enabled)
    .map(([key]) => TCGDEX_VARIANT_TO_FINISH[normalizeBucketKey(key)])
    .filter((id): id is CardFinishId => Boolean(id));
}

export function mergeFinishMarkets(
  priced: CardFinishMarket[],
  variantIds: CardFinishId[] = [],
): CardFinishMarket[] {
  const byFinish = new Map(priced.map((market) => [market.id, market]));

  for (const id of variantIds) {
    if (!byFinish.has(id)) {
      byFinish.set(id, { id, ...FINISH_META[id], ungradedUsd: 0 });
    }
  }

  return CARD_FINISH_ORDER.filter((id) => byFinish.has(id)).map((id) => byFinish.get(id)!);
}

export function attachFinishMarketsToCard(
  card: TcgCard,
  options: {
    priceMap?: Record<string, PriceBucket | null | undefined> | null;
    variantIds?: CardFinishId[];
  } = {},
): TcgCard {
  const priced = extractFinishMarketsFromPriceMap(options.priceMap);
  const variantIds = options.variantIds ?? [];
  const cardName = card.englishName ?? card.name;
  const inherentHolo = isInherentHoloPrint(card.rarity, cardName);
  const allowed = inherentHolo
    ? (["holofoil"] as CardFinishId[])
    : priced.length || variantIds.length
      ? variantIds
      : standardFinishesForRarity(card.rarity, cardName);
  const finishMarkets = mergeFinishMarkets(
    inherentHolo ? priced.filter((market) => market.id === "holofoil" || market.id === "unlimitedHolofoil") : priced,
    allowed,
  );
  const finish =
    card.finish && finishMarkets.some((market) => market.id === card.finish)
      ? card.finish
      : inferPrimaryFinish(
          card.rarity,
          finishMarkets.map((market) => market.id),
          cardName,
        );
  const selected = finishMarkets.find((market) => market.id === finish);
  const ungradedUsd =
    selected && selected.ungradedUsd > 0 ? selected.ungradedUsd : card.marketPriceUsd;

  return {
    ...card,
    finish,
    finishMarkets,
    marketPriceUsd: ungradedUsd > 0 ? ungradedUsd : card.marketPriceUsd,
  };
}

export function applySelectedFinish(card: TcgCard, finish: CardFinishId): TcgCard {
  const markets = card.finishMarkets?.length
    ? card.finishMarkets
    : [{ id: finish, ...FINISH_META[finish], ungradedUsd: card.marketPriceUsd }];
  const selected = markets.find((market) => market.id === finish) ?? markets[0];
  const ungradedUsd = selected?.ungradedUsd ?? card.marketPriceUsd;
  const nextUngraded =
    ungradedUsd > 0
      ? card.gradedPrices.map((price) =>
          price.grade === "Ungraded" ? { ...price, value: ungradedUsd } : price,
        )
      : card.gradedPrices;

  const productUrl = card.marketIdentity?.priceChartingProductUrl ?? "";
  const identityMatchesFinish =
    !productUrl || productUrlMatchesFinish(productUrl, finish, card.rarity);
  const marketIdentity = card.marketIdentity
    ? {
        ...card.marketIdentity,
        priceChartingProductUrl: identityMatchesFinish
          ? card.marketIdentity.priceChartingProductUrl
          : null,
        priceChartingProductId: identityMatchesFinish
          ? card.marketIdentity.priceChartingProductId
          : null,
      }
    : card.marketIdentity;

  return {
    ...card,
    finish,
    finishMarkets: markets,
    marketIdentity,
    marketPriceUsd: ungradedUsd > 0 ? ungradedUsd : card.marketPriceUsd,
    gradedPrices: nextUngraded,
    recentSales: [],
    psaPopulation: {
      ...card.psaPopulation,
      status: "pending",
      totalCertified: null,
      grades: [],
      note: `Looking up ${FINISH_META[finish].label} population for this print.`,
    },
    priceHistory: card.priceHistory,
    marketHistory: undefined,
    historyUnavailable: undefined,
  };
}

export function saleMatchesFinish(sale: SaleRecord, finish?: CardFinishId | null) {
  if (!finish) {
    return true;
  }

  const haystack = [sale.title, sale.condition, sale.source].filter(Boolean).join(" ");
  const isReverse = REVERSE_SALE.test(haystack);
  const isFirstEdition = FIRST_EDITION_SALE.test(haystack);
  const isHolo = HOLO_SALE.test(haystack) && !isReverse;

  switch (finish) {
    case "reverseHolofoil":
      return isReverse;
    case "firstEditionHolofoil":
      return isFirstEdition && !isReverse;
    case "firstEditionNormal":
      return isFirstEdition && !isHolo && !isReverse;
    case "holofoil":
    case "unlimitedHolofoil":
      return isHolo && !isFirstEdition;
    case "normal":
      return !isReverse && !isHolo;
    default:
      return true;
  }
}

export function filterSalesForFinish(sales: SaleRecord[], finish?: CardFinishId | null) {
  if (!finish || !sales.length) {
    return sales;
  }

  const matched = sales.filter((sale) => saleMatchesFinish(sale, finish));
  return matched.length ? matched : sales;
}

export function priceChartingFinishSuffixes(finish?: CardFinishId | null) {
  switch (finish) {
    case "reverseHolofoil":
      return ["-reverse-holo", "-reverse"];
    case "firstEditionHolofoil":
      return ["-1st-edition", "-1st-edition-holo"];
    case "firstEditionNormal":
      return ["-1st-edition"];
    case "unlimitedHolofoil":
      return ["", "-unlimited"];
    case "holofoil":
      // Promo and modern holos live on the unsuffixed PriceCharting product
      // (`/pikachu-swsh020`). Trying `-holo` first 404s and burns the detail budget.
      return ["", "-holo"];
    case "normal":
    default:
      return [""];
  }
}

export function productUrlMatchesFinish(
  url: string,
  finish?: CardFinishId | null,
  rarity?: string | null,
) {
  if (!finish) {
    return true;
  }

  const path = url.toLowerCase();
  const isReverse = /reverse/.test(path);
  const isFirstEdition = /1st-edition|first-edition|1st edition|first edition/.test(path);
  const namedHolo = /(?:^|[/\s-])holo(?:foil)?(?:[/\s-]|$)/.test(path);

  if (finish === "reverseHolofoil") {
    return isReverse;
  }

  if (finish === "firstEditionHolofoil" || finish === "firstEditionNormal") {
    return isFirstEdition && !isReverse;
  }

  if (finish === "normal") {
    return !isReverse && !isFirstEdition && !namedHolo;
  }

  if (finish === "holofoil" || finish === "unlimitedHolofoil") {
    if (isReverse || isFirstEdition) {
      return false;
    }

    if (/\b(common|uncommon)\b/i.test(rarity ?? "")) {
      return namedHolo;
    }

    return true;
  }

  return !isReverse && !isFirstEdition;
}

export function withPriceChartingFinishSuffixes(
  url: string,
  finish?: CardFinishId | null,
  rarity?: string | null,
) {
  const stripped = url
    .replace(/\/$/, "")
    .replace(/-(?:reverse-holo|reverse|1st-edition-holo|1st-edition|unlimited|holo)$/i, "");
  const candidates = [...new Set(priceChartingFinishSuffixes(finish).map((suffix) => `${stripped}${suffix}`))];
  const matched = candidates.filter((candidate) => productUrlMatchesFinish(candidate, finish, rarity));
  return matched.length ? matched : candidates;
}

export function mageryFinishQueryToken(finish?: CardFinishId | null) {
  switch (finish) {
    case "reverseHolofoil":
      return "reverse holo";
    case "firstEditionHolofoil":
    case "firstEditionNormal":
      return "1st edition";
    case "holofoil":
    case "unlimitedHolofoil":
      return "holo";
    default:
      return "";
  }
}

export function splitEditionCardId(id: string): {
  baseId: string;
  finish: CardFinishId | null;
} {
  if (id.endsWith("-1st-edition")) {
    return {
      baseId: id.slice(0, -"-1st-edition".length),
      finish: "firstEditionHolofoil",
    };
  }
  if (id.endsWith("-unlimited")) {
    return {
      baseId: id.slice(0, -"-unlimited".length),
      finish: "unlimitedHolofoil",
    };
  }
  return { baseId: id, finish: null };
}

export function splitOfficialJapaneseCardSlugId(id: string): {
  officialCardId: string;
  finish: CardFinishId | null;
} {
  const { baseId, finish } = splitEditionCardId(id);
  return {
    officialCardId: baseId.replace(/^official-/, ""),
    finish,
  };
}

export function isFirstEditionFinish(finish?: CardFinishId | null) {
  return finish === "firstEditionHolofoil" || finish === "firstEditionNormal";
}

export function cardMatchesEditionFilter(card: TcgCard, edition: CardEditionFilter = "all") {
  if (edition === "all") {
    return true;
  }

  const isFirst =
    isFirstEditionFinish(card.finish) ||
    card.id.endsWith("-1st-edition") ||
    card.slug.endsWith("-1st-edition");

  if (edition === "1st") {
    return isFirst;
  }

  return !isFirst;
}

function isSpecializedEditionCard(card: TcgCard) {
  return (
    card.id.endsWith("-1st-edition") ||
    card.slug.endsWith("-1st-edition") ||
    card.id.endsWith("-unlimited") ||
    card.slug.endsWith("-unlimited") ||
    ((card.finishMarkets?.length ?? 0) === 1 && Boolean(card.finish))
  );
}

function unlimitedCounterpartFor(firstEdition: CardFinishId, markets: CardFinishMarket[]) {
  const allowed: CardFinishId[] =
    firstEdition === "firstEditionNormal"
      ? ["normal"]
      : ["unlimitedHolofoil", "holofoil"];
  return markets.find((market) => allowed.includes(market.id));
}

export function expandEditionSearchCards(card: TcgCard): TcgCard[] {
  if (isSpecializedEditionCard(card)) {
    return [card];
  }

  const markets = card.finishMarkets ?? [];
  const firstEdition = markets.find((market) => isFirstEditionFinish(market.id));
  if (!firstEdition) {
    return [card];
  }

  const unlimited = unlimitedCounterpartFor(firstEdition.id, markets);
  if (!unlimited) {
    return [card];
  }

  const unlimitedCard = {
    ...applySelectedFinish(card, unlimited.id),
    finishMarkets: markets.filter((market) => !isFirstEditionFinish(market.id)),
  };
  const firstEditionCard = {
    ...applySelectedFinish(
      {
        ...card,
        id: `${card.id}-1st-edition`,
        slug: `${card.slug}-1st-edition`,
      },
      firstEdition.id,
    ),
    finishMarkets: markets.filter((market) => isFirstEditionFinish(market.id)),
  };

  return [unlimitedCard, firstEditionCard];
}

export function expandJapaneseEditionSearchCards(card: TcgCard): TcgCard[] {
  return expandEditionSearchCards(card);
}

export function expandSearchResultEditions(results: SearchResult[]): SearchResult[] {
  const seenIds = new Set<string>();
  const expanded: SearchResult[] = [];

  for (const result of results) {
    for (const [index, card] of expandEditionSearchCards(result.card).entries()) {
      if (seenIds.has(card.id)) {
        continue;
      }
      seenIds.add(card.id);
      expanded.push({
        ...result,
        card,
        score: index === 0 ? result.score : Math.max(1, result.score - 0.05),
      });
    }
  }

  return expanded;
}

export function filterSearchResultsByEdition(
  results: SearchResult[],
  edition: CardEditionFilter = "all",
) {
  if (edition === "all") {
    return results;
  }

  return results.filter((result) => cardMatchesEditionFilter(result.card, edition));
}

export function applyEditionFilterToSearchResponse(
  response: LiveSearchResponse,
  edition: CardEditionFilter = "all",
): LiveSearchResponse {
  if (edition === "all") {
    return response;
  }

  const results = filterSearchResultsByEdition(response.results, edition);
  return {
    ...response,
    results,
    totalCount: response.totalCount == null ? null : results.length,
  };
}

export function applyEditionFinish(card: TcgCard, finish: CardFinishId): TcgCard {
  const markets = card.finishMarkets ?? [];
  const resolved =
    finish === "firstEditionHolofoil" && !markets.some((market) => market.id === finish)
      ? (markets.find((market) => market.id === "firstEditionNormal")?.id ?? finish)
      : finish;
  const selected = markets.find((market) => market.id === resolved);
  const next = applySelectedFinish(card, resolved);
  return selected ? { ...next, finishMarkets: [selected] } : next;
}
