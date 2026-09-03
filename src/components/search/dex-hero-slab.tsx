"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { ClientPrice } from "@/components/client-price";
import { ListCardImage } from "@/components/card/list-card-image";
import { HoloTilt } from "@/components/fx/holo-tilt";
import { useLazyCardPrice } from "@/hooks/use-lazy-card-price";
import { clamp01, useScrollDrivenTransform } from "@/hooks/use-scroll-progress";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { APP_SCROLL_ROOT_ID } from "@/lib/app-scroll";
import type { TcgCard } from "@/types/pokemon";

const SWIPE_THRESHOLD_PX = 36;

/** Within this much of the top the rail is fully open, whatever came before. */
const TUCK_ENTER_PX = 120;
/** Downward travel that folds the rail all the way away. */
const TUCK_HIDE_PX = 220;
/** Upward travel that brings it all the way back — quicker, it is being asked for. */
const TUCK_SHOW_PX = 175;
/** Depth over which the bar earns its separator and shadow. */
const TUCK_LIFT_PX = 22;
/** Past this the rail is invisible, so it stops taking focus and pointers. */
const TUCK_SPENT = 0.92;

/**
 * The phone Dex pins its search surface so the field is never a scroll away,
 * while the expanded filter group uses ~6.5rem of an 844pt screen. The group
 * therefore rides the scroll like an iOS search bar: scrolling down into the
 * list folds it away and scrolling back up brings it out again.
 *
 * It rides it literally. This used to be a threshold — eight pixels of travel
 * flipped an attribute and a 260ms transition then ran on its own clock, so
 * the fold arrived as a lurch that had nothing to do with where the thumb was
 * and could not be taken back halfway. Here the fold is a fraction (0 open, 1
 * away) written straight onto the element every frame from the distance
 * scrolled, and every one of its steps is reversible: lift the thumb mid-fold
 * and the rail stays half-folded; push back up and it comes out at the rate
 * the thumb comes back. Nothing animates, so nothing can snap.
 *
 * One exception, and it is the important one — a narrowed browse always shows
 * what narrowed it. If any filter is engaged the rail stays put, so results
 * that are not the whole catalog can never look like they are.
 */
function useTuckingSearchBar<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    const root = document.getElementById(APP_SCROLL_ROOT_ID);

    if (!el || !root || !window.matchMedia("(max-width: 639px)").matches) {
      return;
    }

    // A rubber-banding phone reports a negative scrollTop past the top edge;
    // that is still the top, not a reason to unfold twice as fast.
    let last = Math.max(0, root.scrollTop);
    let tuck = 0;
    let frame = 0;

    const settle = () => {
      frame = 0;
      const top = Math.max(0, root.scrollTop);
      const delta = top - last;
      last = top;

      if (el.querySelector(".dex-quick-chip[data-active]")) {
        tuck = 0;
      } else {
        // Folding away is the slower of the two: reading down the list should
        // not cost the filters the moment the thumb moves.
        tuck = clamp01(tuck + delta / (delta > 0 ? TUCK_HIDE_PX : TUCK_SHOW_PX));
      }

      // Approaching the top the rail is unfolded by the scroll itself rather
      // than released at one line, so the last stretch has no step in it.
      tuck = Math.min(tuck, top / TUCK_ENTER_PX);

      el.style.setProperty("--dex-tuck", tuck.toFixed(4));
      // Resting at the top, the bar is not covering anything, so it does not
      // cast over anything either — the separator and shadow arrive with the
      // first row that slides under it.
      el.style.setProperty("--dex-lift", clamp01(top / TUCK_LIFT_PX).toFixed(3));
      el.toggleAttribute("data-tucked", tuck >= TUCK_SPENT);
    };

    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(settle);
      }
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    settle();

    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      el.style.removeProperty("--dex-tuck");
      el.style.removeProperty("--dex-lift");
      el.removeAttribute("data-tucked");
    };
  }, []);

  return ref;
}

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
                <HoloTilt className="slab-card-inner list-card-art-frame" max={6} allowTouch={false}>
                  <ListCardImage
                    src={card.image}
                    alt={card.name}
                    priority={index < 4}
                    setCode={card.setCode}
                    number={card.collectorNumber}
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
  const heroRef = useTuckingSearchBar<HTMLElement>();

  return (
    <section className="sheet sheet-open dex-hero" ref={heroRef}>
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
