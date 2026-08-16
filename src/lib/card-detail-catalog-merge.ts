import type { TcgCard } from "@/types/pokemon";

export function catalogFactCompleteness(
  card: Pick<TcgCard, "stage" | "dexIds" | "setPrintedTotal" | "setTotal" | "types" | "attacks">,
) {
  return (
    (card.stage ? 1 : 0) +
    (card.dexIds?.length ? 1 : 0) +
    (card.setPrintedTotal || card.setTotal ? 1 : 0) +
    (card.types?.length ? 1 : 0) +
    (card.attacks?.length ? 1 : 0)
  );
}

export function shouldKeepCurrentCatalogCard(current: TcgCard, incoming: TcgCard) {
  if (current.image?.trim() && !incoming.image?.trim()) {
    return true;
  }

  if (current.language === "en" && current.marketPriceUsd > 0 && !(incoming.marketPriceUsd > 0)) {
    return true;
  }

  if (
    (current.attacks?.length ?? 0) > 0 &&
    (incoming.attacks?.length ?? 0) === 0 &&
    current.rarity !== "Localized release" &&
    incoming.rarity === "Localized release"
  ) {
    return true;
  }

  const currentFacts = catalogFactCompleteness(current);
  const incomingFacts = catalogFactCompleteness(incoming);
  if (incomingFacts !== currentFacts) {
    return incomingFacts < currentFacts;
  }

  return (
    current.slug === incoming.slug &&
    current.image === incoming.image &&
    current.marketPriceUsd === incoming.marketPriceUsd &&
    current.name === incoming.name &&
    current.collectorNumber === incoming.collectorNumber &&
    current.setCode === incoming.setCode &&
    current.stage === incoming.stage &&
    (current.setPrintedTotal ?? current.setTotal) ===
      (incoming.setPrintedTotal ?? incoming.setTotal) &&
    (current.dexIds?.join(",") ?? "") === (incoming.dexIds?.join(",") ?? "") &&
    (current.attacks?.length ?? 0) === (incoming.attacks?.length ?? 0) &&
    (current.psaPopulation?.grades?.length ?? 0) ===
      (incoming.psaPopulation?.grades?.length ?? 0) &&
    (current.gradedPrices?.length ?? 0) === (incoming.gradedPrices?.length ?? 0)
  );
}
