import "server-only";

import {
  canonicalMarketSetCode,
  getEnglishParallelSetMarketProfile,
  getLocalizedSetMarketProfile,
} from "@/lib/localized-set-market";
import type {
  CardFinishId,
  CardLanguageCode,
  GradedPrice,
  GradingService,
  MarketEvidence,
  PsaPopulationSnapshot,
} from "@/types/pokemon";
import { productUrlMatchesFinish } from "@/lib/card-finish";

export type MarketLanguage = Extract<CardLanguageCode, "en" | "ja" | "zh-cn" | "zh-tw">;

export type MarketCardIdentityInput = {
  language?: string;
  name: string;
  englishName?: string;
  setName?: string;
  setEnglishName?: string;
  setCode?: string;
  collectorNumber?: string;
  setPrintedTotal?: number;
  setTotal?: number;
  rarity?: string;
  /** Selected print finish (non-holo / holo / reverse). */
  finish?: CardFinishId;
  /** Verified PriceCharting product id for this exact print. */
  productId?: string;
  /** Verified public PriceCharting `/game/...` URL for this exact print. */
  productUrl?: string;
  /** Verified PriceCharting console/set slug for this exact print. */
  setSlug?: string;
};

export type MarketCardIdentity = {
  key: string;
  language: MarketLanguage;
  languageLabel: string;
  nativeName: string;
  englishName: string;
  nativeSetName: string;
  englishSetName: string;
  setCode?: string;
  collectorNumber: string;
  numberBase: string;
  numberWithTotal: string;
  setTotal?: number;
  rarity?: string;
  finish?: CardFinishId;
  productId?: string;
  productUrl?: string;
  setSlug?: string;
  priceChartingSetSlug?: string;
  englishParallelSetName?: string;
  englishParallelPriceChartingSlug?: string;
  queryNames: string[];
  querySetNames: string[];
  priceChartingQueries: string[];
};

const LANGUAGE_LABELS: Record<MarketLanguage, string> = {
  en: "English",
  ja: "Japanese",
  "zh-cn": "Chinese Simplified",
  "zh-tw": "Chinese Traditional",
};

function clean(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function stripPokemonAccent(value: string) {
  return value.replace(/Pokémon/gi, "Pokemon");
}

function extractParentheticalEnglish(value?: string | null) {
  const matches = [...(value ?? "").matchAll(/\(([^()]*[A-Za-z][^()]*)\)/g)];
  return matches
    .map((match) => clean(match[1]))
    .reverse()
    .find((part) => part && !/^(?:jp|ja|japanese|en|eng|english)$/i.test(part));
}

function cleanBilingualMarketLabel(value?: string | null) {
  const trimmed = stripPokemonAccent(clean(value));
  if (!trimmed) {
    return "";
  }

  const parentheticalEnglish = extractParentheticalEnglish(trimmed);
  if (parentheticalEnglish && !/^[A-Za-z]{1,3}$/i.test(parentheticalEnglish)) {
    return parentheticalEnglish;
  }

  return clean(
    trimmed
      .replace(/\s*\((?:JP|JA|Japanese|EN|ENG|English)\)\s*$/i, "")
      .replace(/\s*\[(?:JP|JA|Japanese|EN|ENG|English)\]\s*$/i, "")
      .replace(/\s+-\s+(?:JP|JA|Japanese|EN|ENG|English)\s*$/i, ""),
  );
}

function hasJapanese151SetHint(...values: Array<string | undefined>) {
  return values.some((value) => {
    const normalized = stripPokemonAccent(clean(value)).toLowerCase();
    return (
      normalized === "sv2a" ||
      /\bsv2a\b/i.test(normalized) ||
      /ポケモンカード\s*151/u.test(normalized) ||
      /\bpokemon\s+card\s+151\b/i.test(normalized) ||
      /\bpokemon\s+151\b/i.test(normalized)
    );
  });
}

function priceChartingSetCode(setCode: string | undefined, context: string[]) {
  if (hasJapanese151SetHint(setCode, ...context)) {
    return "SV2a";
  }

  return clean(setCode).toUpperCase() || undefined;
}

function japanesePriceChartingSetLiterals(input: {
  setCode?: string;
  nativeSetName: string;
  englishSetName: string;
}) {
  if (!hasJapanese151SetHint(input.setCode, input.nativeSetName, input.englishSetName)) {
    return uniq([input.englishSetName, input.nativeSetName]);
  }

  return uniq(["Pokemon 151", "Pokemon Card 151", "151", input.englishSetName]);
}

function priceChartingSlugSearchLabel(value?: string) {
  return value
    ?.replace(/^pokemon-japanese-/, "")
    .replace(/^pokemon-/, "")
    .replace(/-/g, " ");
}

function priceChartingProductUrl(value?: string) {
  const cleanValue = clean(value);
  if (!cleanValue) {
    return undefined;
  }

  try {
    const url = new URL(cleanValue);
    if (!/(^|\.)pricecharting\.com$/i.test(url.hostname) || !/^\/game\/[^/]+\/[^/]+\/?$/i.test(url.pathname)) {
      return undefined;
    }

    url.protocol = "https:";
    url.hostname = "www.pricecharting.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function priceChartingSetSlugFromProductUrl(value?: string) {
  const productUrl = priceChartingProductUrl(value);
  if (!productUrl) {
    return undefined;
  }

  return new URL(productUrl).pathname.match(/^\/game\/([^/]+)\//i)?.[1];
}

export function normalizeMarketLanguage(language?: string): MarketLanguage {
  const lower = clean(language).toLowerCase();

  if (lower === "ja" || lower === "jp" || lower === "japanese") {
    return "ja";
  }

  if (
    lower === "zh-cn" ||
    lower === "zh-hans" ||
    lower === "cn" ||
    lower === "chinese-simplified"
  ) {
    return "zh-cn";
  }

  if (
    lower === "zh-tw" ||
    lower === "zh-hant" ||
    lower === "tw" ||
    lower === "chinese-traditional"
  ) {
    return "zh-tw";
  }

  return "en";
}

function numberBase(collectorNumber?: string) {
  const raw = clean(collectorNumber).split("/")[0]?.trim() ?? "";
  // Official JP HTML often prints "017"; PriceCharting titles use "#17".
  // Keep the significant digits so public-page identity checks and slugs match.
  return raw.replace(/^0+(?=\d)/, "") || raw;
}

function withTotal(base: string, total?: number) {
  return base && total ? `${base}/${total}` : base;
}

function uniq(values: Array<string | undefined>) {
  const seen = new Set<string>();
  return values
    .map(clean)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function buildMarketCardIdentity(input: MarketCardIdentityInput): MarketCardIdentity {
  const language = normalizeMarketLanguage(input.language);
  const setCode = canonicalMarketSetCode(input.setCode) || undefined;
  const localizedProfile = setCode ? getLocalizedSetMarketProfile(setCode) : undefined;
  const parallelProfile = setCode ? getEnglishParallelSetMarketProfile(setCode) : undefined;
  const total = input.setPrintedTotal ?? input.setTotal;
  const baseNumber = numberBase(input.collectorNumber);
  const productId = clean(input.productId) || undefined;
  const productUrl = priceChartingProductUrl(input.productUrl);
  const primaryEnglishName =
    cleanBilingualMarketLabel(input.englishName) ||
    extractParentheticalEnglish(input.name) ||
    cleanBilingualMarketLabel(input.name);
  const englishNameRaw = primaryEnglishName || clean(input.name);
  // Catalog finish suffixes are useful for display but break PriceCharting/TCGFish
  // product slugs (Arceus VSTAR Gold → arceus-vstar-gold-gg70 miss).
  const englishName =
    /\bgold\s+star\b/i.test(englishNameRaw)
      ? englishNameRaw
      : englishNameRaw.replace(/\s+\b(?:gold|silver|rainbow)\s*$/i, "").trim() || englishNameRaw;
  const nativeName = cleanBilingualMarketLabel(input.name) || englishName;
  const nativeSetName =
    cleanBilingualMarketLabel(input.setName) ||
    (language === "en" ? cleanBilingualMarketLabel(input.setEnglishName) : localizedProfile?.englishName) ||
    cleanBilingualMarketLabel(input.setEnglishName);
  const englishSetName =
    localizedProfile?.englishName ||
    cleanBilingualMarketLabel(input.setEnglishName) ||
    (language === "en" ? nativeSetName : parallelProfile?.englishParallelSetName) ||
    nativeSetName;
  const pcSetCode = priceChartingSetCode(setCode, [
    input.setName,
    input.setEnglishName,
    nativeSetName,
    englishSetName,
    localizedProfile?.englishName,
  ].filter(Boolean) as string[]);
  const setSlug =
    clean(input.setSlug) ||
    priceChartingSetSlugFromProductUrl(productUrl) ||
    localizedProfile?.priceChartingSlug ||
    undefined;

  const queryNames =
    language === "en"
      ? uniq([englishName, nativeName, englishNameRaw, primaryEnglishName])
      : uniq([englishName || nativeName, englishNameRaw]);
  const galleryParentSet = (nativeSetName || englishSetName).match(
    /^(.+?)\s+(?:galarian|trainer)\s+gallery$/i,
  )?.[1];
  const querySetNames = uniq([
    englishSetName,
    nativeSetName,
    galleryParentSet,
    localizedProfile?.englishName,
    parallelProfile?.englishParallelSetName,
    setCode,
  ]);
  const priceChartingSetNames =
    language === "en"
      ? uniq([englishSetName, galleryParentSet, nativeSetName, setCode])
      : uniq([
          priceChartingSlugSearchLabel(localizedProfile?.priceChartingSlug),
          nativeSetName,
          englishSetName,
          parallelProfile?.englishParallelSetName,
          ...japanesePriceChartingSetLiterals({ setCode, nativeSetName, englishSetName }),
          setCode,
          pcSetCode,
        ]);
  const priceChartingQueries = buildPriceChartingQueries({
    language,
    names: queryNames,
    setNames: priceChartingSetNames,
    numberBase: baseNumber,
    numberWithTotal: withTotal(baseNumber, total),
    setCode: pcSetCode,
    setLiterals:
      language === "ja"
        ? japanesePriceChartingSetLiterals({ setCode, nativeSetName, englishSetName })
        : [],
  });

  return {
    key: [
      language,
      setCode ?? "",
      clean(input.collectorNumber).toLowerCase(),
      nativeName.toLowerCase(),
      englishName.toLowerCase(),
      productId ?? "",
      productUrl ?? "",
      input.finish ?? "",
    ].join("|"),
    language,
    languageLabel: LANGUAGE_LABELS[language],
    nativeName,
    englishName,
    nativeSetName,
    englishSetName,
    setCode,
    collectorNumber: clean(input.collectorNumber),
    numberBase: baseNumber,
    numberWithTotal: withTotal(baseNumber, total),
    setTotal: total,
    rarity: clean(input.rarity) || undefined,
    finish: input.finish,
    productId,
    productUrl,
    setSlug,
    priceChartingSetSlug: setSlug,
    englishParallelSetName: parallelProfile?.englishParallelSetName,
    englishParallelPriceChartingSlug: parallelProfile?.englishParallelPriceChartingSlug,
    queryNames,
    querySetNames,
    priceChartingQueries,
  };
}

function buildPriceChartingQueries(input: {
  language: MarketLanguage;
  names: string[];
  setNames: string[];
  numberBase: string;
  numberWithTotal: string;
  setCode?: string;
  setLiterals?: string[];
}) {
  const numberParts = uniq([
    input.numberWithTotal ? `#${input.numberWithTotal}` : undefined,
    input.numberBase ? `#${input.numberBase}` : undefined,
    input.numberWithTotal,
    input.numberBase,
  ]);
  const languagePrefix =
    input.language === "ja"
      ? "Japanese"
      : input.language === "zh-cn" || input.language === "zh-tw"
        ? "Chinese"
        : "";
  const setNameQueries: string[] = [];
  const setCodeQueries: string[] = [];

  // Prefer set-name / slug-label queries first. Bare set-code queries (e.g. "M4")
  // often miss on PriceCharting and burn the localized 3s fast-path budget.
  for (const setName of input.setNames) {
    for (const name of input.names) {
      for (const number of numberParts) {
        setNameQueries.push(
          [languagePrefix, "Pokemon", setName, name, number].filter(Boolean).join(" "),
        );
        setNameQueries.push(
          ["Pokemon", languagePrefix, setName, name, number].filter(Boolean).join(" "),
        );
        setNameQueries.push([setName, name, number].filter(Boolean).join(" "));
      }
    }
  }

  if (input.language === "ja" && input.setCode && input.numberBase) {
    for (const name of input.names) {
      for (const setLiteral of input.setLiterals ?? []) {
        setNameQueries.push(
          [name, input.numberBase, setLiteral, "Japanese"].filter(Boolean).join(" "),
        );

        if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
          setNameQueries.push(
            [name, input.numberWithTotal, setLiteral, "Japanese"].filter(Boolean).join(" "),
          );
        }
      }
    }

    for (const name of input.names) {
      setCodeQueries.push(
        [name, input.setCode, input.numberBase, "Japanese"].filter(Boolean).join(" "),
      );

      if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
        setCodeQueries.push(
          [name, input.setCode, input.numberWithTotal, "Japanese"].filter(Boolean).join(" "),
        );
      }
    }

    setCodeQueries.push([input.setCode, input.numberBase, "Japanese"].join(" "));

    if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
      setCodeQueries.push([input.setCode, input.numberWithTotal, "Japanese"].join(" "));
    }
  }

  if (input.setCode) {
    for (const name of input.names) {
      for (const number of numberParts) {
        setCodeQueries.push(
          [languagePrefix, "Pokemon", input.setCode, name, number].filter(Boolean).join(" "),
        );
      }
    }
  }

  return uniq([...setNameQueries, ...setCodeQueries]);
}

function explicitLanguageTags(value: string): Set<MarketLanguage | "ko" | "other"> {
  const text = value.toLowerCase();
  const tags = new Set<MarketLanguage | "ko" | "other">();

  if (/\b(japanese|japan|jp)\b|[\u3040-\u30ff]/iu.test(text)) {
    tags.add("ja");
  }

  if (/\b(chinese|china|simplified|traditional|cn|tw)\b/iu.test(text)) {
    tags.add("zh-cn");
  }

  if (/\b(korean|korea|kr)\b|[\uac00-\ud7af]/iu.test(text)) {
    tags.add("ko");
  }

  if (/\b(english|eng|en)\b/iu.test(text)) {
    tags.add("en");
  }

  if (/\b(french|german|spanish|italian|portuguese|thai|indonesian)\b/iu.test(text)) {
    tags.add("other");
  }

  return tags;
}

export function marketRecordMatchesIdentityLanguage(
  identity: MarketCardIdentity,
  text: string,
  options: { allowEnglishParallel?: boolean } = {},
) {
  const tags = explicitLanguageTags(text);

  if (identity.language === "en") {
    return !tags.has("ja") && !tags.has("zh-cn") && !tags.has("zh-tw") && !tags.has("ko");
  }

  if (tags.has("other") || tags.has("ko")) {
    return false;
  }

  const allowsParallel =
    options.allowEnglishParallel &&
    tags.has("en") &&
    Boolean(identity.englishParallelSetName || identity.englishParallelPriceChartingSlug);

  if (identity.language === "ja") {
    return !tags.has("zh-cn") && !tags.has("zh-tw") && (!tags.has("en") || allowsParallel);
  }

  return !tags.has("ja") && (!tags.has("en") || allowsParallel);
}

export function priceChartingProductMatchesIdentity(
  identity: MarketCardIdentity,
  product: { "product-name"?: string; "console-name"?: string; productName?: string; consoleName?: string },
) {
  const productName = clean(product["product-name"] ?? product.productName);
  const consoleName = clean(product["console-name"] ?? product.consoleName);
  const haystack = `${consoleName} ${productName}`.toLowerCase();

  if (!marketRecordMatchesIdentityLanguage(identity, `${consoleName} ${productName}`, {
    allowEnglishParallel: true,
  })) {
    return false;
  }

  const normalizeCollectorToken = (value: string) => {
    const [base, total] = value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/^#/, "")
      .split("/");
    const cleanPart = (part?: string) =>
      part?.trim().replace(/^0+(?=\d)/, "") ?? "";
    const cleanBase = cleanPart(base);
    const cleanTotal = cleanPart(total);
    return cleanTotal ? `${cleanBase}/${cleanTotal}` : cleanBase;
  };
  const expectedNumbers = new Set(
    uniq([identity.numberWithTotal, identity.numberBase])
      .map(normalizeCollectorToken)
      .filter(Boolean),
  );
  const productNumbers = new Set(
    [...`${consoleName} ${productName}`.normalize("NFKC").matchAll(/#\s*(\d+[a-z]?)(?:\s*\/\s*(\d+))?/gi)]
      .flatMap((match) => [
        normalizeCollectorToken(match[1]),
        match[2] ? normalizeCollectorToken(`${match[1]}/${match[2]}`) : "",
      ])
      .filter(Boolean),
  );
  const hasNumber =
    !expectedNumbers.size ||
    [...productNumbers].some((number) => expectedNumbers.has(number));
  const nameTokens = uniq([identity.nativeName, identity.englishName]).map((name) =>
    name.toLowerCase(),
  );
  const hasName = nameTokens.some((name) => haystack.includes(name));
  const setTokens = uniq([
    identity.nativeSetName,
    identity.englishSetName,
    identity.englishParallelSetName,
    identity.setCode,
    priceChartingSlugSearchLabel(identity.priceChartingSetSlug),
  ]).map((setName) => setName.toLowerCase());
  const hasSet = !setTokens.length || setTokens.some((setName) => haystack.includes(setName));
  const languageHint =
    identity.language === "en" ||
    haystack.includes(identity.languageLabel.toLowerCase()) ||
    haystack.includes(identity.nativeSetName.toLowerCase()) ||
    Boolean(identity.priceChartingSetSlug && haystack.includes(identity.priceChartingSetSlug.replace(/^pokemon-/, "").replace(/-/g, " ")));
  const finishHaystack = `${productName} ${consoleName}`.replace(/\s+/g, "-").toLowerCase();
  const finishMatches =
    !identity.finish || productUrlMatchesFinish(finishHaystack, identity.finish, identity.rarity);

  return hasName && hasNumber && hasSet && languageHint && finishMatches;
}

export function normalizePopulationForIdentity(
  identity: MarketCardIdentity,
  snapshot: PsaPopulationSnapshot,
  options: { allowEnglishParallel?: boolean; service?: GradingService } = {},
): PsaPopulationSnapshot | null {
  const sourceText = [snapshot.source, snapshot.sourceUrl, snapshot.note, snapshot.warning]
    .filter(Boolean)
    .join(" ");

  if (!marketRecordMatchesIdentityLanguage(identity, sourceText, options)) {
    return null;
  }

  const service = options.service ?? snapshot.service;
  const grades = service
    ? snapshot.grades.filter((grade) => !grade.service || grade.service === service)
    : snapshot.grades;

  const englishParallel =
    identity.language !== "en" &&
    options.allowEnglishParallel &&
    explicitLanguageTags(sourceText).has("en");

  return {
    ...snapshot,
    grades,
    service,
    warning: englishParallel
      ? [
          snapshot.warning,
          `Population is from the English parallel set "${identity.englishParallelSetName}" and is kept separate from native ${identity.languageLabel} market pricing.`,
        ]
          .filter(Boolean)
          .join(" ")
      : snapshot.warning,
  };
}

export function normalizePricesForIdentity(
  identity: MarketCardIdentity,
  prices: GradedPrice[],
  options: { allowEnglishParallel?: boolean; service?: GradingService } = {},
) {
  return prices.filter((price) => {
    if (options.service && price.service && price.service !== options.service) {
      return false;
    }

    const text = [price.source, price.sourceUrl, price.warning].filter(Boolean).join(" ");
    return marketRecordMatchesIdentityLanguage(identity, text, options);
  });
}

export function normalizeEvidenceForIdentity(
  identity: MarketCardIdentity,
  evidence: MarketEvidence[],
  options: { allowEnglishParallel?: boolean } = {},
) {
  return evidence.filter((entry) => {
    const text = [entry.source, entry.sourceUrl, entry.title, entry.note, entry.warning]
      .filter(Boolean)
      .join(" ");
    return marketRecordMatchesIdentityLanguage(identity, text, options);
  });
}
