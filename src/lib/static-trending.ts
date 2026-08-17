import learnedCardsSeed from "../../data/pokemon-cards-seed.json";
import { tcgCards as STATIC_CARDS } from "@/data/cards";
import {
  isUsablePreviewCard,
  normalizePreviewCard,
} from "@/lib/preview-selection";
import { SEARCH_PAGE_SIZE } from "@/lib/search-constants";
import type { LiveSearchResponse, TcgCard } from "@/types/pokemon";

/**
 * Bundled static pool so Dex/home still have cards when live APIs time out.
 * Keep this module free of pokemon-tcg-api imports to avoid a cycle.
 */
export function getStaticMarketPool(): TcgCard[] {
  const seen = new Set<string>();
  const pool: TcgCard[] = [];
  const seedCards = (learnedCardsSeed as { cards?: TcgCard[] }).cards ?? [];

  for (const card of [...STATIC_CARDS, ...seedCards]) {
    if (!isUsablePreviewCard(card) || seen.has(card.slug)) {
      continue;
    }

    seen.add(card.slug);
    pool.push(normalizePreviewCard(card));
  }

  return pool;
}

export function getStaticTrendingSearchResponse(limit = SEARCH_PAGE_SIZE): LiveSearchResponse {
  const cards = getStaticMarketPool().slice(0, limit);

  return {
    results: cards.map((card) => ({
      card,
      score: 90,
      matchReason: "Trending & Hot",
    })),
    totalCount: cards.length,
    page: 1,
    pageSize: limit,
    hasNextPage: false,
  };
}
