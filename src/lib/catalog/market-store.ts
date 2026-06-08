import type { TcgCard } from "@/types/pokemon";

import { cardKeyFromTcgCard } from "@/lib/catalog/identity";
import { readCatalogJson, writeCatalogJson } from "@/lib/catalog/file-store";
import { isDatabaseEnabled, prisma } from "@/lib/db";

const MARKET_FILE = "market-cache.json";

type MarketCachePayload = {
  psaPopulation?: unknown;
  population?: unknown;
  gradedPrices: Array<{
    grade: string;
    value: number;
    lastSoldAt?: string | null;
    source?: string;
    evidenceType?: string;
    confidence?: string;
    confidenceScore?: number;
    saleCount?: number;
  }>;
  recentSales?: Array<{
    date: string;
    price: number;
    source: string;
    title?: string;
    condition?: string;
    listingUrl?: string;
    confidence?: string;
    confidenceScore?: number;
  }>;
};

type MarketFileEntry = {
  cardKey: string;
  payload: MarketCachePayload;
  expiresAt: string;
};

type MarketFile = Record<string, MarketFileEntry>;

export async function readPersistedMarketResult(
  cacheKey: string,
): Promise<MarketCachePayload | null> {
  if (isDatabaseEnabled() && prisma) {
    const row = await prisma.marketCacheEntry.findUnique({ where: { id: cacheKey } });
    if (row && row.expiresAt.getTime() > Date.now()) {
      return row.payload as MarketCachePayload;
    }
  }

  const file = await readCatalogJson<MarketFile>(MARKET_FILE);
  const entry = file?.[cacheKey];
  if (!entry) {
    return null;
  }

  if (new Date(entry.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return entry.payload;
}

export async function writePersistedMarketResult(
  cacheKey: string,
  payload: MarketCachePayload,
  ttlMs: number,
) {
  const expiresAt = new Date(Date.now() + ttlMs);

  if (isDatabaseEnabled() && prisma) {
    await prisma.marketCacheEntry.upsert({
      where: { id: cacheKey },
      create: {
        id: cacheKey,
        payload: payload as object,
        expiresAt,
      },
      update: {
        payload: payload as object,
        expiresAt,
      },
    });
  }

  const file = (await readCatalogJson<MarketFile>(MARKET_FILE)) ?? {};
  file[cacheKey] = {
    cardKey: cacheKey,
    payload,
    expiresAt: expiresAt.toISOString(),
  };
  await writeCatalogJson(MARKET_FILE, file).catch(() => undefined);
}

export async function persistSoldListingsFromCard(card: TcgCard, market: MarketCachePayload) {
  if (!isDatabaseEnabled() || !prisma || !market.recentSales?.length) {
    return;
  }

  const cardKey = cardKeyFromTcgCard(card);
  const cardRecord = await prisma.cardRecord.upsert({
    where: { slug: card.slug },
    create: {
      id: card.id,
      slug: card.slug,
      language: card.language,
      setId: card.setId,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      name: card.name,
      localizedName: card.localizedName,
      englishName: card.englishName,
      rarity: card.rarity,
      imageUrl: card.image,
    },
    update: {
      name: card.name,
      localizedName: card.localizedName,
      englishName: card.englishName,
      rarity: card.rarity,
      imageUrl: card.image,
    },
  });

  for (const sale of market.recentSales.slice(0, 12)) {
    await prisma.soldListing.create({
      data: {
        cardKey,
        cardRecordId: cardRecord.id,
        grade: sale.condition || "Ungraded",
        priceUsd: sale.price,
        soldAt: sale.date ? new Date(sale.date) : null,
        title: sale.title,
        source: sale.source,
        listingUrl: sale.listingUrl,
        confidence: sale.confidence ?? "medium",
        confidenceScore: sale.confidenceScore ?? 0.5,
      },
    });
  }

  const ungraded = market.gradedPrices.find((price) => price.grade === "Ungraded");
  if (ungraded && ungraded.value > 0) {
    await prisma.priceSnapshot.create({
      data: {
        cardKey,
        cardRecordId: cardRecord.id,
        priceUsd: ungraded.value,
        source: ungraded.source ?? "market_consensus",
        evidenceType: ungraded.evidenceType ?? "sold_comp",
        confidence: ungraded.confidence ?? "medium",
        confidenceScore: ungraded.confidenceScore ?? 0.5,
        sampleCount: ungraded.saleCount ?? 0,
      },
    });
  }
}

export async function lookupLastSoldForCard(card: TcgCard) {
  const cardKey = cardKeyFromTcgCard(card);

  if (isDatabaseEnabled() && prisma) {
    const listing = await prisma.soldListing.findFirst({
      where: { cardKey },
      orderBy: { soldAt: "desc" },
    });

    if (listing) {
      return {
        lastSoldAt: listing.soldAt?.toISOString() ?? null,
        lastSoldPriceUsd: listing.priceUsd,
        source: listing.source,
      };
    }
  }

  const file = await readCatalogJson<MarketFile>(MARKET_FILE);
  const entry = Object.values(file ?? {}).find((item) => item.cardKey.includes(cardKey));
  const sale = entry?.payload.recentSales?.[0];
  if (!sale) {
    return null;
  }

  return {
    lastSoldAt: sale.date ?? null,
    lastSoldPriceUsd: sale.price,
    source: sale.source,
  };
}
