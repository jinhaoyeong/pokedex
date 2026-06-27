"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { TcgCard } from "@/types/pokemon";

// Calm editorial drift, in px per animation frame (~27px/s at 60fps).
const AUTO_SPEED = 0.45;
// How long the strip stays still after the user lets go before it drifts again.
const RESUME_DELAY = 1600;
// Pointer travel (px) beyond which a press counts as a drag, not a tap — so
// swiping the strip never accidentally "selects" a card.
const DRAG_THRESHOLD = 8;

/**
 * An interactive, swipeable strip of card art — editorial "imagery in motion".
 *
 * It drifts on its own when idle, but the row is a real horizontally-scrollable
 * surface: drag or swipe to explore (native momentum on touch). Cards are
 * buttons, not links — tapping/clicking a card magnifies it in place (a
 * "selection zoom") rather than navigating into the card detail. On a pointer
 * device, hovering previews the same magnify; on touch, a tap locks it and a
 * second tap (or tapping elsewhere) releases it.
 *
 * The track is duplicated so the loop never visibly resets, and we lean on
 * native scrolling + cheap box-shadows (instead of a perpetual transform
 * animation with per-card filters) so the strip stays smooth on mobile.
 */
export function CardMarquee({ cards }: { cards: TcgCard[] }) {
  // A lean run of unique cards keeps the mobile image payload light.
  const row = cards.slice(0, 14);

  // The track animates by exactly one half, so each half must comfortably
  // exceed any viewport width or empty space would scroll into view. Repeat the
  // unique run until a half is wide enough, then mirror it for the seamless loop.
  const MIN_CARDS_PER_HALF = 14;
  const half: TcgCard[] = [];
  if (row.length) {
    while (half.length < MIN_CARDS_PER_HALF) {
      half.push(...row);
    }
  }
  const loop = [...half, ...half];

  const scrollerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const pausedUntilRef = useRef(0);
  const pressedRef = useRef(false);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const downXRef = useRef(0);
  const downYRef = useRef(0);
  const lastXRef = useRef(0);
  const reducedRef = useRef(false);
  const periodRef = useRef(0);

  // `hovered` is a transient pointer preview; `locked` is a click/tap selection
  // that persists after the pointer leaves. The magnified card is whichever is
  // set, preferring the live hover.
  const [hovered, setHovered] = useState<number | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  const active = hovered ?? locked;
  const activeRef = useRef<number | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Auto-drift + seamless wrap, driven by native scrollLeft so touch momentum
  // and drag come for free.
  useEffect(() => {
    const el = scrollerRef.current;
    const track = el?.firstElementChild as HTMLElement | null;
    if (!el || !track) {
      return;
    }
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The loop is two identical copies. The exact distance to advance for a
    // seamless wrap is one copy's width — i.e. the offset of the first card of
    // the second copy. Measuring it (rather than scrollWidth/2) keeps the gap
    // between copies from introducing a visible jump.
    const measurePeriod = () => {
      const cards = track.children;
      const copyLength = cards.length / 2;
      if (copyLength < 1) {
        return 0;
      }
      const first = cards[0] as HTMLElement;
      const second = cards[copyLength] as HTMLElement;
      return Math.max(0, second.offsetLeft - first.offsetLeft);
    };
    periodRef.current = measurePeriod();

    // Start centred on the second copy so swiping has room in both directions.
    // Positions p and p + period are pixel-identical, so this and every wrap
    // below are invisible.
    if (periodRef.current > 0) {
      el.scrollLeft = periodRef.current;
    }

    const resize = new ResizeObserver(() => {
      periodRef.current = measurePeriod();
    });
    resize.observe(track);

    // scrollLeft snaps to whole pixels, so sub-pixel drift is accumulated and
    // flushed only once it crosses a full pixel — otherwise it never moves.
    let carry = 0;
    const step = () => {
      const period = periodRef.current;
      if (period > 0) {
        const drifting =
          !reducedRef.current &&
          activeRef.current === null &&
          !pressedRef.current &&
          Date.now() >= pausedUntilRef.current &&
          !document.hidden;
        if (drifting) {
          carry += AUTO_SPEED;
          const whole = Math.trunc(carry);
          if (whole !== 0) {
            el.scrollLeft += whole;
            carry -= whole;
          }
        }
        // Keep the position inside [period/2, 1.5·period]; re-centre by exactly
        // one copy whenever it drifts out, in either direction.
        if (el.scrollLeft >= period * 1.5) {
          el.scrollLeft -= period;
        } else if (el.scrollLeft <= period * 0.5) {
          el.scrollLeft += period;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafRef.current);
      resize.disconnect();
    };
  }, []);

  const pause = useCallback(() => {
    pausedUntilRef.current = Date.now() + RESUME_DELAY;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      pressedRef.current = true;
      movedRef.current = false;
      suppressClickRef.current = false;
      downXRef.current = event.clientX;
      downYRef.current = event.clientY;
      lastXRef.current = event.clientX;
      pause();
      // Touch swipes are handled natively (with momentum). For a mouse we drive
      // a click-drag scroll ourselves, capturing the pointer so the drag keeps
      // tracking even past the strip's edges.
      if (event.pointerType === "mouse") {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* pointer capture is best-effort */
        }
      }
    },
    [pause],
  );

  const markDrag = useCallback(() => {
    if (!movedRef.current) {
      movedRef.current = true;
      suppressClickRef.current = true;
    }
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        Math.abs(event.clientX - downXRef.current) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - downYRef.current) > DRAG_THRESHOLD
      ) {
        markDrag();
      }
      if (!pressedRef.current) {
        return;
      }
      if (event.pointerType === "mouse") {
        const el = scrollerRef.current;
        if (el) {
          el.scrollLeft -= event.clientX - lastXRef.current;
        }
        lastXRef.current = event.clientX;
      }
      pause();
    },
    [markDrag, pause],
  );

  const endPress = useCallback(() => {
    pressedRef.current = false;
    pause();
    if (suppressClickRef.current) {
      // Keep suppression through the synthetic click that browsers emit after drag.
      window.setTimeout(() => {
        movedRef.current = false;
        suppressClickRef.current = false;
      }, 0);
    } else {
      movedRef.current = false;
    }
  }, [pause]);

  const onCardEnter = useCallback((index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    // Hover preview is a fine-pointer affordance only; touch uses tap-to-lock.
    if (event.pointerType === "mouse") {
      setHovered(index);
    }
  }, []);

  const onCardLeave = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") {
      setHovered(null);
    }
  }, []);

  const onCardClick = useCallback((index: number) => {
    // A drag that ended on a card is a scroll, not a selection.
    if (movedRef.current || suppressClickRef.current) {
      return;
    }
    setLocked((current) => (current === index ? null : index));
    setHovered(null);
  }, []);

  if (!loop.length) {
    return null;
  }

  return (
    <div className="marquee" aria-label="Featured cards">
      <div
        ref={scrollerRef}
        className="marquee-scroller"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onWheel={pause}
      >
        <div className={`marquee-track ${active !== null ? "is-focusing" : ""}`}>
          {loop.map((card, index) => {
            const isActive = active === index;
            return (
              <button
                type="button"
                key={`${card.slug}__${index}`}
                className={`marquee-card ${isActive ? "is-active" : ""}`}
                tabIndex={-1}
                aria-label={card.name}
                onPointerEnter={(event) => onCardEnter(index, event)}
                onPointerLeave={onCardLeave}
                onClick={() => onCardClick(index)}
              >
                <span className="marquee-card-art">
                  <Image
                    src={card.image}
                    alt=""
                    fill
                    sizes="160px"
                    quality={60}
                    loading="lazy"
                    draggable={false}
                    className="object-contain"
                  />
                  <span className="marquee-card-sheen" aria-hidden="true" />
                  <span className="marquee-card-caption" aria-hidden="true">
                    <span className="marquee-card-name">{card.name}</span>
                    {(card.setName || card.collectorNumber) && (
                      <span className="marquee-card-meta">
                        {[card.setName, card.collectorNumber].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
