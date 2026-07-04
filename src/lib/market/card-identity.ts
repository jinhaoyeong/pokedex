import "server-only";

import {
  getEnglishParallelSetMarketProfile,
  getLocalizedSetMarketProfile,
} from "@/lib/localized-set-market";
import type {
  CardLanguageCode,
  GradedPrice,
  GradingService,
  MarketEvidence,
  PsaPopulationSnapshot,
} from "@/types/pokemon";

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
  return clean(collectorNumber).split("/")[0]?.trim() ?? "";
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
  const setCode = clean(input.setCode).toUpperCase() || undefined;
  const localizedProfile = setCode ? getLocalizedSetMarketProfile(setCode) : undefined;
  const parallelProfile = setCode ? getEnglishParallelSetMarketProfile(setCode) : undefined;
  const total = input.setPrintedTotal ?? input.setTotal;
  const baseNumber = numberBase(input.collectorNumber);
  const primaryEnglishName =
    cleanBilingualMarketLabel(input.englishName) ||
    extractParentheticalEnglish(input.name) ||
    cleanBilingualMarketLabel(input.name);
  const englishName = primaryEnglishName || clean(input.name);
  const nativeName = cleanBilingualMarketLabel(input.name) || englishName;
  const nativeSetName =
    cleanBilingualMarketLabel(input.setName) ||
    (language === "en" ? cleanBilingualMarketLabel(input.setEnglishName) : localizedProfile?.englishName) ||
    cleanBilingualMarketLabel(input.setEnglishName);
  const englishSetName =
    cleanBilingualMarketLabel(input.setEnglishName) ||
    (language === "en" ? nativeSetName : parallelProfile?.englishParallelSetName) ||
    localizedProfile?.englishName ||
    nativeSetName;
  const pcSetCode = priceChartingSetCode(setCode, [
    input.setName,
    input.setEnglishName,
    nativeSetName,
    englishSetName,
    localizedProfile?.englishName,
  ].filter(Boolean) as string[]);

  const queryNames =
    language === "en" ? uniq([nativeName, englishName]) : uniq([englishName || nativeName]);
  const querySetNames = uniq([
    nativeSetName,
    englishSetName,
    localizedProfile?.englishName,
    parallelProfile?.englishParallelSetName,
    setCode,
  ]);
  const priceChartingSetNames =
    language === "en"
      ? uniq([englishSetName, nativeSetName, setCode])
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
    priceChartingSetSlug: localizedProfile?.priceChartingSlug,
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
  const queries: string[] = [];

  if (input.language === "ja" && input.setCode && input.numberBase) {
    for (const name of input.names) {
      queries.push([name, input.setCode, input.numberBase, "Japanese"].filter(Boolean).join(" "));

      if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
        queries.push([name, input.setCode, input.numberWithTotal, "Japanese"].filter(Boolean).join(" "));
      }
    }

    for (const name of input.names) {
      for (const setLiteral of input.setLiterals ?? []) {
        queries.push([name, input.numberBase, setLiteral, "Japanese"].filter(Boolean).join(" "));

        if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
          queries.push([name, input.numberWithTotal, setLiteral, "Japanese"].filter(Boolean).join(" "));
        }
      }
    }

    queries.push([input.setCode, input.numberBase, "Japanese"].join(" "));

    if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
      queries.push([input.setCode, input.numberWithTotal, "Japanese"].join(" "));
    }
  }

  for (const setName of input.setNames) {
    for (const name of input.names) {
      for (const number of numberParts) {
        queries.push([languagePrefix, "Pokemon", setName, name, number].filter(Boolean).join(" "));
        queries.push(["Pokemon", languagePrefix, setName, name, number].filter(Boolean).join(" "));
        queries.push([setName, name, number].filter(Boolean).join(" "));
      }
    }
  }

  if (input.setCode) {
    for (const name of input.names) {
      for (const number of numberParts) {
        queries.push([languagePrefix, "Pokemon", input.setCode, name, number].filter(Boolean).join(" "));
      }
    }
  }

  return uniq(queries);
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

  const numberTokens = uniq([
    identity.numberWithTotal,
    identity.numberBase ? `#${identity.numberBase}` : undefined,
    identity.numberBase,
  ]).map((token) => token.toLowerCase());
  const hasNumber = !numberTokens.length || numberTokens.some((token) => haystack.includes(token));
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

  return hasName && hasNumber && hasSet && languageHint;
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
