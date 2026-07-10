"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { HoloTilt } from "@/components/fx/holo-tilt";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

const CYCLE_MS = 2400;
const SWIPE_THRESHOLD_PX = 36;

/**
 * Dex hero centrepiece — a scan bay holding a receding rack of real cards.
 * The front card sits under a sweeping scan line while the readout below it
 * shows that card's actual set / language / collector number, so the banner
 * demonstrates the search it is advertising.
 */
export function DexHeroScanner({ cards }: { cards: TcgCard[] }) {
  const deck = cards.slice(0, 4);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (deck.length < 2 || paused) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % deck.length);
    }, CYCLE_MS);

    return () => window.clearInterval(timer);
  }, [deck.length, paused]);

  if (!deck.length) {
    return null;
  }

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
      // Swipe left → next card; swipe right → previous.
      step(deltaX < 0 ? 1 : -1);
    } else if (drag.moved) {
      suppressClickRef.current = true;
    }

    window.setTimeout(() => {
      suppressClickRef.current = false;
      setPaused(false);
    }, 80);
  };

  return (
    <div
      className="dex-scanner"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => {
        if (!dragRef.current) {
          setPaused(false);
        }
      }}
    >
      <span className="dex-scanner-glow" aria-hidden="true" />

      <div className="dex-scanner-bay">
        <div className="dex-scanner-head">
          <span>Dex-01</span>
          <strong>
            <i className="dex-scanner-led" aria-hidden="true" />
            Scanning
          </strong>
        </div>

        <div
          className="dex-scanner-rack"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          role="group"
          aria-roledescription="carousel"
          aria-label="Featured cards. Swipe or drag to change."
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
                className={`dex-scanner-card dex-scanner-depth-${depth}`}
                aria-label={card.name}
                aria-hidden={depth !== 0}
                tabIndex={depth === 0 ? undefined : -1}
              >
                <span
                  className="dex-scanner-aura"
                  aria-hidden="true"
                  style={{ backgroundImage: `url("${card.image}")` }}
                />
                <HoloTilt
                  className="dex-scanner-card-inner absolute inset-0 overflow-hidden rounded-[inherit]"
                  max={14}
                >
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
                  <span className="holo-weave" aria-hidden="true" />
                </HoloTilt>
              </Link>
            );
          })}

          <span className="dex-scanner-beam" aria-hidden="true" />
          <span className="dex-scanner-grid" aria-hidden="true" />

          <span className="dex-scanner-bracket bracket-tl" aria-hidden="true" />
          <span className="dex-scanner-bracket bracket-tr" aria-hidden="true" />
          <span className="dex-scanner-bracket bracket-bl" aria-hidden="true" />
          <span className="dex-scanner-bracket bracket-br" aria-hidden="true" />
        </div>

        <dl className="dex-scanner-readout" key={front.slug}>
          <div>
            <dt>Set</dt>
            <dd>{front.setCode || "—"}</dd>
          </div>
          <div>
            <dt>Lang</dt>
            <dd>{(front.language || "en").toUpperCase()}</dd>
          </div>
          <div>
            <dt>No.</dt>
            <dd>#{front.collectorNumber || "—"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
