import type { Metadata } from "next";

import { CardDetailLoader } from "@/components/card/card-detail-loader";
import { lookupCachedCardBySlug } from "@/lib/pokemon-cards-cache.server";
import { getCards } from "@/lib/cards";

export const revalidate = 21600;

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
  const cached = lookupCachedCardBySlug(slug)?.card;

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

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <CardDetailLoader slug={slug} />;
}
