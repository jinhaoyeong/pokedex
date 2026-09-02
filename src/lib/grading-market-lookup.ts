import { catalogMarketName } from "@/lib/card-catalog-facts";
import { getLocalizedSetMarketProfile } from "@/lib/localized-set-market";
import type { TcgCard } from "@/types/pokemon";
import { applyCanonicalJapaneseIdentityToCard } from "@/lib/japanese-market-identity";

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
  const rawEnglish = normalizeLookupText(card.setEnglishName?.trim() || "");
  const rawSetName = normalizeLookupText(card.setName?.trim() || "");
  const rawCandidate =
    SET_CODE_ONLY_PATTERN.test(rawEnglish) &&
    rawSetName &&
    !SET_CODE_ONLY_PATTERN.test(rawSetName)
      ? rawSetName
      : rawEnglish || rawSetName;
  const celebrationsName = celebrationsParentSetName(rawCandidate);
  const trainerGalleryName = trainerGalleryParentSetName(card.setCode, rawCandidate);

  if (profile?.englishName) {
    const rawIsMostlyNonLatin =
      Boolean(rawCandidate) &&
      !/[A-Za-z]{3,}/.test(rawCandidate) &&
      /[\u3040-\u30ff\u3400-\u9fff]/.test(rawCandidate);
    const rawMatchesAlias = [profile.englishName, ...(profile.aliases ?? [])].some(
      (alias) => {
        const normalizedAlias = normalizeLookupText(alias).toLowerCase();
        const normalizedRaw = rawCandidate.toLowerCase();
        if (!normalizedAlias) return false;
        // Exact match, or bilingual "日本語 (English)" / alias contained in the
        // display set name — common for JA catalog hydration.
        return (
          alias.trim().toLowerCase() === normalizedRaw ||
          normalizedAlias === normalizedRaw ||
          normalizedRaw.includes(normalizedAlias)
        );
      },
    );
    if (
      !rawCandidate ||
      rawCandidate.toUpperCase() === card.setCode?.trim().toUpperCase() ||
      SET_CODE_ONLY_PATTERN.test(rawCandidate) ||
      celebrationsName ||
      trainerGalleryName ||
      /classic collection/i.test(rawCandidate) ||
      rawIsMostlyNonLatin ||
      rawMatchesAlias
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

function stripDecorativeStarSuffix(name: string) {
  if (/\bgold\s+star\b/i.test(name)) {
    return name.trim();
  }

  return name
    .replace(/[\u2605\u2606★☆]/g, " ")
    .replace(/\s+star\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveGradingMarketLookupCardName(
  card: Pick<TcgCard, "name" | "englishName" | "language">,
): string {
  let resolved: string;

  if (card.language !== "en" && card.englishName?.trim()) {
    resolved = catalogMarketName(card);
  } else {
    const bilingualMatch = card.name.match(/\(([^)]+)\)\s*$/);
    resolved = bilingualMatch?.[1]?.trim()
      ? bilingualMatch[1].trim()
      : catalogMarketName(card) || card.name.trim();
  }

  const withoutStar = stripDecorativeStarSuffix(resolved);
  const withoutFinish = withoutStar
    .replace(/\s+1st\s+edition(?:\s+(?:rare\s+)?holo(?:foil)?)?$/i, "")
    .replace(/\s+unlimited(?:\s+(?:rare\s+)?holo(?:foil)?)?$/i, "")
    .trim();
  return withoutFinish || withoutStar || resolved;
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

  // Preview/static homepage records must always re-enrich, even after /api/price
  // attaches a trusted guide snapshot. Otherwise population stays on the fake
  // PSA 9/10-only model and sold comps never load.
  if (PARTIAL_PREVIEW_MARKET_SOURCE.test(sourceBlob)) {
    return true;
  }

  return false;
}

function shouldSanitizePreviewMarketData(card: GradingMarketEnrichmentCard) {
  return cardHasPartialPreviewMarketData(card) && !hasLivePopulation(card) && !hasLiveSoldComps(card);
}

export function sanitizePartialPreviewMarketCard(card: TcgCard): TcgCard {
  card = applyCanonicalJapaneseIdentityToCard(card);
  if (!shouldSanitizePreviewMarketData(card)) {
    return card;
  }

  const ungradedPrice = 0;

  return {
    ...card,
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Live grading market",
      fetchedAt: null,
      note: "Partial cached preview cleared; live grading data is loading for this card.",
      confidence: "low",
      confidenceScore: 0.3,
      warning: "Preview population rows were removed until live grading data finishes loading.",
    },
    gradedPrices: [
      {
        grade: "Ungraded",
        value: ungradedPrice,
        populationCount: 0,
        service: "RAW",
      },
    ],
    finishMarkets: card.finishMarkets?.map((market) => ({
      ...market,
      ungradedUsd: 0,
    })),
    priceHistory: [],
    recentSales: [],
    sources: (card.sources ?? []).filter(
      (source) => !PARTIAL_PREVIEW_MARKET_SOURCE.test(`${source.source} ${source.note ?? ""}`),
    ),
    evidenceSummary: undefined,
    sourceStatus: undefined,
    marketEvidence: undefined,
    priceConsensus: undefined,
  };
}

function hasLiveSoldComps(card: GradingMarketEnrichmentCard) {
  return Boolean(
    card.recentSales?.some(
      (sale) =>
        !PARTIAL_PREVIEW_MARKET_SOURCE.test(
          `${sale.source} ${sale.listingUrl ?? ""} ${sale.sourceUrl ?? ""}`,
        ),
    ),
  );
}

function hasLivePopulation(card: GradingMarketEnrichmentCard) {
  const population = card.psaPopulation;
  if (!population) {
    return false;
  }

  if (PARTIAL_PREVIEW_MARKET_SOURCE.test(`${population.source} ${population.note ?? ""}`)) {
    return false;
  }

  return (
    population.status === "verified" &&
    ((population.grades?.length ?? 0) > 0 || typeof population.totalCertified === "number")
  );
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

  const populationReady = hasLivePopulation(card);
  const gradedReady = (card.gradedPrices?.length ?? 0) > 1;
  const salesReady = hasLiveSoldComps(card);
  const consensusReady = (card.priceConsensus?.sourceCount ?? 0) > 1;

  return (
    localizedMarketPriceNeedsRefresh(card) ||
    !(populationReady && gradedReady && (salesReady || consensusReady))
  );
}

/**
 * `mode=core` is a 4.5s set-guide snapshot. That often lands as ungraded-only
 * or PSA 9/10 only, with no census and no sold comps. First paint should still
 * show those rows, then `mode=full` has to run for the rest of the sheet.
 */
export function shouldFetchFullMarketAfterCore(card: GradingMarketEnrichmentCard) {
  if (cardNeedsGradingMarketEnrichment(card)) {
    return true;
  }

  const slabCount =
    card.gradedPrices?.filter((price) => price.grade !== "Ungraded" && (price.value ?? 0) > 0)
      .length ?? 0;

  return slabCount < 4 || !hasLiveSoldComps(card) || !hasLivePopulation(card);
}
