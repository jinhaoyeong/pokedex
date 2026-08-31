/**
 * Ledger glyph set. Drawn rather than borrowed from Unicode so the
 * trend marks and sort arrow share one weight with the rest of the
 * registry's printed vocabulary.
 */

type GlyphProps = {
  className?: string;
  size?: number;
};

/** Solid triangle. Rotated to 180deg by CSS for a downward trend. */
export function TrendMark({ className, size = 8 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 0.5 7.5 7H0.5L4 0.5Z" fill="currentColor" />
    </svg>
  );
}

/** Flat trend: a plain rule, no direction. */
export function FlatMark({ className, size = 8 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      aria-hidden="true"
    >
      <rect x="0.5" y="3.25" width="7" height="1.5" fill="currentColor" />
    </svg>
  );
}

/** Arrow with a stem, pointing down at rest. */
export function SortMark({ className, size = 9 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 9 9"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 1v7M1.75 5.5 4.5 8.25 7.25 5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="square"
      />
    </svg>
  );
}

/** Plus, for the ledger's primary "add" action. */
export function PlusMark({ className, size = 9 }: GlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 9 9"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 1v7M1 4.5h7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
      />
    </svg>
  );
}
