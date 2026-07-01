"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { PremiumHoloCard } from "@/components/fx/premium-holo-card";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

// Calm editorial drift, in px per animation frame (~27px/s at 60fps).
const AUTO_SPEED = 0.45;
// How long the strip stays still after the user lets go before it drifts again.
// Kept short so the auto-slide feels like it resumes the moment you stop
// swiping; just long enough to let native touch momentum settle first.
const RESUME_DELAY = 300;
// How long a tapped card stays magnified (and the strip held still) before the
// drift quietly resumes — a selection is a glance, not a permanent stop.
const SELECT_VIEW_MS = 2400;
// Two taps on the same card within this window open the card detail.
const DOUBLE_TAP_MS = 400;
// Pointer travel (px) beyond which a press counts as a drag, not a tap — so
// swiping the strip never accidentally "selects" a card.
const DRAG_THRESHOLD = 8;
// Cap on the unique run. The live pool tops out around three dozen cards; using
// all of them means a long stretch scrolls by before the loop repeats. Cards
// beyond the fold load lazily, so a longer run barely affects initial load.
const MAX_UNIQUE_CARDS = 40;

// The "rainbow" arch. When a card is focused it rises highest and its
// neighbours lift progressively less on each side, so the row bows up into a
// deep, smooth arc that follows the pointer — instead of one card popping
// alone. Values are indexed by distance (in cards) from the focused one; the
// lift is a fraction of the card's width so the curve looks the same on phones
// and desktop.
const DOCK_SCALE = [1.15, 1.08, 1.04, 1.02, 1.01];
const DOCK_LIFT_FRACTION = [0.42, 0.24, 0.13, 0.05, 0.015];
// How far each neighbour is displaced sideways (as a fraction of card width) to
// clear room for the magnified focal card. The focal itself never shifts.
const DOCK_PUSH_FRACTION = [0, 0.22, 0.12, 0.05, 0.02];
// Phones have no hover and a tighter strip, so the arch only fires on tap.
// Use a gentler, narrower profile there so it fits the closer gap without the
// magnified neighbours overlapping.
const DOCK_SCALE_COMPACT = [1.15, 1.07, 1.03];
const DOCK_LIFT_FRACTION_COMPACT = [0.2, 0.11, 0.04];
const DOCK_PUSH_FRACTION_COMPACT = [0, 0.12, 0.05];

function dockStyle(
  signedOffset: number,
  cardWidth: number,
  scales: number[],
  lifts: number[],
  pushes: number[],
): { transform: string; zIndex: number } {
  const offset = Math.abs(signedOffset);
  if (offset >= scales.length) {
    return { transform: "translate3d(0,0,0) scale(1)", zIndex: 0 };
  }
  // Neighbours slide away from the focal card (left ones left, right ones
  // right); the focal card (offset 0) rises straight up and jumps to the front.
  const direction = Math.sign(signedOffset);
  const lift = lifts[offset] * cardWidth;
  const push = direction * pushes[offset] * cardWidth;
  return {
    transform: `translate3d(${push.toFixed(1)}px, ${(-lift).toFixed(1)}px, 0) scale(${scales[offset]})`,
    zIndex: offset === 0 ? 50 : 40 - offset,
  };
}

/**
 * An interactive, swipeable strip of card art — editorial "imagery in motion".
 *
 * It drifts on its own when idle, but the row is a real horizontally-scrollable
 * surface: drag or swipe to explore (native momentum on touch). Cards are
 * buttons, not links: a single tap/click magnifies a card in place (a
 * "selection zoom") and a double tap/click opens its detail page. A single tap
 * only holds the strip for a moment — the drift always resumes on its own, so
 * the carousel never gets stuck after you interact with it. On a pointer device,
 * hovering previews the same magnify.
 *
 * The track is duplicated so the loop never visibly resets, and we lean on
 * native scrolling + cheap box-shadows (instead of a perpetual transform
 * animation with per-card filters) so the strip stays smooth on mobile.
 */
export function CardMarquee({ cards }: { cards: TcgCard[] }) {
  // Use the whole live pool of unique cards so the strip travels a long way
  // before it repeats.
  const row = cards.slice(0, MAX_UNIQUE_CARDS);

  // The track animates by exactly one half, so each half must comfortably
  // exceed any viewport width or empty space would scroll into view. With a
  // small pool, repeat the unique run until a half is wide enough; then mirror
  // it for the seamless loop.
  const MIN_CARDS_PER_HALF = 14;
  const half: TcgCard[] = [];
  if (row.length) {
    while (half.length < MIN_CARDS_PER_HALF) {
      half.push(...row);
    }
  }
  const loop = [...half, ...half];

  const router = useRouter();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const pausedUntilRef = useRef(0);
  const pressedRef = useRef(false);
  const movedRef = useRef(false);
  const downXRef = useRef(0);
  const downYRef = useRef(0);
  const lastXRef = useRef(0);
  const reducedRef = useRef(false);
  const periodRef = useRef(0);
  const capturedRef = useRef(false);
  const selectTimerRef = useRef(0);
  const lastTapRef = useRef({ index: -1, time: 0 });

  // `hovered` is a live pointer preview (desktop); `selected` is a transient
  // tap-to-magnify that clears itself so the strip can resume drifting. The
  // magnified card is whichever is set, preferring the live hover.
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Measured card width, so the arch lift can be sized proportionally.
  const [cardWidth, setCardWidth] = useState(118);
  // Phones get the gentler arch profile (and a tighter gap, in CSS).
  const [compact, setCompact] = useState(false);
  const active = hovered ?? selected;
  // Only a live hover holds the drift; a tap-selection relies on a timed pause
  // so the carousel always resumes on its own.
  const hoveredRef = useRef<number | null>(null);
  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  useEffect(() => () => window.clearTimeout(selectTimerRef.current), []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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
      if (first.offsetWidth > 0) {
        // React bails out if the width is unchanged, so this is cheap to call.
        setCardWidth(first.offsetWidth);
      }
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
          hoveredRef.current === null &&
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
      capturedRef.current = false;
      downXRef.current = event.clientX;
      downYRef.current = event.clientY;
      lastXRef.current = event.clientX;
      pause();
    },
    [pause],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pressedRef.current) {
        return;
      }
      if (
        Math.abs(event.clientX - downXRef.current) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - downYRef.current) > DRAG_THRESHOLD
      ) {
        movedRef.current = true;
      }
      // Touch swipes scroll natively (with momentum). For a mouse we drive a
      // click-drag scroll ourselves — but only capture the pointer once a real
      // drag has begun, so a plain click still lands on the card (and never gets
      // hijacked into the scroller, which would swallow the open-on-double-tap).
      if (event.pointerType === "mouse") {
        if (movedRef.current && !capturedRef.current) {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
            capturedRef.current = true;
          } catch {
            /* pointer capture is best-effort */
          }
        }
        const el = scrollerRef.current;
        if (el) {
          el.scrollLeft -= event.clientX - lastXRef.current;
        }
        lastXRef.current = event.clientX;
      }
      pause();
    },
    [pause],
  );

  const endPress = useCallback(() => {
    pressedRef.current = false;
    pause();
  }, [pause]);

  const onCardEnter = useCallback((index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    // Hover preview is a fine-pointer affordance only; touch uses tap-to-zoom.
    if (event.pointerType === "mouse") {
      setHovered(index);
    }
  }, []);

  const onCardLeave = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") {
      setHovered(null);
    }
  }, []);

  const openCard = useCallback(
    (card: TcgCard) => {
      stashCardForNavigation(card);
      router.push(`/cards/${card.slug}`);
    },
    [router],
  );

  const onCardClick = useCallback(
    (index: number, card: TcgCard) => {
      // A drag that ended on a card is a scroll, not a tap.
      if (movedRef.current) {
        return;
      }
      const now = Date.now();
      const last = lastTapRef.current;
      // Second tap on the same card → open its detail page.
      if (last.index === index && now - last.time < DOUBLE_TAP_MS) {
        window.clearTimeout(selectTimerRef.current);
        lastTapRef.current = { index: -1, time: 0 };
        openCard(card);
        return;
      }
      // First tap → magnify in place and hold the strip briefly, then let the
      // drift resume on its own (a selection never stops the carousel for good).
      lastTapRef.current = { index, time: now };
      setSelected(index);
      pausedUntilRef.current = now + SELECT_VIEW_MS;
      window.clearTimeout(selectTimerRef.current);
      selectTimerRef.current = window.setTimeout(() => {
        setSelected(null);
        lastTapRef.current = { index: -1, time: 0 };
      }, SELECT_VIEW_MS);
    },
    [openCard],
  );

  if (!loop.length) {
    return null;
  }

  const dockScales = compact ? DOCK_SCALE_COMPACT : DOCK_SCALE;
  const dockLifts = compact ? DOCK_LIFT_FRACTION_COMPACT : DOCK_LIFT_FRACTION;
  const dockPushes = compact ? DOCK_PUSH_FRACTION_COMPACT : DOCK_PUSH_FRACTION;

  return (
    <div className="marquee" aria-label="Featured cards">
      <div
        ref={scrollerRef}
        className="marquee-scroller"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        onWheel={pause}
      >
        <div className={`marquee-track ${active !== null ? "is-focusing" : ""}`}>
          {loop.map((card, index) => {
            const isActive = active === index;
            // Lift every card into the arch around the focused one; when nothing
            // is focused, leave the transform to CSS so it eases back to rest.
            const dock =
              active === null
                ? null
                : dockStyle(index - active, cardWidth, dockScales, dockLifts, dockPushes);
            return (
              <button
                type="button"
                key={`${card.slug}__${index}`}
                className={`marquee-card ${isActive ? "is-active" : ""}`}
                // FIXED-SIZE hover target: it never transforms (only its stacking
                // order changes), so its box never slides out from under the
                // cursor — which is what makes the hovered card flutter. All hover
                // triggers stay on this stable outer wrapper.
                style={dock ? { zIndex: dock.zIndex } : undefined}
                tabIndex={-1}
                aria-label={card.name}
                onPointerEnter={(event) => onCardEnter(index, event)}
                onPointerLeave={onCardLeave}
                onClick={() => onCardClick(index, card)}
              >
                {/* ANIMATION target: the lift / scale / neighbour-push transform
                   lives here, fully decoupled from the hover target above. */}
                <div
                  className="marquee-card-inner"
                  style={dock ? { transform: dock.transform } : undefined}
                >
                  {/* Exact same premium recipe as the 5-card hero: sampled aura,
                     3D tilt (max 22), holo-foil and cursor-locked holo-weave. */}
                  <PremiumHoloCard
                    src={card.image}
                    alt=""
                    sizes="160px"
                    quality={60}
                    loading="lazy"
                    innerClassName="marquee-card-art"
                    max={22}
                  >
                    <span className="marquee-card-sheen" aria-hidden="true" />
                    <span className="marquee-card-caption" aria-hidden="true">
                      <span className="marquee-card-name">{card.name}</span>
                      {(card.setName || card.collectorNumber) && (
                        <span className="marquee-card-meta">
                          {[card.setName, card.collectorNumber].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </PremiumHoloCard>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
