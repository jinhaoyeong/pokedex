"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { ClientPrice } from "@/components/client-price";
import { HoloTilt } from "@/components/fx/holo-tilt";
import { useLazyCardPrice } from "@/hooks/use-lazy-card-price";
import { clamp01, useScrollDrivenTransform } from "@/hooks/use-scroll-progress";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

const SWIPE_THRESHOLD_PX = 36;

function cardSetLine(card: TcgCard) {
  return card.setEnglishName ?? card.setName;
}

function cardNumberLine(card: TcgCard) {
  const printedTotal = card.setPrintedTotal ?? card.setTotal;
  if (!card.collectorNumber) {
    return "—";
  }

  return printedTotal ? `#${card.collectorNumber}/${printedTotal}` : `#${card.collectorNumber}`;
}

/**
 * The card's market value, resolved the same lazy way every result tile
 * resolves its own. This is what the panel is for: the identity line was
 * repeating a name, a set and a number that the grid below already prints
 * under every card, so the object had nothing of its own to say.
 */
function FeaturedValue({ card }: { card: TcgCard }) {
  const { priceUsd, isLoading } = useLazyCardPrice(card);

  if (priceUsd <= 0) {
    return isLoading ? (
      <p className="slab-value">
        <span className="slab-value-label">Market</span>
        <span className="slab-value-skeleton" />
      </p>
    ) : null;
  }

  return (
    <p className="slab-value">
      <span className="slab-value-label">Market</span>
      <ClientPrice amountUsd={priceUsd} className="slab-value-amount" />
    </p>
  );
}

/**
 * Sealed slab holding a stack of real cards. The printed label carries
 * that card's set, name, language and collector number — the same three
 * things the search field accepts. Cycling restamps the label so the
 * object demonstrates the search.
 */
function SlabDeck({
  deck,
  active,
  paused,
  setPaused,
  setActive,
}: {
  deck: TcgCard[];
  active: number;
  paused: boolean;
  setPaused: (next: boolean) => void;
  setActive: (next: number | ((current: number) => number)) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const slabRef = useScrollDrivenTransform<HTMLDivElement>((el, { viewportH, rect }) => {
    const centre = rect.top + rect.height / 2;
    const offset = (centre / viewportH) * 2 - 1;
    const bounded = clamp01((offset + 1) / 2) * 2 - 1;
    el.style.transform = `translate3d(0, ${(-bounded * 12).toFixed(2)}px, 0) rotateX(${(
      bounded * 2.4
    ).toFixed(2)}deg)`;
  });

  const front = deck[active];
  const step = (direction: 1 | -1) => {
    setActive((current) => (current + direction + deck.length) % deck.length);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || deck.length < 2) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPaused(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (Math.abs(event.clientX - drag.startX) > 8) {
      drag.moved = true;
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    dragRef.current = null;

    if (Math.abs(deltaX) >= SWIPE_THRESHOLD_PX) {
      suppressClickRef.current = true;
      step(deltaX < 0 ? 1 : -1);
    } else if (drag.moved) {
      suppressClickRef.current = true;
    }

    window.setTimeout(() => {
      suppressClickRef.current = false;
      setPaused(false);
    }, 80);
  };

  const setLine = cardSetLine(front);

  return (
    <div
      className="slab-stage"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => {
        if (!dragRef.current) {
          setPaused(false);
        }
      }}
    >
      <div className="slab" ref={slabRef} data-paused={paused || undefined}>
        <div
          className="slab-window"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          role="group"
          aria-roledescription="carousel"
          aria-label="Featured cards. Drag or use the buttons below to change."
        >
          {deck.map((card, index) => {
            const depth = (index - active + deck.length) % deck.length;

            return (
              <Link
                key={card.slug}
                href={`/cards/${card.slug}`}
                onClick={(event) => {
                  if (suppressClickRef.current || depth !== 0) {
                    event.preventDefault();
                    return;
                  }
                  stashCardForNavigation(card);
                }}
                draggable={false}
                className="slab-card"
                data-depth={depth}
                aria-label={card.name}
                aria-hidden={depth !== 0}
                tabIndex={depth === 0 ? undefined : -1}
              >
                {/* Touch drives the deck swipe on the window above, so the
                    card must not also claim the gesture. */}
                <HoloTilt className="slab-card-inner" max={6} allowTouch={false}>
                  <Image
                    src={card.image}
                    alt={card.name}
                    fill
                    sizes="180px"
                    priority={index === 0}
                    unoptimized
                    draggable={false}
                    className="object-contain"
                  />
                </HoloTilt>
              </Link>
            );
          })}
        </div>

        {deck.length > 1 ? (
          <div className="slab-dots">
            {deck.map((card, index) => (
              <button
                key={card.slug}
                type="button"
                className="slab-dot"
                aria-current={index === active}
                aria-label={`Show ${card.name}`}
                onClick={() => setActive(index)}
              />
            ))}
          </div>
        ) : null}

        <div className="slab-plate" key={front.slug} data-stamp="">
          <span className="slab-ident">
            <span className="slab-name">{front.name}</span>
            <span className="slab-origin">
              <span>{setLine}</span>
              <span>{cardNumberLine(front)}</span>
              <span>{(front.language || "en").toUpperCase()}</span>
            </span>
          </span>
          <FeaturedValue key={front.slug} card={front} />
        </div>
      </div>
    </div>
  );
}

/**
 * Search hero: a card-index sheet. The heading states the job, the slab
 * shows a real card from the catalog, and the search rail sits in the
 * same panel underneath so the field is never a scroll away.
 */
export function DexHero({
  cards,
  search,
  children,
}: {
  cards: TcgCard[];
  search?: ReactNode;
  children: ReactNode;
}) {
  const deck = cards.slice(0, 4);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  return (
    <section className="sheet sheet-open dex-hero">
      <header className="sheet-band">
        <h2 className="sheet-band-title">Card index</h2>
        <p className="sheet-meta">
          <span>English</span>
          <span>Japanese</span>
          <span>Chinese</span>
        </p>
      </header>

      <div className="dex-hero-body">
        <div className="dex-hero-copy">
          {children}
          {search}
        </div>
        {deck.length ? (
          <div className="dex-hero-slab">
            <SlabDeck
              deck={deck}
              active={active}
              paused={paused}
              setPaused={setPaused}
              setActive={setActive}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
