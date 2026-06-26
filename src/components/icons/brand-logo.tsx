import type { SVGProps } from "react";

/**
 * PokePokedex brand mark — a refined Poké Ball rendered for the premium-black
 * theme: dark body, accent-red upper half and core, hairline ring.
 */
export function BrandLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="PokePokedex"
      {...props}
    >
      <circle cx="16" cy="16" r="14.4" fill="#0d0e13" stroke="rgba(255,255,255,0.16)" strokeWidth="1.2" />
      {/* Upper half */}
      <path d="M2.1 16a13.9 13.9 0 0 1 27.8 0Z" fill="#ff5147" />
      <path d="M2.1 16a13.9 13.9 0 0 1 27.8 0Z" fill="url(#brand-logo-sheen)" />
      {/* Equator */}
      <path d="M2.1 16h27.8" stroke="#05060a" strokeWidth="2.4" />
      {/* Core button */}
      <circle cx="16" cy="16" r="5.1" fill="#0d0e13" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="2.2" fill="#ff5147" />
      <defs>
        <linearGradient id="brand-logo-sheen" x1="6" y1="3" x2="22" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
