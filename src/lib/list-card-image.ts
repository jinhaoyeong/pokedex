/**
 * Prefer a list-sized derivative so Dex tiles do not download hi-res scans.
 * Unknown hosts keep the original URL.
 */

export const LIST_CARD_IMAGE_QUALITY = 60;
export const LIST_CARD_PRELOAD_WIDTH = 384;
/** First two desktop Dex rows stay in-viewport — load them immediately. */
export const DEX_VISIBLE_CARD_IMAGE_COUNT = 8;

const OPTIMIZE_HOSTS = new Set([
  "images.pokemontcg.io",
  "images.scrydex.com",
  "assets.tcgdex.net",
  "tcgdex.net",
  "serebii.net",
  "www.serebii.net",
  "archives.bulbagarden.net",
  "cdn2.bulbagarden.net",
  "storage.googleapis.com",
]);

function parseHttpsUrl(src: string): URL | null {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function hostnameOf(src: string): string | null {
  return parseHttpsUrl(src)?.hostname.toLowerCase() ?? null;
}

export function listCardImageSrc(src: string): string {
  const trimmed = src.trim();

  if (!trimmed || trimmed === "/icon.svg") {
    return trimmed;
  }

  if (/images\.pokemontcg\.io/i.test(trimmed)) {
    return trimmed.replace(/_hires(\.(?:png|webp|jpe?g))(?:\?.*)?$/i, "$1");
  }

  if (/assets\.tcgdex\.net/i.test(trimmed)) {
    return trimmed.replace(/\/high(\.(?:png|webp|jpe?g))(?:\?.*)?$/i, "/low$1");
  }

  return trimmed;
}

export function shouldProxyCardImage(src: string): boolean {
  const host = hostnameOf(src);
  return host === "www.pokemon-card.com" || host === "pokemon-card.com";
}

/**
 * Next/Vercel image optimizer fetches from a datacenter IP and does not send
 * a same-site Referer. pokemon-card.com rejects that; every other catalog CDN
 * we use is safe to transcode into a ~220px WebP/AVIF tile.
 */
export function shouldOptimizeCardImage(src: string): boolean {
  if (!src || src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("/")) {
    return false;
  }

  const host = hostnameOf(src);
  if (!host || shouldProxyCardImage(src)) {
    return false;
  }

  if (OPTIMIZE_HOSTS.has(host)) {
    return true;
  }

  return host.endsWith(".tcgdex.net");
}

export function listCardDisplaySrc(src: string): string {
  const sized = listCardImageSrc(src);
  if (!sized || sized === "/icon.svg") {
    return sized;
  }

  if (shouldProxyCardImage(sized)) {
    return `/api/card-image?url=${encodeURIComponent(sized)}`;
  }

  return sized;
}

export function listCardPreloadHref(src: string): string | null {
  const display = listCardDisplaySrc(src);
  if (!display || display === "/icon.svg") {
    return null;
  }

  if (!shouldOptimizeCardImage(display)) {
    return display;
  }

  return `/_next/image?url=${encodeURIComponent(display)}&w=${LIST_CARD_PRELOAD_WIDTH}&q=${LIST_CARD_IMAGE_QUALITY}`;
}
