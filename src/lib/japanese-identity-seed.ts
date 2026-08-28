import bundledJapaneseIdentitySeed from "../../data/japanese-market-identity-seed.json";

import {
  normalizeJapaneseOfficialCardId,
  normalizeJapanesePrintedCollectorNumber,
} from "@/lib/japanese-market-identity";
import type {
  JapaneseMarketIdentitySource,
  JapaneseMarketIdentityStatus,
} from "@/types/pokemon";

export type BundledJapaneseIdentitySeed = {
  officialCardId: string;
  browseIndex?: number | null;
  japaneseName?: string | null;
  printedCollectorNumber?: string | null;
  collectorNumberTotal?: number | null;
  setCode?: string | null;
  japaneseSetName?: string | null;
  englishName?: string | null;
  englishMarketName?: string | null;
  englishSetName?: string | null;
  priceChartingSlug?: string | null;
  priceChartingSetSlug?: string | null;
  priceChartingProductId?: string | null;
  priceChartingProductUrl?: string | null;
  identityConfidence?: number | null;
  identitySource?: JapaneseMarketIdentitySource[];
  identityStatus?: JapaneseMarketIdentityStatus | null;
  verifiedAt?: string | null;
  identityVersion?: number;
};

const IDENTITY_SOURCES = new Set<JapaneseMarketIdentitySource>([
  "official-detail",
  "official-browse",
  "tcgdex",
  "manual-set-map",
  "pricecharting-discovery",
  "cached-confirmed-identity",
  "name-database",
  "caller-supplied",
]);

function parseIdentitySources(value: unknown): JapaneseMarketIdentitySource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (source): source is JapaneseMarketIdentitySource =>
      typeof source === "string" && IDENTITY_SOURCES.has(source as JapaneseMarketIdentitySource),
  );
}

function isConfirmedBundledIdentity(candidate: BundledJapaneseIdentitySeed) {
  return Boolean(
    candidate.identityStatus === "confirmed" &&
      normalizeJapanesePrintedCollectorNumber(candidate.printedCollectorNumber) &&
      parseIdentitySources(candidate.identitySource).includes("official-detail") &&
      Number.isFinite(Date.parse(candidate.verifiedAt ?? "")),
  );
}

function cloneBundledIdentity(entry: BundledJapaneseIdentitySeed): BundledJapaneseIdentitySeed {
  return {
    ...entry,
    identitySource: parseIdentitySources(entry.identitySource),
  };
}

const bundledIdentityByCardId = new Map<string, BundledJapaneseIdentitySeed>();

for (const entry of bundledJapaneseIdentitySeed as BundledJapaneseIdentitySeed[]) {
  if (!isConfirmedBundledIdentity(entry)) {
    continue;
  }

  bundledIdentityByCardId.set(
    normalizeJapaneseOfficialCardId(entry.officialCardId),
    cloneBundledIdentity(entry),
  );
}

export function lookupBundledJapaneseIdentitySeed(
  officialCardId: string | number | null | undefined,
): BundledJapaneseIdentitySeed | null {
  const clean = normalizeJapaneseOfficialCardId(String(officialCardId ?? ""));
  if (!clean) {
    return null;
  }

  const bundled = bundledIdentityByCardId.get(clean);
  return bundled ? cloneBundledIdentity(bundled) : null;
}
