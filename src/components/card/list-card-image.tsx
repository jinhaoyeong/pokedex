"use client";

import Image from "next/image";
import { useState } from "react";

import {
  LIST_CARD_IMAGE_QUALITY,
  listCardDisplaySrc,
  shouldOptimizeCardImage,
  shouldProxyCardImage,
} from "@/lib/list-card-image";

export function ListCardImage({
  alt,
  className = "object-contain",
  draggable,
  eager = false,
  fetchPriority,
  preload = false,
  sizes,
  src,
}: {
  alt: string;
  className?: string;
  draggable?: boolean;
  eager?: boolean;
  fetchPriority?: "high" | "low" | "auto";
  preload?: boolean;
  sizes: string;
  src: string;
}) {
  const listSrc = listCardDisplaySrc(src);
  const [sourceKey, setSourceKey] = useState(src);
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null);

  if (sourceKey !== src) {
    setSourceKey(src);
    setOverrideSrc(null);
  }

  const imageSrc = overrideSrc ?? listSrc;
  if (!imageSrc) {
    return null;
  }

  const optimize = shouldOptimizeCardImage(imageSrc);
  const resolvedFetchPriority =
    fetchPriority ?? (preload || eager ? "high" : "auto");

  return (
    <Image
      src={imageSrc}
      alt={alt}
      fill
      sizes={sizes}
      preload={preload}
      fetchPriority={resolvedFetchPriority}
      loading={preload ? undefined : eager ? "eager" : "lazy"}
      unoptimized={!optimize}
      quality={optimize ? LIST_CARD_IMAGE_QUALITY : undefined}
      decoding="async"
      draggable={draggable}
      className={className}
      onError={() => {
        if (imageSrc === "/icon.svg") {
          return;
        }

        if (
          imageSrc === listSrc &&
          listSrc !== src &&
          !shouldProxyCardImage(src)
        ) {
          setOverrideSrc(src);
          return;
        }

        if (shouldProxyCardImage(src)) {
          const proxied = `/api/card-image?url=${encodeURIComponent(src)}`;
          if (imageSrc !== proxied) {
            setOverrideSrc(proxied);
            return;
          }
        }

        setOverrideSrc("/icon.svg");
      }}
    />
  );
}
