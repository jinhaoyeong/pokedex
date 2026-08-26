import learnedCardsSeed from "../../data/pokemon-cards-seed.json";
import { attachFinishMarketsToCard } from "@/lib/card-finish";
import { getCardBySlug } from "@/lib/cards";
import { sanitizePartialPreviewMarketCard } from "@/lib/grading-market-lookup";
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
  return getCardBySlug(slug) ?? seedCardsBySlug.get(slug) ?? null;
}

/**
 * Full-page offline catalog from the high-trust seed (not a 4-card stub).
 * Homepage grail previews are excluded so 1st Edition tiles cannot inherit
 * the $185k static preview.
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

  for (const raw of seedCards) {
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
    if (scored.length >= limit * 3) {
      break;
    }
  }

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
    .map((item) => item.card);
}
