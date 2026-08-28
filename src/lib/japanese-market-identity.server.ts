import "server-only";

import {
  classifyLocalizedPriceChartingSetSlug,
  getLocalizedSetMarketProfile,
  type LocalizedSetMarketProfile,
} from "@/lib/localized-set-market";
import {
  buildJapaneseMarketIdentity,
  isConfirmedJapaneseMarketIdentity,
  japanesePrintedCollectorNumbersEqual,
  japaneseMarketIdentityMaterialKey,
  nextJapaneseMarketIdentityVersion,
  normalizeJapaneseOfficialCardId,
  normalizeJapanesePrintedCollectorNumber,
  uniqueJapaneseIdentitySources,
} from "@/lib/japanese-market-identity";
import type {
  PokemonCardJpDetail,
  PokemonCardJpSearchItem,
} from "@/lib/pokemon-tcg/api-types";
import {
  fetchOfficialJapaneseCardDetail,
  resolveOfficialJapaneseEnglishName,
} from "@/lib/pokemon-tcg/official-japanese-catalog";
import {
  readCardIdentityMapping,
  writeCardIdentityMapping,
  type CardIdentityMapping,
} from "@/lib/price/identity-cache.server";
import type {
  JapaneseMarketIdentity,
  JapaneseMarketIdentitySource,
} from "@/types/pokemon";

export type ResolveJapaneseMarketIdentityInput = {
  officialCardId: string;
  browseIndex?: number | null;
  browseItem?: PokemonCardJpSearchItem;
  japaneseName?: string | null;
  englishMarketName?: string | null;
  /** A caller hint only. It is never considered confirmed without official detail evidence. */
  printedCollectorNumber?: string | null;
  collectorNumberTotal?: number | null;
  japaneseSetCode?: string | null;
  japaneseSetName?: string | null;
  englishSetName?: string | null;
  priceChartingSetSlug?: string | null;
  priceChartingProductId?: string | null;
  priceChartingProductUrl?: string | null;
  identitySource?: JapaneseMarketIdentitySource[];
};

export type PriceChartingIdentityResolution = {
  setSlug?: string | null;
  productId?: string | null;
  productUrl?: string | null;
  englishMarketName?: string | null;
  confidence?: number;
};

export type JapaneseMarketIdentityResolverDependencies = {
  readIdentityMapping: (officialCardId: string) => Promise<CardIdentityMapping | null>;
  writeIdentityMapping: (mapping: CardIdentityMapping) => Promise<boolean>;
  fetchOfficialDetail: (
    officialCardId: string,
    fallback?: PokemonCardJpSearchItem,
  ) => Promise<PokemonCardJpDetail | null>;
  resolveEnglishName: (detail: PokemonCardJpDetail) => Promise<string | undefined>;
  getSetProfile: (setCode: string) => LocalizedSetMarketProfile | undefined;
  resolvePriceChartingIdentity: (
    identity: JapaneseMarketIdentity,
    detail: PokemonCardJpDetail | null,
  ) => Promise<PriceChartingIdentityResolution | null>;
  now: () => Date;
};

export type ResolveJapaneseMarketIdentityOptions = {
  /** Re-fetch official detail even when a confirmed persistent mapping exists. */
  forceRefresh?: boolean;
  /** Disable official detail I/O while still returning a partial/cache-backed identity. */
  hydrateOfficialDetail?: boolean;
  /** Disable best-effort persistence, primarily for deterministic tests. */
  persist?: boolean;
  /** Set only after the PriceCharting provider has identity-validated this exact product. */
  validatedPriceChartingIdentity?: boolean;
  dependencies?: Partial<JapaneseMarketIdentityResolverDependencies>;
};

function cachedPriceChartingIdentityIsTrusted(identity: JapaneseMarketIdentity) {
  if (
    !identity.identitySource.includes("pricecharting-discovery") ||
    !/^\d+$/.test(identity.priceChartingProductId ?? "")
  ) {
    return false;
  }
  if (!identity.priceChartingProductUrl) {
    return true;
  }

  try {
    const url = new URL(identity.priceChartingProductUrl);
    const path = url.pathname.match(/^\/game\/([^/]+)\/([^/]+)\/?$/i);
    if (!/(^|\.)pricecharting\.com$/i.test(url.hostname) || !path) {
      return false;
    }
    const expectedNumber = normalizeJapanesePrintedCollectorNumber(
      identity.printedCollectorNumber,
    );
    const productNumber = normalizeJapanesePrintedCollectorNumber(
      path[2].match(/-(\d+[a-z]?)$/i)?.[1] ?? null,
    );
    const setMatches =
      !identity.priceChartingSetSlug ||
      path[1].toLowerCase() === identity.priceChartingSetSlug.toLowerCase();
    const hasNativeJapaneseSetAttribution =
      classifyLocalizedPriceChartingSetSlug(
        identity.japaneseSetCode ?? undefined,
        path[1],
      ) === "native";
    return Boolean(
      expectedNumber &&
        japanesePrintedCollectorNumbersEqual(productNumber, expectedNumber) &&
        setMatches &&
        hasNativeJapaneseSetAttribution,
    );
  } catch {
    return false;
  }
}

const defaultDependencies: JapaneseMarketIdentityResolverDependencies = {
  readIdentityMapping: (officialCardId) => readCardIdentityMapping(officialCardId),
  writeIdentityMapping: (mapping) => writeCardIdentityMapping(mapping),
  fetchOfficialDetail: (officialCardId, fallback) =>
    fetchOfficialJapaneseCardDetail(officialCardId, fallback),
  resolveEnglishName: (detail) => resolveOfficialJapaneseEnglishName(detail),
  getSetProfile: (setCode) => getLocalizedSetMarketProfile(setCode),
  resolvePriceChartingIdentity: async (identity) => {
    if (
      identity.identityStatus !== "confirmed" ||
      !identity.printedCollectorNumber
    ) {
      return null;
    }

    if (cachedPriceChartingIdentityIsTrusted(identity)) {
      return {
        setSlug: identity.priceChartingSetSlug,
        productId: identity.priceChartingProductId,
        productUrl: identity.priceChartingProductUrl,
        englishMarketName: identity.englishMarketName,
        confidence: identity.identityConfidence,
      };
    }

    const { lookupPriceChartingSetGuidePrice } = await import(
      "@/lib/market/pricecharting-set-guide.server"
    );
    const exact = await lookupPriceChartingSetGuidePrice({
      englishName: identity.englishMarketName ?? undefined,
      language: "ja",
      setCode: identity.japaneseSetCode ?? undefined,
      setName: identity.japaneseSetName ?? undefined,
      setEnglishName: identity.englishSetName ?? undefined,
      collectorNumber: identity.printedCollectorNumber,
      setSlug: identity.priceChartingSetSlug ?? undefined,
    }).catch(() => null);

    if (!exact?.productUrl) {
      return null;
    }

    return {
      setSlug: exact.setSlug ?? identity.priceChartingSetSlug,
      productId: exact.productId,
      productUrl: exact.productUrl,
      englishMarketName: exact.productName ?? identity.englishMarketName,
      confidence: exact.matchConfidence,
    };
  },
  now: () => new Date(),
};

function identityFromMapping(
  mapping: CardIdentityMapping,
  input: ResolveJapaneseMarketIdentityInput,
): JapaneseMarketIdentity {
  return buildJapaneseMarketIdentity({
    officialCardId: mapping.officialCardId,
    browseIndex: mapping.browseIndex ?? input.browseIndex ?? null,
    japaneseName: mapping.japaneseName ?? input.japaneseName ?? "",
    englishMarketName:
      mapping.englishMarketName ?? mapping.englishName ?? input.englishMarketName ?? null,
    printedCollectorNumber: mapping.printedCollectorNumber,
    collectorNumberTotal: mapping.collectorNumberTotal ?? input.collectorNumberTotal ?? null,
    japaneseSetCode: mapping.setCode ?? input.japaneseSetCode ?? null,
    japaneseSetName: mapping.japaneseSetName ?? input.japaneseSetName ?? null,
    englishSetName: mapping.englishSetName ?? input.englishSetName ?? null,
    priceChartingSetSlug:
      mapping.priceChartingSetSlug ??
      mapping.priceChartingSlug ??
      null,
    // Exact provider identity may only come from persisted, provider-validated
    // mapping fields. Never backfill a cache record with request query hints:
    // the mapping's PriceCharting provenance would otherwise make those hints
    // appear trusted on the next validation step.
    priceChartingProductId: mapping.priceChartingProductId ?? null,
    priceChartingProductUrl: mapping.priceChartingProductUrl ?? null,
    identityConfidence: mapping.identityConfidence ?? 0,
    identitySource: uniqueJapaneseIdentitySources([
      ...(mapping.identitySource ?? []),
      mapping.identityStatus === "confirmed" ? "cached-confirmed-identity" : null,
    ]),
    identityStatus: mapping.identityStatus ?? "partial",
    verifiedAt: mapping.verifiedAt ?? null,
    identityVersion: mapping.identityVersion ?? 1,
  });
}

function mappingFromIdentity(identity: JapaneseMarketIdentity): CardIdentityMapping {
  return {
    officialCardId: identity.officialCardId,
    browseIndex: identity.browseIndex,
    japaneseName: identity.japaneseName,
    printedCollectorNumber: identity.printedCollectorNumber,
    collectorNumberTotal: identity.collectorNumberTotal,
    setCode: identity.japaneseSetCode,
    japaneseSetName: identity.japaneseSetName,
    englishName: identity.englishMarketName,
    englishMarketName: identity.englishMarketName,
    englishSetName: identity.englishSetName,
    priceChartingSlug: identity.priceChartingSetSlug,
    priceChartingSetSlug: identity.priceChartingSetSlug,
    priceChartingProductId: identity.priceChartingProductId,
    priceChartingProductUrl: identity.priceChartingProductUrl,
    identityConfidence: identity.identityConfidence,
    identitySource: identity.identitySource,
    identityStatus: identity.identityStatus,
    verifiedAt: identity.verifiedAt,
    identityVersion: identity.identityVersion,
  };
}

/**
 * Resolve the single authoritative Japanese catalog/market identity. Browse
 * metadata is useful for presentation and lookup, but only an official detail
 * record (or a previously persisted record carrying that provenance) can
 * confirm `printedCollectorNumber`.
 */
export async function resolveJapaneseMarketIdentity(
  input: ResolveJapaneseMarketIdentityInput,
  options: ResolveJapaneseMarketIdentityOptions = {},
): Promise<JapaneseMarketIdentity> {
  const officialCardId = normalizeJapaneseOfficialCardId(input.officialCardId);

  if (!officialCardId) {
    throw new TypeError("officialCardId is required to resolve Japanese market identity");
  }

  const dependencies: JapaneseMarketIdentityResolverDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const now = dependencies.now();
  const cachedMapping = await dependencies
    .readIdentityMapping(officialCardId)
    .catch(() => null);
  const cachedIdentity = cachedMapping ? identityFromMapping(cachedMapping, input) : null;
  const cachedIsConfirmed = Boolean(
    cachedIdentity && isConfirmedJapaneseMarketIdentity(cachedIdentity),
  );
  const shouldHydrate =
    options.hydrateOfficialDetail !== false &&
    (options.forceRefresh === true || !cachedIsConfirmed);
  const detail = shouldHydrate
    ? await dependencies
        .fetchOfficialDetail(officialCardId, input.browseItem)
        .catch(() => null)
    : null;
  const detailPrintedNumber =
    detail?.collectorNumberSource === "official-detail"
      ? normalizeJapanesePrintedCollectorNumber(detail.collectorNumber)
      : null;
  const hasFreshOfficialDetail = Boolean(detail && detailPrintedNumber);
  const officialMaterialChanged = Boolean(
    hasFreshOfficialDetail &&
      cachedIdentity &&
      (detailPrintedNumber !== cachedIdentity.printedCollectorNumber ||
        (detail?.setCode?.trim() &&
          detail.setCode.trim().toUpperCase() !== cachedIdentity.japaneseSetCode?.toUpperCase())),
  );
  const printedCollectorNumber =
    detailPrintedNumber ??
    (cachedIsConfirmed ? cachedIdentity?.printedCollectorNumber ?? null : null);
  const setCode =
    detail?.setCode?.trim() ||
    cachedIdentity?.japaneseSetCode ||
    input.japaneseSetCode?.trim() ||
    null;
  const profile = setCode ? dependencies.getSetProfile(setCode) : undefined;
  let resolvedEnglishName: string | undefined;

  if (detail) {
    resolvedEnglishName = await dependencies.resolveEnglishName(detail).catch(() => undefined);
  }

  const sources = uniqueJapaneseIdentitySources([
    ...(input.identitySource ?? []),
    ...(cachedIdentity?.identitySource ?? []),
    input.browseIndex || input.browseItem ? "official-browse" : null,
    hasFreshOfficialDetail ? "official-detail" : null,
    profile ? "manual-set-map" : null,
    resolvedEnglishName ? "name-database" : null,
  ]);
  const verifiedAt = hasFreshOfficialDetail
    ? now.toISOString()
    : cachedIsConfirmed
      ? cachedIdentity?.verifiedAt ?? null
      : null;
  const isConfirmed = Boolean(
    printedCollectorNumber && sources.includes("official-detail") && verifiedAt,
  );
  const validatedIncomingProduct = options.validatedPriceChartingIdentity === true;
  const canReuseCachedProduct = Boolean(
    cachedIdentity &&
      !officialMaterialChanged &&
      cachedPriceChartingIdentityIsTrusted(cachedIdentity),
  );
  let identity = buildJapaneseMarketIdentity({
    officialCardId,
    browseIndex:
      detail?.browseIndex ?? cachedIdentity?.browseIndex ?? input.browseIndex ?? null,
    japaneseName:
      detail?.name?.trim() ||
      cachedIdentity?.japaneseName ||
      input.japaneseName?.trim() ||
      input.browseItem?.cardNameAltText?.trim() ||
      input.browseItem?.cardNameViewText?.trim() ||
      "",
    englishMarketName:
      resolvedEnglishName ??
      cachedIdentity?.englishMarketName ??
      input.englishMarketName ??
      null,
    printedCollectorNumber,
    collectorNumberTotal:
      detail?.printedTotal ??
      cachedIdentity?.collectorNumberTotal ??
      input.collectorNumberTotal ??
      null,
    japaneseSetCode: setCode,
    japaneseSetName:
      cachedIdentity?.japaneseSetName ?? input.japaneseSetName ?? detail?.setCode ?? setCode,
    englishSetName:
      profile?.englishName ?? cachedIdentity?.englishSetName ?? input.englishSetName ?? null,
    priceChartingSetSlug:
      (validatedIncomingProduct ? input.priceChartingSetSlug : null) ??
      (canReuseCachedProduct ? cachedIdentity?.priceChartingSetSlug : null) ??
      profile?.priceChartingSlug ??
      null,
    priceChartingProductId:
      (validatedIncomingProduct ? input.priceChartingProductId : null) ??
      (canReuseCachedProduct ? cachedIdentity?.priceChartingProductId : null) ??
      null,
    priceChartingProductUrl:
      (validatedIncomingProduct ? input.priceChartingProductUrl : null) ??
      (canReuseCachedProduct ? cachedIdentity?.priceChartingProductUrl : null) ??
      null,
    identityConfidence: Math.max(
      cachedIdentity?.identityConfidence ?? 0,
      hasFreshOfficialDetail ? 0.75 : 0,
    ),
    identitySource: sources,
    identityStatus: isConfirmed
      ? "confirmed"
      : officialCardId || detail || input.browseItem
        ? "partial"
        : "identity_incomplete",
    verifiedAt,
    identityVersion: cachedIdentity?.identityVersion ?? 1,
  });

  const priceChartingIdentity = await dependencies
    .resolvePriceChartingIdentity(identity, detail)
    .catch(() => null);

  if (priceChartingIdentity) {
    identity = buildJapaneseMarketIdentity({
      ...identity,
      priceChartingSetSlug:
        priceChartingIdentity.setSlug ?? identity.priceChartingSetSlug,
      priceChartingProductId:
        priceChartingIdentity.productId ?? identity.priceChartingProductId,
      priceChartingProductUrl:
        priceChartingIdentity.productUrl ?? identity.priceChartingProductUrl,
      englishMarketName:
        priceChartingIdentity.englishMarketName ?? identity.englishMarketName,
      identityConfidence: Math.max(
        identity.identityConfidence,
        priceChartingIdentity.confidence ?? 0,
      ),
      identitySource: uniqueJapaneseIdentitySources([
        ...identity.identitySource,
        "pricecharting-discovery",
      ]),
    });
  }

  identity = buildJapaneseMarketIdentity({
    ...identity,
    identityVersion: nextJapaneseMarketIdentityVersion(cachedIdentity, identity),
  });

  const materialChanged =
    !cachedIdentity ||
    japaneseMarketIdentityMaterialKey(cachedIdentity) !==
      japaneseMarketIdentityMaterialKey(identity) ||
    cachedIdentity.identityStatus !== identity.identityStatus;

  if (
    options.persist !== false &&
    isConfirmedJapaneseMarketIdentity(identity) &&
    materialChanged
  ) {
    await dependencies.writeIdentityMapping(mappingFromIdentity(identity)).catch(() => false);
  }

  return identity;
}
