import "server-only";

import type {
  ActiveListing,
  CardFinishId,
  CardLanguageCode,
  GradedPrice,
  MarketEvidence,
  PricePoint,
  TcgCard,
} from "@/types/pokemon";

import { lookupEbayActiveListings } from "@/lib/market/ebay-active-listings.server";
import { recordEstimateDiagnostics } from "@/lib/market/estimate-diagnostics.server";
import { estimatedGradeValuesEnabled } from "@/lib/market/estimated-grade-values";
import { firstPartyMarketOnly } from "@/lib/market/first-party-market";
import { mergeGradeRowsByPrecedence } from "@/lib/market/grade-row-merge";
import {
  extractTrustedCatalogRawPrices,
  type SlabEstimateIdentity,
} from "@/lib/market/slab-estimate-v1";
import { lookupFirstPartySlabCalibration } from "@/lib/market/slab-calibration.server";
import {
  estimatePsaGradesV2,
  type SlabEstimateV2Input,
} from "@/lib/market/slab-estimate-v2";
import type { SlabEstimateResult } from "@/lib/market/slab-estimate-v1";
import { getSetFromDatabase } from "@/lib/pokemon-sets-db.server";

export type SlabEstimateCardContext = {
  slug?: string;
  name: string;
  englishName?: string | null;
  setName?: string | null;
  setEnglishName?: string | null;
  setCode?: string | null;
  collectorNumber: string;
  language: string;
  finish?: CardFinishId | string | null;
  rarity?: string | null;
  setReleaseDate?: string | null;
  officialCardId?: string | null;
  printedCollectorNumber?: string | null;
  identityStatus?: SlabEstimateIdentity["identityStatus"];
  identitySources?: string[] | null;
  conflictingCatalogIdentities?: boolean;
  trustedRawPricesUsd: number[];
};

export type SlabEstimateMarketSlice = {
  gradedPrices: GradedPrice[];
  priceHistory?: PricePoint[];
  marketEvidence?: MarketEvidence[];
  activeListings?: ActiveListing[];
  sourceStatus?: Array<{ source: string; note?: string }>;
};

function buildIdentity(ctx: SlabEstimateCardContext): SlabEstimateIdentity {
  return {
    name: ctx.englishName?.trim() || ctx.name,
    setCode: ctx.setCode,
    setName: ctx.setEnglishName || ctx.setName,
    collectorNumber: ctx.collectorNumber,
    language: ctx.language,
    finish: ctx.finish,
    officialCardId: ctx.officialCardId,
    printedCollectorNumber: ctx.printedCollectorNumber,
    identityStatus: ctx.identityStatus,
    identitySources: ctx.identitySources,
    conflictingCatalogIdentities: ctx.conflictingCatalogIdentities,
  };
}

function estimateRows(result: SlabEstimateResult): GradedPrice[] {
  if (result.outcome === "blocked") {
    return [];
  }
  return result.grades.map((grade) => ({
    grade: grade.grade,
    value: grade.midpointUsd,
    populationCount: 0,
    source: "PSA grade estimate",
    confidence: grade.confidence,
    confidenceScore: grade.confidence === "medium" ? 0.48 : 0.28,
    service: "PSA" as const,
    evidenceType: "estimate" as const,
    warning: grade.reasonCodes.includes("asks_disagree")
      ? "Active asking prices disagree with the model."
      : grade.reasonCodes.includes("model_only_no_valid_asks")
        ? "No valid active listings remained after hygiene."
        : "Display-only estimate. Not a sold comp or book value.",
    estimate: {
      lowUsd: grade.lowUsd,
      midpointUsd: grade.midpointUsd,
      highUsd: grade.highUsd,
      modelVersion: grade.modelVersion,
      confidence: grade.confidence,
      reasonCodes: grade.reasonCodes,
      explanation: grade.explanation,
    },
  }));
}

function projectedHistory(existing: PricePoint[] | undefined, estimates: GradedPrice[]): PricePoint[] {
  const history = [...(existing ?? [])];
  if (!estimates.length) {
    return history;
  }
  const today = new Date().toISOString().slice(0, 10);
  const gradeValues: Record<string, number> = {};
  for (const price of estimates) {
    gradeValues[price.grade] = price.value;
  }
  const existingToday = history.find((point) => point.date.slice(0, 10) === today);
  if (existingToday) {
    existingToday.gradeValues = { ...(existingToday.gradeValues ?? {}), ...gradeValues };
    existingToday.isProjected = existingToday.isProjected ?? true;
    existingToday.pointType = existingToday.pointType ?? "projected";
    return history;
  }
  history.push({
    date: today,
    value: 0,
    gradeValues,
    isProjected: true,
    pointType: "projected",
  });
  return history;
}

async function resolveReleaseDate(ctx: SlabEstimateCardContext) {
  if (ctx.setReleaseDate?.trim()) {
    return ctx.setReleaseDate.trim();
  }
  const setId = ctx.setCode?.trim();
  if (!setId) {
    return null;
  }
  try {
    const language = (ctx.language || "en") as CardLanguageCode;
    const set = await Promise.race([
      getSetFromDatabase(setId, language),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 200);
      }),
    ]);
    return set?.releaseDate?.trim() || null;
  } catch {
    return null;
  }
}

async function persistDiagnostics(
  ctx: SlabEstimateCardContext,
  result: SlabEstimateResult,
) {
  const slug = ctx.slug?.trim() || `${ctx.setCode ?? ""}-${ctx.collectorNumber}`;
  if (result.outcome === "blocked") {
    await recordEstimateDiagnostics(
      result.reasonCodes
        .filter((code) => code === "identity_incomplete" || code === "identity_conflict")
        .map((reasonCode) => ({
          cardSlug: slug,
          grade: "PSA 9/10",
          reasonCode,
          outcome: "blocked" as const,
          evidence: {
            identity: buildIdentity(ctx),
            explanation: result.explanation,
          },
        })),
    );
    return;
  }
  if (result.outcome === "widened") {
    await recordEstimateDiagnostics(
      result.grades.map((grade) => ({
        cardSlug: slug,
        grade: grade.grade,
        reasonCode: "asks_disagree",
        outcome: "widened" as const,
        evidence: {
          estimate: grade,
          explanation: grade.explanation,
        },
      })),
    );
  }
}

export function contextFromTcgCard(card: TcgCard): SlabEstimateCardContext {
  const printed = card.marketIdentity?.printedCollectorNumber;
  const collector = card.collectorNumber;
  const conflicting =
    Boolean(printed && collector && printed.replace(/^0+(?=\d)/, "") !== collector.split("/")[0]?.replace(/^0+(?=\d)/, "")) &&
    card.language === "ja";

  return {
    slug: card.slug,
    name: card.name,
    englishName: card.englishName,
    setName: card.setName,
    setEnglishName: card.setEnglishName,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    language: card.language,
    finish: card.finish,
    rarity: card.rarity,
    setReleaseDate: card.setReleaseDate,
    officialCardId: card.officialCardId ?? card.marketIdentity?.officialCardId,
    printedCollectorNumber: printed,
    identityStatus: card.marketIdentity?.identityStatus,
    identitySources: card.marketIdentity?.identitySource,
    conflictingCatalogIdentities: conflicting,
    trustedRawPricesUsd: extractTrustedCatalogRawPrices(card),
  };
}

export async function applySlabEstimatesToMarketSlice<T extends SlabEstimateMarketSlice>(
  slice: T,
  ctx: SlabEstimateCardContext,
  options: { signal?: AbortSignal; includeActiveListings?: boolean } = {},
): Promise<T> {
  if (!estimatedGradeValuesEnabled()) {
    return slice;
  }

  const releaseDate = await resolveReleaseDate(ctx);
  const calibration = await lookupFirstPartySlabCalibration({
    cardSlug: ctx.slug,
    releaseDate,
    rarity: ctx.rarity,
    language: ctx.language,
  }).catch(() => ({}));
  const mayUseExternalAsks = options.includeActiveListings === true && !firstPartyMarketOnly();
  const ebay =
    mayUseExternalAsks
      ? await lookupEbayActiveListings(
          {
            name: ctx.name,
            englishName: ctx.englishName ?? undefined,
            setName: ctx.setName ?? undefined,
            setEnglishName: ctx.setEnglishName ?? undefined,
            collectorNumber: ctx.collectorNumber,
            language: ctx.language,
            finish: ctx.finish,
            rarity: ctx.rarity,
          },
          options.signal ?? AbortSignal.timeout(2_500),
        ).catch(() => ({
          listings: [] as ActiveListing[],
          discardedCount: 0,
          asksByGrade: {
            Ungraded: [] as number[],
            "PSA 9": [] as number[],
            "PSA 10": [] as number[],
          },
        }))
      : {
          listings: [] as ActiveListing[],
          discardedCount: 0,
          asksByGrade: {
            Ungraded: [] as number[],
            "PSA 9": [] as number[],
            "PSA 10": [] as number[],
          },
        };

  const estimateInput: SlabEstimateV2Input = {
    identity: buildIdentity(ctx),
    releaseDate,
    rarity: ctx.rarity,
    finish: ctx.finish,
    language: ctx.language,
    trustedRawPricesUsd: ctx.trustedRawPricesUsd,
    cleanedAsksByGrade: {
      "PSA 9": ebay.asksByGrade["PSA 9"],
      "PSA 10": ebay.asksByGrade["PSA 10"],
    },
    discardedJunkCount: ebay.discardedCount,
    calibration,
  };
  const result = estimatePsaGradesV2(estimateInput);

  setImmediate(() => {
    void persistDiagnostics(ctx, result);
  });

  const estimated = estimateRows(result);
  const gradedPrices = mergeGradeRowsByPrecedence(slice.gradedPrices ?? [], estimated);
  const marketEvidence: MarketEvidence[] = [
    ...(slice.marketEvidence ?? []).filter((item) => item.evidenceType !== "estimate"),
    ...estimated.map((price) => ({
      id: `estimate-${price.grade}`,
      source: "PSA grade estimate",
      evidenceType: "estimate" as const,
      grade: price.grade,
      priceUsd: price.value,
      confidence: price.confidence ?? "low",
      confidenceScore: price.confidenceScore ?? 0.28,
      note: price.estimate?.explanation ?? "Display-only PSA estimate.",
      warning: price.warning,
    })),
  ];

  return {
    ...slice,
    gradedPrices,
    priceHistory: projectedHistory(slice.priceHistory, estimated),
    marketEvidence,
    activeListings: mayUseExternalAsks ? ebay.listings : slice.activeListings,
  };
}

export async function applySlabEstimatesToCard(card: TcgCard, signal?: AbortSignal): Promise<TcgCard> {
  const slice = await applySlabEstimatesToMarketSlice(
    {
      gradedPrices: card.gradedPrices,
      priceHistory: card.priceHistory,
      marketEvidence: card.marketEvidence,
      activeListings: card.activeListings,
    },
    contextFromTcgCard(card),
    { signal, includeActiveListings: false },
  );
  return {
    ...card,
    gradedPrices: slice.gradedPrices,
    priceHistory: slice.priceHistory ?? card.priceHistory,
    marketEvidence: slice.marketEvidence,
    activeListings: slice.activeListings,
  };
}
