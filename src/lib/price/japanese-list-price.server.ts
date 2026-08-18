import "server-only";

import {
  fetchTcgdexJapaneseDexIds,
  resolveJapaneseCardIdentity,
} from "@/lib/japanese-card-identity";
import { getLocalizedSetMarketProfile } from "@/lib/localized-set-market";
import { formatBilingualName } from "@/lib/pokemon-tcg/text-and-collector-utils";
import {
  applyPriceChartingSetGuideToCards,
  fetchPriceChartingSetGuide,
  fetchPriceChartingSetGuideHead,
  findPriceChartingSetGuideEntry,
  peekCachedPriceChartingSetGuide,
  type PriceChartingSetGuide,
} from "@/lib/market/pricecharting-set-guide.server";
import { fetchPublicPageText, isPublicPageCircuitOpen } from "@/lib/public-page-fetch";
import { parsePriceChartingPublicPagePrices } from "@/lib/market/pricecharting-provider";
import { isTcgdexStyleJapaneseCardId } from "@/lib/price/japanese-list-price";
import {
  inferEnglishNameFromTcgdexLocalizedName,
  resolveJapaneseListEnglishName,
} from "@/lib/tcgdex-japanese-name";
import type { PriceQuery, ProviderPriceResult } from "@/lib/price/types";
import type { TcgCard } from "@/types/pokemon";

const LIST_HEAD_BUDGET_MS = 2_500;
const LIST_HEAD_MAX_SETS = 2;

const warmupQueue: string[] = [];
let warmupRunning = false;

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void task
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

async function listEnglishName(query: PriceQuery) {
  const syncName = resolveJapaneseListEnglishName({
    name: query.name,
    englishName: query.englishName,
  });

  if (syncName) {
    return syncName;
  }

  const localized = (query.name || "").replace(/\s*\([^)]+\)\s*$/, "").trim();
  const dexIds = isTcgdexStyleJapaneseCardId(query.cardId, query.slug)
    ? await fetchTcgdexJapaneseDexIds(query.cardId)
    : undefined;

  return resolveJapaneseCardIdentity({
    jpName: localized,
    setCode: query.setCode,
    collectorNumber: query.collectorNumber,
    cardId: query.cardId,
    dexIds,
    skipTcgdex: true,
  });
}

function normalizeNameKey(value?: string | null) {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clearUntrustedJapaneseListPrice(card: TcgCard): TcgCard {
  return {
    ...card,
    marketPriceUsd: 0,
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded" ? { ...price, value: 0 } : price,
    ),
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: 0,
          sources: [],
        }
      : card.priceConsensus,
    sources: card.sources.filter(
      (source) => !/pricecharting|public guide|cached market/i.test(source.source),
    ),
  };
}

export async function repairJapaneseTcgdexListCards(cards: TcgCard[]): Promise<TcgCard[]> {
  return Promise.all(
    cards.map(async (card) => {
      if (card.language !== "ja" || !isTcgdexStyleJapaneseCardId(card.id, card.slug)) {
        return card;
      }

      const localizedName = (card.localizedName ?? card.name)
        .replace(/\s*\([^)]+\)\s*$/, "")
        .trim();
      const inferred = inferEnglishNameFromTcgdexLocalizedName(localizedName);
      let resolved =
        inferred ||
        (await resolveJapaneseCardIdentity({
          jpName: localizedName,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
          cardId: card.id,
          dexIds: card.dexIds,
          skipTcgdex: true,
        }));

      if (!resolved && isTcgdexStyleJapaneseCardId(card.id, card.slug)) {
        const dexIds = card.dexIds?.length
          ? card.dexIds
          : await fetchTcgdexJapaneseDexIds(card.id);
        resolved = await resolveJapaneseCardIdentity({
          jpName: localizedName,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
          cardId: card.id,
          dexIds,
          skipTcgdex: true,
        });
      }
      const englishName = resolved?.trim();

      if (!englishName) {
        if (card.englishName?.trim() && !inferEnglishNameFromTcgdexLocalizedName(localizedName)) {
          return clearUntrustedJapaneseListPrice({
            ...card,
            englishName: undefined,
            name: localizedName,
          });
        }

        return card;
      }

      const next: TcgCard = {
        ...card,
        englishName,
        name: formatBilingualName(localizedName, englishName),
      };

      if (normalizeNameKey(card.englishName) !== normalizeNameKey(englishName)) {
        return clearUntrustedJapaneseListPrice(next);
      }

      return next;
    }),
  );
}

function setGuideSlug(setCode?: string | null) {
  if (!setCode?.trim()) {
    return undefined;
  }

  return getLocalizedSetMarketProfile(setCode)?.priceChartingSlug;
}

async function providerFromGuide(
  query: PriceQuery,
  guide: PriceChartingSetGuide,
): Promise<ProviderPriceResult | null> {
  const englishName = await listEnglishName(query);
  const entry = findPriceChartingSetGuideEntry(
    {
      language: "ja",
      setCode: query.setCode,
      collectorNumber: query.collectorNumber,
      englishName,
    },
    guide.slug,
    guide.entries,
  );

  if (!entry?.ungradedUsd) {
    return null;
  }

  return {
    provider: "pricecharting-api",
    sourceLabel: "PriceCharting set guide",
    ungradedUsd: entry.ungradedUsd,
    confidenceScore: 0.62,
    matchConfidence: 0.92,
    evidenceType: "guide_snapshot",
    sourceUrl: entry.productUrl,
    productId: entry.productId,
    productName: entry.name,
    productUrl: entry.productUrl,
    setSlug: guide.slug,
    sampleCount: 1,
    fetchedAt: guide.fetchedAt,
  };
}

export async function lookupJapaneseTcgdexListPrice(
  query: PriceQuery,
): Promise<ProviderPriceResult | null> {
  const setSlug = setGuideSlug(query.setCode) || query.setSlug?.trim().toLowerCase();

  const englishName = await listEnglishName(query);

  if (!setSlug || !englishName) {
    return null;
  }

  const cached = await peekCachedPriceChartingSetGuide(setSlug);
  if (cached) {
    const fromCache = await providerFromGuide(query, cached);
    if (fromCache) {
      return fromCache;
    }
  }

  if (
    isPublicPageCircuitOpen("www.pricecharting.com") &&
    isPublicPageCircuitOpen("r.jina.ai")
  ) {
    return null;
  }

  const head = await withTimeout(fetchPriceChartingSetGuideHead(setSlug), LIST_HEAD_BUDGET_MS);
  return head ? await providerFromGuide(query, head) : null;
}

function uniqueSetSlugs(cards: TcgCard[]) {
  const slugs: string[] = [];

  for (const card of cards) {
    if (card.language !== "ja") {
      continue;
    }

    const slug = setGuideSlug(card.setCode);
    if (slug && !slugs.includes(slug)) {
      slugs.push(slug);
    }
  }

  return slugs;
}

export async function applyCachedJapaneseListPrices(cards: TcgCard[]): Promise<TcgCard[]> {
  if (!cards.some((card) => card.language === "ja")) {
    return cards;
  }

  const bySet = new Map<string, TcgCard[]>();

  for (const card of cards) {
    const key = card.language === "ja" ? card.setCode?.trim().toUpperCase() || "" : "";
    const group = bySet.get(key) ?? [];
    group.push(card);
    bySet.set(key, group);
  }

  const pricedById = new Map<string, TcgCard>();

  await Promise.all(
    [...bySet.entries()].map(async ([setCode, setCards]) => {
      const slug = setGuideSlug(setCode);
      if (!slug) {
        return;
      }

      const guide = await peekCachedPriceChartingSetGuide(slug);
      if (!guide) {
        return;
      }

      for (const card of applyPriceChartingSetGuideToCards(setCards, guide, {
        language: "ja",
        setCode,
      })) {
        pricedById.set(card.id, card);
      }
    }),
  );

  if (!pricedById.size) {
    return cards;
  }

  return cards.map((card) => pricedById.get(card.id) ?? card);
}

async function pumpJapaneseListSetGuideWarmup() {
  if (warmupRunning) {
    return;
  }

  warmupRunning = true;

  try {
    while (warmupQueue.length) {
      const slug = warmupQueue.shift();
      if (!slug) {
        continue;
      }

      const cached = await peekCachedPriceChartingSetGuide(slug);
      if (cached) {
        continue;
      }

      await fetchPriceChartingSetGuideHead(slug).catch(() => null);
    }
  } finally {
    warmupRunning = false;
    if (warmupQueue.length) {
      void pumpJapaneseListSetGuideWarmup();
    }
  }
}

export function scheduleJapaneseListSetGuideWarmup(cards: TcgCard[]) {
  for (const slug of uniqueSetSlugs(cards)) {
    if (!warmupQueue.includes(slug)) {
      warmupQueue.push(slug);
    }
  }

  void pumpJapaneseListSetGuideWarmup();
}

export async function hydrateJapaneseTcgdexListPrices(
  cards: TcgCard[],
  options: { budgetMs?: number; maxHeadFetches?: number; fullGuide?: boolean } = {},
): Promise<TcgCard[]> {
  const jaCards = cards.filter((card) => card.language === "ja");
  if (!jaCards.length) {
    return cards;
  }

  let next = await applyCachedJapaneseListPrices(await repairJapaneseTcgdexListCards(cards));
  const unpricedJa = next.filter(
    (card) => card.language === "ja" && !(card.marketPriceUsd > 0),
  );
  const useFullGuide = Boolean(options.fullGuide) || unpricedJa.length <= 8;
  const missingSlugs: string[] = [];

  for (const slug of uniqueSetSlugs(useFullGuide ? unpricedJa : next)) {
    if (/promo/i.test(slug)) {
      continue;
    }

    const cached = await peekCachedPriceChartingSetGuide(slug);
    if (!cached || (useFullGuide && cached.partial === true)) {
      missingSlugs.push(slug);
    }
  }

  const budgetMs = options.budgetMs ?? LIST_HEAD_BUDGET_MS;
  const maxHeadFetches = options.maxHeadFetches ?? LIST_HEAD_MAX_SETS;
  const fetchNow = [...new Set(missingSlugs)].slice(0, maxHeadFetches);

  if (
    fetchNow.length &&
    !(
      isPublicPageCircuitOpen("www.pricecharting.com") &&
      isPublicPageCircuitOpen("r.jina.ai")
    )
  ) {
    await withTimeout(
      Promise.all(
        fetchNow.map((slug) =>
          useFullGuide ? fetchPriceChartingSetGuide(slug) : fetchPriceChartingSetGuideHead(slug),
        ),
      ),
      budgetMs,
    );
    next = await applyCachedJapaneseListPrices(next);
  }

  next = await applyPerCardJapaneseListPrices(next, budgetMs);

  scheduleJapaneseListSetGuideWarmup(next);
  return next;
}

function collectorPriceChartingProductUrls(card: TcgCard, englishName: string) {
  const profile = getLocalizedSetMarketProfile(card.setCode);
  const slugs = [
    ...new Set(
      [profile?.priceChartingSlug, ...(profile?.priceChartingSlugAliases ?? [])].filter(
        (slug): slug is string => Boolean(slug),
      ),
    ),
  ];
  const nameSlug = englishName
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const raw = card.collectorNumber.replace(/^0+(?=\d)/, "") || card.collectorNumber;
  const numbers = [...new Set([raw, raw.padStart(3, "0")])];
  const urls: string[] = [];

  for (const slug of slugs) {
    for (const number of numbers) {
      if (nameSlug) {
        urls.push(`https://www.pricecharting.com/game/${slug}/${nameSlug}-${number}`);
      }
    }
  }

  return urls.slice(0, 4);
}

async function applyPerCardJapaneseListPrices(cards: TcgCard[], budgetMs: number): Promise<TcgCard[]> {
  const jaCards = cards.filter((card) => card.language === "ja");
  const unpriced = jaCards.filter((card) => !(card.marketPriceUsd > 0));

  // Name searches can have many unpriced JA rows. Per-card scrapes belong on
  // short collector hits (100/095, 288/SV-P), not Dialga name pages.
  if (!unpriced.length || jaCards.length > 8) {
    return cards;
  }

  const priced = await withTimeout(
    Promise.all(
      unpriced.map(async (card) => {
        const englishName =
          card.englishName?.trim() ||
          inferEnglishNameFromTcgdexLocalizedName(card.localizedName ?? card.name) ||
          "";
        const urls = collectorPriceChartingProductUrls(card, englishName);

        for (const url of urls) {
          try {
            const html = await fetchPublicPageText(url, 6 * 60 * 60, {
              readerFirst: false,
              preferHtml: true,
            });
            const prices = parsePriceChartingPublicPagePrices(html, url);
            const parsedUngraded = prices.find((price) => price.grade === "Ungraded")?.value ?? 0;
            const usedPrice = Number.parseFloat(
              (html.match(
                /id="used_price"[\s\S]{0,400}?\$([0-9][0-9,]*(?:\.[0-9]+)?)/i,
              )?.[1] ?? "").replace(/,/g, ""),
            );
            const ungradedUsd =
              parsedUngraded > 0
                ? parsedUngraded
                : Number.isFinite(usedPrice) && usedPrice > 0
                  ? usedPrice
                  : 0;

            if (!(ungradedUsd > 0)) {
              continue;
            }

            return {
              ...card,
              marketPriceUsd: ungradedUsd,
              gradedPrices: prices.length ? prices : card.gradedPrices,
              priceConsensus: {
                finalEstimateUsd: ungradedUsd,
                confidence: "medium" as const,
                confidenceScore: 0.62,
                sourceCount: 1,
                sampleCount: 0,
                methodology: "PriceCharting public guide for a short Dex collector result.",
                sources: [
                  {
                    source: "PriceCharting public guide",
                    value: ungradedUsd,
                    confidence: "medium" as const,
                    confidenceScore: 0.62,
                    evidenceType: "guide_snapshot" as const,
                    note: url,
                  },
                ],
              },
              sources: [
                ...card.sources,
                {
                  source: "PriceCharting public guide",
                  status: "verified" as const,
                  fetchedAt: new Date().toISOString(),
                  confidence: 0.62,
                  note: url,
                },
              ],
            } as TcgCard;
          } catch {
            continue;
          }
        }

        return card;
      }),
    ),
    budgetMs,
  );

  if (!priced) {
    return cards;
  }

  const byId = new Map(priced.map((card) => [card.id, card]));
  return cards.map((card) => byId.get(card.id) ?? card);
}
