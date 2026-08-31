import type { Metadata } from "next";
import { Suspense } from "react";

import { CardDetailLoader } from "@/components/card/card-detail-loader";
import { CardDetailSkeleton } from "@/components/card/card-detail-skeleton";
import { getCardCatalogCached } from "@/lib/card-catalog";
import { getCards } from "@/lib/cards";
import { fetchGradingMarketData, mergeLiveMarketDataIntoCard } from "@/lib/grading-market";
import {
  resolveGradingMarketLookupCardName,
  resolveGradingMarketLookupSetName,
  sanitizePartialPreviewMarketCard,
} from "@/lib/grading-market-lookup";
import { hasLiveMarketSignal } from "@/lib/market/live-market-merge";
import { lookupCachedCardBySlug } from "@/lib/pokemon-cards-cache.server";
import type { TcgCard } from "@/types/pokemon";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function titleFromSlug(slug: string) {
  const [, id = slug] = slug.split("--");
  return id.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cached = (await lookupCachedCardBySlug(slug))?.card;

  if (cached) {
    const displayTitle =
      cached.language !== "en" && cached.localizedName?.trim()
        ? cached.localizedName
        : cached.name;

    return {
      title: `${displayTitle} ${cached.collectorNumber}`,
    };
  }

  return {
    title: titleFromSlug(slug),
  };
}

export async function generateStaticParams() {
  return getCards().map((card) => ({ slug: card.slug }));
}

async function CardDetailServer({ slug }: { slug: string }) {
  // Same catalog resolver as /api/cards. Identity only — Magery/sold-comp
  // scrapes stay on /api/price and /api/grading-market so first paint stays fast.
  let initialCard: TcgCard | null = null;
  let lookupFailed = false;
  let initialNotFound = false;

  try {
    const lookup = await getCardCatalogCached(slug, false, { hydrateTimeoutMs: 2_000 });
    initialCard = lookup.card ? sanitizePartialPreviewMarketCard(lookup.card) : null;
    lookupFailed = lookup.lookupFailed;
    initialNotFound = !lookup.card && !lookup.lookupFailed;
  } catch (error) {
    console.error(`Card detail SSR lookup failed for "${slug}"`, error);
    lookupFailed = true;
  }

  if (initialCard) {
    try {
      const cachedMarket = await fetchGradingMarketData(
        resolveGradingMarketLookupSetName(initialCard),
        resolveGradingMarketLookupCardName(initialCard),
        initialCard.collectorNumber,
        initialCard.marketPriceUsd,
        initialCard.setPrintedTotal ?? initialCard.setTotal,
        initialCard.rarity,
        {
          setCode: initialCard.setCode,
          isJapanese: initialCard.language === "ja",
          language: initialCard.language,
          englishCardName: initialCard.englishName?.trim() || undefined,
          productId: initialCard.marketIdentity?.priceChartingProductId ?? undefined,
          productUrl: initialCard.marketIdentity?.priceChartingProductUrl ?? undefined,
          setSlug: initialCard.marketIdentity?.priceChartingSetSlug ?? undefined,
          identityVersion: initialCard.marketIdentity?.identityVersion,
          officialCardId: initialCard.officialCardId ?? undefined,
          finish: initialCard.finish,
          allowScrape: false,
        },
      );

      if (cachedMarket && hasLiveMarketSignal(cachedMarket)) {
        const next = structuredClone(initialCard);
        mergeLiveMarketDataIntoCard(next, cachedMarket);
        initialCard = next;
      }
    } catch (error) {
      console.warn(`Card detail cached market overlay failed for "${slug}"`, error);
    }
  }

  return (
    <CardDetailLoader
      slug={slug}
      initialCard={initialCard}
      lookupFailed={lookupFailed}
      initialNotFound={initialNotFound}
    />
  );
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <Suspense fallback={<CardDetailSkeleton />}>
      <CardDetailServer slug={slug} />
    </Suspense>
  );
}
