"use client";

import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";

let hoverCapableCache: boolean | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hasFineHover(): boolean {
  if (hoverCapableCache === null) {
    hoverCapableCache = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }
  return hoverCapableCache;
}

/**
 * Whether this pointer event may drive the 3D tilt.
 *
 * - Mouse: only a genuine hovering fine pointer (so it never fires from an
 *   emulated mouse event on a phone).
 * - Touch / pen: always allowed, but the tilt only runs *while the finger is on
 *   the card* (pointerdown → move → up). There is deliberately no gyroscope or
 *   idle "breathing" loop, so nothing shimmers untouched and the GPU is only
 *   busy during a real interaction — the same premium tilt + glow as desktop
 *   hover, just triggered by dragging a finger across the card.
 */
function tiltAllowed(pointerType: string): boolean {
  if (typeof window === "undefined" || prefersReducedMotion()) {
    return false;
  }
  if (pointerType === "touch" || pointerType === "pen") {
    return true;
  }
  return hasFineHover();
}

/**
 * Gives card artwork the real Pokémon holo-card feel: a 3D tilt that follows the
 * pointer (cursor on desktop, finger on touch) plus a coloured holo glow. Flat +
 * safe for reduced-motion users, and completely inert until touched on phones.
 */
export function HoloTilt({
  className,
  children,
  max = 14,
  foil = true,
}: {
  className?: string;
  children: ReactNode;
  max?: number;
  foil?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const applyTilt = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!tiltAllowed(event.pointerType)) {
        return;
      }
      const el = ref.current;
      if (!el) {
        return;
      }
      // Take the coordinates now, but do the LAYOUT READ inside the frame
      // callback. Measuring in the handler forced a layout on every pointermove,
      // and on touch — where the tilt runs while the finger drags — the marquee
      // writes `scrollLeft` between moves, so each read landed on a dirtied tree.
      // In rAF the layout is clean and a burst of moves collapses to one read.
      const { clientX, clientY } = event;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          return;
        }
        const px = (clientX - rect.left) / rect.width;
        const py = (clientY - rect.top) / rect.height;
        el.style.setProperty("--rx", `${-(py - 0.5) * 2 * max}deg`);
        el.style.setProperty("--ry", `${(px - 0.5) * 2 * max}deg`);
        el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
        el.style.setProperty("--ho", "1");
      });
    },
    [max],
  );

  const resetTilt = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    cancelAnimationFrame(raf.current);
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--ho", "0");
  }, []);

  // A finger lifting off ends the interaction (there is no "hover at rest" on
  // touch), so reset then. A mouse button release does NOT — the cursor is
  // still hovering, so the tilt should hold until it actually leaves.
  const handleUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse") {
        resetTilt();
      }
    },
    [resetTilt],
  );

  return (
    <div
      ref={ref}
      onPointerMove={applyTilt}
      onPointerDown={applyTilt}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={resetTilt}
      data-foil={foil ? "true" : undefined}
      className={`holo-tilt ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
