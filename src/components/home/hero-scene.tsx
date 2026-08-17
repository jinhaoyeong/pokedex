"use client";

import type { ReactNode } from "react";

import { clamp01, useScrollDrivenTransform } from "@/hooks/use-scroll-progress";

/**
 * Wraps the hero (headline + buttons + 5-card fan) and runs its half of the
 * home-page choreography: as the marquee ring below fades in, eases DOWN and
 * unrolls into the flat slider (see card-marquee.tsx), the hero SIMULTANEOUSLY
 * scales down and translates UPWARD out of the way. Both sides complete over
 * the same ~60% of a viewport of scrolling, so the two moves read as one
 * synchronized handoff. Driven imperatively off window scroll (see
 * useScrollDrivenTransform) — no per-frame React renders, GPU transforms only.
 */
export function HeroScene({ children }: { children: ReactNode }) {
  const ref = useScrollDrivenTransform<HTMLDivElement>((el, { scrollY, viewportH }) => {
    // Same span as the ring's RING_FLATTEN_SPAN (0.6) so hero-out and ring-in
    // land together.
    const p = clamp01(scrollY / (viewportH * 0.6));
    // A SLIGHT recede — the ring rises to meet the fan, so the fan only needs
    // to clear a little headroom, not vacate the stage: ~-80px & scale 0.85
    // keeps the two elements visually adjacent through the whole handoff.
    const y = -p * Math.min(viewportH * 0.1, 80); // 0 → −80px, translate upwards
    const scale = 1 - p * 0.15; // 1 → 0.85: become smaller
    const opacity = 1 - p * 0.55; // soften to 0.45 — recedes without vanishing
    el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    el.style.opacity = opacity.toFixed(3);
  });

  return (
    <div ref={ref} className="hero-scene">
      {children}
    </div>
  );
}
