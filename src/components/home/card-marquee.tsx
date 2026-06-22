import Image from "next/image";
import Link from "next/link";

import type { TcgCard } from "@/types/pokemon";

/**
 * A slow, seamless horizontal marquee of card art — editorial "imagery in
 * motion". The row is duplicated so the loop never visibly resets.
 */
export function CardMarquee({ cards }: { cards: TcgCard[] }) {
  const row = cards.slice(0, 10);
  if (!row.length) {
    return null;
  }
  const loop = [...row, ...row];

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
