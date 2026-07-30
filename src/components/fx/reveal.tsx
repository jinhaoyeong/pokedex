"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({ children, className, delay = 0, variant = "rise" }: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: "rise" | "pop" | "fade";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); observer.disconnect(); }
    }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} style={delay ? { transitionDelay: `${delay}ms` } : undefined} className={`reveal reveal--${variant} ${shown ? "reveal-in" : ""} ${className ?? ""}`}>{children}</div>;
}
