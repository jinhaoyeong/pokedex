import Image from "next/image";
import Link from "next/link";

import type { TcgCard } from "@/types/pokemon";

/**
 * A slow, seamless horizontal marquee of card art — editorial "imagery in
 * motion". The row is duplicated so the loop never visibly resets. Auto-slides
 * continuously; cards are decorative (not an interactive picker).
 */
export function CardMarquee({ cards }: { cards: TcgCard[] }) {
  // A wide-enough run of unique cards (no visible repeat) but kept lean so the
  // mobile image payload stays light and the strip loads smoothly.
  const row = cards.slice(0, 14);
  if (!row.length) {
    return null;
  }

  // The track animates by exactly one half (translateX(-50%)), so each half
  // must be at least as wide as the viewport or empty space scrolls into
  // view. If the unique run is short, repeat it until a half comfortably
  // exceeds any screen width, then mirror it for the seamless loop.
  const MIN_CARDS_PER_HALF = 14;
  const half: TcgCard[] = [];
  while (half.length < MIN_CARDS_PER_HALF) {
    half.push(...row);
  }
  const loop = [...half, ...half];

  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {loop.map((card, index) => (
          <Link
            key={`${card.slug}__${index}`}
            href={`/cards/${card.slug}`}
            tabIndex={-1}
            className="marquee-card"
          >
            <Image
              src={card.image}
              alt=""
              fill
              sizes="150px"
              quality={60}
              loading="lazy"
              className="object-contain"
            />
          </Link>
        ))}
      </div>
      <span className="marquee-fade marquee-fade--l" />
      <span className="marquee-fade marquee-fade--r" />
    </div>
  );
}
