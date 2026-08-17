import {
  resolveJapaneseCardIdentity,
  getCachedJapaneseEnglishName,
} from "@/lib/japanese-card-identity";
import {
  JAPANESE_CARD_NAME_OVERRIDES,
  parseJapaneseCardNameSuffix,
} from "@/lib/japanese-name-overrides";
import {
  getLocalizedSetMarketProfile,
  SHARED_POKEMON_TCG_SET_IDS,
} from "@/lib/localized-set-market";
import { buildJapaneseMarketIdentity } from "@/lib/japanese-market-identity";
import { resolvePokemonNameToEnglish } from "@/lib/pokemon-name-db.server";
import {
  getOfficialJapaneseSetSupplementById,
  isOfficialJapaneseSupplementSetCode,
} from "@/lib/official-japanese-sets.server";
import type {
  CollectorCodeQuery,
  PokemonCardJpDetail,
  PokemonCardJpSearchItem,
  PokemonCardJpSearchResponse,
} from "@/lib/pokemon-tcg/api-types";
import {
  absolutePokemonCardJpUrl,
  buildLocalizedSlug,
  collectorDetailMatchesCode,
  formatBilingualName,
  lookupOfficialJpCollectorFallback,
  lookupOfficialJpCollectorFallbackByPartial,
  normalizeSetCode,
  normalizeWhitespace,
  parseCollectorCodeQuery,
  POKEMON_CARD_JP_BASE_URL,
  stripHtml,
} from "@/lib/pokemon-tcg/text-and-collector-utils";
import {
  getLocalizedSetEnglishName,
  resolveTcgdexApiLanguage,
  TCGDEX_API_BASE_URL,
  fetchTcgdexJson,
} from "@/lib/pokemon-tcg/tcgdex-normalizers";
import type { CardLanguageCode, TcgCard } from "@/types/pokemon";

const PUBLIC_HTML_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.5",
  Connection: "keep-alive",
  Referer: "https://www.pokemon-card.com/",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const OFFICIAL_JP_RARITY_LABELS: Record<string, string> = {
  a: "Amazing Rare",
  ar: "Art Rare",
  c: "Common",
  chr: "Character Rare",
  csr: "Character Super Rare",
  hr: "Hyper Rare",
  k: "Amazing Rare",
  r: "Rare",
  rr: "Double Rare",
  rrr: "Triple Rare",
  sar: "Special Art Rare",
  sr: "Super Rare",
  tr: "Trainer Rare",
  u: "Uncommon",
  ur: "Ultra Rare",
};

const OFFICIAL_JP_TYPE_LABELS: Record<string, string> = {
  colorless: "Colorless",
  darkness: "Darkness",
  dragon: "Dragon",
  fairy: "Fairy",
  fighting: "Fighting",
  fire: "Fire",
  grass: "Grass",
  lightning: "Lightning",
  metal: "Metal",
  psychic: "Psychic",
  steel: "Metal",
  water: "Water",
};

const OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS: Record<
  string,
  {
    cardId: string;
    englishName?: string;
    imagePath: string;
    jpName: string;
    rarity: string;
    setCode: string;
  }
> = {
  "100/095": {
    cardId: "37382",
    englishName: "Arceus & Dialga & Palkia GX",
    imagePath: "/assets/images/card_images/large/SM12/037382_P_ARUSEUSUDEIARUGAPARUKIAGX.jpg",
    jpName: "ã‚¢ãƒ«ã‚»ã‚¦ã‚¹&ãƒ‡ã‚£ã‚¢ãƒ«ã‚¬&ãƒ‘ãƒ«ã‚­ã‚¢GX",
    rarity: "Super Rare",
    setCode: "SM12",
  },
  "017/027": {
    cardId: "31109",
    englishName: "Dialga",
    imagePath: "/assets/images/card_images/large/CP2/031109_P_DEIARUGA.jpg",
    jpName: "ãƒ‡ã‚£ã‚¢ãƒ«ã‚¬",
    rarity: "Rare Holo",
    setCode: "CP2",
  },
  "071/067": {
    cardId: "41654",
    englishName: "Origin Forme Palkia V",
    imagePath: "/assets/images/card_images/large/S10P/041654_P_ORIJINPARUKIAV.jpg",
    jpName: "ã‚ªãƒªã‚¸ãƒ³ãƒ‘ãƒ«ã‚­ã‚¢V",
    rarity: "Super Rare",
    setCode: "S10P",
  },
};

const OFFICIAL_JP_STAGE_LABELS: Record<string, string> = {
  "1é€²åŒ–": "Stage 1",
  "2é€²åŒ–": "Stage 2",
  "ãŸã­": "Basic",
};

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalizeOfficialCollectorNumber(value: string) {
  const trimmed = value.trim();
  const slashMatch = trimmed.match(/(?:^|[^\d])0*(\d+)\s*\/\s*0*\d+(?:[^\d]|$)/);

  if (slashMatch?.[1]) {
    return slashMatch[1].replace(/^0+(?=\d)/, "") || "0";
  }

  const matches = [...trimmed.matchAll(/\d+/g)];
  const match = matches[matches.length - 1];

  return match ? match[0].replace(/^0+(?=\d)/, "") || "0" : trimmed;
}

async function logJapaneseScraperFailure(response: Response) {
  console.error("JAPANESE SCRAPER FAILED | Status:", response.status, response.statusText);

  try {
    const text = await response.text();
    console.error("BODY RESPONSE:", text.substring(0, 200));
  } catch (error) {
    console.error("BODY RESPONSE: <failed to read>", error);
  }
}

export async function fetchPokemonCardJpSearchPage(
  keyword: string,
  page: number,
): Promise<PokemonCardJpSearchResponse | null> {
  const params = new URLSearchParams({
    keyword,
    regulation_sidebar_form: "all",
    pg: "",
    illust: "",
    sm_and_keyword: "true",
    page: String(page),
  });
  const response = await fetch(
    `${POKEMON_CARD_JP_BASE_URL}/card-search/resultAPI.php?${params.toString()}`,
    {
      headers: PUBLIC_HTML_HEADERS,
      next: { revalidate: 86400 },
    },
  );

  if (!response.ok) {
    await logJapaneseScraperFailure(response);
    console.error("official Japanese catalog search failed", {
      keyword,
      page,
      status: response.status,
      statusText: response.statusText,
    });
    return null;
  }

  const payload = (await response.json()) as PokemonCardJpSearchResponse;
  return payload.result === 1 ? payload : null;
}

export function padTcgdexLocalId(localId: string) {
  const bare = localId.replace(/^0+(?=\d)/, "");
  return bare.length >= 3 ? bare.padStart(3, "0") : bare;
}

function officialJapaneseCollectorCodeKey(detail: PokemonCardJpDetail) {
  if (!(typeof detail.printedTotal === "number" && detail.printedTotal > 0)) {
    return null;
  }

  const number = detail.collectorNumber.replace(/^0+(?=\d)/, "") || detail.collectorNumber;
  return `${number}/${String(detail.printedTotal).padStart(3, "0")}`;
}

export async function resolveOfficialJapaneseEnglishName(
  detail: PokemonCardJpDetail,
): Promise<string | undefined> {
  const cached = getCachedJapaneseEnglishName({
    jpName: detail.name,
    setCode: detail.setCode,
    collectorNumber: detail.collectorNumber,
    cardId: detail.cardID,
  });

  if (cached) {
    return cached;
  }

  const collectorKey = officialJapaneseCollectorCodeKey(detail);
  const collectorFallback = collectorKey
    ? OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS[collectorKey]
    : undefined;

  if (collectorFallback?.englishName && collectorFallback.cardId === detail.cardID) {
    return collectorFallback.englishName;
  }

  for (const fallback of Object.values(OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS)) {
    if (fallback.cardId === detail.cardID && fallback.englishName) {
      return fallback.englishName;
    }
  }

  const fromDatabase = await resolvePokemonNameToEnglish(detail.name.trim(), "ja");

  if (fromDatabase) {
    return fromDatabase;
  }

  const override = JAPANESE_CARD_NAME_OVERRIDES[detail.name.trim()];

  if (override) {
    return override;
  }

  const { base, englishSuffix } = parseJapaneseCardNameSuffix(detail.name);
  const baseOverride = JAPANESE_CARD_NAME_OVERRIDES[base];

  if (baseOverride) {
    return `${baseOverride}${englishSuffix}`;
  }

  return undefined;
}

export function shouldSkipTcgdexOfficialJapaneseEnrichment(
  detail: PokemonCardJpDetail,
) {
  const setCode = detail.setCode?.trim().toLowerCase() ?? "";
  return (
    SHARED_POKEMON_TCG_SET_IDS.has(setCode) ||
    Boolean(getLocalizedSetMarketProfile(detail.setCode)) ||
    // Official-only Japanese supplement sets (e.g. M5/M2A/M4) have no TCGdex
    // records, so every per-card TCGdex lookup is a guaranteed miss. On
    // serverless this fans out to hundreds of doomed network calls per page,
    // which can exhaust the route budget and surface as "No cards found".
    isOfficialJapaneseSupplementSetCode(detail.setCode)
  );
}

export async function resolveOfficialJapaneseIdentityName(
  detail: PokemonCardJpDetail,
  options: { skipTcgdex?: boolean } = {},
) {
  return (
    (await resolveOfficialJapaneseEnglishName(detail)) ??
    (await resolveJapaneseCardIdentity({
      jpName: detail.name,
      setCode: detail.setCode,
      collectorNumber: detail.collectorNumber,
      cardId: detail.cardID,
      skipTcgdex: options.skipTcgdex,
    }))
  );
}

export function parseOfficialJapaneseCardDetail(
  cardID: string,
  html: string,
  fallback?: PokemonCardJpSearchItem,
): PokemonCardJpDetail {
  const name =
    stripHtml(html.match(/<h1[^>]*class="[^"]*Heading1[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ||
    // The official catalog (and bundled browse seed) store names with HTML
    // entities, e.g. tag-team cards as "ã‚»ãƒ¬ãƒ“ã‚£&amp;ãƒ•ã‚·ã‚®ãƒãƒŠGX". Decode them so
    // the display name is clean and the "&" split for multi-PokÃ©mon English-name
    // resolution actually matches.
    normalizeWhitespace(fallback?.cardNameAltText ?? "") ||
    normalizeWhitespace(fallback?.cardNameViewText ?? "") ||
    "Japanese Pokemon card";
  const image =
    absolutePokemonCardJpUrl(
      html.match(/<img[^>]+class="fit"[^>]+src="([^"]+)"/i)?.[1] ??
        fallback?.cardThumbFile,
    ) || absolutePokemonCardJpUrl(fallback?.cardThumbFile);
  const imageSetCode = image.match(/\/large\/([^/]+)\//i)?.[1] ?? "";
  const subtextMatch = html.match(
    /class="img-regulation"[^>]+alt="([^"]+)"[^>]*>[\s\S]*?&nbsp;([^&<]+)&nbsp;\s*\/\s*&nbsp;([^&<]+)&nbsp;/i,
  );
  const setCode = normalizeWhitespace(subtextMatch?.[1] ?? imageSetCode);
  const collectorNumber = normalizeWhitespace(subtextMatch?.[2] ?? "");
  const printedTotalText = normalizeWhitespace(subtextMatch?.[3] ?? "");
  const printedTotal = Number.parseInt(printedTotalText.replace(/\D/g, ""), 10);
  const rarityCode = (
    html.match(/\/rarity\/ic_rare_([^".\/]+)\.(?:gif|png|webp)/i)?.[1] ?? ""
  )
    .split("_")[0]
    .toLowerCase();
  const topInfoHtml =
    html.match(/<div class="TopInfo[\s\S]*?<span class="hp-type">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i)?.[0] ??
    "";
  const typeCodes = [
    ...new Set(
      [...topInfoHtml.matchAll(/class="icon-([a-z-]+)\s+icon"/gi)]
        .map((match) => match[1].toLowerCase())
        .filter((code) => code !== "none"),
    ),
  ];
  const stageText = stripHtml(
    html.match(/<span class="type">([\s\S]*?)<\/span>/i)?.[1] ?? "",
  );

  return {
    cardID,
    name,
    image,
    setCode,
    collectorNumber,
    collectorNumberSource:
      subtextMatch && collectorNumber ? "official-detail" : "official-browse",
    printedTotal: Number.isFinite(printedTotal) && printedTotal > 0 ? printedTotal : undefined,
    rarity: OFFICIAL_JP_RARITY_LABELS[rarityCode] ?? "Official Japanese release",
    hp: stripHtml(html.match(/<span class="hp-num">([\s\S]*?)<\/span>/i)?.[1] ?? "") || "-",
    types: typeCodes
      .map((code) => OFFICIAL_JP_TYPE_LABELS[code])
      .filter((type): type is string => Boolean(type)),
    stage: OFFICIAL_JP_STAGE_LABELS[stageText] ?? (stageText || undefined),
    artist:
      stripHtml(
        html.match(/<div class="author">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "",
      ) || "Unknown",
  };
}

export function buildOfficialJapaneseDetailFromBrowseItem(
  item: PokemonCardJpSearchItem,
  setIndex: number,
  browseSetCode: string,
  printedTotal?: number,
): PokemonCardJpDetail {
  const parsed = parseOfficialJapaneseCardDetail(item.cardID, "", item);
  const setCode = parsed.setCode || browseSetCode;

  return {
    ...parsed,
    setCode,
    // A browse position is not printed card identity. Keep it explicit and
    // leave collectorNumber unresolved until an official detail page confirms it.
    collectorNumber: "",
    browseIndex: setIndex + 1,
    collectorNumberSource: "official-browse",
    printedTotal:
      parsed.printedTotal ??
      (typeof printedTotal === "number" && printedTotal > 0 ? printedTotal : undefined),
    rarity: parsed.rarity || "Official Japanese release",
  };
}

export async function fetchOfficialJapaneseCardDetail(
  cardID: string,
  fallback?: PokemonCardJpSearchItem,
): Promise<PokemonCardJpDetail | null> {
  const response = await fetch(
    `${POKEMON_CARD_JP_BASE_URL}/card-search/details.php/card/${encodeURIComponent(cardID)}/regu/all`,
    {
      headers: PUBLIC_HTML_HEADERS,
      next: { revalidate: 86400 },
      // Most detail pages respond in ~1s; cap stragglers so one slow page can't
      // stretch the rolling-window tail (ceil(cards/concurrency) * timeout).
      signal: AbortSignal.timeout(6_000),
    },
  );

  if (!response.ok) {
    await logJapaneseScraperFailure(response);
    console.error("official Japanese card detail failed", {
      cardID,
      status: response.status,
      statusText: response.statusText,
    });
    return null;
  }

  return parseOfficialJapaneseCardDetail(cardID, await response.text(), fallback);
}

export function normalizeOfficialJapaneseCard(
  detail: PokemonCardJpDetail,
  englishName?: string,
): TcgCard {
  const fetchedAt = new Date().toISOString();
  const setCode = detail.setCode || "Official Japanese catalog";
  const normalizedSetCode = normalizeSetCode(setCode);
  const supplementSet = getOfficialJapaneseSetSupplementById(normalizedSetCode);
  const profile = getLocalizedSetMarketProfile(normalizedSetCode);
  const setEnglishName = profile?.englishName ?? getLocalizedSetEnglishName(setCode, undefined) ?? setCode;
  const setDisplayName = profile?.englishName ?? setCode;
  const collectorNumber =
    detail.collectorNumberSource === "official-browse"
      ? ""
      : normalizeOfficialCollectorNumber(detail.collectorNumber);
  const setPrintedTotal =
    supplementSet?.printedTotal ??
    supplementSet?.total ??
    detail.printedTotal;
  const hasConfirmedOfficialNumber = Boolean(
    collectorNumber && detail.collectorNumberSource === "official-detail",
  );
  const marketIdentity = buildJapaneseMarketIdentity({
    officialCardId: detail.cardID,
    browseIndex: detail.browseIndex ?? null,
    japaneseName: detail.name,
    englishMarketName: englishName ?? null,
    printedCollectorNumber: collectorNumber || null,
    collectorNumberTotal: setPrintedTotal ?? null,
    japaneseSetCode: normalizedSetCode,
    japaneseSetName: setCode,
    englishSetName: setEnglishName,
    priceChartingSetSlug: profile?.priceChartingSlug ?? null,
    priceChartingProductId: null,
    priceChartingProductUrl: null,
    identitySource: [
      detail.collectorNumberSource === "official-detail"
        ? "official-detail"
        : detail.collectorNumberSource === "official-browse"
          ? "official-browse"
          : "caller-supplied",
      profile ? "manual-set-map" : null,
      englishName ? "caller-supplied" : null,
    ].filter(Boolean) as Array<
      "official-detail" | "official-browse" | "manual-set-map" | "caller-supplied"
    >,
    identityStatus: hasConfirmedOfficialNumber ? "confirmed" : "partial",
    verifiedAt: hasConfirmedOfficialNumber ? fetchedAt : null,
  });

  return {
    id: `official-${detail.cardID}`,
    slug: buildLocalizedSlug("ja", `official-${detail.cardID}`),
    language: "ja",
    languageLabel: "Japanese",
    name: formatBilingualName(detail.name, englishName),
    localizedName: detail.name,
    englishName,
    officialCardId: detail.cardID,
    browseIndex: detail.browseIndex,
    marketIdentity,
    collectorNumber,
    rarity: detail.rarity,
    supertype: "Pokemon",
    hp: detail.hp,
    types: detail.types,
    setId: normalizedSetCode,
    setCode: normalizedSetCode,
    setName: setDisplayName,
    setLocalizedName: setCode,
    setEnglishName,
    image: detail.image,
    artist: detail.artist,
    stage: detail.stage,
    setPrintedTotal,
    setTotal: setPrintedTotal,
    imageStatus: "official",
    marketPriceUsd: 0,
    psaPopulation: {
      status: "pending",
      totalCertified: null,
      grades: [],
      source: "Pokemon Card Japan official catalog",
      fetchedAt: null,
      note: "Official Japanese card identity is loaded. Population and market data are resolved from public market sources when available.",
    },
    portfolioDefaultQuantity: 1,
    priceHistory: [
      { date: isoDaysAgo(30), value: 0 },
      { date: isoDaysAgo(14), value: 0 },
      { date: isoDaysAgo(7), value: 0 },
      { date: isoDaysAgo(1), value: 0 },
      { date: isoDaysAgo(0), value: 0 },
    ],
    gradedPrices: [
      {
        grade: "Ungraded",
        value: 0,
        populationCount: 0,
      },
    ],
    recentSales: [],
    priceConsensus: {
      finalEstimateUsd: 0,
      confidence: "low",
      confidenceScore: 0,
      sourceCount: 0,
      sampleCount: 0,
      methodology:
        "Official Japanese catalog identity only. Market value requires public sold-comps enrichment.",
      sources: [],
    },
    sources: [
      {
        source: "Pokemon Card Japan official catalog",
        status: "verified",
        fetchedAt,
        confidence: 0.92,
        note: "Official Japanese Pokemon Card catalog record used for identity and image coverage.",
      },
    ],
  };
}

export function buildOfficialJapaneseFallbackDetail(
  collectorCode: CollectorCodeQuery,
  fallback: (typeof OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS)[string],
): PokemonCardJpDetail {
  return {
    cardID: fallback.cardId,
    name: fallback.jpName,
    image: absolutePokemonCardJpUrl(fallback.imagePath),
    setCode: normalizeSetCode(fallback.setCode),
    collectorNumber: normalizeOfficialCollectorNumber(
      collectorCode.rawNumber ?? collectorCode.number,
    ),
    collectorNumberSource: "manual-fallback",
    printedTotal: collectorCode.printedTotal,
    rarity: fallback.rarity,
    hp: "-",
    types: [],
    artist: "Unknown",
  };
}

export function findOfficialJapaneseCollectorFallbackByCardId(cardId: string) {
  return Object.entries(OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS).find(
    ([, fallback]) => fallback.cardId === cardId,
  );
}

export function buildOfficialJapaneseFallbackDetailByLabel(label: string) {
  const fallback = OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS[label];
  const collectorCode = parseCollectorCodeQuery(label);

  if (!fallback || !collectorCode) {
    return null;
  }

  return {
    detail: buildOfficialJapaneseFallbackDetail(collectorCode, fallback),
    fallback,
  };
}

export async function fetchOfficialJapaneseFallbackDetailForCollectorCode(
  collectorCode: CollectorCodeQuery,
) {
  const directFallback = lookupOfficialJpCollectorFallback(collectorCode);

  if (!directFallback) {
    return null;
  }

  const detail = await fetchOfficialJapaneseCardDetail(directFallback.cardId).catch(() => null);

  if (detail) {
    return detail;
  }

  return buildOfficialJapaneseFallbackDetail(collectorCode, directFallback);
}

export function lookupOfficialJapanesePartialCollectorFallback(
  collectorCode: CollectorCodeQuery,
  nameQuery = "",
) {
  return lookupOfficialJpCollectorFallbackByPartial(collectorCode, nameQuery);
}

export async function fetchOfficialJapaneseTcgdexCandidate<T>(
  language: CardLanguageCode,
  candidateId: string,
) {
  const apiLanguage = resolveTcgdexApiLanguage(language);
  return fetchTcgdexJson<T>(
    `${TCGDEX_API_BASE_URL}/${apiLanguage}/cards/${encodeURIComponent(candidateId)}`,
  ).catch(() => null);
}

export function officialJapaneseDetailMatchesCollectorCode(
  detail: PokemonCardJpDetail,
  collectorCode: CollectorCodeQuery,
) {
  return collectorDetailMatchesCode(detail, collectorCode);
}
