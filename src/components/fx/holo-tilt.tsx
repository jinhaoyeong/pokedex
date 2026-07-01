"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

let hoverCapableCache: boolean | null = null;
let coarsePointerCache: boolean | null = null;

type MobileMotionMode = "pointer" | "gyro" | "ambient";
type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied" | "prompt">;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function canPointerTilt(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (prefersReducedMotion()) {
    return false;
  }
  if (hoverCapableCache === null) {
    hoverCapableCache = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }
  return hoverCapableCache;
}

function isCoarsePointer(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (coarsePointerCache === null) {
    coarsePointerCache = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  }
  return coarsePointerCache;
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
  const motionModeRef = useRef<MobileMotionMode>("pointer");
  const [motionMode, setMotionMode] = useState<MobileMotionMode>("pointer");

  const setMode = useCallback((mode: MobileMotionMode) => {
    if (motionModeRef.current === mode) {
      return;
    }

    motionModeRef.current = mode;
    setMotionMode(mode);
  }, []);

  const requestMotionPermission = useCallback(() => {
    if (typeof window === "undefined" || canPointerTilt()) {
      return;
    }

    const orientationEvent = window.DeviceOrientationEvent as
      | DeviceOrientationEventConstructorWithPermission
      | undefined;

    if (typeof orientationEvent?.requestPermission !== "function") {
      return;
    }

    void orientationEvent.requestPermission().catch(() => undefined);
  }, []);

  useEffect(() => {
    const el = ref.current;

    if (!el || typeof window === "undefined" || !isCoarsePointer() || prefersReducedMotion()) {
      return;
    }

    let seenMotion = false;
    let frame = 0;
    let fallbackTimer = 0;
    let beta = 0;
    let gamma = 0;

    const applyOrientation = () => {
      frame = 0;
      const normalizedBeta = clamp(beta / 45, -1, 1);
      const normalizedGamma = clamp(gamma / 35, -1, 1);
      const rx = -normalizedBeta * max * 0.7;
      const ry = normalizedGamma * max;
      const mx = clamp(50 + normalizedGamma * 26, 18, 82);
      const my = clamp(50 + normalizedBeta * 22, 22, 78);

      el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      el.style.setProperty("--mx", `${mx.toFixed(1)}%`);
      el.style.setProperty("--my", `${my.toFixed(1)}%`);
      el.style.setProperty("--ho", "0.72");
      setMode("gyro");
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (typeof event.beta !== "number" || typeof event.gamma !== "number") {
        return;
      }

      seenMotion = true;
      beta = event.beta;
      gamma = event.gamma;

      if (!frame) {
        frame = requestAnimationFrame(applyOrientation);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    fallbackTimer = window.setTimeout(() => {
      if (!seenMotion) {
        el.style.setProperty("--ho", "0.42");
        setMode("ambient");
      }
    }, 900);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      window.clearTimeout(fallbackTimer);
      cancelAnimationFrame(frame);
    };
  }, [max, setMode]);

  const handleMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canPointerTilt()) {
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
    if (!canPointerTilt()) {
      return;
    }

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
      onPointerDown={requestMotionPermission}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      data-foil={foil ? "true" : undefined}
      data-motion={motionMode === "pointer" ? undefined : motionMode}
      className={`holo-tilt ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
