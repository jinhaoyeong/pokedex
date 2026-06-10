"use client";

import Image from "next/image";
import Link from "next/link";

import { useBootPreviewCards } from "@/hooks/use-boot-preview-cards";
import type { TcgCard } from "@/types/pokemon";

export function HeroCardPoster({ initialCards }: { initialCards: TcgCard[] }) {
  const cards = useBootPreviewCards(initialCards);
  const heroCards = cards.slice(0, 3);

  return (
    <div className="hero-card-poster relative order-first mx-auto w-full max-w-md lg:order-last lg:mx-0 lg:ml-auto">
      <div className="hero-card-glow" />
      <div className="hero-card-stage">
        <div className="hero-stage-header">
          <span>Market Picks</span>
          <strong>Live Card Board</strong>
        </div>
        {heroCards.map((card, index) => (
          <Link
            key={card.slug}
            href={`/cards/${card.slug}`}
            className={`hero-real-card hero-real-card-${index + 1}`}
          >
            <Image
              src={card.image}
              alt={card.name}
              fill
              sizes="(max-width: 768px) 42vw, 190px"
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
      </div>
      <div className="hero-poster-caption">
        <span>Live Preview</span>
        <strong>Card Board</strong>
      </div>
    </div>
  );
}
