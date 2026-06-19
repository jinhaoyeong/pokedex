"use client";

import { useEffect, useRef, useState, type ElementType } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#*<>/";

/**
 * Cinematic "scanner decode" effect: text resolves from scrambled glyphs into
 * the final string when it scrolls into view. Reduced-motion shows it instantly.
 */
export function DecodeText({
  text,
  as: Tag = "span",
  className,
  speed = 28,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  speed?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [out, setOut] = useState(text);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // State already initialises to the final text; nothing to animate.
      return;
    }

    let frame = 0;
    let interval = 0;
    let revealed = 0;

    const start = () => {
      interval = window.setInterval(() => {
        frame += 1;
        if (frame % 2 === 0) {
          revealed += 1;
        }
        const next = text
          .split("")
          .map((char, i) => {
            if (char === " ") {
              return " ";
            }
            if (i < revealed) {
              return char;
            }
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          })
          .join("");
        setOut(next);
        if (revealed >= text.length) {
          window.clearInterval(interval);
          setOut(text);
        }
      }, speed);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          start();
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, [text, speed]);

  return (
    <Tag ref={ref} className={className} aria-label={text}>
      <span aria-hidden="true">{out}</span>
    </Tag>
  );
}
