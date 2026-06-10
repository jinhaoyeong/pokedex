import type { Metadata } from "next";
import { cache } from "react";

import { CardDetailLoader } from "@/components/card/card-detail-loader";
import { getCardBySlug, getCards } from "@/lib/cards";
import { fetchLiveCardBySlug } from "@/lib/pokemon-tcg-api";

export const revalidate = 21600;

const getCardCatalogCached = cache(
  async (
    slug: string,
    includePublicPriceFallback: boolean,
  ): Promise<{ card: Awaited<ReturnType<typeof fetchLiveCardBySlug>>; lookupFailed: boolean }> => {
    const localCard = getCardBySlug(slug);

    if (localCard) {
      return { card: localCard, lookupFailed: false };
    }

    try {
      return {
        card: await fetchLiveCardBySlug(slug, { includePublicPriceFallback }),
        lookupFailed: false,
      };
    } catch (error) {
      console.error(`Live card lookup failed for "${slug}"`, error);
      return { card: null, lookupFailed: true };
    }
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { card, lookupFailed } = await getCardCatalogCached(slug, false);

  if (!card) {
    return { title: lookupFailed ? "Card Temporarily Unavailable" : "Card Not Found" };
  }

  const displayTitle =
    card.language !== "en" && card.localizedName?.trim()
      ? card.localizedName
      : card.name;

  return {
    title: `${displayTitle} ${card.collectorNumber}`,
  };
}

export async function generateStaticParams() {
  return getCards().map((card) => ({ slug: card.slug }));
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <CardDetailLoader slug={slug} />;
}
