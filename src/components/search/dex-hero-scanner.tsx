"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { HoloTilt } from "@/components/fx/holo-tilt";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

const CYCLE_MS = 3800;

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

  return (
    <div
      className="dex-scanner"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
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

        <div className="dex-scanner-rack">
          {deck.map((card, index) => {
            const depth = (index - active + deck.length) % deck.length;

            return (
              <Link
                key={card.slug}
                href={`/cards/${card.slug}`}
                onClick={() => stashCardForNavigation(card)}
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
                    sizes="260px"
                    priority={index === 0}
                    unoptimized
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
