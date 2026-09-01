"use client";

import { useState } from "react";

import { listCardImageDisplaySrc } from "@/lib/list-card-image";

function ArtlessPlate({ setCode, number }: { setCode?: string; number?: string }) {
  return (
    <span className="card-artless">
      <span className="card-artless-code">
        {[setCode, number ? `#${number}` : null].filter(Boolean).join(" ")}
      </span>
      <span className="card-artless-note">No artwork on file</span>
    </span>
  );
}

/**
 * Thumbnail art for Dex, scan, and other card grids. Always uses the list-sized
 * URL (never hi-res), and a native img so Chrome actually requests the file
 * inside a HoloTilt transform.
 */
export function ListCardImage({
  alt,
  src,
  priority = false,
  setCode,
  number,
  className = "absolute inset-0 h-full w-full object-contain",
}: {
  alt: string;
  src: string;
  priority?: boolean;
  setCode?: string;
  number?: string;
  className?: string;
}) {
  const listSrc = listCardImageDisplaySrc(src);
  const [sourceKey, setSourceKey] = useState(src);
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null);

  if (sourceKey !== src) {
    setSourceKey(src);
    setOverrideSrc(null);
  }

  const imageSrc = overrideSrc ?? listSrc;

  if (!imageSrc || imageSrc === "/icon.svg") {
    return <ArtlessPlate setCode={setCode} number={number} />;
  }

  return (
    // Native img: Next/Image `loading=lazy` never fires inside .holo-tilt's
    // transform, so catalog tiles sat empty even after the list JSON returned.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageSrc}
      alt={alt}
      width={245}
      height={342}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "low"}
      decoding="async"
      draggable={false}
      className={className}
      onError={() => {
        if (
          imageSrc === listSrc &&
          listSrc !== src &&
          !listSrc.startsWith("/api/card-image")
        ) {
          setOverrideSrc(src);
          return;
        }

        if (imageSrc !== "/icon.svg") {
          setOverrideSrc("/icon.svg");
        }
      }}
    />
  );
}
