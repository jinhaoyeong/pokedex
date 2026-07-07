import { getLocalizedSetMarketProfile } from "@/lib/localized-set-market";
import type { TcgCard } from "@/types/pokemon";

const SET_CODE_ONLY_PATTERN = /^[A-Z]{1,4}[0-9]{0,3}[A-Z]?$/;
const TRAINER_GALLERY_SET_CODE_PATTERN = /^SWSH\d+TG$/i;

function normalizeLookupText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function celebrationsParentSetName(setName: string) {
  if (!/celebrations/i.test(setName)) {
    return null;
  }

  return "Celebrations";
}

function trainerGalleryParentSetName(setCode?: string, setName?: string) {
  const code = setCode?.trim().toUpperCase() ?? "";

  if (!TRAINER_GALLERY_SET_CODE_PATTERN.test(code)) {
    if (!/trainer\s+gallery/i.test(setName ?? "")) {
      return null;
    }
  }

  const match = code.match(/^SWSH(\d+)TG$/i);

  if (!match) {
    return null;
  }

  const setNumber = match[1];

  const parentNames: Record<string, string> = {
    "9": "Brilliant Stars",
    "10": "Astral Radiance",
    "11": "Lost Origin",
    "12": "Silver Tempest",
  };

  return parentNames[setNumber] ?? null;
}

function stripSetSubsetSuffix(setName: string) {
  const normalized = normalizeLookupText(setName);

  if (/celebrations/i.test(normalized) && /classic collection/i.test(normalized)) {
    return celebrationsParentSetName(normalized) ?? normalized;
  }

  const colonParent = normalized.match(/^([^:]+):/);

  if (colonParent?.[1]?.trim()) {
    const parent = colonParent[1].trim();

    if (parent.length >= 3 && !SET_CODE_ONLY_PATTERN.test(parent)) {
      return parent;
    }
  }

  return normalized;
}

/** Resolve a human set name for PriceCharting / market APIs (not a bare set code like SM12). */
export function resolveGradingMarketLookupSetName(
  card: Pick<TcgCard, "setName" | "setEnglishName" | "setCode" | "rarity">,
): string {
  const profile = card.setCode ? getLocalizedSetMarketProfile(card.setCode) : undefined;
  const rawCandidate = normalizeLookupText(card.setEnglishName?.trim() || card.setName?.trim() || "");
  const celebrationsName = celebrationsParentSetName(rawCandidate);
  const trainerGalleryName = trainerGalleryParentSetName(card.setCode, rawCandidate);

  if (profile?.englishName) {
    if (
      !rawCandidate ||
      rawCandidate.toUpperCase() === card.setCode?.trim().toUpperCase() ||
      SET_CODE_ONLY_PATTERN.test(rawCandidate) ||
      celebrationsName ||
      trainerGalleryName ||
      /classic collection/i.test(rawCandidate)
    ) {
      return profile.englishName;
    }
  }

  if (celebrationsName) {
    return celebrationsName;
  }

  if (trainerGalleryName) {
    return trainerGalleryName;
  }

  const stripped = stripSetSubsetSuffix(rawCandidate);

  if (stripped && stripped !== rawCandidate) {
    return stripped;
  }

  if (
    profile?.englishName &&
    (!rawCandidate || SET_CODE_ONLY_PATTERN.test(rawCandidate))
  ) {
    return profile.englishName;
  }

  return rawCandidate || profile?.englishName || card.setCode?.trim() || "Unknown set";
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

type GradingMarketEnrichmentCard = Pick<
  TcgCard,
  "psaPopulation" | "gradedPrices" | "recentSales" | "priceConsensus"
> &
  Partial<Pick<TcgCard, "language" | "marketPriceUsd" | "sources">>;

const TRUSTED_LOCALIZED_PRICE_SOURCE =
  /pricecharting|public guide|public sold|magery|grading market consensus/i;

const ESTIMATED_LOCALIZED_PRICE_SOURCE =
  /early market estimate|card-adjusted rarity estimate|localized market estimate|localized search group estimate|rarity estimate|english companion/i;
const PARTIAL_PREVIEW_MARKET_SOURCE =
  /static grail preview|bundled grail preview|premium preview composite|preview model|partial cached/i;

export function cardHasPartialPreviewMarketData(card: GradingMarketEnrichmentCard) {
  const hasLiveMarketSignal =
    card.recentSales?.some(
      (sale) =>
        (sale.listingUrl || sale.sourceUrl) &&
        !PARTIAL_PREVIEW_MARKET_SOURCE.test(`${sale.source} ${sale.listingUrl ?? ""} ${sale.sourceUrl ?? ""}`),
    ) ||
    card.priceConsensus?.sources?.some(
      (source) =>
        source.value > 0 &&
        (source.evidenceType === "sold_comp" ||
          source.evidenceType === "guide_snapshot" ||
          TRUSTED_LOCALIZED_PRICE_SOURCE.test(source.source)),
    ) ||
    card.gradedPrices?.some(
      (price) =>
        price.value > 0 &&
        price.source &&
        TRUSTED_LOCALIZED_PRICE_SOURCE.test(price.source),
    );

  if (hasLiveMarketSignal) {
    return false;
  }

  const sourceBlob = [
    card.psaPopulation?.source,
    card.psaPopulation?.note,
    ...(card.sources ?? []).flatMap((source) => [source.source, source.note]),
    ...(card.gradedPrices ?? []).map((price) => price.source),
    ...(card.recentSales ?? []).flatMap((sale) => [sale.source, sale.listingUrl, sale.sourceUrl]),
    card.priceConsensus?.methodology,
    ...(card.priceConsensus?.sources ?? []).flatMap((source) => [source.source, source.note]),
  ]
    .filter(Boolean)
    .join(" ");

  return PARTIAL_PREVIEW_MARKET_SOURCE.test(sourceBlob);
}

function localizedMarketPriceNeedsRefresh(card: GradingMarketEnrichmentCard) {
  if (!card.language || card.language === "en") {
    return false;
  }

  const ungraded = card.gradedPrices?.find((price) => price.grade === "Ungraded");
  const headline = Math.max(
    card.marketPriceUsd ?? 0,
    card.priceConsensus?.finalEstimateUsd ?? 0,
    ungraded?.value ?? 0,
  );

  if (!(headline > 0)) {
    return true;
  }

  const trustedSource =
    card.priceConsensus?.sources?.some((source) => {
      const score = source.confidenceScore ?? 0;

      return (
        (source.evidenceType === "sold_comp" && score >= 0.44) ||
        (source.evidenceType === "guide_snapshot" && score >= 0.5) ||
        TRUSTED_LOCALIZED_PRICE_SOURCE.test(source.source)
      );
    }) ||
    card.sources?.some((source) => TRUSTED_LOCALIZED_PRICE_SOURCE.test(source.source)) ||
    card.gradedPrices?.some(
      (price) =>
        price.grade === "Ungraded" &&
        price.value > 0 &&
        TRUSTED_LOCALIZED_PRICE_SOURCE.test(price.source ?? ""),
    );

  if (trustedSource) {
    return false;
  }

  const estimatedSource =
    card.sources?.some((source) => ESTIMATED_LOCALIZED_PRICE_SOURCE.test(source.source)) ||
    card.priceConsensus?.sources?.some((source) =>
      ESTIMATED_LOCALIZED_PRICE_SOURCE.test(source.source),
    ) ||
    card.gradedPrices?.some(
      (price) =>
        price.grade === "Ungraded" &&
        ESTIMATED_LOCALIZED_PRICE_SOURCE.test(price.source ?? ""),
    );

  return Boolean(estimatedSource || (card.priceConsensus?.confidenceScore ?? 0) < 0.7);
}

export function cardNeedsGradingMarketEnrichment(card: GradingMarketEnrichmentCard) {
  if (cardHasPartialPreviewMarketData(card)) {
    return true;
  }

  const populationReady =
    card.psaPopulation?.status === "verified" &&
    ((card.psaPopulation.grades?.length ?? 0) > 0 ||
      typeof card.psaPopulation.totalCertified === "number");
  const gradedReady = (card.gradedPrices?.length ?? 0) > 1;
  const salesReady = (card.recentSales?.length ?? 0) > 0;
  const consensusReady = (card.priceConsensus?.sourceCount ?? 0) > 1;

  return (
    localizedMarketPriceNeedsRefresh(card) ||
    !(populationReady && gradedReady && (salesReady || consensusReady))
  );
}
