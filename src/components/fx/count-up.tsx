"use client";

import { useEffect, useRef, useState } from "react";

export function CountUp({
  value,
  duration = 1400,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
}: {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(frame);
    }
    let frame = 0;
    let start = 0;
    const animate = (now: number) => {
      if (!start) start = now;
      const progress = Math.min((now - start) / duration, 1);
      setDisplay(value * (progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        frame = requestAnimationFrame(animate);
        observer.disconnect();
      }
    }, { threshold: 0.4 });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value, duration]);

  return <span ref={ref} className={className}>{prefix}{display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}
