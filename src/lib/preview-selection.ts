import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import type { TcgCard } from "@/types/pokemon";

/** Hosts that serve flat digital card scans (not phone photos of physical cards). */
const OFFICIAL_PREVIEW_IMAGE_HOSTS = new Set([
  "images.pokemontcg.io",
  "assets.tcgdex.net",
  "serebii.net",
  "www.serebii.net",
  "archives.bulbagarden.net",
  "cdn2.bulbagarden.net",
]);

function hasOfficialPreviewImage(image: string) {
  if (!image || image === "/icon.svg" || image.startsWith("/")) {
    return false;
  }

  try {
    const host = new URL(image).hostname.toLowerCase();
    return OFFICIAL_PREVIEW_IMAGE_HOSTS.has(host) || host.endsWith(".pokemontcg.io");
  } catch {
    return false;
  }
}

export function isUsablePreviewCard(card: TcgCard) {
  const headlinePrice = getHeadlineMarketPriceUsd(card);

  return (
    Boolean(card.slug) &&
    Boolean(card.name.trim()) &&
    Boolean(card.setName.trim()) &&
    Boolean(card.collectorNumber.trim()) &&
    headlinePrice >= 5 &&
    headlinePrice <= 250_000 &&
    card.image !== "/icon.svg" &&
    card.imageStatus !== "placeholder" &&
    hasOfficialPreviewImage(card.image)
  );
}

export function normalizePreviewCard(card: TcgCard): TcgCard {
  const headlinePrice = Math.round(getHeadlineMarketPriceUsd(card) * 100) / 100;

  return {
    ...card,
    marketPriceUsd: headlinePrice,
    gradedPrices: card.gradedPrices.map((price) =>
      price.grade === "Ungraded"
        ? {
            ...price,
            value: headlinePrice,
          }
        : price,
    ),
    priceConsensus: card.priceConsensus
      ? {
          ...card.priceConsensus,
          finalEstimateUsd: headlinePrice,
        }
      : card.priceConsensus,
  };
}

export function pushUniquePreviewCards(target: TcgCard[], cards: TcgCard[], limit: number) {
  const seen = new Set(target.map((card) => card.slug));

  for (const card of cards) {
    if (target.length >= limit) {
      break;
    }

    if (!isUsablePreviewCard(card) || seen.has(card.slug)) {
      continue;
    }

    target.push(normalizePreviewCard(card));
    seen.add(card.slug);
  }
}
