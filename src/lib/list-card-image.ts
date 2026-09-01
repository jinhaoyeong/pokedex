/**
 * Prefer a list-sized derivative so Dex tiles do not download hi-res scans.
 * Unknown hosts keep the original URL.
 */
export function listCardImageSrc(src: string): string {
  const trimmed = src.trim();

  if (!trimmed || trimmed === "/icon.svg") {
    return trimmed;
  }

  if (/images\.pokemontcg\.io/i.test(trimmed)) {
    return trimmed.replace(/_hires(\.(?:png|webp|jpe?g))(?:\?.*)?$/i, "$1");
  }

  if (/images\.scrydex\.com/i.test(trimmed)) {
    return trimmed.replace(/\/(?:large|medium)(?:\?.*)?$/i, "/small");
  }

  if (/tcgdex\.net/i.test(trimmed)) {
    const fromHigh = trimmed.replace(/\/high(\.(?:png|webp|jpe?g))(?:\?.*)?$/i, "/low$1");
    if (fromHigh !== trimmed) {
      return fromHigh;
    }

    if (!/\.(?:avif|png|webp|jpe?g)(?:\?|$)/i.test(trimmed)) {
      return `${trimmed.replace(/\/+$/, "")}/low.webp`;
    }
  }

  return trimmed;
}

/**
 * List tiles fetch this URL. Official Japanese scans are hotlink-protected, so
 * those go through the same-origin proxy; every other host stays direct so the
 * browser can use a separate connection pool from /api/*.
 */
export function listCardImageDisplaySrc(src: string): string {
  const listSrc = listCardImageSrc(src);

  if (!listSrc || listSrc === "/icon.svg") {
    return listSrc;
  }

  try {
    const parsed = new URL(listSrc);
    if (parsed.protocol === "https:" && parsed.hostname === "www.pokemon-card.com") {
      return `/api/card-image?url=${encodeURIComponent(listSrc)}`;
    }
  } catch {
    // Relative placeholders stay as-is.
  }

  return listSrc;
}
