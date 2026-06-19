"use client";

import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";

let hoverCapableCache: boolean | null = null;

function canTilt(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  if (hoverCapableCache === null) {
    hoverCapableCache = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }
  return hoverCapableCache;
}

/**
 * Gives card artwork the real Pokémon holo-card feel: a 3D tilt that follows the
 * cursor plus a rainbow holofoil shimmer and a moving shine. Flat + safe on
 * touch devices and for reduced-motion users.
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

  const handleMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canTilt()) {
        return;
      }
      const el = ref.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        el.style.setProperty("--rx", `${-(py - 0.5) * 2 * max}deg`);
        el.style.setProperty("--ry", `${(px - 0.5) * 2 * max}deg`);
        el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
        el.style.setProperty("--ho", "1");
      });
    },
    [max],
  );

  const handleLeave = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    cancelAnimationFrame(raf.current);
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--ho", "0");
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      data-foil={foil ? "true" : undefined}
      className={`holo-tilt ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
