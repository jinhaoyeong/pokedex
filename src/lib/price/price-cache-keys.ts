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

/**
 * TCGdex / Pokemon TCG API ids and printed set codes for the same English
 * release. Do not alias Celebrations (`cel25`) to Classic Collection (`cel25c`) —
 * those are different Charizard prints.
 */
const SET_CODE_FAMILIES: string[][] = [
  ["bs", "base1"],
  ["sv3pt5", "sv03.5", "sv3.5"],
  ["me2pt5", "me02.5", "me2.5"],
];

function setCodeFamily(setCode?: string | null): string[] {
  const normalized = setCode?.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const family = SET_CODE_FAMILIES.find((codes) => codes.includes(normalized));
  return family ? [...family] : [normalized];
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
  const number = collectorNumberBase(input.collectorNumber);
  const paddedNumber = number ? number.padStart(3, "0") : "";

  for (const setCode of setCodeFamily(input.setCode)) {
    if (!number) {
      continue;
    }

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
