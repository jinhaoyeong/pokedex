"use client";

import Image from "next/image";
import Link from "next/link";

import { ClientPrice } from "@/components/client-price";
import { HoloTilt } from "@/components/fx/holo-tilt";
import { useBootPreviewCards } from "@/hooks/use-boot-preview-cards";
import { useLazyCardPrice } from "@/hooks/use-lazy-card-price";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { MARKET_PICKS_LIMIT } from "@/lib/preview-constants";
import type { TcgCard } from "@/types/pokemon";

function MarketPickPrice({ card }: { card: TcgCard }) {
  const { priceUsd, isLoading } = useLazyCardPrice(card);

  if (priceUsd > 0) {
    return (
      <ClientPrice
        amountUsd={priceUsd}
        className="market-pick-price block max-w-full truncate text-base font-semibold tabular-nums leading-tight text-[var(--text)] sm:text-lg"
      />
    );
  }

  if (isLoading) {
    return (
      <span
        aria-label="Loading market price"
        className="block h-5 w-24 max-w-full animate-pulse rounded-md bg-white/10"
      />
    );
  }

  return <span className="text-sm font-medium text-amber-200">Price pending</span>;
}

export function MarketPicksGrid({ initialCards }: { initialCards: TcgCard[] }) {
  const cards = useBootPreviewCards(initialCards).slice(0, MARKET_PICKS_LIMIT);

  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
      {cards.map((card, index) => (
        <Link
          key={`${card.slug}__${index}`}
          href={`/cards/${card.slug}`}
          onClick={() => stashCardForNavigation(card)}
          className="basecamp-market-card basecamp-market-card--pick group grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-4 rounded-2xl p-4 transition duration-200 hover:-translate-y-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:p-5 lg:grid-cols-1 lg:p-6"
        >
          <HoloTilt className="basecamp-market-image relative aspect-[0.72/1] overflow-hidden rounded-xl lg:mx-auto lg:w-full lg:max-w-[9.5rem]">
            <Image
              src={card.image}
              alt={card.name}
              fill
              sizes="(max-width: 640px) 84px, (max-width: 1024px) 96px, 152px"
              priority={index < 3}
              unoptimized
              className="object-contain p-1.5 transition duration-200 group-hover:scale-[1.03]"
            />
          </HoloTilt>

          <div className="flex min-w-0 flex-col">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
              Live pick {index + 1}
            </p>
            <h3 className="mt-1 break-words text-base font-semibold leading-tight text-white sm:text-lg">
              {card.name}
            </h3>
            <p className="mt-1.5 break-words text-sm leading-5 text-slate-400">
              {card.setName} &middot; #{card.collectorNumber}
            </p>
            <div className="mt-auto min-w-0 space-y-2 pt-3">
              <span className="result-chip inline-flex max-w-full truncate">{card.rarity}</span>
              <MarketPickPrice card={card} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
