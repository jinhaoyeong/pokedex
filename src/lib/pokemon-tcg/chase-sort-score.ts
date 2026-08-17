import type { TcgCard } from "@/types/pokemon";

/**
 * Prefer ex/mega/secret-looking prints when market prices are still pending.
 * Shared by server search sort and client page re-sort so unpriced commons do
 * not float above chase cards alphabetically on price-desc.
 */
export function officialJapaneseChaseSortScore(card: TcgCard) {
  const identity = `${card.name} ${card.englishName ?? ""} ${card.localizedName ?? ""}`;
  const nameScore = /special illustration|\bsir\b|\bsar\b|hyper rare/i.test(identity)
    ? 4
    : /\bmega\b|メガ/i.test(identity)
      ? 3
      : /\bex\b|ｅｘ|VMAX|VSTAR|\bGX\b/i.test(identity)
        ? 2
        : /illustration|art rare|アートレア/i.test(identity)
          ? 1
          : 0;
  const number = Number.parseInt(String(card.collectorNumber ?? "").replace(/[^\d]/g, ""), 10);
  const printed = card.setPrintedTotal ?? card.setTotal ?? 0;
  const secretSlot = Number.isFinite(number) && printed > 0 && number > printed ? 1 : 0;

  return nameScore * 1_000 + secretSlot * 800 + (Number.isFinite(number) ? number : 0);
}
