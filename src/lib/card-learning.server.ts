import "server-only";

import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
import { loadCardWithGradingMarket } from "@/lib/grading-market";
import { isOfficialJapaneseCatalogFallbackCard } from "@/lib/pokemon-tcg/market-enrichment";
import {
  listCardsNeedingRefresh,
  lookupCachedCardBySlug,
  lookupCachedCardsByQuery,
  persistCard,
  shouldRefreshCachedCard,
  type CachedCardMeta,
} from "@/lib/pokemon-cards-cache.server";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";
import {
  findJapaneseCardNameSearchAliases,
  findLocalizedPokemonNameAliases,
} from "@/lib/pokemon-name-db.server";
import { localizedCardMatchesNameQuery } from "@/lib/pokemon-tcg/text-and-collector-utils";
import type { CardLanguageFilter, SearchResult, TcgCard } from "@/types/pokemon";

function getRefreshBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL?.trim()) {
    return process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL?.trim()) {
    return `https://${process.env.VERCEL_URL.trim()}`;
  }

  return "http://localhost:3000";
}

function shouldBlockOnDetailGrading(card: TcgCard) {
  return card.language === "en" && !isOfficialJapaneseCatalogFallbackCard(card);
}

export function scheduleCardBackgroundRefresh(slug: string) {
  const baseUrl = getRefreshBaseUrl();
  const token = process.env.INTERNAL_REFRESH_TOKEN?.trim();

  void fetch(`${baseUrl}/api/card-cache/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-internal-token": token } : {}),
    },
    body: JSON.stringify({ slug }),
    cache: "no-store",
  }).catch(() => undefined);
}

export async function refreshCardInBackground(slug: string): Promise<TcgCard | null> {
  const live = await fetchLiveCardBySlug(slug, { includePublicPriceFallback: true }).catch(
    () => null,
  );

  if (!live) {
    return (await lookupCachedCardBySlug(slug))?.card ?? null;
  }

  const enriched = await loadCardWithGradingMarket(live);
  await persistCard(enriched.card, { context: "refresh" });
  return enriched.card;
}

export async function resolveCachedCardForDetail(slug: string) {
  const cached = await lookupCachedCardBySlug(slug);

  if (!cached) {
    return null;
  }

  if (shouldRefreshCachedCard(cached.meta)) {
    scheduleCardBackgroundRefresh(slug);
  }

  return cached;
}

export async function resolveCardForCatalog(
  slug: string,
  includePublicPriceFallback: boolean,
  options: {
    enrichGrading?: boolean;
    /** Optional prefetched learning-cache hit so callers can overlap index I/O. */
    prefetchedCached?: Awaited<ReturnType<typeof resolveCachedCardForDetail>>;
  } = {},
): Promise<{ card: TcgCard | null; source: "live" | "cache" | "none"; meta?: CachedCardMeta }> {
  const enrichGrading = options.enrichGrading ?? false;

  try {
    const cached =
      options.prefetchedCached !== undefined
        ? options.prefetchedCached
        : await resolveCachedCardForDetail(slug);

    if (cached) {
      if (
        enrichGrading &&
        shouldBlockOnDetailGrading(cached.card) &&
        cardNeedsGradingMarketEnrichment(cached.card)
      ) {
        const enriched = await loadCardWithGradingMarket(cached.card);
        await persistCard(enriched.card, { context: "detail" });
        return { card: enriched.card, source: "cache", meta: cached.meta };
      }

      return { card: cached.card, source: "cache", meta: cached.meta };
    }

    const live = await fetchLiveCardBySlug(slug, { includePublicPriceFallback });

    if (live) {
      if (enrichGrading && shouldBlockOnDetailGrading(live)) {
        const enriched = await loadCardWithGradingMarket(live);
        await persistCard(enriched.card, { context: "detail" });
        return { card: enriched.card, source: "live" };
      }

      await persistCard(live, { context: "detail" });
      return { card: live, source: "live" };
    }
  } catch {
    // Fall through to none.
  }

  return { card: null, source: "none" };
}

export async function buildLearnedSearchResults(
  query: string,
  language: CardLanguageFilter,
): Promise<SearchResult[]> {
  const learned = await lookupCachedCardsByQuery(query, language, 16);
  const aliases =
    language === "ja"
      ? await findJapaneseCardNameSearchAliases(query).catch(() => [])
      : language !== "all" && language !== "en"
        ? await findLocalizedPokemonNameAliases(query, language).catch(() => [])
        : [];

  return learned
    .filter((item) => localizedCardMatchesNameQuery(item.card, query, aliases))
    .map((item) => ({
      card: item.card,
      score: Math.round(item.score),
      matchReason:
        item.meta.trustScore >= 0.7
          ? "Learned match from community search history"
          : item.meta.wrongPriceFlags > 0 || item.meta.wrongCardFlags > 0
            ? "Learned match (under review after user flags)"
            : "Learned match (training accuracy from prior searches)",
    }));
}

export async function scheduleLearningRefreshQueue(limit = 5) {
  for (const slug of await listCardsNeedingRefresh(limit)) {
    scheduleCardBackgroundRefresh(slug);
  }
}
