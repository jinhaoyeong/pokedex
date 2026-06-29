"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";

import type { TcgCard } from "@/types/pokemon";

function cardFanWeight(card: TcgCard, rotationKey: number) {
  const input = `${card.slug}-${rotationKey}`;
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * Binder hero trio. Uses a stable hash shuffle so SSR and hydration agree.
 */
export function BinderHeroCards({ cards }: { cards: TcgCard[] }) {
  const picks = useMemo(() => {
    if (cards.length <= 3) {
      return cards.slice(0, 3);
    }

    const rotationKey = cards.length;
    return [...cards]
      .sort((left, right) => cardFanWeight(left, rotationKey) - cardFanWeight(right, rotationKey))
      .slice(0, 3);
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
