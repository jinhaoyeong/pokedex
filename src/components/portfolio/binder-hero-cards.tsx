"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { TcgCard } from "@/types/pokemon";

/**
 * Binder hero trio — picks a fresh random three cards from the live pool on
 * every visit. SSR renders the first three (stable for hydration) and the
 * client reshuffles on mount so the fan changes each load.
 */
export function BinderHeroCards({ cards }: { cards: TcgCard[] }) {
  const [picks, setPicks] = useState(() => cards.slice(0, 3));

  useEffect(() => {
    if (cards.length <= 3) {
      setPicks(cards.slice(0, 3));
      return;
    }

    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setPicks(shuffled.slice(0, 3));
  }, [cards]);

  return (
    <>
      {picks.map((card, index) => (
        <Link
          key={`${card.slug}-${index}`}
          href={`/cards/${card.slug}`}
          className={`hero-real-card hero-real-card-${index + 1}`}
        >
          <Image
            src={card.image}
            alt={card.name}
            fill
            sizes="360px"
            priority={index === 0}
            className="object-contain"
          />
          <span className="hero-card-label">
            <strong>{card.name}</strong>
            <span>
              {card.setCode} #{card.collectorNumber}
            </span>
          </span>
        </Link>
      ))}
    </>
  );
}
