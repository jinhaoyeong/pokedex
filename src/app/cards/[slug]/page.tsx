import type { Metadata } from "next";
import { Suspense } from "react";

import { CardDetailLoader } from "@/components/card/card-detail-loader";
import { CardDetailSkeleton } from "@/components/card/card-detail-skeleton";
import { getCardCatalogCached } from "@/lib/card-catalog";
import { sanitizePartialPreviewMarketCard } from "@/lib/grading-market-lookup";
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

  return {
    title: titleFromSlug(slug),
  };
}

async function CardDetailServer({ slug }: { slug: string }) {
  // Identity only. Live market scrapes stay on /api/price and
  // /api/grading-market so this Suspense boundary can resolve without waiting
  // on Magery, PriceCharting crawls, or a busy Postgres pool.
  let initialCard: TcgCard | null = null;
  let lookupFailed = false;
  let initialNotFound = false;

  try {
    const lookup = await getCardCatalogCached(slug, false, { hydrateTimeoutMs: 1_500 });
    initialCard = lookup.card ? sanitizePartialPreviewMarketCard(lookup.card) : null;
    lookupFailed = lookup.lookupFailed;
    initialNotFound = !lookup.card && !lookup.lookupFailed;
  } catch (error) {
    console.error(`Card detail SSR lookup failed for "${slug}"`, error);
    lookupFailed = true;
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
