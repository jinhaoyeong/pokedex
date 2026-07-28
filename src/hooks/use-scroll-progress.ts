"use client";

import { useEffect, useRef, type RefObject } from "react";

type ScrollContext = {
  /** Current window scroll offset in px. */
  scrollY: number;
  /** Viewport height in px (never 0). */
  viewportH: number;
  /** The tracked element's current position relative to the viewport. */
  rect: DOMRect;
};

/**
 * Scroll-linked transforms, done the lightweight way (no framer-motion).
 *
 * Attaches a single passive scroll/resize listener that is strictly throttled to
 * one `requestAnimationFrame` per frame, then calls `apply` to write styles
 * IMPERATIVELY onto the tracked node. Because it never touches React state,
 * nothing re-renders while you scroll — essential for the heavy marquee, whose
 * ~28 card nodes must not reconcile per frame.
 *
 * `apply` must only ever set hardware-accelerated properties (transform via
 * translate3d/scale/rotateX, opacity) — never top/margin/padding — so the work
 * stays on the compositor and off the main thread.
 *
 * Respects `prefers-reduced-motion`: the listener is never bound, so the element
 * simply keeps its CSS resting state.
 */
export function useScrollDrivenTransform<T extends HTMLElement>(
  apply: (el: T, ctx: ScrollContext) => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Keep the latest closure without re-binding the scroll listener each render.
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let ticking = false;
    const run = () => {
      ticking = false;
      const node = ref.current;
      if (!node) {
        return;
      }
      applyRef.current(node, {
        scrollY: window.scrollY,
        viewportH: window.innerHeight || 1,
        rect: node.getBoundingClientRect(),
      });
    };
    const onScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(run);
    };

    run(); // set the correct state for the initial scroll position
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return ref;
}

/** Clamp a value into the 0–1 range. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
