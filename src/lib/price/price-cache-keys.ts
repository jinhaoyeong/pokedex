import type { PriceQuery } from "./types";

function pushSlug(slugs: string[], value?: string | null) {
  const clean = value?.trim();
  if (clean) {
    slugs.push(clean);
  }
}

function collectorNumberBase(value?: string | null) {
  return value?.trim().split("/")[0]?.replace(/^0+(?=\d)/, "").trim() || "";
}

/** Cache aliases so `/api/price` and grading-market consensus share a row. */
export function priceCacheSlugAliases(
  input: Pick<
    PriceQuery,
    | "slug"
    | "language"
    | "setCode"
    | "collectorNumber"
    | "officialCardId"
    | "cacheIdentityKey"
    | "cardId"
  >,
): string[] {
  const slugs: string[] = [];
  pushSlug(slugs, input.cacheIdentityKey);
  pushSlug(slugs, input.slug);
  pushSlug(slugs, input.cardId);

  const language = (input.language || "en").trim() || "en";
  const setCode = input.setCode?.trim();
  const number = collectorNumberBase(input.collectorNumber);
  const paddedNumber = number ? number.padStart(3, "0") : "";

  if (setCode && number) {
    pushSlug(slugs, `${setCode}-${number}`.toLowerCase());
    pushSlug(slugs, `${language}--${setCode}-${number}`.toLowerCase());
    if (paddedNumber !== number) {
      pushSlug(slugs, `${setCode}-${paddedNumber}`.toLowerCase());
      pushSlug(slugs, `${language}--${setCode}-${paddedNumber}`.toLowerCase());
    }
  }

  if (language === "ja" && input.officialCardId) {
    pushSlug(slugs, `ja--official-${input.officialCardId}`);
  }

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const slug of slugs) {
    const key = slug.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(slug);
  }

  return unique;
}
