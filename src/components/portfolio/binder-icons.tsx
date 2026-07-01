import type { SVGProps } from "react";

export type BinderIconName =
  | "sprout"
  | "leaf"
  | "bolt"
  | "medal"
  | "crown"
  | "trophy"
  | "gem"
  | "trending-up"
  | "trending-down"
  | "bag"
  | "layers"
  | "folder"
  | "box"
  | "coins"
  | "shield"
  | "sparkles"
  | "scale";

const PATHS: Record<BinderIconName, React.ReactNode> = {
  sprout: (
    <>
      <path d="M12 22V11" />
      <path d="M12 12c-4 0-6-2-6-6 4 0 6 2 6 6Z" />
      <path d="M12 10c0-3 2-5 6-5 0 4-2 5-6 5Z" />
    </>
  ),
  leaf: (
    <>
      <path d="M11 21A8 8 0 0 1 4 13C4 7 9 3 20 3c0 11-4 18-9 18Z" />
      <path d="M9 17c2-4 5-6 9-7" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  medal: (
    <>
      <path d="M8.5 9.5 5 2h5l2.5 5" />
      <path d="M15.5 9.5 19 2h-5l-2.5 5" />
      <circle cx="12" cy="15" r="6" />
      <path d="m12 12 1 2 2 .3-1.4 1.4.3 2-1.9-1-1.9 1 .3-2L9 14.3l2-.3 1-2Z" />
    </>
  ),
  crown: (
    <>
      <path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7Z" />
      <path d="M5 19h14" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v6a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3" />
      <path d="M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M12 16v4" />
      <path d="M8 21h8" />
    </>
  ),
  gem: (
    <>
      <path d="M6 3h12l3 6-9 12L3 9l3-6Z" />
      <path d="M3 9h18" />
      <path d="m9 3-1.5 6L12 21l4.5-12L15 3" />
    </>
  ),
  "trending-up": (
    <>
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M16 7h5v5" />
    </>
  ),
  "trending-down": (
    <>
      <path d="M3 7 9 13l4-4 8 8" />
      <path d="M16 17h5v-5" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <path d="M9 12h6" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ),
  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8L12 3Z" />
      <path d="M19 14l.6 1.6 1.6.6-1.6.6L19 19l-.6-1.6-1.6-.6 1.6-.6L19 14Z" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M5 7h14" />
      <path d="M5 7 2.5 13a3 3 0 0 0 5 0L5 7Z" />
      <path d="M19 7l-2.5 6a3 3 0 0 0 5 0L19 7Z" />
    </>
  ),
};

export function BinderIcon({
  name,
  className,
  ...props
}: { name: string; className?: string } & SVGProps<SVGSVGElement>) {
  const inner = PATHS[name as BinderIconName] ?? PATHS.gem;

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {inner}
    </svg>
  );
}
