"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveals children with a friendly pop/rise the first time they scroll into
 * view. Reduced-motion is handled in CSS (always visible), so the effect only
 * flips a class.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = "rise",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: "rise" | "pop" | "fade";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal reveal--${variant} ${shown ? "reveal-in" : ""} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
