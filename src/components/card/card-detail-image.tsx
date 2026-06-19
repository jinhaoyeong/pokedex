"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { HoloTilt } from "@/components/fx/holo-tilt";

export function CardDetailImage({
  src,
  alt,
  className,
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes: string;
  priority?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`View larger image of ${alt}`}
        className={`group relative block cursor-zoom-in overflow-hidden border-0 bg-transparent p-0 text-left ${className ?? ""}`}
      >
        <HoloTilt className="absolute inset-0 rounded-[inherit]" max={10}>
          <Image
            src={src}
            alt={alt}
            fill
            priority={priority}
            sizes={sizes}
            className="object-contain drop-shadow-2xl transition duration-200 group-hover:scale-[1.02]"
          />
        </HoloTilt>
        <span className="pointer-events-none absolute inset-x-2 bottom-2 z-10 rounded-md bg-slate-950/70 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-slate-200 opacity-0 transition group-hover:opacity-100 sm:text-[11px]">
          Tap to enlarge
        </span>
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setIsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${alt} enlarged`}
            className="relative flex max-h-[90dvh] w-full max-w-[20rem] flex-col items-stretch sm:max-w-[24rem]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="mb-3 self-end rounded-full border border-white/15 bg-slate-950/80 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-slate-200 hover:text-white"
            >
              Close
            </button>
            <div className="relative mx-auto aspect-[0.716/1] w-full overflow-hidden rounded-2xl border border-yellow-200/30 bg-slate-950/60 shadow-2xl shadow-blue-950/50">
              <Image
                src={src}
                alt={alt}
                fill
                sizes="(max-width: 640px) 90vw, 384px"
                className="object-contain"
                priority
              />
            </div>
            <p className="mt-3 text-center text-sm font-semibold text-slate-200">{alt}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
