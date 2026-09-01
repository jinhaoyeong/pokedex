import learnedCardsSeed from "../../data/pokemon-cards-seed.json";
import { attachFinishMarketsToCard } from "@/lib/card-finish";
import { getCardBySlug } from "@/lib/cards";
import {
  cardHasPartialPreviewMarketData,
  sanitizePartialPreviewMarketCard,
} from "@/lib/grading-market-lookup";
import { isPokemonTcgPocketPrint } from "@/lib/pokemon-tcg/tcg-pocket";
import {
  lookupSimplifiedChineseCardBySlug,
  searchSimplifiedChineseCatalog,
} from "@/lib/simplified-chinese-catalog";
import type { CardLanguageFilter, TcgCard } from "@/types/pokemon";

const seedCards = ((learnedCardsSeed as { cards?: TcgCard[] }).cards ?? []).filter(
  (card) => typeof card?.slug === "string" && card.slug.trim(),
);
const seedCardsBySlug = new Map(seedCards.map((card) => [card.slug, card]));

function normalizeCatalogNeedle(value: string) {
  return value
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Instant identity for homepage/static cards and the exported high-trust seed.
 * Used when Postgres catalog/cache is not configured so card detail does not
 * wait on live API + Magery scrapes before first paint.
 */
export function lookupBundledCardBySlug(slug: string): TcgCard | null {
  const card =
    getCardBySlug(slug) ??
    seedCardsBySlug.get(slug) ??
    lookupSimplifiedChineseCardBySlug(slug) ??
    null;
  if (!card || isPokemonTcgPocketPrint(card)) {
    return null;
  }

  // Homepage grail previews must not win card-detail identity. A 1st Edition
  // Charizard slug used to return the $185k static showcase (then sanitize to $0)
  // instead of the live Unlimited vs 1st Edition markets.
  if (cardHasPartialPreviewMarketData(card)) {
    return null;
  }

  return sanitizePartialPreviewMarketCard(card);
}

/**
 * Full-page offline catalog from the high-trust seed (not a 4-card stub).
 * Homepage grail previews are excluded so 1st Edition tiles cannot inherit
 * the $185k static preview. Pass `limit: 0` to return every match so fallback
 * paging can reach cards past the first Dex page.
 */
export function searchBundledCards({
  query,
  setFilter,
  language = "all",
  limit = 24,
}: {
  query?: string;
  setFilter?: string;
  language?: CardLanguageFilter;
  limit?: number;
}): TcgCard[] {
  const needle = normalizeCatalogNeedle(query ?? "");
  const setNeedle = normalizeCatalogNeedle(setFilter ?? "");

  if (!needle && !setNeedle) {
    return [];
  }

  const scored: Array<{ card: TcgCard; score: number }> = [];
  const seen = new Set<string>();

  const chineseCatalog = searchSimplifiedChineseCatalog({
    query,
    setFilter,
    language,
    limit: 0,
  });
  for (const card of chineseCatalog) {
    if (isPokemonTcgPocketPrint(card)) {
      continue;
    }
    seen.add(card.slug);
    scored.push({
      card: attachFinishMarketsToCard(sanitizePartialPreviewMarketCard(card)),
      score: 90,
    });
  }

  for (const raw of seedCards) {
    if (seen.has(raw.slug)) {
      continue;
    }
    if (isPokemonTcgPocketPrint(raw)) {
      continue;
    }
    if (language !== "all" && raw.language !== language) {
      continue;
    }

    const setHaystack = normalizeCatalogNeedle(
      [raw.setId, raw.setCode, raw.setName, raw.setEnglishName, raw.setLocalizedName]
        .filter(Boolean)
        .join(" "),
    );
    if (setNeedle && !setHaystack.includes(setNeedle)) {
      continue;
    }

    const nameHaystack = normalizeCatalogNeedle(
      [raw.name, raw.englishName, raw.localizedName, raw.collectorNumber].filter(Boolean).join(" "),
    );
    if (needle && !nameHaystack.includes(needle)) {
      continue;
    }

    let score = 40;
    if (needle && nameHaystack.startsWith(needle)) {
      score += 40;
    } else if (needle && nameHaystack.includes(` ${needle}`)) {
      score += 20;
    }
    if (setNeedle && (raw.setId || "").toLowerCase() === setNeedle) {
      score += 20;
    }

    scored.push({
      card: attachFinishMarketsToCard(sanitizePartialPreviewMarketCard(raw)),
      score,
    });
  }

  const ranked = scored.sort((left, right) => right.score - left.score).map((item) => item.card);
  return limit > 0 ? ranked.slice(0, limit) : ranked;
}
