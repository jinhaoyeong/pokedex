import learnedCardsSeed from "../../data/pokemon-cards-seed.json";
import { getCardBySlug } from "@/lib/cards";
import type { TcgCard } from "@/types/pokemon";

const seedCards = ((learnedCardsSeed as { cards?: TcgCard[] }).cards ?? []).filter(
  (card) => typeof card?.slug === "string" && card.slug.trim(),
);
const seedCardsBySlug = new Map(seedCards.map((card) => [card.slug, card]));

/**
 * Instant identity for homepage/static cards and the exported high-trust seed.
 * Used when Postgres catalog/cache is not configured so card detail does not
 * wait on live API + Magery scrapes before first paint.
 */
export function lookupBundledCardBySlug(slug: string): TcgCard | null {
  return getCardBySlug(slug) ?? seedCardsBySlug.get(slug) ?? null;
}
