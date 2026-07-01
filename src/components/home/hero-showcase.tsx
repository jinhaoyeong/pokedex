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
            {/* Ambient aura sampled straight from the card art — a blurred copy
               behind the card that glows in the artwork's own colour (violet for
               Mewtwo, ember-red for Charizard) and brightens on hover. */}
            <span
              className="showcase-card-aura"
              aria-hidden="true"
              style={{ backgroundImage: `url(${card.image})` }}
            />
            <HoloTilt className="showcase-card-inner" max={22}>
              <Image
                src={card.image}
                alt={card.name}
                fill
                sizes="(max-width: 768px) 40vw, 240px"
                priority={index === 0}
                className="object-contain"
              />
              {/* Fine holographic weave — a micro-dot + parallel-line pattern
                 that surfaces on hover and tracks the cursor, mimicking a real
                 foil card catching the light. */}
              <span className="holo-weave" aria-hidden="true" />
            </HoloTilt>
          </Link>
        ))}
      </div>
      <span className="showcase-floor" aria-hidden="true" />
    </div>
  );
}
