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
  const englishName = clean(input.englishName) || clean(input.name);
  const nativeName = clean(input.name) || englishName;
  const nativeSetName =
    clean(input.setName) ||
    (language === "en" ? clean(input.setEnglishName) : localizedProfile?.englishName) ||
    clean(input.setEnglishName);
  const englishSetName =
    clean(input.setEnglishName) ||
    (language === "en" ? nativeSetName : parallelProfile?.englishParallelSetName) ||
    localizedProfile?.englishName ||
    nativeSetName;

  const queryNames = uniq([nativeName, englishName]);
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
          localizedProfile?.priceChartingSlug?.replace(/^pokemon-/, "").replace(/-/g, " "),
          nativeSetName,
          englishSetName,
          parallelProfile?.englishParallelSetName,
          setCode,
        ]);
  const priceChartingQueries = buildPriceChartingQueries({
    language,
    names: queryNames,
    setNames: priceChartingSetNames,
    numberBase: baseNumber,
    numberWithTotal: withTotal(baseNumber, total),
    setCode,
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
      queries.push(["Pokemon", name, input.setCode, input.numberBase, "Japanese"].filter(Boolean).join(" "));

      if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
        queries.push([name, input.setCode, input.numberWithTotal, "Japanese"].filter(Boolean).join(" "));
        queries.push(["Pokemon", name, input.setCode, input.numberWithTotal, "Japanese"].filter(Boolean).join(" "));
      }
    }

    queries.push([input.setCode, input.numberBase, "Japanese"].join(" "));
    queries.push(["Pokemon", input.setCode, input.numberBase, "Japanese"].join(" "));

    if (input.numberWithTotal && input.numberWithTotal !== input.numberBase) {
      queries.push([input.setCode, input.numberWithTotal, "Japanese"].join(" "));
      queries.push(["Pokemon", input.setCode, input.numberWithTotal, "Japanese"].join(" "));
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
