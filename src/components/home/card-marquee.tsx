"use client";

import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
   2 · STRIP BEHAVIOUR (drift, drag, fan-style hover, tap-to-open)
   ═══════════════════════════════════════════════════════════════════════ */

// How long the strip stays still after the user lets go before drifting again.
const RESUME_DELAY = 320;
// After a touch fling, wait longer so native momentum can finish before drift.
const RESUME_DELAY_TOUCH = 1000;
// Steady auto-slide speed (px per millisecond). Kept gentle to avoid stutter.
const DRIFT_PX_PER_MS = 0.042;
// Pointer travel (px) beyond which a press counts as a drag, not a tap.
const DRAG_THRESHOLD = 8;
const HORIZONTAL_DRAG_THRESHOLD = 6;
const MOMENTUM_MIN_VELOCITY = 0.08;
const MOMENTUM_STOP_VELOCITY = 0.018;
const MOMENTUM_FRICTION = 0.94;
const MAX_UNIQUE_CARDS = 36;
// Three copies is enough runway and halves the DOM vs five copies.
const LOOP_COPIES = 3;
const LOOP_MIDDLE_COPY = Math.floor(LOOP_COPIES / 2);
const LOOP_SETTLE_MS = 180;
const LOOP_EDGE_MARGIN_RUNS = 0.4;
// Treat the ring as flat early so auto-drift / swipe aren't fighting 3D math.
const RING_FLAT_PROGRESS = 0.72;

// Fan-style arch around the focused card (same language as the 5-card hero).
const DOCK_SCALE = [1.16, 1.08, 1.03];
const DOCK_LIFT_FRACTION = [0.14, 0.07, 0.03];
const DOCK_PUSH_FRACTION = [0, 0.18, 0.08];

/** Linear interpolation. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function dockStyle(
  signedOffset: number,
  cardWidth: number,
): { transform: string; zIndex: number } | null {
  const offset = Math.abs(signedOffset);
  if (offset >= DOCK_SCALE.length) {
    return null;
  }
  const direction = Math.sign(signedOffset);
  const lift = DOCK_LIFT_FRACTION[offset] * cardWidth;
  const push = direction * DOCK_PUSH_FRACTION[offset] * cardWidth;
  return {
    transform: `translate3d(${push.toFixed(1)}px, ${(-lift).toFixed(1)}px, 0) scale(${DOCK_SCALE[offset]})`,
    zIndex: offset === 0 ? 50 : 40 - offset,
  };
}

type MarqueeCardProps = {
  card: TcgCard;
  isActive: boolean;
  dockTransform?: string;
  dockZIndex?: number;
  onEnter: (index: number, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLeave: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSelect: (card: TcgCard) => void;
  index: number;
};

/**
 * One card cell, memoised. Only the focused card + its neighbours receive new
 * dock props on hover — the rest keep stable props and skip re-render.
 */
const MarqueeCard = memo(function MarqueeCard({
  card,
  index,
  isActive,
  dockTransform,
  dockZIndex,
  onEnter,
  onLeave,
  onSelect,
}: MarqueeCardProps) {
  return (
    <button
      type="button"
      data-marquee-index={index}
      data-docked={dockTransform === undefined ? undefined : ""}
      className={`marquee-card ${isActive ? "is-active" : ""}`}
      style={dockZIndex === undefined ? undefined : { zIndex: dockZIndex }}
      tabIndex={-1}
      aria-label={card.name}
      onPointerEnter={(event) => onEnter(index, event)}
      onPointerLeave={onLeave}
      onClick={() => onSelect(card)}
    >
      <div className="marquee-card-cyl">
        <div
          className="marquee-card-inner"
          style={dockTransform === undefined ? undefined : { transform: dockTransform }}
        >
          <PremiumHoloCard
            src={card.image}
            alt=""
            sizes="(max-width: 640px) 88px, 160px"
            quality={60}
            loading="lazy"
            unoptimized
            innerClassName="marquee-card-art"
            // Tilt only on the focused card — enabling it on every cell made hover lag.
            max={isActive ? 14 : 0}
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
 * Idle auto-drift keeps the showcase moving. Hover fans neighbouring cards
 * (hero-style) with colour bloom. Touch uses native momentum for smooth swipes.
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
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [cardWidth, setCardWidth] = useState(118);
  const hoveredRef = useRef<number | null>(null);
  const driftCarryRef = useRef(0);

  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  useEffect(
    () => () => {
      window.cancelAnimationFrame(momentumRafRef.current);
    },
    [],
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
        // Idempotent: only hop when actually sitting in the first copy, so a
        // remount (dev strict mode re-runs effects) can't stack a second shift.
        if (scroller.scrollLeft < runWidthRef.current * 0.5) {
          scroller.scrollLeft += runWidthRef.current * LOOP_MIDDLE_COPY;
        }
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
    let copyShift = 0;
    const minMiddle = run * (LOOP_MIDDLE_COPY - 0.5);
    const maxMiddle = run * (LOOP_MIDDLE_COPY + 0.5);

    while (el.scrollLeft < minMiddle) {
      el.scrollLeft += run;
      copyShift += 1;
    }

    while (el.scrollLeft > maxMiddle) {
      el.scrollLeft -= run;
      copyShift -= 1;
    }

    if (copyShift !== 0) {
      const indexShift = copyShift * row.length;
      setHovered((value) => (value === null ? null : value + indexShift));
    }
  }, [row.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !loopEnabled) {
      return;
    }
    const onScroll = () => {
      // NEVER normalize during a live gesture or momentum: a programmatic
      // scrollLeft write cancels native inertia on mobile. Defer until the
      // strip has settled — the jump is pixel-identical, so nobody sees it.
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        if (!pressedRef.current) {
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
      const first = track.children[0] as HTMLElement | undefined;
      if (first && first.offsetWidth > 0) {
        setCardWidth(first.offsetWidth);
      }
      measureCards();
    });
    const first = track.children[0] as HTMLElement | undefined;
    if (first && first.offsetWidth > 0) {
      setCardWidth(first.offsetWidth);
    }
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
    let drifting = false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const step = (now: number) => {
      /* ---- EVERY LAYOUT READ HAPPENS HERE, BEFORE ANY WRITE ---------------
         Reading scrollLeft after writing a style in the same frame forces a
         synchronous layout — 60 times a second, forever. Layout is clean when
         rAF runs, so read first and let everything below only write. */
      const dt = Math.min(now - lastTs, 32);
      lastTs = now;
      let scrollLeft = el.scrollLeft;

      /* ---- AUTO-DRIFT -----------------------------------------------------
         Steady compositor-friendly scroll while idle. Pause on press/hover.
         Sub-pixel carry avoids stuttery 1px jumps. Ring math is skipped once
         mostly flat so drift isn't fighting 3D projection every frame. */
      const canDrift =
        !reduceMotion &&
        !pressedRef.current &&
        momentumRafRef.current === 0 &&
        hoveredRef.current === null &&
        Date.now() >= pausedUntilRef.current &&
        progressRef.current >= 0.2;

      if (canDrift) {
        driftCarryRef.current += DRIFT_PX_PER_MS * dt;
        const stepPx = Math.floor(driftCarryRef.current);
        if (stepPx !== 0) {
          driftCarryRef.current -= stepPx;
          el.scrollLeft += stepPx;
        }
        if (loopEnabled && runWidthRef.current > 0) {
          const run = runWidthRef.current;
          const minMiddle = run * (LOOP_MIDDLE_COPY - 0.45);
          const maxMiddle = run * (LOOP_MIDDLE_COPY + 0.45);
          if (el.scrollLeft < minMiddle || el.scrollLeft > maxMiddle) {
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
        driftCarryRef.current = 0;
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
      if (progress >= RING_FLAT_PROGRESS || drifting) {
        // Flat / drifting: clear residual 3D work so scroll stays smooth.
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
      if (running) {
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
        if (entries[entries.length - 1].isIntersecting) {
          start();
        } else {
          stop();
        }
      },
      { rootMargin: "300px 0px" },
    );
    visibility.observe(el);
    start();

    return () => {
      stop();
      visibility.disconnect();
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
    setDragging(false);
  }, []);

  const startMomentum = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || Math.abs(dragVelocityRef.current) < MOMENTUM_MIN_VELOCITY) {
      dragVelocityRef.current = 0;
      setDragging(false);
      return;
    }

    let previous = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - previous, 32);
      previous = now;
      el.scrollLeft += dragVelocityRef.current * dt;
      if (runWidthRef.current > 0) {
        const run = runWidthRef.current;
        const minMiddle = run * (LOOP_MIDDLE_COPY - 0.45);
        const maxMiddle = run * (LOOP_MIDDLE_COPY + 0.45);
        if (el.scrollLeft < minMiddle || el.scrollLeft > maxMiddle) {
          normalizeLoop();
        }
      }
      dragVelocityRef.current *= MOMENTUM_FRICTION;

      if (Math.abs(dragVelocityRef.current) <= MOMENTUM_STOP_VELOCITY) {
        dragVelocityRef.current = 0;
        momentumRafRef.current = 0;
        setDragging(false);
        return;
      }

      momentumRafRef.current = requestAnimationFrame(step);
    };

    momentumRafRef.current = requestAnimationFrame(step);
  }, [normalizeLoop]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      pointerTypeRef.current = event.pointerType;
      stopMomentum();
      pressedRef.current = true;
      movedRef.current = false;
      capturedRef.current = false;
      horizontalDragRef.current = false;
      dragVelocityRef.current = 0;
      downXRef.current = event.clientX;
      downYRef.current = event.clientY;
      lastXRef.current = event.clientX;
      lastMoveTimeRef.current = performance.now();
      pause();
    },
    [pause, stopMomentum],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pressedRef.current) {
        return;
      }
      const dx = event.clientX - downXRef.current;
      const dy = event.clientY - downYRef.current;
      if (
        Math.abs(dx) > DRAG_THRESHOLD ||
        Math.abs(dy) > DRAG_THRESHOLD
      ) {
        movedRef.current = true;
      }

      // Touch/pen: native overflow scroll owns the fling. Writing scrollLeft
      // (or capturing the pointer) here cancels inertia and feels glitchy.
      if (event.pointerType !== "mouse") {
        pause();
        return;
      }

      if (
        !horizontalDragRef.current &&
        Math.abs(dx) > HORIZONTAL_DRAG_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        horizontalDragRef.current = true;
        movedRef.current = true;
        setDragging(true);
        setHovered(null);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
      // Capture only once a real drag begins, so a plain click still lands on
      // the card.
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
      if (el && horizontalDragRef.current) {
        el.scrollLeft -= deltaX;
        dragVelocityRef.current = -deltaX / Math.max(now - lastMoveTimeRef.current, 1);
        if (loopEnabled && runWidthRef.current > 0) {
          const run = runWidthRef.current;
          const minMiddle = run * (LOOP_MIDDLE_COPY - 0.45);
          const maxMiddle = run * (LOOP_MIDDLE_COPY + 0.45);
          if (el.scrollLeft < minMiddle || el.scrollLeft > maxMiddle) {
            normalizeLoop();
          }
        }
        event.preventDefault();
      }
      lastXRef.current = event.clientX;
      lastMoveTimeRef.current = now;
      pause();
    },
    [normalizeLoop, pause],
  );

  const endPress = useCallback(() => {
    const wasPressed = pressedRef.current;
    const shouldGlide =
      pointerTypeRef.current === "mouse" &&
      horizontalDragRef.current &&
      movedRef.current;
    pressedRef.current = false;
    horizontalDragRef.current = false;
    // Only hold the strip after a real drag/swipe (lets touch momentum settle);
    // a plain hover-leave resumes the auto-slide immediately.
    if (wasPressed) {
      pausedUntilRef.current =
        Date.now() +
        (pointerTypeRef.current === "mouse" ? RESUME_DELAY : RESUME_DELAY_TOUCH);
    }
    if (shouldGlide) {
      startMomentum();
    } else {
      setDragging(false);
    }
  }, [startMomentum]);

  const onCardEnter = useCallback((index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && !pressedRef.current) {
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
        className={`marquee-scroller ${dragging ? "is-dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        onWheel={pause}
      >
        <div
          className={`marquee-track ${hovered !== null ? "is-focusing" : ""} ${
            dragging ? "is-dragging" : ""
          }`}
        >
          {loopRow.map(({ card, copy }, index) => {
            const dock =
              hovered === null ? null : dockStyle(index - hovered, cardWidth);
            return (
              <MarqueeCard
                key={`${copy}:${card.slug}`}
                card={card}
                index={index}
                isActive={hovered === index}
                dockTransform={dock?.transform}
                dockZIndex={dock?.zIndex}
                onEnter={onCardEnter}
                onLeave={onCardLeave}
                onSelect={onCardClick}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
