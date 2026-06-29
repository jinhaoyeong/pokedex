"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { HoloTilt } from "@/components/fx/holo-tilt";

const subscribeToClientReady = () => () => undefined;
const getClientReadySnapshot = () => true;
const getServerReadySnapshot = () => false;

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

  // The lightbox is rendered through a portal so a transformed ancestor
  // (HoloTilt / Reveal animations) can't become its containing block — that
  // was making the fixed overlay jitter on hover and push the close button
  // off-screen. Portals require the DOM, so only render after mount.
  const mounted = useSyncExternalStore(
    subscribeToClientReady,
    getClientReadySnapshot,
    getServerReadySnapshot,
  );

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
        <HoloTilt className="absolute inset-0 rounded-[inherit]" max={12}>
          <Image
            src={src}
            alt={alt}
            fill
            priority={priority}
            sizes={sizes}
            className="object-contain drop-shadow-2xl transition duration-200 group-hover:scale-[1.02]"
          />
        </HoloTilt>
        <span className="pointer-events-none absolute inset-x-2 bottom-2 z-10 rounded-md bg-black/70 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-dim)] opacity-0 transition group-hover:opacity-100 sm:text-[11px]">
          Tap to enlarge
        </span>
      </button>

      {isOpen && mounted
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label={`${alt} enlarged`}
              onClick={() => setIsOpen(false)}
            >
              {/* Always-visible close affordance, pinned to the viewport corner. */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close enlarged image"
                className="fixed right-4 top-4 z-[210] flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/70 text-2xl leading-none text-white shadow-lg transition hover:bg-white hover:text-black"
              >
                <span aria-hidden="true" className="-mt-0.5">&times;</span>
              </button>

              <div
                className="relative flex max-h-[90dvh] w-full max-w-[20rem] flex-col items-stretch sm:max-w-[24rem]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="relative mx-auto aspect-[0.716/1] w-full overflow-hidden rounded-2xl border border-white/12 bg-black/60 shadow-2xl">
                  <Image
                    src={src}
                    alt={alt}
                    fill
                    sizes="(max-width: 640px) 90vw, 384px"
                    className="object-contain"
                    priority
                  />
                </div>
                <p className="mt-3 text-center text-sm font-semibold text-[var(--text-dim)]">{alt}</p>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="mx-auto mt-3 rounded-full border border-white/15 bg-black/60 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--text-dim)] transition hover:border-white/35 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
