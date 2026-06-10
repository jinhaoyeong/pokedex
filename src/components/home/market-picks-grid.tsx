"use client";

import Image from "next/image";
import Link from "next/link";

import { ClientPrice } from "@/components/client-price";
import { useBootPreviewCards } from "@/hooks/use-boot-preview-cards";
import type { TcgCard } from "@/types/pokemon";

export function MarketPicksGrid({ initialCards }: { initialCards: TcgCard[] }) {
  const cards = useBootPreviewCards(initialCards);

  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
      {cards.map((card, index) => (
        <Link
          key={`${card.slug}__${index}`}
          href={`/cards/${card.slug}`}
          className="basecamp-market-card group grid grid-cols-[6rem_minmax(0,1fr)] gap-4 rounded-2xl p-4 transition duration-200 hover:-translate-y-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:p-5 lg:grid-cols-1 lg:p-6"
        >
          <div className="basecamp-market-image relative aspect-[0.72/1] overflow-hidden rounded-xl lg:mx-auto lg:w-full lg:max-w-[9.5rem]">
            <Image
              src={card.image}
              alt={card.name}
              fill
              sizes="(max-width: 640px) 84px, (max-width: 1024px) 96px, 152px"
              className="object-contain p-1.5 transition duration-200 group-hover:scale-[1.03]"
            />
          </div>

          <div className="flex min-w-0 flex-col">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-200">
              Live pick {index + 1}
            </p>
            <h3 className="mt-1 break-words text-base font-semibold leading-tight text-white sm:text-lg">
              {card.name}
            </h3>
            <p className="mt-1.5 break-words text-sm leading-5 text-slate-400">
              {card.setName} &middot; #{card.collectorNumber}
            </p>
            <div className="mt-auto flex items-end justify-between gap-3 pt-3">
              <span className="result-chip">{card.rarity}</span>
              <ClientPrice
                amountUsd={card.marketPriceUsd}
                className="shrink-0 text-right text-lg font-semibold leading-none text-blue-200 sm:text-xl"
              />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
