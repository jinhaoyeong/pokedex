import { getLocalizedSetMarketProfile } from "@/lib/localized-set-market";
import type { TcgCard } from "@/types/pokemon";

const SET_CODE_ONLY_PATTERN = /^[A-Z]{1,4}[0-9]{0,3}[A-Z]?$/;

/** Resolve a human set name for PriceCharting / market APIs (not a bare set code like SM12). */
export function resolveGradingMarketLookupSetName(
  card: Pick<TcgCard, "setName" | "setEnglishName" | "setCode">,
): string {
  const profile = card.setCode ? getLocalizedSetMarketProfile(card.setCode) : undefined;
  const candidate = card.setEnglishName?.trim() || card.setName?.trim() || "";

  if (
    profile?.englishName &&
    (!candidate ||
      candidate.toUpperCase() === card.setCode?.trim().toUpperCase() ||
      SET_CODE_ONLY_PATTERN.test(candidate))
  ) {
    return profile.englishName;
  }

  return candidate || profile?.englishName || card.setCode?.trim() || "Unknown set";
}

export function resolveGradingMarketLookupCardName(
  card: Pick<TcgCard, "name" | "englishName" | "language">,
): string {
  if (card.language !== "en" && card.englishName?.trim()) {
    return card.englishName.trim();
  }

  const bilingualMatch = card.name.match(/\(([^)]+)\)\s*$/);
  if (bilingualMatch?.[1]?.trim()) {
    return bilingualMatch[1].trim();
  }

  return card.name.trim();
}
