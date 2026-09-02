import "server-only";

import { lookupPriceChartingSetGuidePrice } from "@/lib/market/pricecharting-set-guide.server";
import { canUseJapaneseSetGuideWithoutOfficialIdentity } from "@/lib/price/japanese-list-price";
import { lookupJapaneseTcgdexListPrice } from "@/lib/price/japanese-list-price.server";
import {
  PRICE_SORT_BATCH_BUDGET_MS,
  PRICE_SORT_BATCH_MAX_CARDS,
  providerResultToLookupPayload,
  resolvedPriceToLookupPayload,
} from "@/lib/price/list-price-batch";
import { priceCacheSlugAliases } from "@/lib/price/price-cache-keys";
import { readCachedPriceMap, writeCachedPrice } from "@/lib/price/price-cache.server";
import { priceQueryFromLookupFields, type PriceLookupPayload } from "@/lib/price/price-query";
import { isPricedProviderResult, isPricedResolvedPrice } from "@/lib/price/priced-payload";
import { sanitizeResolvedPrice } from "@/lib/price/sanity";
import type { PriceQuery, ProviderPriceResult, ResolvedPrice } from "@/lib/price/types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function persistResolved(resolved: ResolvedPrice, query: PriceQuery) {
  if (!isPricedResolvedPrice(resolved)) {
    return;
  }

  for (const slug of priceCacheSlugAliases(query)) {
    void writeCachedPrice(
      { ...resolved, slug },
      { language: query.language, setCode: query.setCode },
    );
  }
}

function fromGuide(query: PriceQuery, result: ProviderPriceResult): ResolvedPrice {
  return sanitizeResolvedPrice({
    slug: query.slug,
    ungradedUsd: result.ungradedUsd,
    confidenceScore: result.confidenceScore,
    primaryProvider: result.provider,
    results: [result],
    fetchedAt: result.fetchedAt,
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
) {
  if (!items.length) {
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await mapper(items[currentIndex]);
      }
    }),
  );
}

export async function lookupListPricesBatch(
  rawCards: Array<Record<string, string | undefined | null>>,
  options: { budgetMs?: number } = {},
): Promise<Record<string, PriceLookupPayload>> {
  const budgetMs = options.budgetMs ?? PRICE_SORT_BATCH_BUDGET_MS;
  const startedAt = Date.now();
  const queries = rawCards
    .slice(0, PRICE_SORT_BATCH_MAX_CARDS)
    .map((fields) => priceQueryFromLookupFields(fields))
    .filter((query): query is PriceQuery => Boolean(query));
  const prices: Record<string, PriceLookupPayload> = {};

  if (!queries.length) {
    return prices;
  }

  const remaining = () => Math.max(0, budgetMs - (Date.now() - startedAt));
  const allAliases = queries.flatMap((query) => priceCacheSlugAliases(query));
  const cached = await readCachedPriceMap(allAliases, CACHE_TTL_MS);

  const misses: PriceQuery[] = [];

  for (const query of queries) {
    let hit: ResolvedPrice | null = null;
    for (const alias of priceCacheSlugAliases(query)) {
      const cachedPrice = cached.get(alias.toLowerCase());
      if (cachedPrice && isPricedResolvedPrice(cachedPrice)) {
        hit = { ...cachedPrice, slug: query.slug };
        break;
      }
    }

    if (hit) {
      prices[query.slug] = resolvedPriceToLookupPayload(hit);
    } else {
      misses.push(query);
    }
  }

  if (!misses.length || remaining() < 80) {
    return prices;
  }

  await mapWithConcurrency(misses, 8, async (query) => {
    if (remaining() < 80 || prices[query.slug]) {
      return;
    }

    const guide = await lookupPriceChartingSetGuidePrice(query).catch(() => null);
    if (guide && isPricedProviderResult(guide)) {
      const resolved = fromGuide(query, guide);
      persistResolved(resolved, query);
      prices[query.slug] = providerResultToLookupPayload(query.slug, guide);
      return;
    }

    if (
      remaining() < 80 ||
      !canUseJapaneseSetGuideWithoutOfficialIdentity({
        language: query.language,
        cardId: query.cardId,
        slug: query.slug,
        officialCardId: query.officialCardId,
        setCode: query.setCode,
        collectorNumber: query.collectorNumber,
        englishName: query.englishName,
        setEnglishName: query.setEnglishName,
        setName: query.setName,
      })
    ) {
      return;
    }

    const japaneseGuide = await lookupJapaneseTcgdexListPrice(query).catch(() => null);
    if (japaneseGuide && isPricedProviderResult(japaneseGuide)) {
      const resolved = fromGuide(query, japaneseGuide);
      persistResolved(resolved, query);
      prices[query.slug] = providerResultToLookupPayload(query.slug, japaneseGuide);
    }
  });

  return prices;
}
