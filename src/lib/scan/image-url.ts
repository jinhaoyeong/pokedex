/** Resolve extensionless TCGdex asset bases to an actual image file. */
export function normalizeScanCardImageUrl(url: string): string {
  const trimmed = url.trim();
  if (
    trimmed.startsWith("https://assets.tcgdex.net/") &&
    !/\.(?:avif|jpe?g|png|webp)(?:\?|$)/i.test(trimmed)
  ) {
    return `${trimmed.replace(/\/+$/, "")}/high.webp`;
  }
  return trimmed;
}
