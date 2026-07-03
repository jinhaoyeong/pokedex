"use client";

import type { ReactNode } from "react";

import { clamp01, useScrollDrivenTransform } from "@/hooks/use-scroll-progress";

/**
 * Wraps the hero (headline + buttons + 5-card fan) and makes it "recede" as the
 * page scrolls: it drifts upward, shrinks and fades ALL the way out, handing
 * the stage to the marquee ring that opens up around it (the ring is pulled up
 * behind the fan — see .marquee's desktop negative margin). Driven imperatively
 * off window scroll (see useScrollDrivenTransform) — no per-frame React
 * renders, GPU transforms only.
 */
export function HeroScene({ children }: { children: ReactNode }) {
  const ref = useScrollDrivenTransform<HTMLDivElement>((el, { scrollY, viewportH }) => {
    // Complete the recede over the first ~65% of a viewport of scrolling —
    // roughly in step with the ring finishing its unfold, so the fan dissolves
    // as the ring takes its place.
    const p = clamp01(scrollY / (viewportH * 0.65));
    const y = -p * viewportH * 0.16; // 0 → -16vh
    const scale = 1 - p * 0.16; // 1 → 0.84
    const opacity = 1 - p; // 1 → 0 (fully gone, not half-there)
    el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    el.style.opacity = opacity.toFixed(3);
    // Once dissolved it must not swallow hovers/taps meant for the ring cards.
    // visibility (not pointer-events): the hero's inner content re-enables
    // pointer-events via CSS, which would override a plain pointer-events none
    // here — hidden visibility kills hit-testing for the whole subtree.
    el.style.visibility = p > 0.92 ? "hidden" : "";
  });

  return (
    <div ref={ref} className="hero-scene">
      {children}
    </div>
  );
}
