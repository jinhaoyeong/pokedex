"use client";

import { useEffect, useRef, useState } from "react";

import { formatCurrency } from "@/lib/cards";
import {
  CURRENCY_LABEL_ATTR,
  PRICE_FX_PAINTED_ATTR,
  PRICE_USD_ATTR,
} from "@/lib/currency-preference";
import { useCurrency } from "@/components/currency-provider";

const COUNT_UP_MS = 900;

/**
 * Ramps the underlying USD amount from zero the first time the figure
 * scrolls into view, so headline totals settle instead of snapping.
 * Conversion still runs per frame, which keeps the animated text in the
 * viewer's own currency. Returns the final amount immediately when the
 * viewer prefers reduced motion.
 */
function useSettledAmount(target: number, enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const [amount, setAmount] = useState(enabled ? 0 : target);
  const played = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setAmount(target);
      return;
    }

    if (played.current) {
      setAmount(target);
      return;
    }

    const node = ref.current;
    if (!node) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      played.current = true;
      setAmount(target);
      return;
    }

    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || played.current) {
          return;
        }

        played.current = true;
        observer.disconnect();

        const start = performance.now();
        const step = (now: number) => {
          const progress = Math.min((now - start) / COUNT_UP_MS, 1);
          // Exponential ease-out: fast commitment, quiet landing.
          const eased = 1 - Math.pow(2, -10 * progress);
          setAmount(progress >= 1 ? target : target * eased);

          if (progress < 1) {
            frame = requestAnimationFrame(step);
          }
        };

        frame = requestAnimationFrame(step);
      },
      { threshold: 0.35 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled, target]);

  return { ref, amount };
}

export function ClientPrice({
  amountUsd,
  className,
  countUp = false,
}: {
  amountUsd: number;
  className?: string;
  /** Ramp the value from zero on first view. Reserved for headline figures. */
  countUp?: boolean;
}) {
  const { currency, exchangeRates } = useCurrency();
  const valid = Number.isFinite(amountUsd);
  const { ref, amount } = useSettledAmount(valid ? amountUsd : 0, countUp && valid);

  if (!valid) {
    return <span className={className}>N/A</span>;
  }

  return (
    <span
      ref={ref}
      className={className}
      suppressHydrationWarning
      {...{
        // Always stamp the settled amount: the currency repaint script
        // reads this attribute and must never see a mid-animation value.
        [PRICE_USD_ATTR]: String(amountUsd),
        [PRICE_FX_PAINTED_ATTR]: currency,
      }}
    >
      {formatCurrency(countUp ? amount : amountUsd, currency, exchangeRates)}
    </span>
  );
}

export function CurrencyLabel({ className }: { className?: string }) {
  const { currency } = useCurrency();

  return (
    <span className={className} suppressHydrationWarning {...{ [CURRENCY_LABEL_ATTR]: "" }}>
      {currency}
    </span>
  );
}
