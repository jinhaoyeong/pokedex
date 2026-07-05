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
// Beyond one loop they are cleared so they never double-wrap and overlap.
const RING_MAX_THETA = Math.PI;
// The ring starts nearly invisible (opacity 0 at progress 0) and fades fully
// in by this share of the unroll — simultaneous with the hero's recede.
const RING_FADE_SPAN = 0.5;
// How far (fraction of viewport height) the strip's CENTRE travels up from the
// bottom edge before it is fully flat. 0.6 ⇒ the whole unroll plays on-screen,
// in step with the hero recede (HeroScene uses the same 0.6 span).
const RING_FLATTEN_SPAN = 0.6;

/* ═══════════════════════════════════════════════════════════════════════════
   2 · STRIP BEHAVIOUR (drift, tap, hover-dock) — unchanged design values
   ═══════════════════════════════════════════════════════════════════════ */

// Calm editorial drift, in px per animation frame (~27px/s at 60fps).
const AUTO_SPEED = 0.45;
// How long the strip stays still after the user lets go before drifting again.
const RESUME_DELAY = 300;
// How long a tapped card stays magnified before the drift quietly resumes.
const SELECT_VIEW_MS = 2400;
// Two taps on the same card within this window open the card detail page.
const DOUBLE_TAP_MS = 400;
// Pointer travel (px) beyond which a press counts as a drag, not a tap.
const DRAG_THRESHOLD = 8;
// Cap on the unique run before the loop repeats.
const MAX_UNIQUE_CARDS = 40;

// The "rainbow" arch: the focused card rises highest, neighbours progressively
// less, indexed by distance from the focal card (fractions of card width).
const DOCK_SCALE = [1.15, 1.08, 1.04, 1.02, 1.01];
const DOCK_LIFT_FRACTION = [0.16, 0.09, 0.05, 0.02, 0.015];
const DOCK_PUSH_FRACTION = [0, 0.22, 0.12, 0.05, 0.02];
// Phones: gentler, narrower profile (tap-to-magnify, no hover).
const DOCK_SCALE_COMPACT = [1.15, 1.07, 1.03];
const DOCK_LIFT_FRACTION_COMPACT = [0.1, 0.05, 0.02];
const DOCK_PUSH_FRACTION_COMPACT = [0, 0.12, 0.05];

/** Linear interpolation. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

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
  // Neighbours slide away from the focal card; the focal card rises in place.
  const direction = Math.sign(signedOffset);
  const lift = lifts[offset] * cardWidth;
  const push = direction * pushes[offset] * cardWidth;
  return {
    transform: `translate3d(${push.toFixed(1)}px, ${(-lift).toFixed(1)}px, 0) scale(${scales[offset]})`,
    zIndex: offset === 0 ? 50 : 40 - offset,
  };
}

/**
 * An interactive, swipeable strip of card art that enters as a rolling 3D
 * cylinder and unspools into a flat auto-drifting slider.
 *
 * The row is a real horizontally-scrollable surface: drag or swipe to explore
 * (native momentum on touch). Cards are buttons: a single tap magnifies in
 * place, a double tap opens the card detail; on a pointer device hovering
 * previews the same magnify. The track is duplicated so the loop never visibly
 * resets.
 */
export function CardMarquee({ cards }: { cards: TcgCard[] }) {
  // Use the whole live pool of unique cards so the strip travels a long way
  // before it repeats.
  const row = cards.slice(0, MAX_UNIQUE_CARDS);

  // The track animates by exactly one half, so each half must comfortably
  // exceed any viewport width. With a small pool, repeat the unique run until
  // a half is wide enough; then mirror it for the seamless loop.
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
  // tap-to-magnify that clears itself so the strip can resume drifting.
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Measured card width, so the arch lift can be sized proportionally.
  const [cardWidth, setCardWidth] = useState(118);
  // Phones get the gentler arch profile (and a tighter gap, in CSS).
  const [compact, setCompact] = useState(false);
  const active = hovered ?? selected;
  // Only a live hover holds the drift; a tap relies on a timed pause so the
  // carousel always resumes on its own.
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

  /* ── Ring geometry cache ─────────────────────────────────────────────────
     Each card's centre in scroller-content space + the cylinder wrapper we
     transform imperatively — measured once (and on resize / image load), so
     the per-frame math needs ZERO layout reads. */
  const cardGeomRef = useRef<Array<{ el: HTMLElement; contentCenterX: number }>>([]);
  const scrollerLeftRef = useRef(0);
  const halfViewportRef = useRef(1);
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
    cardGeomRef.current = (Array.from(track.children) as HTMLElement[]).map((card) => {
      const cyl = card.firstElementChild as HTMLElement | null;
      const rect = card.getBoundingClientRect();
      return {
        el: cyl ?? card,
        // Position in the scroller's scrolled content, independent of scrollLeft.
        contentCenterX: rect.left - scRect.left + scrollLeft + rect.width / 2,
      };
    });
  }, []);

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
      const rect = scroller.getBoundingClientRect();
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

  /* ── Drift + seamless wrap + THE 3D RING ENGINE (single rAF loop) ──────── */
  useEffect(() => {
    const el = scrollerRef.current;
    const track = el?.firstElementChild as HTMLElement | null;
    if (!el || !track) {
      return;
    }
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The loop is two identical copies; the seamless wrap distance is one
    // copy's width, measured as the offset of the second copy's first card.
    const measurePeriod = () => {
      const trackCards = track.children;
      const copyLength = trackCards.length / 2;
      if (copyLength < 1) {
        return 0;
      }
      const first = trackCards[0] as HTMLElement;
      const second = trackCards[copyLength] as HTMLElement;
      if (first.offsetWidth > 0) {
        setCardWidth(first.offsetWidth);
      }
      return Math.max(0, second.offsetLeft - first.offsetLeft);
    };
    periodRef.current = measurePeriod();

    // Start centred on the second copy so swiping has room in both directions.
    if (periodRef.current > 0) {
      el.scrollLeft = periodRef.current;
    }
    measureCards();

    const resize = new ResizeObserver(() => {
      periodRef.current = measurePeriod();
      measureCards();
    });
    resize.observe(track);
    const onResize = () => measureCards();
    window.addEventListener("resize", onResize, { passive: true });

    // scrollLeft snaps to whole pixels; accumulate sub-pixel drift and flush
    // once it crosses a full pixel.
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
        // Keep the position inside [period/2, 1.5·period]; re-centre by one
        // copy whenever it drifts out, in either direction.
        if (el.scrollLeft >= period * 1.5) {
          el.scrollLeft -= period;
        } else if (el.scrollLeft <= period * 0.5) {
          el.scrollLeft += period;
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
      // Carousel tilt on the track, easing to 0° once flat.
      track.style.transform = `rotateX(${lerp(tiltDeg, 0, progress).toFixed(2)}deg)`;
      if (progress >= 0.999) {
        // Flat line: clear any residual card transforms/opacity exactly once.
        if (ringDirtyRef.current) {
          for (const g of geom) {
            g.el.style.transform = "";
            g.el.style.opacity = "";
          }
          ringDirtyRef.current = false;
        }
      } else if (geom.length) {
        ringDirtyRef.current = true;
        const scrollLeft = el.scrollLeft;
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
            continue;
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
    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafRef.current);
      resize.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [measureCards]);

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
      // click-drag scroll ourselves — capturing the pointer only once a real
      // drag begins, so a plain click still lands on the card.
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
    const wasPressed = pressedRef.current;
    pressedRef.current = false;
    // Only hold the strip after a real drag/swipe (lets touch momentum settle);
    // a plain hover-leave resumes the auto-slide immediately.
    if (wasPressed) {
      pause();
    }
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
      // First tap → magnify in place and hold the strip briefly; the drift
      // always resumes on its own.
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
            // Lift every card into the arch around the focused one; when
            // nothing is focused, CSS eases the transform back to rest.
            const dock =
              active === null
                ? null
                : dockStyle(index - active, cardWidth, dockScales, dockLifts, dockPushes);
            return (
              <button
                type="button"
                key={`${card.slug}__${index}`}
                data-marquee-index={index}
                className={`marquee-card ${isActive ? "is-active" : ""}`}
                // FIXED-SIZE hover target: it never transforms (only stacking
                // order changes), so its box never slides out from under the
                // cursor.
                style={dock ? { zIndex: dock.zIndex } : undefined}
                tabIndex={-1}
                aria-label={card.name}
                onPointerEnter={(event) => onCardEnter(index, event)}
                onPointerLeave={onCardLeave}
                onClick={() => onCardClick(index, card)}
              >
                {/* CYLINDER target: the ring engine writes transform/opacity
                   here imperatively, composing with (never fighting) the hover
                   dock transform on the inner wrapper. React never sets its
                   style. */}
                <div className="marquee-card-cyl">
                  {/* ANIMATION target: lift / scale / neighbour-push rides
                     here, decoupled from the stable hover target above. */}
                  <div
                    className="marquee-card-inner"
                    style={dock ? { transform: dock.transform } : undefined}
                  >
                    {/* Same premium recipe as the 5-card hero: sampled aura,
                       3D tilt, holo-foil and cursor-locked holo-weave. */}
                    <PremiumHoloCard
                      src={card.image}
                      alt=""
                      sizes="(max-width: 640px) 88px, 160px"
                      quality={60}
                      loading="lazy"
                      unoptimized
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
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
