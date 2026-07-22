import type {
  JapaneseMarketIdentity,
  JapaneseMarketIdentitySource,
  JapaneseMarketIdentityStatus,
  TcgCard,
} from "@/types/pokemon";

export const JAPANESE_MARKET_IDENTITY_VERSION = 1;
export const JAPANESE_MARKET_CACHE_VERSION = 1;

export type BuildJapaneseMarketIdentityInput = Omit<
  JapaneseMarketIdentity,
  "identityConfidence" | "identitySource" | "identityStatus" | "identityVersion"
> & {
  identityConfidence?: number;
  identitySource?: JapaneseMarketIdentitySource[];
  identityStatus?: JapaneseMarketIdentityStatus;
  identityVersion?: number;
};

function cleanNullable(value: string | null | undefined) {
  const clean = value?.trim().replace(/\s+/g, " ") ?? "";
  return clean || null;
}

export function normalizeJapaneseOfficialCardId(value: string) {
  return value
    .trim()
    .replace(/^ja--official-/i, "")
    .replace(/^official-/i, "");
}

/** Normalize only a real printed number; an empty browse record remains null. */
export function normalizeJapanesePrintedCollectorNumber(value?: string | null) {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  const numerator = normalized.split("/")[0]?.trim() ?? "";

  if (!numerator) {
    return null;
  }

  // Preserve the official printed width (`071`, not `71`) for display and
  // provenance. Provider matchers can compare numbers width-insensitively.
  return numerator || null;
}

export function japanesePrintedCollectorNumbersEqual(
  left?: string | null,
  right?: string | null,
) {
  const leftComparable = normalizeJapaneseCollectorForComparison(left);
  const rightComparable = normalizeJapaneseCollectorForComparison(right);
  return Boolean(leftComparable && rightComparable && leftComparable === rightComparable);
}

export function normalizeJapaneseCollectorForComparison(value?: string | null) {
  return (
    normalizeJapanesePrintedCollectorNumber(value)
      ?.toLowerCase()
      .replace(/^0+(?=\d)/, "") ?? null
  );
}

export function uniqueJapaneseIdentitySources(
  sources: Array<JapaneseMarketIdentitySource | null | undefined>,
) {
  return [...new Set(sources.filter((source): source is JapaneseMarketIdentitySource => Boolean(source)))];
}

export function buildJapaneseMarketIdentity(
  input: BuildJapaneseMarketIdentityInput,
): JapaneseMarketIdentity {
  const printedCollectorNumber = normalizeJapanesePrintedCollectorNumber(
    input.printedCollectorNumber,
  );
  const identitySource = uniqueJapaneseIdentitySources(input.identitySource ?? []);
  const identityStatus =
    input.identityStatus ??
    (printedCollectorNumber && identitySource.includes("official-detail")
      ? "confirmed"
      : input.officialCardId || input.japaneseName
        ? "partial"
        : "identity_incomplete");
  const inferredConfidence =
    (printedCollectorNumber ? 0.5 : 0) +
    (cleanNullable(input.englishMarketName) ? 0.15 : 0) +
    (cleanNullable(input.japaneseSetCode) ? 0.1 : 0) +
    (cleanNullable(input.priceChartingSetSlug) ? 0.1 : 0) +
    (cleanNullable(input.priceChartingProductId) ? 0.15 : 0);

  return {
    officialCardId: normalizeJapaneseOfficialCardId(input.officialCardId),
    browseIndex:
      typeof input.browseIndex === "number" && Number.isInteger(input.browseIndex) && input.browseIndex > 0
        ? input.browseIndex
        : null,
    japaneseName: input.japaneseName.trim(),
    englishMarketName: cleanNullable(input.englishMarketName),
    printedCollectorNumber,
    collectorNumberTotal:
      typeof input.collectorNumberTotal === "number" && input.collectorNumberTotal > 0
        ? Math.trunc(input.collectorNumberTotal)
        : null,
    japaneseSetCode: cleanNullable(input.japaneseSetCode)?.toUpperCase() ?? null,
    japaneseSetName: cleanNullable(input.japaneseSetName),
    englishSetName: cleanNullable(input.englishSetName),
    priceChartingSetSlug: cleanNullable(input.priceChartingSetSlug),
    priceChartingProductId: cleanNullable(input.priceChartingProductId),
    priceChartingProductUrl: cleanNullable(input.priceChartingProductUrl),
    identityConfidence: Math.max(
      0,
      Math.min(1, input.identityConfidence ?? inferredConfidence),
    ),
    identitySource,
    identityStatus,
    verifiedAt: cleanNullable(input.verifiedAt),
    identityVersion: Math.max(
      1,
      Math.trunc(input.identityVersion ?? JAPANESE_MARKET_IDENTITY_VERSION),
    ),
  };
}

export function isConfirmedJapaneseMarketIdentity(
  identity: JapaneseMarketIdentity,
) {
  return Boolean(
    identity.identityStatus === "confirmed" &&
      identity.printedCollectorNumber &&
      identity.identitySource.includes("official-detail") &&
      identity.verifiedAt,
  );
}

function officialJapaneseIdFromCard(card: Pick<TcgCard, "id" | "slug" | "officialCardId">) {
  const explicit = card.officialCardId?.trim();
  if (explicit) {
    return normalizeJapaneseOfficialCardId(explicit);
  }

  return (
    card.id.match(/^official-(\d+)$/i)?.[1] ??
    card.slug.match(/^ja--official-(\d+)$/i)?.[1] ??
    null
  );
}

function clearUnattributedJapaneseMarketData(card: TcgCard): TcgCard {
  return {
    ...card,
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Canonical Japanese identity",
      fetchedAt: null,
      note: "Legacy market data was cleared because it was not tied to a confirmed printed collector number.",
      confidence: "low",
      confidenceScore: 0,
      warning: "Waiting for official-detail identity hydration before market lookup.",
    },
    gradingPopulation: undefined,
    populationBreakdown: undefined,
    priceHistory: [],
    marketHistory: {
      status: "unavailable",
      historyUnavailable: true,
      realSaleCount: 0,
      note: "Market history is unavailable until Japanese identity is confirmed.",
    },
    marketHistoryStatus: "unavailable",
    historyUnavailable: true,
    gradedPrices: [],
    recentSales: [],
    evidenceSummary: undefined,
    sourceStatus: undefined,
    marketEvidence: undefined,
    priceConsensus: undefined,
  };
}

/**
 * Apply a resolver-produced identity to a card and quarantine legacy Japanese
 * rows that stored a browse position in `collectorNumber`. A numeric official
 * catalog card is allowed to expose market data only when its printed number
 * carries official-detail provenance.
 */
export function applyCanonicalJapaneseIdentityToCard(
  card: TcgCard,
  resolvedIdentity?: JapaneseMarketIdentity | null,
): TcgCard {
  if (card.language !== "ja") {
    return card;
  }

  const officialCardId = officialJapaneseIdFromCard(card);
  if (!officialCardId) {
    return card;
  }

  const identity = resolvedIdentity ?? card.marketIdentity;
  const identityMatchesCard =
    identity && normalizeJapaneseOfficialCardId(identity.officialCardId) === officialCardId;
  const confirmedIdentity =
    identityMatchesCard && identity && isConfirmedJapaneseMarketIdentity(identity)
      ? identity
      : null;

  if (!confirmedIdentity?.printedCollectorNumber) {
    return clearUnattributedJapaneseMarketData({
      ...card,
      officialCardId,
      collectorNumber: "",
      marketIdentity: identityMatchesCard ? identity ?? undefined : undefined,
    });
  }

  const previousNumber = normalizeJapanesePrintedCollectorNumber(card.collectorNumber);
  const canonicalNumber = confirmedIdentity.printedCollectorNumber;
  const identityCorrected = Boolean(
    previousNumber && !japanesePrintedCollectorNumbersEqual(previousNumber, canonicalNumber),
  );
  const canonicalCard: TcgCard = {
    ...card,
    officialCardId,
    browseIndex: confirmedIdentity.browseIndex ?? card.browseIndex,
    marketIdentity: confirmedIdentity,
    collectorNumber: canonicalNumber,
    englishName: confirmedIdentity.englishMarketName ?? card.englishName,
    setCode: confirmedIdentity.japaneseSetCode ?? card.setCode,
    setLocalizedName: confirmedIdentity.japaneseSetName ?? card.setLocalizedName,
    setEnglishName: confirmedIdentity.englishSetName ?? card.setEnglishName,
    setPrintedTotal: confirmedIdentity.collectorNumberTotal ?? card.setPrintedTotal,
  };

  return identityCorrected ? clearUnattributedJapaneseMarketData(canonicalCard) : canonicalCard;
}

export function japaneseMarketIdentityMaterialKey(
  identity: Pick<
    JapaneseMarketIdentity,
    | "officialCardId"
    | "japaneseName"
    | "englishMarketName"
    | "printedCollectorNumber"
    | "collectorNumberTotal"
    | "japaneseSetCode"
    | "japaneseSetName"
    | "englishSetName"
    | "priceChartingSetSlug"
    | "priceChartingProductId"
    | "priceChartingProductUrl"
  >,
) {
  return JSON.stringify([
    normalizeJapaneseOfficialCardId(identity.officialCardId),
    identity.japaneseName.trim(),
    cleanNullable(identity.englishMarketName),
    normalizeJapaneseCollectorForComparison(identity.printedCollectorNumber),
    identity.collectorNumberTotal ?? null,
    cleanNullable(identity.japaneseSetCode)?.toUpperCase() ?? null,
    cleanNullable(identity.japaneseSetName),
    cleanNullable(identity.englishSetName),
    cleanNullable(identity.priceChartingSetSlug),
    cleanNullable(identity.priceChartingProductId),
    cleanNullable(identity.priceChartingProductUrl),
  ]);
}

export function nextJapaneseMarketIdentityVersion(
  previous: JapaneseMarketIdentity | null,
  next: JapaneseMarketIdentity,
) {
  if (!previous) {
    return JAPANESE_MARKET_IDENTITY_VERSION;
  }

  return japaneseMarketIdentityMaterialKey(previous) === japaneseMarketIdentityMaterialKey(next)
    ? Math.max(1, previous.identityVersion)
    : Math.max(1, previous.identityVersion) + 1;
}

/**
 * Versioned downstream cache identity. Any correction to the official print or
 * exact PriceCharting product naturally moves price/grading/population reads to
 * a new key instead of reusing a response produced for the old identity.
 */
export function buildJapaneseMarketCacheKey(
  identity: Pick<
    JapaneseMarketIdentity,
    | "officialCardId"
    | "printedCollectorNumber"
    | "japaneseSetCode"
    | "priceChartingProductId"
    | "identityVersion"
  >,
  scope = "market",
) {
  const normalize = (value?: string | null) =>
    value?.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "none";

  return [
    `ja-${scope}-v${JAPANESE_MARKET_CACHE_VERSION}`,
    normalizeJapaneseOfficialCardId(identity.officialCardId) || "unknown",
    normalizeJapaneseCollectorForComparison(identity.printedCollectorNumber) || "unresolved",
    normalize(identity.japaneseSetCode),
    normalize(identity.priceChartingProductId),
    `i${Math.max(1, Math.trunc(identity.identityVersion || 1))}`,
  ].join(":");
}
