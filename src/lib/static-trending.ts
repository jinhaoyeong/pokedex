import learnedCardsSeed from "../../data/pokemon-cards-seed.json";
import { tcgCards as STATIC_CARDS } from "@/data/cards";
import { collapseSearchResultEditions } from "@/lib/card-finish";
import {
  isUsablePreviewCard,
  normalizePreviewCard,
} from "@/lib/preview-selection";
import { SEARCH_PAGE_SIZE } from "@/lib/search-constants";
import { rankSearchResultsByTrending } from "@/lib/trending";
import { isPokemonTcgPocketPrint } from "@/lib/pokemon-tcg/tcg-pocket";
import type { LiveSearchResponse, TcgCard } from "@/types/pokemon";

/**
 * Bundled static pool so Dex/home still have cards when live APIs time out.
 * Keep this module free of pokemon-tcg-api imports to avoid a cycle.
 * List tiles must keep their curated market values — sanitizing them to $0
 * made Dex show "Price pending" / wrong estimates.
 */
export function getStaticMarketPool(): TcgCard[] {
  const seen = new Set<string>();
  const pool: TcgCard[] = [];
  const seedCards = (learnedCardsSeed as { cards?: TcgCard[] }).cards ?? [];

  for (const card of [...STATIC_CARDS, ...seedCards]) {
    if (!isUsablePreviewCard(card) || seen.has(card.slug) || isPokemonTcgPocketPrint(card)) {
      continue;
    }

    seen.add(card.slug);
    pool.push(normalizePreviewCard(card));
  }

  return pool;
}

export function getStaticTrendingSearchResponse(limit = SEARCH_PAGE_SIZE): LiveSearchResponse {
  const unique = collapseSearchResultEditions(
    getStaticMarketPool().map((card) => ({
      card,
      score: 0,
      matchReason: "Trending & Hot",
    })),
  );
  const ranked = rankSearchResultsByTrending(unique).slice(0, limit);

  return {
    results: ranked.map((result, index) => ({
      ...result,
      score: Math.max(1, 90 - index),
      matchReason: "Trending & Hot",
    })),
    totalCount: ranked.length,
    page: 1,
    pageSize: limit,
    hasNextPage: false,
  };
}
