"use client";

import { useEffect, useRef, type RefObject } from "react";

import { getAppScrollRoot, isMobileAppShell } from "@/lib/app-scroll";

type ScrollContext = {
  /** Current window scroll offset in px. */
  scrollY: number;
  /** Viewport height in px (never 0). */
  viewportH: number;
  /** The tracked element's current position relative to the viewport. */
  rect: DOMRect;
};

type ScrollDrivenOptions = {
  /**
   * Exponential time constant in ms. Discrete wheel notches ease toward the
   * live scroll position instead of snapping. 0 (default) applies immediately.
   */
  smoothMs?: number;
};

function readPageScrollY() {
  if (typeof window === "undefined") {
    return 0;
  }
  const root = getAppScrollRoot();
  if (isMobileAppShell() && root) {
    return root.scrollTop;
  }
  return window.scrollY;
}

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
  options?: ScrollDrivenOptions,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Keep the latest closure without re-binding the scroll listener each render.
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);
  const smoothMs = options?.smoothMs ?? 0;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let displayedY = readPageScrollY();
    let raf = 0;
    let running = false;
    let lastTs = performance.now();

    const paint = (scrollY: number) => {
      const node = ref.current;
      if (!node) {
        return;
      }
      applyRef.current(node, {
        scrollY,
        viewportH: window.innerHeight || 1,
        rect: node.getBoundingClientRect(),
      });
    };

    const step = (now: number) => {
      raf = 0;
      const target = readPageScrollY();
      if (smoothMs <= 0) {
        displayedY = target;
        paint(displayedY);
        running = false;
        return;
      }
      const dt = Math.min(now - lastTs, 32);
      lastTs = now;
      const k = 1 - Math.exp(-dt / smoothMs);
      displayedY += (target - displayedY) * k;
      if (Math.abs(target - displayedY) < 0.2) {
        displayedY = target;
        paint(displayedY);
        running = false;
        return;
      }
      paint(displayedY);
      running = true;
      raf = requestAnimationFrame(step);
    };

    const kick = () => {
      if (running) {
        return;
      }
      running = true;
      lastTs = performance.now();
      raf = requestAnimationFrame(step);
    };

    paint(displayedY);
    const appScrollRoot = getAppScrollRoot();
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick, { passive: true });
    appScrollRoot?.addEventListener("scroll", kick, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
      appScrollRoot?.removeEventListener("scroll", kick);
    };
  }, [smoothMs]);

  return ref;
}

/** Clamp a value into the 0–1 range. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
