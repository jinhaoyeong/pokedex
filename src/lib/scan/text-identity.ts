/**
 * Text-first scan identity: OCR / PSA label → live catalog lookup.
 * Visual index is optional confirmation, not a hard dependency.
 */

import { fuzzyNameScore, type ParsedOcrText } from "@/lib/scan/ocr";
import { compareCollectorNumbers } from "@/lib/scan/identity-evidence";
import type {
  CardLanguageCode,
  CardLanguageFilter,
  SearchResult,
  TcgCard,
} from "@/types/pokemon";

/** Latin OCR should hit the English catalog first. `all` fans out and often times out empty. */
export function textIdentitySearchLanguages(
  languageHints: CardLanguageCode[] = [],
): CardLanguageFilter[] {
  const primary = languageHints[0];
  if (primary === "ja") {
    return ["ja", "all"];
  }
  if (primary === "zh-cn") {
    return ["zh-cn", "en", "all"];
  }
  if (primary === "zh-tw") {
    return ["zh-tw", "en", "all"];
  }
  return ["en", "all"];
}

export type ScanTextIdentity = {
  names: string[];
  number?: string;
  suffix?: string;
  /** Human set titles from PSA labels / captions ("VMAX Climax"). */
  setHints: string[];
  /** Compact set codes from footer OCR or PSA aliases ("S8b", "S10P"). */
  setCodes: string[];
  languageHints: CardLanguageCode[];
  lines: string[];
};

/** English PSA / listing set titles → catalog set ids worth trying. */
const PSA_SET_ALIASES: Array<{ pattern: RegExp; codes: string[] }> = [
  { pattern: /\bteam\s*rocket\b/i, codes: ["base5"] },
  { pattern: /\bbase\s*set\s*2\b/i, codes: ["base4"] },
  { pattern: /\bbase\s*set\b/i, codes: ["base1"] },
  { pattern: /\bjungle\b/i, codes: ["base2"] },
  { pattern: /\bfossil\b/i, codes: ["base3"] },
  { pattern: /\bgym\s*heroes\b/i, codes: ["gym1"] },
  { pattern: /\bgym\s*challenge\b/i, codes: ["gym2"] },
  { pattern: /\bneo\s*genesis\b/i, codes: ["neo1"] },
  { pattern: /\bneo\s*discovery\b/i, codes: ["neo2"] },
  { pattern: /\bneo\s*revelation\b/i, codes: ["neo3"] },
  { pattern: /\bneo\s*destiny\b/i, codes: ["neo4"] },
  { pattern: /\bvmax\s*climax\b/i, codes: ["S8b", "S8B"] },
  { pattern: /\bspace\s*juggler\b/i, codes: ["S10P"] },
  { pattern: /\btime\s*gazer\b/i, codes: ["S10D"] },
  { pattern: /\bvstar\s*universe\b/i, codes: ["S12a", "S12A"] },
  { pattern: /\bultra\s*prism\b/i, codes: ["sm5", "SM5"] },
  { pattern: /\bstormfront\b/i, codes: ["dp7", "DP07"] },
  { pattern: /\bgalactic'?s?\s*conquest\b/i, codes: ["pt1", "Pt1"] },
  { pattern: /\blegendary\s*shine\b/i, codes: ["CP2"] },
  { pattern: /\bbrilliant\s*stars\b/i, codes: ["swsh9"] },
  { pattern: /\bastral\s*radiance\b/i, codes: ["swsh10"] },
  { pattern: /\blegendary\s*treasures\b/i, codes: ["bw11"] },
  { pattern: /\bmovie\s*e?promo\b/i, codes: ["basep"] },
  { pattern: /\bshadowless\b/i, codes: ["base1"] },
  { pattern: /\bpokemon\s*game\b/i, codes: ["base1"] },
  { pattern: /\bwizards\s*black\s*star\b/i, codes: ["basep"] },
  { pattern: /\bpokemon\s*card\s*membership\b/i, codes: ["SV-P"] },
  { pattern: /\bcrown\s*zenith\b/i, codes: ["swsh12pt5", "swsh12.5"] },
];

const SET_CODE_PATTERN =
  /\b((?:SV|SM|XY|BW|DP|PL|HGSS|SWSH|ME)?\d{0,2}[A-Za-z]{0,3}|[A-Z]{1,3}\d{1,2}[A-Za-z]?)\b/g;

export function extractSetHintsFromText(text: string): {
  setHints: string[];
  setCodes: string[];
} {
  const setHints: string[] = [];
  const setCodes: string[] = [];
  const seenHint = new Set<string>();
  const seenCode = new Set<string>();

  for (const alias of PSA_SET_ALIASES) {
    const match = text.match(alias.pattern);
    if (!match) continue;
    const hint = match[0].replace(/\s+/g, " ").trim();
    const hintKey = hint.toLocaleLowerCase();
    if (!seenHint.has(hintKey)) {
      seenHint.add(hintKey);
      setHints.push(hint);
    }
    for (const code of alias.codes) {
      const key = code.toUpperCase();
      if (seenCode.has(key)) continue;
      seenCode.add(key);
      setCodes.push(code);
    }
  }

  // Footer / caption codes such as "s8b", "S10P", "sv3".
  for (const match of text.matchAll(SET_CODE_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    // Reject pure years and very short noise.
    if (/^\d{4}$/.test(raw)) continue;
    if (raw.length < 2 || raw.length > 6) continue;
    if (!/[A-Za-z]/.test(raw) || !/\d/.test(raw)) continue;
    const key = raw.toUpperCase();
    if (seenCode.has(key)) continue;
    seenCode.add(key);
    setCodes.push(raw);
  }
  for (const match of text.matchAll(/\bSV-?P\b/gi)) {
    const raw = match[0];
    const key = raw.toUpperCase();
    if (seenCode.has(key) || seenCode.has("SV-P") || seenCode.has("SVP")) continue;
    seenCode.add("SV-P");
    setCodes.push("SV-P");
  }

  return { setHints, setCodes };
}

export function buildScanTextIdentity(input: {
  parsed?: ParsedOcrText | null;
  languageHints?: CardLanguageCode[];
  extraNames?: string[];
  extraLines?: string[];
}): ScanTextIdentity {
  const lines = [
    ...(input.parsed?.lines ?? []),
    ...(input.extraLines ?? []),
  ].filter(Boolean);
  const blob = lines.join("\n");
  const fromText = extractSetHintsFromText(blob);
  const names = Array.from(
    new Set(
      [
        ...(input.extraNames ?? []),
        ...(input.parsed?.nameCandidates ?? []),
      ]
        .map((name) => name.trim())
        .filter((name) => name.length >= 2),
    ),
  );

  return {
    names,
    number: input.parsed?.number,
    suffix: input.parsed?.suffix,
    setHints: Array.from(
      new Set([...(input.parsed?.setHints ?? []), ...fromText.setHints]),
    ),
    setCodes: Array.from(
      new Set([...(input.parsed?.setCodes ?? []), ...fromText.setCodes]),
    ),
    languageHints: input.languageHints ?? [],
    lines,
  };
}

export function scoreNameAgainstCard(names: string[], card: TcgCard): number {
  if (!names.length) return 0;
  let best = 0;
  for (const name of names) {
    best = Math.max(
      best,
      fuzzyNameScore(name, card.name),
      fuzzyNameScore(name, card.englishName ?? ""),
      fuzzyNameScore(name, card.localizedName ?? ""),
    );
    if (best >= 1) break;
  }
  return best;
}

export function scoreSetAgainstCard(
  identity: ScanTextIdentity,
  card: TcgCard,
): number {
  const cardSetCode = (card.setCode || card.setId || "").toUpperCase();
  const cardSetName = `${card.setName ?? ""} ${card.setEnglishName ?? ""}`.toLowerCase();

  for (const code of identity.setCodes) {
    const normalized = code.toUpperCase();
    if (!normalized) continue;
    if (cardSetCode === normalized) return 1;
    if (cardSetCode.replace(/[^A-Z0-9]/g, "") === normalized.replace(/[^A-Z0-9]/g, "")) {
      return 0.96;
    }
    if (card.id.toUpperCase().startsWith(`${normalized}-`)) return 0.9;
  }

  for (const hint of identity.setHints) {
    const key = hint.toLowerCase();
    if (key.length >= 4 && cardSetName.includes(key)) return 0.88;
  }
  return 0;
}

export function scoreCatalogAgainstTextIdentity(
  identity: ScanTextIdentity,
  result: SearchResult,
): {
  total: number;
  nameScore: number;
  collectorScore: number;
  setScore: number;
  languageScore: number;
} {
  const card = result.card;
  const nameScore = scoreNameAgainstCard(identity.names, card);
  const collector = compareCollectorNumbers(identity.number, card.collectorNumber, {
    setCode: card.setCode,
    setPrintedTotal: card.setPrintedTotal,
  });
  const setScore = scoreSetAgainstCard(identity, card);
  const languageScore = identity.languageHints.length
    ? identity.languageHints.some((hint) => hint === card.language)
      ? 1
      : 0.15
    : 0.55;

  // Text identity should be able to win without artwork. Name+number is enough
  // for a high score; set/language refine among reprints.
  let total =
    nameScore * 0.42 +
    collector.score * 0.32 +
    setScore * 0.16 +
    languageScore * 0.1;

  if (nameScore >= 0.9 && collector.score >= 0.85) {
    total = Math.max(total, 0.86 + setScore * 0.08 + languageScore * 0.04);
  }
  if (nameScore >= 0.9 && setScore >= 0.88 && collector.score >= 0.85) {
    total = Math.max(total, 0.93);
  }
  if (nameScore >= 0.9 && !identity.number && setScore >= 0.88) {
    total = Math.max(total, 0.74);
  }

  return {
    total: Math.max(0, Math.min(1, total)),
    nameScore,
    collectorScore: collector.score,
    setScore,
    languageScore,
  };
}

/** True when text alone is strong enough to shortlist / accept a print. */
export function isActionableTextIdentity(identity: ScanTextIdentity): boolean {
  if (!identity.names.length) return false;
  if (identity.number) return true;
  if (identity.setCodes.length || identity.setHints.length) return true;
  // Bare name still worth a live-search attempt.
  return identity.names[0].length >= 3;
}

export function isResolvedTextIdentity(
  identity: ScanTextIdentity,
  scores: { nameScore: number; collectorScore: number; setScore: number },
): boolean {
  if (scores.nameScore >= 0.9 && scores.collectorScore >= 0.85) return true;
  if (
    scores.nameScore >= 0.9 &&
    scores.collectorScore >= 0.7 &&
    scores.setScore >= 0.85
  ) {
    return true;
  }
  return false;
}
