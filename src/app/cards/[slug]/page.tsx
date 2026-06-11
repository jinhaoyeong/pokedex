import type { Metadata } from "next";

import { CardDetailLoader } from "@/components/card/card-detail-loader";
import { getCardCatalogCached } from "@/lib/card-catalog";
import { getCards } from "@/lib/cards";

export const revalidate = 21600;

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
  const { card, lookupFailed } = await getCardCatalogCached(slug, true);

  return (
    <CardDetailLoader
      key={slug}
      slug={slug}
      initialCard={card}
      lookupFailed={lookupFailed}
      initialNotFound={!card && !lookupFailed}
    />
  );
}
