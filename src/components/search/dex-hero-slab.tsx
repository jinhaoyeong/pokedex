"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { HoloTilt } from "@/components/fx/holo-tilt";
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
 * The three searchable axes, always taken from a real catalog card —
 * never a decorative placeholder. Restamps when the deck advances.
 */
function PrintAxes({ card }: { card: TcgCard }) {
  return (
    <dl className="dex-print-line" key={card.slug} data-stamp="">
      <div>
        <dt>Name</dt>
        <dd>{card.name}</dd>
      </div>
      <div>
        <dt>Set</dt>
        <dd className="mono">{card.setCode || "—"}</dd>
      </div>
      <div>
        <dt>Number</dt>
        <dd className="mono">{cardNumberLine(card)}</dd>
      </div>
    </dl>
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
        <div className="slab-label" key={front.slug} data-stamp="">
          <p className="slab-label-set">{setLine}</p>
          <p className="slab-label-name">{front.name}</p>
          <p className="slab-label-cert">
            <strong>{(front.language || "en").toUpperCase()}</strong>
            <strong>{cardNumberLine(front)}</strong>
            <span>{front.setCode || "—"}</span>
          </p>
        </div>

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
                <HoloTilt className="slab-card-inner" max={6}>
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

        <div className="slab-foot">
          <span className="slab-serial">
            {front.setCode || "—"}-{front.collectorNumber || "—"}-
            {(front.language || "en").toUpperCase()}
          </span>
          {deck.length > 1 ? (
            <span className="slab-dots">
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
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Search hero: a card-index sheet. The heading states the job; the
 * print line and the slab are the same live card, so the object proves
 * you can search by name, set, or number.
 */
export function DexHero({
  cards,
  children,
}: {
  cards: TcgCard[];
  children: ReactNode;
}) {
  const deck = cards.slice(0, 4);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const front = deck[active];

  return (
    <section className="sheet dex-hero">
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
          {front ? <PrintAxes card={front} /> : null}
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
