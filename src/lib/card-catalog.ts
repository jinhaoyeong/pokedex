import { cache } from "react";

import { cardNeedsGradingMarketEnrichment } from "@/lib/grading-market-lookup";
import { loadCardWithGradingMarket } from "@/lib/grading-market";
import {
  resolveCachedCardForDetail,
  resolveCardForCatalog,
} from "@/lib/card-learning.server";
import { lookupBundledCardBySlug } from "@/lib/bundled-cards";
import { resolveGuideSecretRareCardBySlug } from "@/lib/market/pricecharting-set-guide.server";
import { lookupCardInIndexBySlug } from "@/lib/pokemon-cards-index.server";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";
import { overlayCachedPrice } from "@/lib/price/overlay.server";
import { hydrateThinCatalogCard } from "@/lib/card-catalog-hydrate.server";
import {
  hasConfirmedJapaneseCanonicalMarketIdentity,
  normalizeJapaneseOfficialCardId,
} from "@/lib/japanese-market-identity";
import type { TcgCard } from "@/types/pokemon";

export type CardCatalogLookup = {
  card: TcgCard | null;
  lookupFailed: boolean;
  /** The official catalog was temporarily unable to establish a safe Japanese print identity. */
  identityRetryable?: boolean;
  source?: "local" | "live" | "cache";
};

export function japaneseOfficialCardIdFromSlug(slug: string) {
  return slug.match(/^ja--official-(\d+)$/i)?.[1] ?? null;
}

/**
 * Japanese official detail URLs are identity-bearing URLs, not generic cache
 * keys. A browse/index row can be useful for artwork, but must never win over
 * the official detail record unless it already carries every market-critical
 * field with official-detail confirmation.
 */
export function hasCompleteJapaneseOfficialDetailIdentity(
  card: TcgCard | null | undefined,
  officialCardId: string,
) {
  if (!card || card.language !== "ja") return false;

  const cardOfficialId = normalizeJapaneseOfficialCardId(
    card.officialCardId ?? card.marketIdentity?.officialCardId ?? "",
  );
  const expectedOfficialId = normalizeJapaneseOfficialCardId(officialCardId);
  const identity = card.marketIdentity;

  return Boolean(
    expectedOfficialId &&
      cardOfficialId === expectedOfficialId &&
      card.collectorNumber?.trim() &&
      card.englishName?.trim() &&
      card.setCode?.trim() &&
      card.localizedName?.trim() &&
      identity &&
      normalizeJapaneseOfficialCardId(identity.officialCardId) === expectedOfficialId &&
      identity.printedCollectorNumber?.trim() &&
      hasConfirmedJapaneseCanonicalMarketIdentity("ja", identity),
  );
}

function preserveSafeLocalJapaneseDetailMetadata(card: TcgCard, local?: TcgCard | null): TcgCard {
  if (!local) return card;

  return {
    ...card,
    // Live official identity is always authoritative. Only retain presentation
    // metadata when the hydrated detail genuinely lacks it.
    image: card.image && card.image !== "/icon.svg" ? card.image : local.image,
    artist: card.artist && card.artist !== "Unknown" ? card.artist : local.artist,
  };
}

export async function resolveJapaneseOfficialDetailForCatalog(
  slug: string,
  candidates: { local?: TcgCard | null; indexed?: TcgCard | null },
  hydrate: (slug: string) => Promise<TcgCard | null>,
): Promise<CardCatalogLookup> {
  const officialCardId = japaneseOfficialCardIdFromSlug(slug);
  if (!officialCardId) {
    throw new TypeError("Expected a Japanese official card slug");
  }

  const reusable = [candidates.local, candidates.indexed].find((card) =>
    hasCompleteJapaneseOfficialDetailIdentity(card, officialCardId),
  );
  if (reusable) {
    return { card: reusable, lookupFailed: false, source: "local" };
  }

  const hydrated = await hydrate(slug).catch(() => null);
  if (!hydrated || !hasCompleteJapaneseOfficialDetailIdentity(hydrated, officialCardId)) {
    // Do not expose a browse-position row as a successful card. This state is
    // explicitly retryable because the official detail endpoint is external.
    return { card: null, lookupFailed: true, identityRetryable: true };
  }

  return {
    card: preserveSafeLocalJapaneseDetailMetadata(hydrated, candidates.local ?? candidates.indexed),
    lookupFailed: false,
    source: "live",
  };
}

async function maybeEnrichCardGrading(card: TcgCard) {
  if (!cardNeedsGradingMarketEnrichment(card)) {
    return card;
  }

  const enriched = await loadCardWithGradingMarket(card);
  return enriched.card;
}

async function resolveCardCatalogLookup(
  slug: string,
  includePublicPriceFallback: boolean,
  options: { enrichGrading?: boolean } = {},
): Promise<CardCatalogLookup> {
  {
    const enrichGrading = options.enrichGrading ?? false;

    // Secret-rare supplement cards (`ja--official-pc-<set>-<number>`) exist only
    // in PriceCharting's set guide — the generic official-catalog lookup below
    // treats their id as a pokemon-card.com record and answers with a junk card
    // (empty image/number). Resolve them deterministically from the guide first;
    // the regex inside returns null instantly for every other slug shape.
    const secretRareCard = await resolveGuideSecretRareCardBySlug(slug).catch(() => null);

    if (secretRareCard) {
      return { card: secretRareCard, lookupFailed: false, source: "live" };
    }

    const localCard = lookupBundledCardBySlug(slug);
    const officialJapaneseId = japaneseOfficialCardIdFromSlug(slug);

    if (officialJapaneseId) {
      const indexedCard = await lookupCardInIndexBySlug(slug);
      const resolved = await resolveJapaneseOfficialDetailForCatalog(
        slug,
        { local: localCard, indexed: indexedCard },
        (detailSlug) => fetchLiveCardBySlug(detailSlug, { includePublicPriceFallback }),
      );

      if (!resolved.card || !enrichGrading || !cardNeedsGradingMarketEnrichment(resolved.card)) {
        return resolved;
      }

      return { ...resolved, card: await maybeEnrichCardGrading(resolved.card) };
    }

    if (localCard) {
      if (!enrichGrading || !cardNeedsGradingMarketEnrichment(localCard)) {
        return { card: localCard, lookupFailed: false, source: "local" };
      }

      return {
        card: await maybeEnrichCardGrading(localCard),
        lookupFailed: false,
        source: "local",
      };
    }

    // Overlap index + learning-cache I/O. Preference order is unchanged: index
    // still wins when present; the cache promise is only consumed on index miss.
    const cachedDetailPromise = resolveCachedCardForDetail(slug).catch(() => null);
    const indexedCard = await lookupCardInIndexBySlug(slug);

    if (indexedCard) {
      if (!enrichGrading || !cardNeedsGradingMarketEnrichment(indexedCard)) {
        return { card: indexedCard, lookupFailed: false, source: "local" };
      }

      return {
        card: await maybeEnrichCardGrading(indexedCard),
        lookupFailed: false,
        source: "local",
      };
    }

    try {
      const resolved = await resolveCardForCatalog(slug, includePublicPriceFallback, {
        enrichGrading,
        prefetchedCached: await cachedDetailPromise,
      });

      return {
        card: resolved.card,
        lookupFailed: resolved.source === "none",
        source: resolved.source === "none" ? undefined : resolved.source,
      };
    } catch (error) {
      console.error(`Live card lookup failed for "${slug}"`, error);
      return { card: null, lookupFailed: true };
    }
  }
}

export const getCardCatalogCached = cache(
  async (
    slug: string,
    includePublicPriceFallback: boolean,
    options: { enrichGrading?: boolean } = {},
  ): Promise<CardCatalogLookup> => {
    const result = await resolveCardCatalogLookup(slug, includePublicPriceFallback, options);
    const hydrated = result.card
      ? { ...result, card: await hydrateThinCatalogCard(result.card) }
      : result;
    // Cache-first price overlay: apply a warmed multi-source price without any
    // provider fetch in the render path. Misses leave the card as-is.
    return hydrated.card ? { ...hydrated, card: await overlayCachedPrice(hydrated.card) } : hydrated;
  },
);
