"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

import { HoloTilt } from "@/components/fx/holo-tilt";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
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
  const [touchActiveIndex, setTouchActiveIndex] = useState<number | null>(null);
  const lastPointerTypeRef = useRef<PointerEvent<HTMLAnchorElement>["pointerType"] | "unknown">(
    "unknown",
  );
  const picks = useMemo(() => {
    if (cards.length <= 3) {
      return cards.slice(0, 3);
    }

    const rotationKey = cards.length;
    return [...cards]
      .sort((left, right) => cardFanWeight(left, rotationKey) - cardFanWeight(right, rotationKey))
      .slice(0, 3);
  }, [cards]);

  useEffect(() => {
    if (touchActiveIndex === null) {
      return;
    }

    const collapse = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "mouse") {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target?.closest(".hero-real-card")) {
        setTouchActiveIndex(null);
      }
    };

    document.addEventListener("pointerdown", collapse);
    return () => document.removeEventListener("pointerdown", collapse);
  }, [touchActiveIndex]);

  const handleCardPointerDown = (event: PointerEvent<HTMLAnchorElement>) => {
    lastPointerTypeRef.current = event.pointerType;
  };

  const handleCardClick = (
    event: MouseEvent<HTMLAnchorElement>,
    card: TcgCard,
    index: number,
  ) => {
    const isTouchLike =
      lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen";

    if (isTouchLike && touchActiveIndex !== index) {
      event.preventDefault();
      setTouchActiveIndex(index);
      return;
    }

    stashCardForNavigation(card);
  };

  return (
    <>
      {picks.map((card, index) => (
        <Link
          key={`${card.slug}-${index}`}
          href={`/cards/${card.slug}`}
          onPointerDown={handleCardPointerDown}
          onClick={(event) => handleCardClick(event, card, index)}
          className={`hero-real-card hero-real-card-${index + 1} ${
            touchActiveIndex === index ? "is-touch-active" : ""
          } ${touchActiveIndex !== null ? "is-touch-open" : ""}`}
        >
          {/* Art-sampled aura — glows faintly at rest, blooms in the card's own
             colour (red Charizard, purple Mewtwo, electric-yellow Pikachu). */}
          <span
            className="hero-real-card-aura"
            aria-hidden="true"
            style={{ backgroundImage: `url("${card.image}")` }}
          />
          {/* Exact 5-card hero engine: 3D cursor tilt, holo-foil + cursor-tracked
             holographic mesh (.holo-weave). */}
          <HoloTilt className="hero-real-card-inner absolute inset-0 overflow-hidden rounded-[inherit]" max={18}>
            <Image
              src={card.image}
              alt={card.name}
              fill
              sizes="360px"
              priority={index === 0}
              unoptimized
              className="object-contain"
            />
            <span className="holo-weave" aria-hidden="true" />
          </HoloTilt>
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
