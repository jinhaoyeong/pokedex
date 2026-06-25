"use client";

import Image from "next/image";
import Link from "next/link";

import { HoloTilt } from "@/components/fx/holo-tilt";
import { useBootPreviewCards } from "@/hooks/use-boot-preview-cards";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

/**
 * The hero centrepiece — a wide, cinematic fan of holographic cards that plays
 * the role of the reference site's full-width hero image. Cards tilt under the
 * cursor and sit on a soft glowing platform.
 */
export function HeroShowcase({ initialCards }: { initialCards: TcgCard[] }) {
  const cards = useBootPreviewCards(initialCards).slice(0, 5);
  if (!cards.length) {
    return null;
  }

  // The fan has five fixed slots (1 = far left … 5 = far right). When fewer
  // than five cards are available, centre them on the middle slot so the
  // arrangement never drifts to one side.
  const startSlot = Math.floor((5 - cards.length) / 2);

  return (
    <div className="showcase">
      <span className="showcase-glow" aria-hidden="true" />
      <div className="showcase-stage">
        {cards.map((card, index) => (
          <Link
            key={`${card.slug}__${index}`}
            href={`/cards/${card.slug}`}
            onClick={() => stashCardForNavigation(card)}
            className={`showcase-card showcase-card-${startSlot + index + 1}`}
            aria-label={card.name}
          >
            <HoloTilt className="showcase-card-inner" max={16}>
              <Image
                src={card.image}
                alt={card.name}
                fill
                sizes="(max-width: 768px) 40vw, 240px"
                priority={index === 0}
                className="object-contain"
              />
            </HoloTilt>
          </Link>
        ))}
      </div>
      <span className="showcase-floor" aria-hidden="true" />
    </div>
  );
}
