import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Pokédex + magnifier — search / card dex. */
export function DexIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4.5" width="10" height="15" rx="2" />
      <path d="M6.5 8h4M6.5 11h4M6.5 14h2.5" />
      <circle cx="16.5" cy="15" r="3.5" />
      <path d="m19.2 17.7 1.8 1.8" />
    </svg>
  );
}

/** Price chart trending up — market. */
export function MarketIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7.5 14 3-3.2 2.6 2.2 4.4-5" />
      <path d="M17.5 4.8h2.7v2.7" />
    </svg>
  );
}

/** Ring binder — collection / portfolio. */
export function BinderIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 4.5h9.5a2 2 0 0 1 2 2v13H9a2 2 0 0 1-2-2v-13Z" />
      <path d="M7 8.5H5a1.5 1.5 0 0 0-1.5 1.5v7.5H7" />
      <path d="M10.5 8.5h5M10.5 12h3.5" />
    </svg>
  );
}

/** Pokéball — generic brand mark. */
export function PokeballIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h5M15.5 12h5" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/** Stylus / touch pointer — DS touch-menu hint. */
export function StylusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15.5 4.5 19.5 8.5 9 19 4.5 19.5 5 15z" />
      <path d="M13.5 6.5 17.5 10.5" />
    </svg>
  );
}

/** Sparkle — shiny / featured accent. */
export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5c.6 3.8 1.7 4.9 5.5 5.5-3.8.6-4.9 1.7-5.5 5.5-.6-3.8-1.7-4.9-5.5-5.5 3.8-.6 4.9-1.7 5.5-5.5Z" />
      <path d="M18 14.5c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4Z" />
    </svg>
  );
}

