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

  if (/assets\.tcgdex\.net/i.test(trimmed)) {
    return trimmed.replace(/\/high(\.(?:png|webp|jpe?g))(?:\?.*)?$/i, "/low$1");
  }

  return trimmed;
}
