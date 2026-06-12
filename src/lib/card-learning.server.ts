import "server-only";

import { loadCardWithGradingMarket } from "@/lib/grading-market";
import {
  listCardsNeedingRefresh,
  lookupCachedCardBySlug,
  lookupCachedCardsByQuery,
  persistCard,
  shouldRefreshCachedCard,
  type CachedCardMeta,
} from "@/lib/pokemon-cards-cache.server";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";
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
    return lookupCachedCardBySlug(slug)?.card ?? null;
  }

  const enriched = await loadCardWithGradingMarket(live);
  persistCard(enriched.card, { context: "refresh" });
  return enriched.card;
}

export function resolveCachedCardForDetail(slug: string) {
  const cached = lookupCachedCardBySlug(slug);

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
  options: { enrichGrading?: boolean } = {},
): Promise<{ card: TcgCard | null; source: "live" | "cache" | "none"; meta?: CachedCardMeta }> {
  const enrichGrading = options.enrichGrading ?? false;

  try {
    const live = await fetchLiveCardBySlug(slug, { includePublicPriceFallback });

    if (live) {
      if (enrichGrading) {
        const enriched = await loadCardWithGradingMarket(live);
        persistCard(enriched.card, { context: "detail" });
        return { card: enriched.card, source: "live" };
      }

      persistCard(live, { context: "detail" });
      return { card: live, source: "live" };
    }
  } catch {
    // Fall through to cache.
  }

  const cached = resolveCachedCardForDetail(slug);

  if (cached) {
    return { card: cached.card, source: "cache", meta: cached.meta };
  }

  return { card: null, source: "none" };
}

export function buildLearnedSearchResults(
  query: string,
  language: CardLanguageFilter,
): SearchResult[] {
  const learned = lookupCachedCardsByQuery(query, language, 16);

  return learned.map((item) => ({
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

export function scheduleLearningRefreshQueue(limit = 5) {
  for (const slug of listCardsNeedingRefresh(limit)) {
    scheduleCardBackgroundRefresh(slug);
  }
}
