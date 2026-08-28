import { LANGUAGE_LABELS } from "@/lib/search-constants";
import type {
  CollectorCodeQuery,
  CollectorHeuristicFallback,
  PokemonCardJpDetail,
} from "@/lib/pokemon-tcg/api-types";
import type {
  CardLanguageCode,
  CardLanguageFilter,
  TcgCard,
} from "@/types/pokemon";

export const POKEMON_CARD_JP_BASE_URL = "https://www.pokemon-card.com";

const POKEMON_NAME_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "card",
  "ex",
  "forme",
  "form",
  "gx",
  "mega",
  "origin",
  "pokemon",
  "radiant",
  "star",
  "tag",
  "team",
  "the",
  "v",
  "vmax",
  "vstar",
]);

const COLLECTOR_HEURISTIC_FALLBACKS: CollectorHeuristicFallback[] = [
  {
    number: "100",
    printedTotal: 95,
    lucene: 'set.id:sm12 AND name:"Arceus & Dialga & Palkia"',
    notice:
      "Japanese Alter Genesis (SM12) lists 100/095 on the card; English Cosmic Eclipse uses the same Pok\u00e9mon TCG set id (sm12) with different card numbers. These listings are the same TAG TEAM trio\u2014pick the art that matches your copy.",
  },
];

export const OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS: Record<
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
    jpName: "アルセウス&ディアルガ&パルキアGX",
    rarity: "Super Rare",
    setCode: "SM12",
  },
  "017/027": {
    cardId: "31109",
    englishName: "Dialga",
    imagePath: "/assets/images/card_images/large/CP2/031109_P_DEIARUGA.jpg",
    jpName: "ディアルガ",
    rarity: "Rare Holo",
    setCode: "CP2",
  },
  "071/067": {
    cardId: "41654",
    englishName: "Origin Forme Palkia V",
    imagePath: "/assets/images/card_images/large/S10P/041654_P_ORIJINPARUKIAV.jpg",
    jpName: "オリジンパルキアV",
    rarity: "Super Rare",
    setCode: "S10P",
  },
  "071/092": {
    cardId: "19223",
    englishName: "Dialga",
    imagePath: "/assets/images/card_images/large/DPs-B/019223_P_DEIARUGA.gif",
    jpName: "ディアルガ",
    rarity: "Rare",
    setCode: "DPs-B",
  },
};

export const LOCALIZED_SET_ID_ALIASES: Partial<Record<CardLanguageCode, Record<string, string>>> = {
  en: {
    me2pt5: "me02.5",
    sv8pt5: "sv08.5",
    sv3pt5: "sv03.5",
    sv6pt5: "sv06.5",
  },
  ja: {
    rsv10pt5: "SV11W",
    sv10: "SV10",
    sv9: "SV9",
    zsv10pt5: "SV11B",
    sv3pt5: "SV2a",
    "sv03.5": "SV2a",
    cel25: "S8a",
    cel25c: "S8a",
    swsh8: "S8",
    swsh9: "S9",
    swsh10: "S10",
    swsh11: "S11",
    sv1: "SV1S",
    sv2: "SV2P",
    sv3: "SV3",
    sv4: "SV4K",
    sv5: "SV5K",
    sv6: "SV6",
    sv7: "SV7",
    sv8: "SV8",
  },
};

const JAPANESE_ENGLISH_COMPANION_SET_IDS: Record<string, string> = {
  SV11W: "sv10.5w",
  SV11B: "sv10.5b",
  // Do NOT map SV2A → sv03.5 by localId: JP 151 and EN 151 use different
  // collector-number layouts (e.g. JA #199 ≠ Charizard ex). English names for
  // SV2A must come from Japanese identity resolution, not EN set briefs.
};

const LOCALIZED_ALIAS_QUERY_LIMIT = 10;

export function normalizeSetCode(setId: string) {
  return setId.toUpperCase();
}

export function collectorHeuristicLookup(code: {
  number: string;
  printedTotal: number;
}): CollectorHeuristicFallback | undefined {
  return COLLECTOR_HEURISTIC_FALLBACKS.find(
    (item) => item.number === code.number && item.printedTotal === code.printedTotal,
  );
}

export function resolveEnglishCompanionSetId(setId?: string | null): string | null {
  if (!setId?.trim()) {
    return null;
  }

  return JAPANESE_ENGLISH_COMPANION_SET_IDS[setId.trim().toUpperCase()] ?? setId.trim();
}

export function isFullCollectorCode(
  collectorCode: CollectorCodeQuery,
): collectorCode is CollectorCodeQuery & { printedTotal: number } {
  return collectorCode.printedTotal != null && Number.isFinite(collectorCode.printedTotal);
}

const PROMO_SET_CODE_ALIASES: Record<string, string> = {
  SVP: "SV-P",
  "SV-P": "SV-P",
  SMP: "SM-P",
  "SM-P": "SM-P",
  SWSHP: "SWSH-P",
  "SWSH-P": "SWSH-P",
  XYP: "XY-P",
  "XY-P": "XY-P",
  SP: "S-P",
  "S-P": "S-P",
};

const ENGLISH_PROMO_SET_IDS: Record<string, string> = {
  "SV-P": "svp",
  "SM-P": "smp",
  "SWSH-P": "swshp",
  "XY-P": "xyp",
  "S-P": "sp",
};

export function normalizeCollectorSetCode(setCode: string) {
  const raw = setCode.trim().toUpperCase();
  return PROMO_SET_CODE_ALIASES[raw] ?? raw;
}

export function collectorSetCodeSearchKeys(setCode: string): string[] {
  const normalized = normalizeCollectorSetCode(setCode);
  const compact = normalized.replace(/-/g, "");
  const englishId = ENGLISH_PROMO_SET_IDS[normalized];

  return [
    ...new Set(
      [normalized, compact, compact.toLowerCase(), normalized.toLowerCase(), englishId].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
}

function unpadCollectorNumber(value: string) {
  return value.replace(/^0+(?=\d)/, "") || value;
}

export function parseCollectorCodeQuery(query: string): CollectorCodeQuery | null {
  const compact = query.trim().toUpperCase().replace(/\s+/g, "");

  if (!compact.includes("/")) {
    return null;
  }

  // TG06/TG30, GG01/GG70 — same letter prefix on both sides of the slash.
  const gallery = compact.match(/^([A-Z]+)(\d+)\/\1(\d{1,4})$/);

  if (gallery) {
    const rawNumber = `${gallery[1]}${gallery[2]}`;
    return {
      rawNumber,
      number: unpadCollectorNumber(rawNumber),
      printedTotal: Number.parseInt(gallery[3], 10),
    };
  }

  // Classic printed-total codes: 100/095, 017/027.
  const printed = compact.match(/^([A-Z]*\d+[A-Z]*)\/0*(\d{1,4})(?:[A-Z]+)?$/);

  if (printed) {
    return {
      rawNumber: printed[1],
      number: unpadCollectorNumber(printed[1]),
      printedTotal: Number.parseInt(printed[2], 10),
    };
  }

  // Promo / set codes: 288/SV-P, 017/CP2.
  const slashSet = compact.match(/^([A-Z]*\d+[A-Z]*)\/([A-Z]{1,8}(?:-[A-Z0-9]{1,4})?[A-Z0-9]*)$/);

  if (slashSet && /[A-Z]/.test(slashSet[2])) {
    return {
      rawNumber: slashSet[1],
      number: unpadCollectorNumber(slashSet[1]),
      setCode: normalizeCollectorSetCode(slashSet[2]),
    };
  }

  return null;
}

export function findCollectorCodeInQuery(query: string): {
  collectorCode: CollectorCodeQuery;
  nameQuery: string;
  matchedText: string;
} | null {
  const trimmed = query.trim();

  if (!trimmed) {
    return null;
  }

  const standalone = trimmed.replace(/\s*\/\s*/g, "/");
  const isStandaloneCode = /^[A-Za-z0-9-]*\d[A-Za-z0-9-]*\/[A-Za-z0-9-]+$/.test(standalone);

  if (isStandaloneCode) {
    const whole = parseCollectorCodeQuery(trimmed);

    if (whole) {
      return { collectorCode: whole, nameQuery: "", matchedText: trimmed };
    }
  }

  const tokenPattern = /([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z0-9][A-Za-z0-9-]{0,7})/g;

  for (const match of trimmed.matchAll(tokenPattern)) {
    if (match.index == null) {
      continue;
    }

    const parsed = parseCollectorCodeQuery(match[0].replace(/\s+/g, ""));

    if (!parsed) {
      continue;
    }

    const nameQuery = `${trimmed.slice(0, match.index)}${trimmed.slice(
      match.index + match[0].length,
    )}`
      .trim()
      .replace(/^[-:,]+|[-:,]+$/g, "")
      .trim();

    return { collectorCode: parsed, nameQuery, matchedText: match[0] };
  }

  return null;
}

export function collectorCodeConstrainsPrintedTotal(
  collectorCode: CollectorCodeQuery,
): collectorCode is CollectorCodeQuery & { printedTotal: number } {
  return (
    isFullCollectorCode(collectorCode) &&
    !isTrainerGalleryCollectorCode(collectorCode) &&
    !collectorCode.setCode
  );
}

export function isOrdinalCollectorToken(token: string) {
  return /^\d+(?:st|nd|rd|th)$/i.test(token.trim());
}

export function isTrainerGalleryCollectorCode(collectorCode: CollectorCodeQuery) {
  const raw = (collectorCode.rawNumber ?? collectorCode.number).toUpperCase();
  return /^(TG|GG)\d+$/i.test(raw);
}

export function parsePartialCollectorToken(token: string): CollectorCodeQuery | null {
  const compact = token.trim().replace(/^#/, "").toUpperCase();

  if (!compact || !/\d/.test(compact) || isOrdinalCollectorToken(compact)) {
    return null;
  }

  const match = compact.match(/^([A-Z]*\d+[A-Z]*)$/);

  if (!match) {
    return null;
  }

  const rawNumber = match[1];

  return {
    rawNumber,
    number: rawNumber.replace(/^0+(?=\d)/, "") || rawNumber,
  };
}

export function resolveEnglishCatalogSetFilterId(setFilter?: string) {
  const clean = setFilter?.trim();

  if (!clean) {
    return clean;
  }

  const lowered = clean.toLowerCase();

  for (const [englishId, localizedId] of Object.entries(LOCALIZED_SET_ID_ALIASES.ja ?? {})) {
    if (localizedId.toLowerCase() === lowered) {
      return englishId;
    }
  }

  const directEnglishAlias = LOCALIZED_SET_ID_ALIASES.en?.[lowered];

  if (directEnglishAlias) {
    return directEnglishAlias;
  }

  return clean;
}

export function resolvePokemonTcgApiSetFilterId(setFilter?: string) {
  const resolved = resolveEnglishCatalogSetFilterId(setFilter);

  if (!resolved) {
    return resolved;
  }

  const lowered = resolved.toLowerCase();

  for (const [pokemonTcgId, tcgdxId] of Object.entries(LOCALIZED_SET_ID_ALIASES.en ?? {})) {
    if (tcgdxId.toLowerCase() === lowered) {
      return pokemonTcgId;
    }
  }

  return resolved;
}

export function collectorCodeDisplayLabel(collectorCode: CollectorCodeQuery) {
  if (collectorCode.setCode) {
    return `${collectorCode.rawNumber ?? collectorCode.number}/${collectorCode.setCode}`;
  }

  if (isFullCollectorCode(collectorCode) && isTrainerGalleryCollectorCode(collectorCode)) {
    const raw = collectorCode.rawNumber ?? collectorCode.number;
    const prefix = raw.replace(/\d+$/, "");
    return `${raw}/${prefix}${String(collectorCode.printedTotal).padStart(2, "0")}`;
  }

  if (isFullCollectorCode(collectorCode)) {
    return collectorCodeLabel(collectorCode);
  }

  return `#${collectorCode.rawNumber ?? collectorCode.number}`;
}

export function collectorNumberMatchesCode(
  cardNumber: string,
  collectorCode: CollectorCodeQuery,
) {
  const normalizedCard = cardNumber.replace(/^0+(?=\d)/, "").toUpperCase();
  const raw = (collectorCode.rawNumber ?? collectorCode.number).toUpperCase();
  const targets = new Set(
    [
      collectorCode.number.toUpperCase(),
      raw,
      raw.replace(/^0+(?=\d)/, ""),
      collectorCode.number.padStart(3, "0"),
      collectorCode.number.padStart(4, "0"),
    ].filter(Boolean),
  );

  return (
    targets.has(normalizedCard) ||
    targets.has(cardNumber.toUpperCase()) ||
    targets.has(cardNumber.replace(/^0+(?=\d)/, "").toUpperCase())
  );
}

export function collectorDetailMatchesCode(
  detail: PokemonCardJpDetail,
  collectorCode: CollectorCodeQuery,
) {
  if (!collectorNumberMatchesCode(detail.collectorNumber, collectorCode)) {
    return false;
  }

  if (!isFullCollectorCode(collectorCode)) {
    return true;
  }

  return detail.printedTotal === collectorCode.printedTotal;
}

export function collectorCardMatchesNameHint(
  card: TcgCard,
  nameQuery: string,
  aliases: string[] = [],
) {
  const cleanNameQuery = nameQuery.trim();

  if (!cleanNameQuery) {
    return true;
  }

  const searchableText = [
    card.name,
    card.localizedName,
    card.englishName,
    card.setName,
    card.setEnglishName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    textMatchesQuery(searchableText, cleanNameQuery) ||
    aliases.some(
      (alias) =>
        alias.trim() &&
        (textMatchesQuery(card.localizedName ?? "", alias) ||
          textMatchesQuery(card.englishName ?? "", alias) ||
          textMatchesQuery(card.name, alias)),
    )
  );
}

export function collectorCodeLabel(
  collectorCode: CollectorCodeQuery & { printedTotal: number },
) {
  return `${collectorCode.rawNumber ?? collectorCode.number}/${String(collectorCode.printedTotal).padStart(3, "0")}`;
}

export function collectorCodeLabelVariants(
  collectorCode: CollectorCodeQuery & { printedTotal: number },
) {
  const rawNumber = collectorCode.rawNumber ?? collectorCode.number;
  const paddedNumber = rawNumber.padStart(3, "0");
  const paddedTotal = String(collectorCode.printedTotal).padStart(3, "0");
  const plainTotal = String(collectorCode.printedTotal);

  return [
    collectorCodeLabel(collectorCode),
    `${rawNumber}/${paddedTotal}`,
    `${paddedNumber}/${paddedTotal}`,
    `${collectorCode.number}/${paddedTotal}`,
    `${collectorCode.number}/${plainTotal}`,
    `${paddedNumber}/${plainTotal}`,
    `${rawNumber}/${plainTotal}`,
  ];
}

export function lookupOfficialJpCollectorFallback(
  collectorCode: CollectorCodeQuery,
) {
  if (!isFullCollectorCode(collectorCode)) {
    return null;
  }

  for (const label of collectorCodeLabelVariants(collectorCode)) {
    const fallback = OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS[label];

    if (fallback) {
      return fallback;
    }
  }

  return null;
}

export function lookupOfficialJpCollectorFallbackByPartial(
  collectorCode: CollectorCodeQuery,
  nameQuery: string,
) {
  const cleanNameQuery = nameQuery.trim();

  if (!cleanNameQuery) {
    return null;
  }

  for (const [label, fallback] of Object.entries(OFFICIAL_JP_COLLECTOR_CODE_FALLBACKS)) {
    const [numberPart] = label.split("/");
    const partialFromLabel = parsePartialCollectorToken(numberPart);

    if (!partialFromLabel || !collectorNumberMatchesCode(numberPart, collectorCode)) {
      continue;
    }

    const searchable = [fallback.englishName, fallback.jpName].filter(Boolean).join(" ");

    if (!textMatchesQuery(searchable, cleanNameQuery)) {
      continue;
    }

    const fullCode = parseCollectorCodeQuery(label);

    if (!fullCode) {
      continue;
    }

    return { fallback, fullCode };
  }

  return null;
}

export function collectorCodeMatchesSetFilter(
  card: TcgCard,
  setFilter: string,
) {
  const setKey = setFilter.trim().toUpperCase();
  const candidates = [
    card.setCode,
    card.setId,
    card.setEnglishName,
    card.setName,
    card.setLocalizedName,
  ]
    .filter(Boolean)
    .map((value) => value!.trim().toUpperCase());

  return candidates.some(
    (candidate) =>
      candidate === setKey ||
      candidate.includes(setKey) ||
      setKey.includes(candidate),
  );
}

export function normalizeSearchText(value: string) {
  return normalizeWhitespace(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "");
}

export function textMatchesQuery(text: string, query: string) {
  const normalizedText = normalizeSearchText(text);
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);

  return terms.length > 0 && terms.every((term) => normalizedText.includes(term));
}

export function localizedNameSearchVariants(
  aliases: string[],
  query: string,
  language: CardLanguageCode,
) {
  const variants = new Set(aliases);

  if (language !== "ja" && language !== "zh-cn" && language !== "zh-tw") {
    return [...variants].slice(0, LOCALIZED_ALIAS_QUERY_LIMIT);
  }

  const normalizedQuery = normalizeSearchText(query);
  const suffixes = ["ex", "EX", "GX", "V", "VMAX", "VSTAR"];

  for (const alias of aliases.slice(0, 3)) {
    for (const suffix of suffixes) {
      variants.add(`${alias}${suffix}`);
    }

    if (language === "ja" && normalizedQuery.includes("origin")) {
      variants.add(`オリジン${alias}`);
      variants.add(`オリジン${alias}V`);
      variants.add(`オリジン${alias}VSTAR`);
    }
  }

  return [...variants].slice(0, LOCALIZED_ALIAS_QUERY_LIMIT);
}

export function pokemonSpeciesQueryTerms(query: string) {
  return [
    ...new Set(
      normalizeSearchText(query)
        .replace(/&/g, " ")
        .replace(/[^a-z0-9\s-]+/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(
          (term) =>
            term.length > 1 &&
            !POKEMON_NAME_QUERY_STOP_WORDS.has(term) &&
            !/^\d+$/.test(term),
        ),
    ),
  ].slice(0, 6);
}

export function buildLocalizedSlug(language: CardLanguageCode, id: string) {
  return language === "en" ? id : `${language}--${id}`;
}

export function parseLocalizedSlug(slug: string) {
  const separatorIndex = slug.indexOf("--");

  if (separatorIndex === -1) {
    return { language: "en" as CardLanguageCode, id: slug };
  }

  const language = slug.slice(0, separatorIndex) as CardLanguageCode;
  const id = slug.slice(separatorIndex + 2);

  if (!(language in LANGUAGE_LABELS) || !id) {
    return { language: "en" as CardLanguageCode, id: slug };
  }

  return { language, id };
}

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const value = Number.parseInt(hex, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function normalizeWhitespace(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

export function stripHtml(value: string) {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

export function absolutePokemonCardJpUrl(path?: string | null) {
  if (!path) {
    return "";
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${POKEMON_CARD_JP_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatBilingualName(localizedName: string, englishName?: string | null) {
  const cleanLocalizedName = normalizeWhitespace(localizedName);
  const cleanEnglishName = englishName ? normalizeWhitespace(englishName) : "";

  if (
    !cleanEnglishName ||
    cleanEnglishName.toLowerCase() === cleanLocalizedName.toLowerCase()
  ) {
    return cleanLocalizedName;
  }

  return `${cleanLocalizedName} (${cleanEnglishName})`;
}

export function resolveLocalizedSetFilterId(
  language: CardLanguageCode,
  setFilter?: string,
) {
  const clean = setFilter?.trim();

  if (!clean) {
    return "";
  }

  const alias = LOCALIZED_SET_ID_ALIASES[language]?.[clean.toLowerCase()];

  if (alias) {
    return alias;
  }

  if (language === "ja" && /^[a-z0-9.]+$/.test(clean) && clean === clean.toLowerCase()) {
    return clean.toUpperCase();
  }

  return clean;
}

export function buildTcgdexSetIdCandidate(setId: string) {
  const normalized = setId.trim().toLowerCase();
  const alias = LOCALIZED_SET_ID_ALIASES.en?.[normalized];

  if (alias) {
    return alias;
  }

  return buildTcgdexSetIdCandidateFromEnglishSetId(normalized) ?? normalized;
}

export function buildTcgdexSetIdCandidateFromEnglishSetId(setFilter: string) {
  const trimmed = setFilter.trim();
  const normalized = trimmed.toLowerCase();
  const pt5Match = normalized.match(/^([a-z]+)(\d+)pt5$/);

  if (pt5Match) {
    const [, prefix, number] = pt5Match;
    return `${prefix}${number.padStart(2, "0")}.5`;
  }

  // Pokemon TCG API uses compact ids (me5, sv8). TCGdex zero-pads (me05, sv08).
  // Only rewrite already-lowercase English ids so JP codes like M5 stay intact.
  if (trimmed === normalized) {
    const paddedMatch = normalized.match(/^([a-z]+)(\d+)$/);

    if (paddedMatch) {
      const [, prefix, number] = paddedMatch;

      if (number.length === 1) {
        return `${prefix}${number.padStart(2, "0")}`;
      }
    }
  }

  return null;
}
