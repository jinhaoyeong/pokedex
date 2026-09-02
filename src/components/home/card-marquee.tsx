"use client";

import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { PremiumHoloCard } from "@/components/fx/premium-holo-card";
import { clamp01 } from "@/hooks/use-scroll-progress";
import { useHomeLiveCards } from "@/hooks/use-home-live-cards";
import { getAppScrollRoot, isMobileAppShell } from "@/lib/app-scroll";
import {
  releaseSmoothPageScroll,
  retainSmoothPageScroll,
  smoothScrollBy,
  wheelDeltaPixels,
} from "@/lib/smooth-page-scroll";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

/* ═══════════════════════════════════════════════════════════════════════════
   1 · THE 3D RING — CORE GEOMETRY CONSTANTS

   SCROLL CHOREOGRAPHY (see the engine below):
     progress 0   → the strip is a fully wrapped cylinder sitting UP near the
                    5-card hero fan, almost transparent.
     progress 0→1 → in one synchronized move the hero recedes (up + smaller,
                    see HeroScene) while the ring fades IN, eases DOWN to its
                    resting line, and UNBENDS — wrapped ring → wider arc →
                    straight flat line (the auto-slider).

   The unbend is a TRUE curvature interpolation, not a positional squish: the
   cylinder radius grows toward infinity while each card keeps its arc-length,
   so the ring physically unrolls from both sides like doors opening.

   The shared camera lives in CSS: `perspective: 1200px` on .marquee-scroller
   and `transform-style: preserve-3d` down the track → card chain, so every
   per-card translate3d/rotateY below projects to ONE vanishing point.
   ═══════════════════════════════════════════════════════════════════════ */

// ---- DESKTOP ----------------------------------------------------------------
// Floor radius of the wrapped cylinder in px at progress 0. The engine also
// raises this to ~1.35× the viewport half-width so a 1920px desktop never
// puts on-screen cards past ~40° (the sliver look). The unroll divides the
// live radius by (1 − progress), so the curve widens to a straight line.
const RING_RADIUS = 820;
// Carousel tilt (deg) of the whole ring at full-wrap; eases to 0° once flat.
const RING_TILT_DEG = -20;
// Entry stage: NEGATIVE = the wrapped ring starts this many px ABOVE its
// resting line — right under the hero fan (near, not overlapping) — and eases
// DOWN into place as it unrolls. Kept small: the big pull-up that closes the
// hero↔marquee gap lives in CSS (.marquee's desktop negative margin), so the
// RESTING line is already tight under the hero; this is just the entry drop.
const RING_ENTER_Y = -80;
// Extra scale at full-wrap to offset the perspective shrink of receded cards.
const RING_SCALE_BOOST = 0.14;

// ---- MOBILE (viewport < 768px wide) ------------------------------------------
// Tighter cylinder so the wrap reads as a ring on a 390px screen, not a
// shallow arc. Do NOT apply the desktop "radius ≥ 1.35× half-width" floor
// here — that flattened the phone pose into the sliding row.
const RING_RADIUS_MOBILE = 220;
// Mild tilt / drop so the unroll still has a 3D pose. These stay small so
// they cannot fight native scroll the way the old viewport-pin lift did.
const RING_TILT_DEG_MOBILE = -12;
const RING_ENTER_Y_MOBILE = -22;
const RING_SCALE_BOOST_MOBILE = 0.08;

// ---- SHARED -------------------------------------------------------------------
// Viewport half-width below which the mobile geometry above is used.
const MOBILE_HALF_W = 384;
// A FULL ring: cards wrap all the way to the back (±180°) at progress 0.
// Beyond the visible arc they are cleared so they never double-wrap and overlap.
const RING_MAX_THETA = Math.PI;
// The ring starts nearly invisible (opacity 0 at progress 0) and fades fully
// in by this share of the unroll — simultaneous with the hero's recede.
const RING_FADE_SPAN = 0.5;
// How far (fraction of viewport height) the strip's CENTRE travels up from the
// bottom edge before it is fully flat. 0.6 ⇒ the whole unroll plays on-screen,
// in step with the hero recede (HeroScene uses the same 0.6 span).
const RING_FLATTEN_SPAN = 0.6;

/* ═══════════════════════════════════════════════════════════════════════════
   2 · STRIP BEHAVIOUR (drift, drag, tap-to-open)
   ═══════════════════════════════════════════════════════════════════════ */

// How long the strip stays still after the user lets go before drifting again.
const RESUME_DELAY = 280;
// After a touch fling, wait longer so native momentum can finish before drift.
const RESUME_DELAY_TOUCH = 700;
// Auto-slide crawl (px per millisecond) — slow enough to read cards, not spin.
const DRIFT_PX_PER_MS = 0.038;
const DRIFT_PX_PER_MS_MOBILE = 0.042;
// Ease the unroll toward the live (UNCLAMPED) scroll target. Must be long
// enough that reversing from well past flat eats the overshoot before the
// ring starts wrapping again — clamping first is what made scroll-up jerk.
// Touch scroll is already continuous, so phones use a much shorter constant
// or the pose lags the finger and the strip visibly bounces up/down.
const PROGRESS_SMOOTH_MS = 160;
const PROGRESS_SMOOTH_MS_MOBILE = 36;
// Desktop stage position inside the scroller's clip padding. The progressive
// start→end rise centres the flat row without crowding the hero during entry.
const RING_STAGE_LIFT_START = 120;
const RING_STAGE_LIFT_END = 172;
const RING_GLOW_HEADROOM = 192;
// Pointer travel (px) beyond which a press counts as a drag, not a tap.
const DRAG_THRESHOLD = 8;
const HORIZONTAL_DRAG_THRESHOLD = 6;
const MOMENTUM_MIN_VELOCITY = 0.05;
const MOMENTUM_STOP_VELOCITY = 0.012;
// Closer to 1 = longer native-like coast after a mouse fling.
const MOMENTUM_FRICTION = 0.962;
// Cap on the unique run rendered in the native scroll row. Kept moderate
// because the row is rendered LOOP_COPIES times for the seamless loop.
const MAX_UNIQUE_CARDS = 44;
// Seamless-loop geometry: the unique run is rendered this many times and the
// viewport lives in the middle copy. Because every copy is pixel-identical,
// jumping scrollLeft by exactly one run-width is invisible.
const LOOP_COPIES = 5;
const LOOP_MIDDLE_COPY = Math.floor(LOOP_COPIES / 2);
// How long after the last scroll event (finger up) the strip counts as
// settled. Normalization ONLY runs then: a programmatic scrollLeft write
// during a live gesture/fling cancels native momentum on mobile, which is
// exactly the "stiff, heavy swipe" failure mode.
const LOOP_SETTLE_MS = 160;
// Emergency-only band near the TRUE ends of the duplicated content. With five
// copies there are ~two full runs of runway per direction, so cutting one
// momentum fling here is a last resort that should almost never fire.
const LOOP_EDGE_MARGIN_RUNS = 0.35;

// Fan hover (desktop): focal card rises, neighbours ease out — written
// imperatively so React never re-renders the ~220-card row on hover.
const FAN_SCALE = [1.14, 1.07, 1.03];
const FAN_LIFT = [0.14, 0.07, 0.03];
const FAN_PUSH = [0, 0.18, 0.08];

/** Linear interpolation. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Keep the compositor slide inside one unique run so the loop never jumps. */
function wrapDrift(offset: number, run: number): number {
  if (run <= 0) {
    return offset;
  }
  const wrapped = offset % run;
  return wrapped < 0 ? wrapped + run : wrapped;
}

/**
 * Unroll progress from PAGE SCROLL, same span as HeroScene (0.6× viewport).
 * UNCLAMPED: values > 1 mean "still flat, scrolled past the flatten point."
 * Easing toward that overshoot is what makes scrolling back up glide instead
 * of jumping from 1.0 to 0.8 in a single notch.
 *
 * Must NOT use the scroller's layout box: negative margin tucks that box
 * onto the first screen, which would seed a wrapped ring on load.
 */
function readUnrollProgress(): number {
  const vh = window.innerHeight || 1;
  const y = isMobileAppShell()
    ? (getAppScrollRoot()?.scrollTop ?? 0)
    : window.scrollY;
  return y / (vh * RING_FLATTEN_SPAN);
}

type MarqueeCardProps = {
  card: TcgCard;
  index: number;
  onSelect: (card: TcgCard) => void;
};

/**
 * One card cell, memoised. Hover fan + glow are applied imperatively on the
 * track so cursor motion never re-renders this row.
 */
const MarqueeCard = memo(function MarqueeCard({ card, index, onSelect }: MarqueeCardProps) {
  return (
    <button
      type="button"
      className="marquee-card"
      data-marquee-index={index}
      tabIndex={-1}
      aria-label={card.name}
      onClick={() => onSelect(card)}
    >
      <div className="marquee-card-cyl">
        <div className="marquee-card-inner">
          <PremiumHoloCard
            src={card.image}
            alt=""
            sizes="(max-width: 640px) 88px, 160px"
            // List-sized scans are already ~245px. Skip /_next/image so the
            // ring does not queue dozens of optimizer hits against the hero.
            unoptimized
            loading="lazy"
            innerClassName="marquee-card-art"
            max={0}
            allowTouchTilt={false}
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
      </div>
    </button>
  );
});

/**
 * An interactive, swipeable strip of card art that enters as a rolling 3D
 * cylinder and unspools into a flat native-scroll slider.
 *
 * The row is a real horizontally-scrollable surface: drag or swipe to explore
 * (native momentum on touch). A single tap/click opens the card. While idle,
 * cards orbit along the 3D ring (and slide once it has unrolled) without
 * moving the cylinder as a rigid body, stealing page scroll, or cancelling a
 * user pan.
 */
export function CardMarquee({ cards }: { cards: TcgCard[] }) {
  const live = useHomeLiveCards();
  const row = useMemo(
    () => (live.marquee ?? cards).slice(0, MAX_UNIQUE_CARDS),
    [cards, live.marquee],
  );
  // INFINITE LOOP: render the unique run LOOP_COPIES times and keep the
  // viewport inside the middle copy. Swiping is plain native scroll (full
  // momentum); scrollLeft is normalized back into the middle copy on animation
  // frames by an exact run-width — a pixel-identical, invisible jump.
  const loopEnabled = row.length > 1;
  const loopRow = useMemo(
    () =>
      loopEnabled
        ? Array.from({ length: LOOP_COPIES }, (_, copy) =>
            row.map((card) => ({ card, copy })),
          ).flat()
        : row.map((card) => ({ card, copy: 0 })),
    [loopEnabled, row],
  );

  const router = useRouter();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const pausedUntilRef = useRef(0);
  // Compositor-only auto-slide. Native scrollLeft is reserved for user drag /
  // swipe so the idle crawl cannot steal page scroll or cancel touch momentum.
  const driftOffsetRef = useRef(0);
  const pressedRef = useRef(false);
  const movedRef = useRef(false);
  const downXRef = useRef(0);
  const downYRef = useRef(0);
  const lastXRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const dragVelocityRef = useRef(0);
  const momentumRafRef = useRef(0);
  const capturedRef = useRef(false);
  const horizontalDragRef = useRef(false);
  const pointerTypeRef = useRef<string>("mouse");
  const hoverFocusRef = useRef<number | null>(null);
  const dockedElsRef = useRef<HTMLElement[]>([]);
  /** Ignore scroll events caused by our own scrollLeft writes (they fire async). */
  const ignoreScrollUntilRef = useRef(0);
  const touchTrackingRef = useRef(false);
  const hoveringRef = useRef(false);
  // Fractional leftover from mouse-drag scroll writes (keeps motion silky).
  const scrollCarryRef = useRef(0);

  const clearFanHover = useCallback(() => {
    for (const el of dockedElsRef.current) {
      el.classList.remove("is-active", "is-fan");
      el.style.zIndex = "";
      const inner = el.querySelector(".marquee-card-inner") as HTMLElement | null;
      if (inner) {
        inner.style.transform = "";
      }
    }
    dockedElsRef.current = [];
    hoverFocusRef.current = null;
    hoveringRef.current = false;
  }, []);

  const applyFanHover = useCallback((focusIndex: number) => {
    const scroller = scrollerRef.current;
    const track = scroller?.firstElementChild as HTMLElement | null;
    if (!track) {
      return;
    }
    clearFanHover();
    hoveringRef.current = true;
    hoverFocusRef.current = focusIndex;

    const cards = Array.from(track.children) as HTMLElement[];
    const width = cards[focusIndex]?.offsetWidth || 118;
    const next: HTMLElement[] = [];

    for (let offset = 0; offset < FAN_SCALE.length; offset += 1) {
      for (const sign of offset === 0 ? [0] : [-1, 1]) {
        const index = focusIndex + sign * offset;
        const card = cards[index];
        if (!card) {
          continue;
        }
        const inner = card.querySelector(".marquee-card-inner") as HTMLElement | null;
        if (!inner) {
          continue;
        }
        const lift = FAN_LIFT[offset] * width;
        const push = sign * FAN_PUSH[offset] * width;
        const scale = FAN_SCALE[offset];
        inner.style.transform =
          `translate3d(${push.toFixed(1)}px, ${(-lift).toFixed(1)}px, 0) scale(${scale})`;
        card.style.zIndex = offset === 0 ? "50" : String(40 - offset);
        card.classList.add("is-fan");
        if (offset === 0) {
          card.classList.add("is-active");
        }
        next.push(card);
      }
    }
    dockedElsRef.current = next;
  }, [clearFanHover]);

  useEffect(
    () => () => {
      window.cancelAnimationFrame(momentumRafRef.current);
      clearFanHover();
    },
    [clearFanHover],
  );

  /* ── Ring geometry cache ─────────────────────────────────────────────────
     Each card's centre in scroller-content space + the cylinder wrapper we
     transform imperatively — measured once (and on resize / image load), so
     the per-frame math needs ZERO layout reads. */
  const cardGeomRef = useRef<
    Array<{ el: HTMLElement; card: HTMLElement; contentCenterX: number; projected: boolean }>
  >([]);
  const halfViewportRef = useRef(1);
  // Loop bookkeeping: exact distance between two copies of the run, whether
  // the initial centring into the middle copy has happened, and the settle
  // timer that defers normalization until momentum has finished.
  const runWidthRef = useRef(0);
  const loopCenteredRef = useRef(false);
  const settleTimerRef = useRef(0);
  // scrollWidth/clientWidth are layout reads. They only change when the track
  // resizes, so cache the scrollable extent there instead of re-reading it on
  // every animation frame.
  const maxScrollRef = useRef(0);
  // Unspool progress 0..1 (0 = fully wrapped ring, 1 = flat line at rest).
  const progressRef = useRef(1);
  // Layout-derived target; progressRef eases toward this every frame.
  const progressTargetRef = useRef(1);
  // Whether a non-flat transform is currently written, so we can clear once.
  const ringDirtyRef = useRef(false);
  // Layout padding-top (px). The 3D camera must sit on the card line, not
  // the centre of the padded clip box, or the cylinder skews left/right.
  const padTopRef = useRef(0);

  const measureCards = useCallback(() => {
    const scroller = scrollerRef.current;
    const track = scroller?.firstElementChild as HTMLElement | null;
    if (!scroller || !track) {
      return;
    }
    halfViewportRef.current = (window.innerWidth || 1) / 2;
    maxScrollRef.current = scroller.scrollWidth - scroller.clientWidth;
    padTopRef.current = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    // offsetLeft is layout, not paint — getBoundingClientRect would include the
    // idle-slide translateX and poison `s` the next time the ring is projected.
    const trackLeft = track.offsetLeft;
    cardGeomRef.current = (Array.from(track.children) as HTMLElement[]).map((card) => {
      const cyl = card.firstElementChild as HTMLElement | null;
      return {
        el: cyl ?? card,
        card,
        contentCenterX: trackLeft + card.offsetLeft + card.offsetWidth / 2,
        // Seeded from the DOM: re-measuring must not lose track of which cards
        // are currently carrying `data-proj`, or the attribute leaks.
        projected: card.hasAttribute("data-proj"),
      };
    });

    // Exact run width = distance between the same card in adjacent copies
    // (immune to gap/rounding math). Centre into the middle copy once.
    if (loopEnabled && cardGeomRef.current.length >= row.length * 2) {
      runWidthRef.current =
        cardGeomRef.current[row.length].contentCenterX - cardGeomRef.current[0].contentCenterX;

      if (!loopCenteredRef.current && runWidthRef.current > 0) {
        loopCenteredRef.current = true;
        // Prime scrollability (iOS often ignores scrollLeft until the scroller
        // has been written at least once), then park in the middle copy.
        ignoreScrollUntilRef.current = performance.now() + 80;
        scroller.scrollLeft = 1;
        scroller.scrollLeft = runWidthRef.current * LOOP_MIDDLE_COPY;
      }
    }
  }, [loopEnabled, row.length]);

  useEffect(() => {
    loopCenteredRef.current = false;
    runWidthRef.current = 0;
  }, [row]);

  /* ── Seamless loop normalization ─────────────────────────────────────────
     Every copy of the run is pixel-identical, so shifting scrollLeft by one
     exact run-width cannot be seen. Keep the viewport inside the middle copy's
     half-window; this turns the duplicated row into a ring buffer, so touch
     momentum can continue without exposing a real edge. */
  const normalizeLoop = useCallback(() => {
    const el = scrollerRef.current;
    const run = runWidthRef.current;
    if (!el || run <= 0) {
      return;
    }
    const minMiddle = run * (LOOP_MIDDLE_COPY - 0.5);
    const maxMiddle = run * (LOOP_MIDDLE_COPY + 0.5);

    while (el.scrollLeft < minMiddle) {
      el.scrollLeft += run;
    }

    while (el.scrollLeft > maxMiddle) {
      el.scrollLeft -= run;
    }
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !loopEnabled) {
      return;
    }
    const onScroll = () => {
      // User-driven scroll (finger swipe) — briefly pause auto-slide. Drag /
      // momentum still write scrollLeft, so ignore a short window after those
      // programmatic writes or the idle crawl would freeze after every fling.
      if (performance.now() >= ignoreScrollUntilRef.current) {
        pausedUntilRef.current = Date.now() + RESUME_DELAY_TOUCH;
      }
      // NEVER normalize during a live gesture or momentum: a programmatic
      // scrollLeft write cancels native inertia on mobile. Defer until the
      // strip has settled — the jump is pixel-identical, so nobody sees it.
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        if (!pressedRef.current) {
          ignoreScrollUntilRef.current = performance.now() + 80;
          normalizeLoop();
        }
      }, LOOP_SETTLE_MS);

      // Sole exception: about to run out of duplicated content entirely
      // (~two whole runs away). Cutting one extreme fling beats a hard wall.
      // Uses the cached extent: scrollWidth is a layout read, and this handler
      // fires on every frame of a fling.
      const run = runWidthRef.current;
      const max = maxScrollRef.current;
      if (run > 0) {
        const margin = run * LOOP_EDGE_MARGIN_RUNS;
        const scrollLeft = el.scrollLeft;
        if (scrollLeft < margin || (max > 0 && scrollLeft > max - margin)) {
          normalizeLoop();
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(settleTimerRef.current);
    };
  }, [loopEnabled, normalizeLoop]);

  /* ── Vertical wheel belongs to the page ──────────────────────────────────
     A horizontally-scrollable overflow box converts vertical wheel into a
     strip pan, which stole the hero↔ring unroll. Forward vertical wheels to
     the page; keep native overflow for horizontal / shift-wheel. */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        return;
      }
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      const horizontal = event.shiftKey || absX > absY;
      if (horizontal) {
        pausedUntilRef.current = Date.now() + RESUME_DELAY;
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      smoothScrollBy(wheelDeltaPixels(event.deltaY, event.deltaMode), event);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    retainSmoothPageScroll();
    return () => {
      el.removeEventListener("wheel", onWheel);
      releaseSmoothPageScroll();
    };
  }, []);

  /* ── Unspool progress ────────────────────────────────────────────────────
     Page-scroll over 0.6× viewport — same driver as HeroScene. 0 at rest
     (wrapped, invisible) → 1 once you've scrolled 60vh (flat). One source
     of truth for phones and desktop so the negative-margin tuck cannot seed
     a wrapped ring onto the first screen.

     CRUCIAL — dual scroll sources: the phone app shell scrolls an inner
     container (#app-scroll-root), NOT the window, and scroll events don't
     bubble. Without the second listener the progress never updates on phones
     and the ring sits invisible at its staged entry (the old "iOS can't
     render it" symptom). Listen to BOTH. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      progressRef.current = 1;
      progressTargetRef.current = 1;
      return;
    }
    let ticking = false;
    const update = () => {
      ticking = false;
      const target = readUnrollProgress();
      progressTargetRef.current = target;
    };
    const onPageScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(update);
    };
    const onResize = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    const appScrollRoot = getAppScrollRoot();
    window.addEventListener("scroll", onPageScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    appScrollRoot?.addEventListener("scroll", onPageScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onPageScroll);
      window.removeEventListener("resize", onResize);
      appScrollRoot?.removeEventListener("scroll", onPageScroll);
    };
  }, []);

  /* ── Native scroll + THE 3D RING ENGINE (single rAF loop) ──────── */
  useEffect(() => {
    const el = scrollerRef.current;
    const track = el?.firstElementChild as HTMLElement | null;
    if (!el || !track) {
      return;
    }
    measureCards();

    const resize = new ResizeObserver(() => {
      measureCards();
    });
    resize.observe(track);
    const onResize = () => measureCards();
    window.addEventListener("resize", onResize, { passive: true });

    // Last transform written to the track, so an unchanged value never triggers
    // a style recalc. Once the strip is flat this string stops changing and the
    // frame becomes a pure no-op.
    let lastTrackTransform = "";
    let lastTrackOrigin = "";
    let lastPerspOrigin = "";
    let lastShellOpacity = "";
    const marqueeShell = el.parentElement;
    // Mirrors the `data-ring` attribute on the scroller. The ENTIRE 3D chain is
    // scoped to it in CSS — `perspective` here, `preserve-3d` on the track and
    // the cards, `will-change` on the ~220 cylinders. A 3D rendering context
    // spanning a scroll container this wide stops the browser from rasterising
    // it in tiles and composites every descendant, which is what made the flat
    // strip heavy to swipe on phones. The ring only needs it while unrolling.
    //
    // Seeded from the DOM, not `false`: this effect can re-run (StrictMode's
    // double-invoke, a dep change) while the ring is mid-unroll, and a stale
    // `false` would mean the flat branch never clears the attribute — pinning
    // the 3D context on for the rest of the session.
    let ringAttr = el.hasAttribute("data-ring");
    let lastTs = performance.now();
    let drifting = false;
    let visible = true;
    let progressSeeded = false;
    let isFlat = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const step = (now: number) => {
      /* ---- EVERY LAYOUT READ HAPPENS HERE, BEFORE ANY WRITE ---------------
         Reading scrollLeft after writing a style in the same frame forces a
         synchronous layout — 60 times a second, forever. Layout is clean when
         rAF runs, so read first and let everything below only write. */
      const dt = Math.min(now - lastTs, 32);
      lastTs = now;
      const isMobile = halfViewportRef.current < MOBILE_HALF_W;

      // Layout target every frame. Displayed progress eases toward it so
      // discrete wheel notches glide instead of hitching, and the orbit
      // keeps running through the unroll.
      const target = readUnrollProgress();
      progressTargetRef.current = target;
      if (reduceMotion) {
        progressRef.current = target;
        progressSeeded = true;
      } else if (!progressSeeded) {
        progressRef.current = target;
        progressSeeded = true;
      } else {
        const smoothMs = isMobile ? PROGRESS_SMOOTH_MS_MOBILE : PROGRESS_SMOOTH_MS;
        const k = 1 - Math.exp(-dt / smoothMs);
        progressRef.current += (target - progressRef.current) * k;
      }

      let scrollLeft = el.scrollLeft;

      /* ---- AUTO-DRIFT -----------------------------------------------------
         Idle orbit is an arc-length offset on each card, NOT a transform on
         the track and NOT scrollLeft. It keeps running during page scroll so
         the showcase never freezes between wheel notches. Native overflow
         stays exclusive to drag / swipe / trackpad. */
      const canDrift =
        !reduceMotion &&
        visible &&
        !pressedRef.current &&
        momentumRafRef.current === 0 &&
        Date.now() >= pausedUntilRef.current &&
        (!isMobile || progressRef.current > 0.1);

      if (canDrift) {
        const speed = isMobile ? DRIFT_PX_PER_MS_MOBILE : DRIFT_PX_PER_MS;
        driftOffsetRef.current = wrapDrift(
          driftOffsetRef.current + speed * dt,
          runWidthRef.current,
        );
        if (!drifting) {
          el.setAttribute("data-drifting", "1");
          drifting = true;
        }
      } else if (drifting) {
        el.removeAttribute("data-drifting");
        drifting = false;
      }

      const drift = driftOffsetRef.current;

      /* ---- LOOP RING-BUFFER GUARD -----------------------------------------
         EMERGENCY band only. Normalizing on every frame writes scrollLeft the
         moment a fling leaves the middle copy, and a programmatic scroll write
         cancels native touch momentum — the "stiff, heavy swipe" bug. Routine
         re-centring is settle-gated in the scroll listener; this per-frame
         check exists solely so a resize/programmatic jump can never expose a
         real content end. `maxScrollRef` is refreshed by measureCards(). */
      if (loopEnabled && runWidthRef.current > 0) {
        const margin = runWidthRef.current * LOOP_EDGE_MARGIN_RUNS;
        const max = maxScrollRef.current;
        if (scrollLeft < margin || (max > 0 && scrollLeft > max - margin)) {
          ignoreScrollUntilRef.current = performance.now() + 80;
          normalizeLoop();
          scrollLeft = el.scrollLeft;
        }
      }

      /* ---- THE UNROLLING 3D PROJECTION ------------------------------------
         True curvature interpolation ("doors open"): each card keeps its
         arc-length s (= its flat x position) while the cylinder's radius
         grows from the base radius toward infinity —

           unroll   = 1 − progress            (1 = wrapped, 0 = straight)
           R(p)     = radius / unroll         (→ ∞ as it flattens)
           θ(p)     = (s / radius) · unroll   (→ 0)
           x(p)     = R(p) · sin θ(p)         (→ s exactly)
           z(p)     = R(p) · (cos θ(p) − 1)   (→ 0)
           rotY(p)  = θ(p)                    (→ 0)

         — so the ring physically unrolls through ever-wider arcs into one
         straight line. NOT a positional lerp / Z squish. Pure trig +
         compositor-only style writes — no layout reads here. */
      const geom = cardGeomRef.current;
      const halfW = halfViewportRef.current;
      // Radius must outrun the visible half-width or edge cards go past 90°
      // and collapse into slivers on a wide desktop. The constants are floors.
      const radius = isMobile
        ? RING_RADIUS_MOBILE
        : Math.max(RING_RADIUS, halfW * 1.35);
      const tiltDeg = isMobile ? RING_TILT_DEG_MOBILE : RING_TILT_DEG;
      const scaleBoost = isMobile ? RING_SCALE_BOOST_MOBILE : RING_SCALE_BOOST;
      const enterY = isMobile ? RING_ENTER_Y_MOBILE : RING_ENTER_Y;
      const progress = clamp01(progressRef.current);
      if (isFlat) {
        if (progress < 0.997) {
          isFlat = false;
        }
      } else if (progress >= 0.999) {
        isFlat = true;
      }
      // Camera on the visible card line, not the padded box centre (that
      // skews the cylinder) and not the midpoint of the 30k-wide track
      // (that pulls the front of the ring off to one side).
      const camY = padTopRef.current + track.offsetHeight / 2;
      const perspOrigin = `50% ${camY.toFixed(1)}px`;
      if (perspOrigin !== lastPerspOrigin) {
        el.style.perspectiveOrigin = perspOrigin;
        lastPerspOrigin = perspOrigin;
      }
      const originX = scrollLeft + el.clientWidth / 2;
      const trackOrigin = `${originX.toFixed(1)}px 50%`;
      if (trackOrigin !== lastTrackOrigin) {
        track.style.transformOrigin = trackOrigin;
        lastTrackOrigin = trackOrigin;
      }
      // One deterministic desktop path: hold the ring below the hero's hover
      // bloom, then rise a few pixels toward the visual midpoint above the next
      // section. Subtract the per-card entry drop from the track lift so their
      // sum never reverses downward while progress catches up after scrolling.
      // Short viewports retain enough clip headroom for the focused card's
      // lift, scale, and 60px ambient blur to feather out naturally.
      const entryY = lerp(enterY, 0, progress);
      const liftCeiling = Math.max(0, padTopRef.current - RING_GLOW_HEADROOM);
      const stageLift = lerp(
        Math.min(RING_STAGE_LIFT_START, liftCeiling),
        Math.min(RING_STAGE_LIFT_END, liftCeiling),
        progress,
      );
      const liftY = isMobile ? 0 : -stageLift - entryY;
      if (isMobile && marqueeShell && lastShellOpacity !== "1") {
        marqueeShell.style.opacity = "1";
        lastShellOpacity = "1";
      }
      // Drift always lives on the track (same slide as the flat slider).
      // Putting it in theta ALONE, with no matching track translate, left
      // on-screen cards at sLayout ≈ 0 with |s| ≈ drift — i.e. looking at
      // the SIDE of the cylinder, which paints them as thin slivers.
      const trackTransform = isFlat
        ? `translate3d(${(-drift).toFixed(2)}px, ${liftY.toFixed(1)}px, 0)`
        : `translate3d(${(-drift).toFixed(2)}px, ${liftY.toFixed(1)}px, 0) rotateX(${lerp(tiltDeg, 0, progress).toFixed(2)}deg)`;
      if (trackTransform !== lastTrackTransform) {
        track.style.transform = trackTransform;
        lastTrackTransform = trackTransform;
      }
      if (isFlat) {
        // Flat line: clear any residual card transforms/opacity exactly once,
        // then drop `data-ring` so the cylinders release their GPU layers.
        if (ringDirtyRef.current) {
          for (const g of geom) {
            g.el.style.transform = "";
            g.el.style.opacity = "";
            if (g.projected) {
              g.projected = false;
              g.card.removeAttribute("data-proj");
            }
          }
          ringDirtyRef.current = false;
        }
        if (ringAttr) {
          el.removeAttribute("data-ring");
          el.style.perspective = "";
          ringAttr = false;
        }
      } else if (geom.length) {
        // Raise the 3D context in the same style recalc that first moves the
        // cards, so the projection is never written into a flattened tree.
        if (!ringAttr) {
          el.setAttribute("data-ring", "1");
          ringAttr = true;
        }
        const persp = isMobile ? 880 : 1200;
        const perspPx = `${persp.toFixed(0)}px`;
        if (el.style.perspective !== perspPx) {
          el.style.perspective = perspPx;
        }
        ringDirtyRef.current = true;
        // As progress goes 0 → 1, unroll goes 1 → 0. When fully unrolled,
        // avoid division by zero with a massive radius / zero angle.
        const unroll = 1 - progress;
        const currentRadius = unroll === 0 ? 100000 : radius / unroll;
        const curScale = lerp(1 + scaleBoost, 1, progress); // offset Z shrink
        // SYNCHRONIZED entry: starts up near the hero (negative enterY),
        // nearly invisible — then eases DOWN to the resting line while fading
        // fully in over RING_FADE_SPAN of the unroll, exactly as the hero
        // recedes upward (HeroScene runs the mirror move on the same span).
        const curY = entryY;
        const entryOpacity = Math.min(progress / RING_FADE_SPAN, 1);
        for (const g of geom) {
          // Layout seat vs visual arc-length: the card lives at sLayout in
          // the flex row. Idle slide is a matching translate on the TRACK
          // (`-drift` above), so the visual offset from the camera is
          // s = sLayout − drift. Theta MUST use that visual s — using it
          // without the track translate left on-screen cards at |θ| ≈ drift/R
          // (edge-on slivers). Using curX − sLayout without −drift on the
          // track shoved the whole ring sideways.
          // originX is the visible scroller centre in track space — same
          // point as transform-origin — so the front of the ring sits on
          // the page midline, not the midpoint of the duplicated strip.
          const sLayout = g.contentCenterX - originX;
          const s = sLayout - drift;
          const thetaWrapped = s / radius; // angle at full wrap (progress 0)
          // Cards past one full loop (±180°) must be INVISIBLE while the ring
          // is wrapped — leaving them flat at full opacity paints a phantom
          // 2D row through the middle of the 3D ring. They fade back in as
          // the unroll brings them onto the line (the flat-clear above
          // restores them fully once progress hits 1).
          if (thetaWrapped > RING_MAX_THETA || thetaWrapped < -RING_MAX_THETA) {
            if (g.el.style.transform || g.el.style.opacity !== "0") {
              g.el.style.transform = "";
              g.el.style.opacity = "0";
            }
            // Off the arc: no transform, invisible. It needs neither a GPU layer
            // nor a place in the 3D context. See `data-proj` below.
            if (g.projected) {
              g.projected = false;
              g.card.removeAttribute("data-proj");
            }
            continue;
          }
          /* `data-proj` marks the cards the engine is ACTUALLY projecting — the
             ones inside the visible ±180° arc. The strip renders 220 cards but
             the arc only ever holds ~33 of them on desktop and ~24 on a phone
             (the mobile radius is much tighter). Scoping `preserve-3d` and
             `will-change` to these means the 3D context and the compositor
             layers cover the couple of dozen cards that move, instead of every
             card in the duplicated row — which is the state the strip is in for
             the whole mid-screen swipe, where `progress` sits around 0.83. */
          if (!g.projected) {
            g.projected = true;
            g.card.setAttribute("data-proj", "");
          }
          // The angle shrinks to 0 as it unrolls; position on the CURRENT arc
          // (radius currentRadius). As the radius grows this converges exactly
          // onto the flat line: x → s, z → 0, rotY → 0. NO per-card
          // perspective — the shared camera on .marquee-scroller gives one
          // vanishing point.
          const currentTheta = unroll === 0 ? 0 : thetaWrapped * unroll;
          const curX = currentRadius * Math.sin(currentTheta);
          const curZ = currentRadius * (Math.cos(currentTheta) - 1);
          const curRotY = currentTheta;
          // Depth cue: cards swinging around the BACK of the cylinder dim
          // toward 30% so the far side reads as receding depth instead of a
          // same-brightness pile-up in the centre. cos(θ): 1 front → −1 back.
          const depth = 0.3 + 0.7 * (Math.cos(currentTheta) + 1) / 2;
          // The card sits at sLayout; the track already shifted by −drift, so
          // the remaining delta onto the arc is curX − s (s is visual).
          // visual x = sLayout + (curX − s) − drift = curX — ring stays put.
          g.el.style.transform =
            `translate3d(${(curX - s).toFixed(1)}px, ${curY.toFixed(1)}px, ${curZ.toFixed(1)}px) ` +
            `rotateY(${curRotY.toFixed(4)}rad) scale(${curScale.toFixed(3)})`;
          g.el.style.opacity = (entryOpacity * depth).toFixed(3);
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };

    /* ---- RUN ONLY WHILE THE STRIP IS NEAR THE VIEWPORT --------------------
       The engine used to hold a 60fps loop open for the entire lifetime of the
       home page, projecting a ring nobody could see. Park it when the strip is
       scrolled away; the progress listener keeps progressRef current, so the
       first frame back on screen is already correct. */
    // Hand the cards back to the 2D world: clear the projection and drop the 3D
    // context. Parking the loop is not enough on its own — on a phone the strip
    // starts below the fold with progress 0 ("wrapped"), so the very first frame
    // raises `data-ring` and the observer then freezes it there, leaving the
    // whole 220-card 3D chain live for as long as the user reads the hero.
    // Safe to do off-screen: the next step() rebuilds it, and the observer's
    // 300px margin means that happens well before the strip is visible.
    const releaseRing = () => {
      if (ringDirtyRef.current) {
        for (const g of cardGeomRef.current) {
          g.el.style.transform = "";
          g.el.style.opacity = "";
        }
        ringDirtyRef.current = false;
      }
      for (const g of cardGeomRef.current) {
        if (g.projected) {
          g.projected = false;
          g.card.removeAttribute("data-proj");
        }
      }
      if (ringAttr) {
        el.removeAttribute("data-ring");
        el.style.perspective = "";
        ringAttr = false;
      }
    };

    let running = false;
    const start = () => {
      if (running || document.hidden) {
        return;
      }
      running = true;
      rafRef.current = requestAnimationFrame(step);
    };
    const stop = () => {
      if (!running) {
        return;
      }
      running = false;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (drifting) {
        el.removeAttribute("data-drifting");
        drifting = false;
      }
      releaseRing();
    };

    const visibility = new IntersectionObserver(
      (entries) => {
        const isVisible = entries[entries.length - 1].isIntersecting;
        visible = isVisible;
        if (isVisible) {
          measureCards();
          start();
        } else {
          stop();
        }
      },
      { rootMargin: "300px 0px" },
    );
    visibility.observe(el);
    const onDocumentVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else if (visible) {
        start();
      }
    };
    document.addEventListener("visibilitychange", onDocumentVisibilityChange);
    start();

    return () => {
      stop();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onDocumentVisibilityChange);
      resize.disconnect();
      window.removeEventListener("resize", onResize);
      if (marqueeShell) {
        marqueeShell.style.opacity = "";
        marqueeShell.style.pointerEvents = "";
      }
    };
  }, [loopEnabled, measureCards, normalizeLoop]);

  const pause = useCallback(() => {
    pausedUntilRef.current = Date.now() + RESUME_DELAY;
  }, []);

  const stopMomentum = useCallback(() => {
    window.cancelAnimationFrame(momentumRafRef.current);
    momentumRafRef.current = 0;
    dragVelocityRef.current = 0;
    scrollCarryRef.current = 0;
    scrollerRef.current?.classList.remove("is-dragging");
    const track = scrollerRef.current?.firstElementChild as HTMLElement | null;
    track?.classList.remove("is-dragging");
  }, []);

  const startMomentum = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || Math.abs(dragVelocityRef.current) < MOMENTUM_MIN_VELOCITY) {
      dragVelocityRef.current = 0;
      scrollCarryRef.current = 0;
      el?.classList.remove("is-dragging");
      (el?.firstElementChild as HTMLElement | null)?.classList.remove("is-dragging");
      return;
    }

    let previous = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - previous, 32);
      previous = now;
      // Same settle-gated loop as touch: never normalize mid-coast — a
      // scrollLeft rewrite here is what made desktop flings feel stepped.
      ignoreScrollUntilRef.current = performance.now() + 48;
      scrollCarryRef.current += dragVelocityRef.current * dt;
      const whole = Math.trunc(scrollCarryRef.current);
      if (whole !== 0) {
        el.scrollLeft += whole;
        scrollCarryRef.current -= whole;
      }
      dragVelocityRef.current *= MOMENTUM_FRICTION;

      if (Math.abs(dragVelocityRef.current) <= MOMENTUM_STOP_VELOCITY) {
        dragVelocityRef.current = 0;
        scrollCarryRef.current = 0;
        momentumRafRef.current = 0;
        el.classList.remove("is-dragging");
        (el.firstElementChild as HTMLElement | null)?.classList.remove("is-dragging");
        ignoreScrollUntilRef.current = performance.now() + 80;
        normalizeLoop();
        return;
      }

      momentumRafRef.current = requestAnimationFrame(step);
    };

    momentumRafRef.current = requestAnimationFrame(step);
  }, [normalizeLoop]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      pointerTypeRef.current = event.pointerType;
      clearFanHover();
      stopMomentum();
      movedRef.current = false;
      capturedRef.current = false;
      horizontalDragRef.current = false;
      dragVelocityRef.current = 0;
      downXRef.current = event.clientX;
      downYRef.current = event.clientY;
      lastXRef.current = event.clientX;
      lastMoveTimeRef.current = performance.now();
      // Mouse: lock immediately. Touch: do NOT set pressed yet — a vertical
      // page-scroll that begins on the strip used to leave pressed=true and
      // freeze auto-drift forever when pointerup was swallowed by the browser.
      if (event.pointerType === "mouse") {
        pressedRef.current = true;
        touchTrackingRef.current = false;
        pause();
      } else {
        pressedRef.current = false;
        touchTrackingRef.current = true;
      }
    },
    [clearFanHover, pause, stopMomentum],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dx = event.clientX - downXRef.current;
      const dy = event.clientY - downYRef.current;

      if (event.pointerType !== "mouse") {
        if (!touchTrackingRef.current && !pressedRef.current) {
          return;
        }
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          movedRef.current = true;
        }
        // Vertical intent → this is a page scroll; release and keep drifting.
        if (
          touchTrackingRef.current &&
          !pressedRef.current &&
          Math.abs(dy) > HORIZONTAL_DRAG_THRESHOLD &&
          Math.abs(dy) >= Math.abs(dx)
        ) {
          touchTrackingRef.current = false;
          return;
        }
        // Horizontal intent → pause drift; native overflow owns the swipe.
        if (
          touchTrackingRef.current &&
          !pressedRef.current &&
          Math.abs(dx) > HORIZONTAL_DRAG_THRESHOLD &&
          Math.abs(dx) > Math.abs(dy)
        ) {
          touchTrackingRef.current = false;
          pressedRef.current = true;
          horizontalDragRef.current = true;
          pausedUntilRef.current = Date.now() + RESUME_DELAY_TOUCH;
        }
        return;
      }

      if (!pressedRef.current) {
        return;
      }
      if (
        Math.abs(dx) > DRAG_THRESHOLD ||
        Math.abs(dy) > DRAG_THRESHOLD
      ) {
        movedRef.current = true;
      }

      if (
        !horizontalDragRef.current &&
        Math.abs(dx) > HORIZONTAL_DRAG_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        horizontalDragRef.current = true;
        movedRef.current = true;
        scrollCarryRef.current = 0;
        // Imperative class — setState here re-rendered ~220 cards mid-drag.
        event.currentTarget.classList.add("is-dragging");
        (event.currentTarget.firstElementChild as HTMLElement | null)?.classList.add(
          "is-dragging",
        );
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
      if (movedRef.current && !capturedRef.current) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
          capturedRef.current = true;
        } catch {
          /* pointer capture is best-effort */
        }
      }
      const el = scrollerRef.current;
      const now = performance.now();
      const deltaX = event.clientX - lastXRef.current;
      const frameDt = Math.max(now - lastMoveTimeRef.current, 1);
      if (el && horizontalDragRef.current) {
        ignoreScrollUntilRef.current = performance.now() + 48;
        // Sub-pixel carry + EMA velocity → same silky feel as native touch.
        scrollCarryRef.current -= deltaX;
        const whole = Math.trunc(scrollCarryRef.current);
        if (whole !== 0) {
          el.scrollLeft += whole;
          scrollCarryRef.current -= whole;
        }
        const instant = -deltaX / frameDt;
        dragVelocityRef.current =
          dragVelocityRef.current * 0.65 + instant * 0.35;
        event.preventDefault();
      }
      lastXRef.current = event.clientX;
      lastMoveTimeRef.current = now;
    },
    [],
  );

  const endPress = useCallback(() => {
    const wasPressed = pressedRef.current;
    const wasTracking = touchTrackingRef.current;
    const shouldGlide =
      pointerTypeRef.current === "mouse" &&
      horizontalDragRef.current &&
      movedRef.current;
    pressedRef.current = false;
    touchTrackingRef.current = false;
    horizontalDragRef.current = false;
    if (wasPressed || wasTracking) {
      pausedUntilRef.current =
        Date.now() +
        (pointerTypeRef.current === "mouse" ? RESUME_DELAY : RESUME_DELAY_TOUCH);
      if (!shouldGlide) {
        ignoreScrollUntilRef.current = performance.now() + 80;
        normalizeLoop();
        scrollerRef.current?.classList.remove("is-dragging");
        (scrollerRef.current?.firstElementChild as HTMLElement | null)?.classList.remove(
          "is-dragging",
        );
      }
    }
    if (shouldGlide) {
      startMomentum();
    } else {
      scrollCarryRef.current = 0;
    }
  }, [normalizeLoop, startMomentum]);

  const onCardPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse" || pressedRef.current) {
        return;
      }
      const target = (event.target as HTMLElement | null)?.closest?.(
        "[data-marquee-index]",
      ) as HTMLElement | null;
      if (!target) {
        return;
      }
      const index = Number(target.dataset.marqueeIndex);
      if (!Number.isFinite(index) || index === hoverFocusRef.current) {
        return;
      }
      applyFanHover(index);
    },
    [applyFanHover],
  );

  const onTrackPointerLeave = useCallback(() => {
    clearFanHover();
  }, [clearFanHover]);

  const openCard = useCallback(
    (card: TcgCard) => {
      stashCardForNavigation(card);
      router.push(`/cards/${card.slug}`);
    },
    [router],
  );

  const onCardClick = useCallback(
    (card: TcgCard) => {
      if (movedRef.current) {
        return;
      }
      openCard(card);
    },
    [openCard],
  );

  if (!row.length) {
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
      >
        <div
          className="marquee-track"
          onPointerMove={onCardPointerEnter}
          onPointerLeave={onTrackPointerLeave}
        >
          {loopRow.map(({ card, copy }, index) => (
            <MarqueeCard
              key={`${copy}:${card.slug}:${index}`}
              card={card}
              index={index}
              onSelect={onCardClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
