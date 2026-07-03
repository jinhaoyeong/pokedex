import type { SVGProps } from "react";

/**
 * PokePokedex brand mark — the DEX LENS.
 *
 * Not a Poké Ball: the mark is the front plate of a Pokédex distilled to its
 * essence — a machined near-black device tile, the big sensor lens that every
 * Pokédex points at the world, a lid seam milled across the plate, and a live
 * status LED. It says "instrument for identifying things", which is exactly
 * what the product is.
 *
 * Drawn as a lit object for the premium-black theme: one soft upper-left light
 * source, metallic collar on the lens, red iris carrying the brand accent, and
 * only colored/faint light — never white glare. Survives 28px: plate, lens,
 * LED are the whole story; the seam is a whisper.
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
      {/* Device plate: rounded tile, near-black, breathed on by top-left light. */}
      <rect x="1.6" y="1.6" width="28.8" height="28.8" rx="8.2" fill="url(#dl-plate)" />
      {/* Lid seam: milled hairline stepping across the plate, classic Pokédex lid. */}
      <path
        d="M1.6 22.4h12.1l4.6-4.6h12.1"
        stroke="rgba(255,255,255,0.09)"
        strokeWidth="1"
      />
      <path
        d="M1.6 23.4h11.7l4.6-4.6h12.5"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth="1"
      />
      {/* Plate rim: hairline, brighter where the light lands. */}
      <rect x="1.6" y="1.6" width="28.8" height="28.8" rx="8.2" stroke="url(#dl-rim)" strokeWidth="1.1" />
      {/* THE LENS — metal collar, dark optical well, red iris, aperture core. */}
      <circle cx="13.4" cy="12.6" r="7.4" fill="#04050a" />
      <circle cx="13.4" cy="12.6" r="7.4" stroke="url(#dl-collar)" strokeWidth="1.2" />
      <circle cx="13.4" cy="12.6" r="5.5" fill="url(#dl-well)" />
      <circle cx="13.4" cy="12.6" r="3.5" fill="url(#dl-iris)" />
      <circle cx="13.4" cy="12.6" r="1.15" fill="#2a0b0d" />
      {/* Lens catch-light: red-tinted, small, upper-left — no white glare. */}
      <circle cx="11.9" cy="11" r="0.7" fill="#ffb0a6" fillOpacity="0.8" />
      {/* Status LED, live: the instrument is on. A dim sibling sits beside it. */}
      <circle cx="25.4" cy="8.2" r="1.5" fill="url(#dl-led)" />
      <circle cx="25.4" cy="8.2" r="2.6" fill="#ff5147" fillOpacity="0.14" />
      <circle cx="25.4" cy="12.6" r="1.05" fill="#191b22" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
      <defs>
        <radialGradient id="dl-plate" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(10 8) rotate(56) scale(30)">
          <stop stopColor="#1a1c25" />
          <stop offset="0.5" stopColor="#0d0e13" />
          <stop offset="1" stopColor="#06070b" />
        </radialGradient>
        <linearGradient id="dl-rim" x1="16" y1="1" x2="16" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="dl-collar" x1="13.4" y1="5.2" x2="13.4" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e8e9ee" stopOpacity="0.72" />
          <stop offset="0.5" stopColor="#8b8e99" stopOpacity="0.42" />
          <stop offset="1" stopColor="#caccd4" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="dl-well" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(12 10.8) rotate(60) scale(8)">
          <stop stopColor="#252732" />
          <stop offset="1" stopColor="#0a0b10" />
        </radialGradient>
        <radialGradient id="dl-iris" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(12.3 11.2) rotate(58) scale(5.2)">
          <stop stopColor="#ff7d6e" />
          <stop offset="0.55" stopColor="#f04438" />
          <stop offset="1" stopColor="#9c1a1a" />
        </radialGradient>
        <radialGradient id="dl-led" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(25 7.8) scale(2)">
          <stop stopColor="#ff9c8f" />
          <stop offset="1" stopColor="#e03a30" />
        </radialGradient>
      </defs>
    </svg>
  );
}
