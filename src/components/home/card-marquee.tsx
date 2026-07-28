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
import { getAppScrollRoot } from "@/lib/app-scroll";
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
// Base radius of the wrapped cylinder in px at progress 0. The unroll divides
// this by (1 − progress), so the curve widens smoothly to a straight line.
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
// Much tighter base radius so the 3D footprint fits a phone instead of
// bleeding out of the box (a desktop-sized radius hung mobile Safari).
const RING_RADIUS_MOBILE = 380;
// Gentler tilt (less vertical footprint), smaller boost, shorter entry drop.
const RING_TILT_DEG_MOBILE = -9;
const RING_ENTER_Y_MOBILE = -36;
const RING_SCALE_BOOST_MOBILE = 0.05;

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
            quality={60}
            loading="lazy"
            unoptimized
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
 * the strip auto-drifts so the showcase keeps moving on desktop and mobile.
 */
export function CardMarquee({ cards }: { cards: TcgCard[] }) {
  const row = useMemo(() => cards.slice(0, MAX_UNIQUE_CARDS), [cards]);
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
    pausedUntilRef.current = Date.now() + 60_000;

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
  const scrollerLeftRef = useRef(0);
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
  // Whether a non-flat transform is currently written, so we can clear once.
  const ringDirtyRef = useRef(false);

  const measureCards = useCallback(() => {
    const scroller = scrollerRef.current;
    const track = scroller?.firstElementChild as HTMLElement | null;
    if (!scroller || !track) {
      return;
    }
    const scRect = scroller.getBoundingClientRect();
    const scrollLeft = scroller.scrollLeft;
    scrollerLeftRef.current = scRect.left;
    halfViewportRef.current = (window.innerWidth || 1) / 2;
    maxScrollRef.current = scroller.scrollWidth - scroller.clientWidth;
    cardGeomRef.current = (Array.from(track.children) as HTMLElement[]).map((card) => {
      const cyl = card.firstElementChild as HTMLElement | null;
      const rect = card.getBoundingClientRect();
      return {
        el: cyl ?? card,
        card,
        // Position in the scroller's scrolled content, independent of scrollLeft.
        contentCenterX: rect.left - scRect.left + scrollLeft + rect.width / 2,
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
      // User-driven scroll (finger swipe) — briefly pause auto-drift. Our own
      // scrollLeft writes also fire this event asynchronously, so ignore a short
      // window after every programmatic write or drift freezes forever.
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

  /* ── Unspool progress ────────────────────────────────────────────────────
     Recomputed from the strip's vertical viewport position: 0 (wrapped ring)
     with its centre at the viewport bottom → 1 (flat) once the centre climbs
     RING_FLATTEN_SPAN of the way up. One rect read, throttled to a frame.

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
      progressRef.current = 1; // reduced motion → always flat
      return;
    }
    let ticking = false;
    const update = () => {
      ticking = false;
      // Measure from the card track (not the padded scroller box). Huge vertical
      // padding made progress stick below ~1 while the cards were on-screen,
      // which blocked auto-drift and left the ring half-unrolled.
      const track = scroller.firstElementChild as HTMLElement | null;
      const target = track ?? scroller;
      const rect = target.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const center = rect.top + rect.height / 2;
      progressRef.current = clamp01((vh - center) / (vh * RING_FLATTEN_SPAN));
    };
    const onScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    const appScrollRoot = getAppScrollRoot();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    appScrollRoot?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      appScrollRoot?.removeEventListener("scroll", onScroll);
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
    let lastProgressTs = 0;
    let drifting = false;
    let visible = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const step = (now: number) => {
      /* ---- EVERY LAYOUT READ HAPPENS HERE, BEFORE ANY WRITE ---------------
         Reading scrollLeft after writing a style in the same frame forces a
         synchronous layout — 60 times a second, forever. Layout is clean when
         rAF runs, so read first and let everything below only write. */
      const dt = Math.min(now - lastTs, 32);
      lastTs = now;

      // Keep unroll progress fresh even when the page isn't scrolling. Without
      // this, progress only moved on scroll events — so auto-drift looked like
      // it "only worked while scrolling down".
      if (now - lastProgressTs > 80) {
        lastProgressTs = now;
        const trackEl = el.firstElementChild as HTMLElement | null;
        const target = trackEl ?? el;
        const rect = target.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const center = rect.top + rect.height / 2;
        progressRef.current = clamp01((vh - center) / (vh * RING_FLATTEN_SPAN));
      }

      let scrollLeft = el.scrollLeft;

      /* ---- AUTO-DRIFT -----------------------------------------------------
         Drift whenever the strip is on-screen and idle. Visibility (not a
         high flatten threshold) gates it so the settled mobile view keeps
         moving without needing continuous page scroll. */
      const canDrift =
        !reduceMotion &&
        visible &&
        !pressedRef.current &&
        !hoveringRef.current &&
        momentumRafRef.current === 0 &&
        Date.now() >= pausedUntilRef.current;

      if (canDrift) {
        const isMobile = halfViewportRef.current < MOBILE_HALF_W;
        const speed = isMobile ? DRIFT_PX_PER_MS_MOBILE : DRIFT_PX_PER_MS;
        const before = el.scrollLeft;
        // Cover the async scroll event that follows this write (~1–2 frames).
        ignoreScrollUntilRef.current = performance.now() + 48;
        el.scrollLeft = before + speed * dt;
        // iOS can ignore the first programmatic writes until the scroller is
        // primed / centred — force a middle-copy hop and retry once.
        if (el.scrollLeft === before && maxScrollRef.current > 1) {
          const run = runWidthRef.current;
          if (run > 0) {
            el.scrollLeft = run * LOOP_MIDDLE_COPY + speed * dt;
          }
        }
        if (loopEnabled && runWidthRef.current > 0) {
          const run = runWidthRef.current;
          const minMiddle = run * (LOOP_MIDDLE_COPY - 0.5);
          const maxMiddle = run * (LOOP_MIDDLE_COPY + 0.5);
          if (el.scrollLeft < minMiddle || el.scrollLeft > maxMiddle) {
            ignoreScrollUntilRef.current = performance.now() + 80;
            normalizeLoop();
          }
        }
        scrollLeft = el.scrollLeft;
        if (!drifting) {
          el.setAttribute("data-drifting", "1");
          drifting = true;
        }
      } else if (drifting) {
        el.removeAttribute("data-drifting");
        drifting = false;
      }

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
      const isMobile = halfViewportRef.current < MOBILE_HALF_W;
      const radius = isMobile ? RING_RADIUS_MOBILE : RING_RADIUS;
      const tiltDeg = isMobile ? RING_TILT_DEG_MOBILE : RING_TILT_DEG;
      const scaleBoost = isMobile ? RING_SCALE_BOOST_MOBILE : RING_SCALE_BOOST;
      const enterY = isMobile ? RING_ENTER_Y_MOBILE : RING_ENTER_Y;
      const progress = progressRef.current;
      // Carousel tilt on the track, easing to 0° once flat. Skip the write when
      // the value is unchanged — at rest this is every frame.
      const trackTransform = `rotateX(${lerp(tiltDeg, 0, progress).toFixed(2)}deg)`;
      if (trackTransform !== lastTrackTransform) {
        track.style.transform = trackTransform;
        lastTrackTransform = trackTransform;
      }
      if (progress >= 0.999) {
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
          ringAttr = false;
        }
      } else if (geom.length) {
        // Raise the 3D context in the same style recalc that first moves the
        // cards, so the projection is never written into a flattened tree.
        if (!ringAttr) {
          el.setAttribute("data-ring", "1");
          ringAttr = true;
        }
        ringDirtyRef.current = true;
        const originLeft = scrollerLeftRef.current;
        const halfW = halfViewportRef.current;
        // As progress goes 0 → 1, unroll goes 1 → 0. When fully unrolled,
        // avoid division by zero with a massive radius / zero angle.
        const unroll = 1 - progress;
        const currentRadius = unroll === 0 ? 100000 : radius / unroll;
        const curScale = lerp(1 + scaleBoost, 1, progress); // offset Z shrink
        // SYNCHRONIZED entry: starts up near the hero (negative enterY),
        // nearly invisible — then eases DOWN to the resting line while fading
        // fully in over RING_FADE_SPAN of the unroll, exactly as the hero
        // recedes upward (HeroScene runs the mirror move on the same span).
        const curY = lerp(enterY, 0, progress);
        const entryOpacity = Math.min(progress / RING_FADE_SPAN, 1);
        for (const g of geom) {
          // The card's flat position relative to the viewport centre — also
          // its fixed arc-length along the unrolling ring.
          const s = originLeft - scrollLeft + g.contentCenterX - halfW;
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
          // The card already sits at `s` in layout flow, so translate3d takes
          // the DELTA to its arc position (curX − s), the entry drop, and Z.
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
    pausedUntilRef.current = Date.now() + RESUME_DELAY;
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
        onWheel={pause}
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
