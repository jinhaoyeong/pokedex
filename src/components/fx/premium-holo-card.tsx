"use client";

import Image from "next/image";
import type { ReactNode } from "react";

import { HoloTilt } from "@/components/fx/holo-tilt";

export type PremiumHoloCardProps = {
  /** Card art URL — drives both the sampled aura and the foreground image. */
  src: string;
  alt: string;
  sizes: string;
  /** Extra classes for the tilting inner frame (sizing, radius, overflow). */
  innerClassName?: string;
  priority?: boolean;
  quality?: number;
  loading?: "eager" | "lazy";
  /** Max 3D tilt in degrees. Defaults to the hero-fan preset. */
  max?: number;
  /** Overlays rendered inside the tilt frame, above the art (sheen, captions). */
  children?: ReactNode;
};

/**
 * The exact premium-card recipe extracted from the 5-card hero showcase, made
 * reusable so any surface (hero fan, marquee slider, …) renders identical depth:
 *
 *  1. `.holo-aura`  — a blurred, auto-sampled copy of the art that glows in the
 *                     card's own colour (same blur / saturation / brightness as
 *                     the hero).
 *  2. `HoloTilt`    — the 3D cursor tilt + rainbow holo-foil + shine (max tilt
 *                     defaults to 22, the hero threshold).
 *  3. `.holo-weave` — the micro-dot + parallel-line foil overlay that locks to
 *                     the cursor via the tilt vars.
 *
 * Keep this the single source of truth for premium card visuals.
 */
export function PremiumHoloCard({
  src,
  alt,
  sizes,
  innerClassName,
  priority = false,
  quality,
  loading,
  max = 22,
  children,
}: PremiumHoloCardProps) {
  return (
    <>
      <span
        className="holo-aura"
        aria-hidden="true"
        style={{ backgroundImage: `url(${src})` }}
      />
      <HoloTilt className={innerClassName} max={max}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          quality={quality}
          loading={loading}
          draggable={false}
          className="object-contain"
        />
        <span className="holo-weave" aria-hidden="true" />
        {children}
      </HoloTilt>
    </>
  );
}
