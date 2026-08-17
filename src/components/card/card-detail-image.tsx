"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { HoloTilt } from "@/components/fx/holo-tilt";

const subscribeToClientReady = () => () => undefined;
const getClientReadySnapshot = () => true;
const getServerReadySnapshot = () => false;

function toProxiedCardImageUrl(src: string): string | null {
  try {
    const parsed = new URL(src);
    if (parsed.protocol !== "https:") return null;
    if (
      parsed.hostname !== "www.pokemon-card.com" &&
      parsed.hostname !== "assets.tcgdex.net"
    ) {
      return null;
    }
    return `/api/card-image?url=${encodeURIComponent(src)}`;
  } catch {
    return null;
  }
}

function initialCardImageSrc(src: string) {
  // pokemon-card.com hotlink-protects browser requests without a same-site
  // referer — go through our proxy first so the hero does not sit on a spinner.
  try {
    const parsed = new URL(src);
    if (parsed.hostname === "www.pokemon-card.com") {
      return toProxiedCardImageUrl(src) ?? src;
    }
  } catch {
    // keep original
  }
  return src;
}

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
  const [trackedSrc, setTrackedSrc] = useState(src);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (trackedSrc !== src) {
    setTrackedSrc(src);
    setFallbackSrc(null);
    setFailed(false);
  }

  const imageSrc = failed ? "" : (fallbackSrc ?? initialCardImageSrc(src));

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

  // No artwork resolved for this card (e.g. a guide-supplemented print whose
  // thumbnail is pending). Render a quiet placeholder panel — an empty string
  // src crashes next/image (`ReactDOM.preload(): Expected … non-empty href`).
  if (!src?.trim() || failed || !imageSrc?.trim()) {
    return (
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.06),transparent_65%)] ${className ?? ""}`}
        role="img"
        aria-label={`${alt} — artwork pending`}
      >
        <span className="px-4 text-center text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
          Artwork pending
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`View larger image of ${alt}`}
        className={`card-hero-holo group relative block cursor-zoom-in border-0 bg-transparent p-0 text-left ${className ?? ""}`}
      >
        {/* Ambient aura sampled from the artwork — a blurred copy that blooms
           outward in the card's own colour (psychic purple for Mewtwo, fire red
           for Charizard) and brightens on hover. Sits behind the clipped art. */}
        <span
          className="card-hero-aura"
          aria-hidden="true"
          style={{ backgroundImage: `url("${imageSrc}")` }}
        />
        <HoloTilt className="absolute inset-0 overflow-hidden rounded-[inherit]" max={16}>
          <Image
            src={imageSrc}
            alt={alt}
            fill
            priority={priority}
            sizes={sizes}
            // Load the source directly (no Next optimizer). JP official cards
            // resolve to www.pokemon-card.com URLs, which block datacenter IPs —
            // so the Vercel image optimizer (server-side, datacenter egress)
            // fails to fetch them and the detail image renders broken, even
            // though it works locally where the optimizer runs on a residential
            // IP. Every other card surface (list, marquee, binder) is already
            // unoptimized for the same reason; this brings the detail hero in
            // line so the browser fetches the art itself.
            unoptimized
            onError={() => {
              const proxied = toProxiedCardImageUrl(src);
              if (proxied && imageSrc !== proxied) {
                setFallbackSrc(proxied);
                return;
              }
              if (imageSrc !== "/icon.svg") {
                setFallbackSrc("/icon.svg");
                return;
              }
              setFailed(true);
            }}
            className="object-contain drop-shadow-2xl transition duration-200 group-hover:scale-[1.03]"
          />
          <span className="holo-weave" aria-hidden="true" />
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
                    src={imageSrc}
                    alt={alt}
                    fill
                    sizes="(max-width: 640px) 90vw, 384px"
                    className="object-contain"
                    priority
                    // Same reason as the hero image above: bypass the Vercel
                    // optimizer so datacenter-blocked JP art still loads.
                    unoptimized
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
