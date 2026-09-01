/**
 * Unified scan identity evidence: structured collector numbers, script/language
 * hints, and weighted fusion so OCR name hits cannot unconditionally override
 * stronger visual matches.
 */

import { fuzzyNameScore } from "@/lib/scan/ocr";
import type { ScanMatch, VisualIndexHit } from "@/lib/scan/types";
import type { CardLanguageCode, SearchResult, TcgCard } from "@/types/pokemon";

export type ScriptHint =
  | "latin"
  | "japanese"
  | "korean"
  | "chinese"
  | "mixed"
  | "unknown";

export type CollectorMatchTier =
  | "exact_raw"
  | "prefix_primary"
  | "primary_denominator"
  | "primary_only"
  | "none";

export interface ParsedCollectorNumber {
  raw: string;
  prefix?: string;
  primary?: string;
  denominator?: string;
}

export interface CollectorCandidateContext {
  setCode?: string;
  setPrintedTotal?: number;
}

export interface IdentityMatchFlags {
  exactName: boolean;
  nameAndNumber: boolean;
  languageMatch: boolean;
  /** Name + collector + (language | set | strong visual) agreement. */
  resolvedIdentity: boolean;
}

export interface EvidenceScoreBreakdown {
  visualScore: number;
  clipScore: number;
  nameScore: number;
  collectorScore: number;
  languageScore: number;
  geometryQuality: number;
  agreementBonus: number;
  conflictPenalty: number;
  finalScore: number;
  flags: IdentityMatchFlags;
}

const VISUAL_WEIGHT = 0.34;
const CLIP_WEIGHT = 0.22;
const NAME_WEIGHT = 0.18;
const COLLECTOR_WEIGHT = 0.14;
const LANGUAGE_WEIGHT = 0.08;
const QUALITY_WEIGHT = 0.04;

const COLLECTOR_TIER_SCORE: Record<CollectorMatchTier, number> = {
  exact_raw: 1,
  prefix_primary: 0.92,
  primary_denominator: 0.88,
  primary_only: 0.35,
  none: 0,
};

export function normalizeIdentityName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripLeadingZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, "") || value;
}

/** Parse collector numbers such as 125/108, SV3 125, TG05/TG30, SWSH262. */
export function parseCollectorNumber(rawInput: string): ParsedCollectorNumber {
  const raw = rawInput.trim().replace(/\s+/g, " ");
  if (!raw) return { raw: "" };

  // Set-prefixed forms such as "SV3 125" (letters + optional trailing set digits).
  const spaced = raw.match(/^([A-Za-z]{1,6}\d{0,3})\s+(\d{1,4}[A-Za-z]?)$/i);
  if (spaced) {
    return {
      raw,
      prefix: spaced[1].toUpperCase(),
      primary: stripLeadingZeros(spaced[2].toUpperCase()),
    };
  }

  const fraction = raw.match(
    /^([A-Za-z]{0,6})(\d{1,4}[A-Za-z]?)\s*\/\s*([A-Za-z]{0,6})(\d{1,4}[A-Za-z]?)$/i,
  );
  if (fraction) {
    const leftPrefix = fraction[1]?.toUpperCase() || undefined;
    const rightPrefix = fraction[3]?.toUpperCase() || undefined;
    return {
      raw,
      prefix: leftPrefix || rightPrefix,
      primary: stripLeadingZeros(`${fraction[1] ?? ""}${fraction[2]}`.toUpperCase()),
      denominator: stripLeadingZeros(
        `${fraction[3] ?? ""}${fraction[4]}`.toUpperCase(),
      ),
    };
  }

  const promo = raw.match(/^([A-Za-z]{1,6})[-_]?(\d{1,4}[A-Za-z]?)$/);
  if (promo) {
    return {
      raw,
      prefix: promo[1].toUpperCase(),
      primary: stripLeadingZeros(promo[2].toUpperCase()),
    };
  }

  const digits = raw.match(/^(\d{1,4}[A-Za-z]?)$/);
  if (digits) {
    return { raw, primary: stripLeadingZeros(digits[1].toUpperCase()) };
  }

  return { raw, primary: stripLeadingZeros(raw.toUpperCase()) };
}

function compareCollectorNumberPair(
  queryRaw: string | undefined,
  candidateRaw: string | undefined,
): { tier: CollectorMatchTier; score: number } {
  if (!queryRaw?.trim() || !candidateRaw?.trim()) {
    return { tier: "none", score: 0 };
  }

  const query = parseCollectorNumber(queryRaw);
  const candidate = parseCollectorNumber(candidateRaw);

  const normalizeRaw = (value: string) =>
    value.toUpperCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");

  if (normalizeRaw(query.raw) && normalizeRaw(query.raw) === normalizeRaw(candidate.raw)) {
    return { tier: "exact_raw", score: COLLECTOR_TIER_SCORE.exact_raw };
  }

  if (
    query.prefix &&
    query.primary &&
    candidate.prefix === query.prefix &&
    candidate.primary === query.primary
  ) {
    return { tier: "prefix_primary", score: COLLECTOR_TIER_SCORE.prefix_primary };
  }

  if (
    query.primary &&
    query.denominator &&
    candidate.primary === query.primary &&
    candidate.denominator === query.denominator
  ) {
    return {
      tier: "primary_denominator",
      score: COLLECTOR_TIER_SCORE.primary_denominator,
    };
  }

  // Compare bare primary digits even when one side is prefixed (SV3 125 vs 125).
  const queryPrimaryBare = query.primary?.replace(/^[A-Z]+/, "") || query.primary;
  const candidatePrimaryBare =
    candidate.primary?.replace(/^[A-Z]+/, "") || candidate.primary;
  if (
    queryPrimaryBare &&
    candidatePrimaryBare &&
    stripLeadingZeros(queryPrimaryBare) === stripLeadingZeros(candidatePrimaryBare)
  ) {
    return { tier: "primary_only", score: COLLECTOR_TIER_SCORE.primary_only };
  }

  return { tier: "none", score: 0 };
}

/**
 * Compare OCR collector evidence with both the card number and its set context.
 * Catalog cards commonly store only the numerator ("125"), while the printed
 * card can expose the full form ("125/108") or a set-prefixed form ("SV3 125").
 */
export function compareCollectorNumbers(
  queryRaw: string | undefined,
  candidateRaw: string | undefined,
  context: CollectorCandidateContext = {},
): { tier: CollectorMatchTier; score: number } {
  if (!queryRaw?.trim() || !candidateRaw?.trim()) {
    return { tier: "none", score: 0 };
  }

  const variants = new Set<string>([candidateRaw.trim()]);
  const parsedCandidate = parseCollectorNumber(candidateRaw);
  const printedTotal =
    typeof context.setPrintedTotal === "number" &&
    Number.isFinite(context.setPrintedTotal) &&
    context.setPrintedTotal > 0
      ? String(Math.trunc(context.setPrintedTotal))
      : "";

  if (printedTotal) {
    variants.add(`${candidateRaw.trim()}/${printedTotal}`);
    if (parsedCandidate.prefix) {
      variants.add(
        `${candidateRaw.trim()}/${parsedCandidate.prefix}${printedTotal}`,
      );
    }
  }

  const setCode = context.setCode?.trim();
  if (setCode && parsedCandidate.primary) {
    const primary = parsedCandidate.primary.replace(/^[A-Z]+/, "");
    if (primary) {
      variants.add(`${setCode} ${primary}`);
      variants.add(`${setCode}-${primary}`);
      variants.add(`${setCode}${primary}`);
    }
  }

  let best: { tier: CollectorMatchTier; score: number } = {
    tier: "none",
    score: 0,
  };
  for (const variant of variants) {
    const comparison = compareCollectorNumberPair(queryRaw, variant);
    if (comparison.score > best.score) best = comparison;
  }
  return best;
}

function countScript(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function kanaCount(text: string): number {
  return countScript(text, /[\u3040-\u30ff]/gu);
}

/** Printed JPN label or enough kana that Tesseract did not invent a glyph. */
export function hasStrongJapanesePrint(ocrText: string): boolean {
  return /JPN|JAPANESE/i.test(ocrText) || kanaCount(ocrText) >= 3;
}

export function inferScriptHint(ocrText: string): ScriptHint {
  const kana = kanaCount(ocrText);
  const cjk = countScript(ocrText, /[\u3400-\u9fff]/gu);
  const hangul = countScript(ocrText, /[\uac00-\ud7af]/gu);
  const latin = countScript(ocrText, /[A-Za-z]/g);
  const japaneseChars = kana + cjk;

  // Pixelated English OCR invents 1–2 CJK glyphs. Real JP cards produce kana
  // runs or enough ideographs to outnumber Latin body text.
  const hasJapanese =
    kana >= 3 || (japaneseChars >= 6 && japaneseChars >= latin);
  const hasKorean = hangul >= 2;
  const hasChineseExclusive =
    cjk >= 3 && kana === 0 && hangul === 0 && cjk >= latin;
  const hasLatin = latin >= 3;

  if (hasJapanese) return "japanese";
  if (hasKorean) return "korean";
  if (hasChineseExclusive) return "chinese";
  if (hasLatin) return "latin";
  if (japaneseChars > 0) return "japanese";
  if (hangul > 0) return "korean";
  return "unknown";
}

/**
 * Cheap language preferences from OCR script. Latin does NOT imply English —
 * French/German/Italian/Spanish/Portuguese share the script.
 */
const JAPANESE_PRINT_LABEL =
  /JPN(?:[\s.]*)?(?:SWSH|SM|SV|XY|BW)?|\bJPN\b|\bJAPANESE\b|\bJP\b/i;
/** Japanese SWSH/SV/SM footer codes (`s8b`, `SV4a`, `SM12a`). */
const JAPANESE_SET_CODE =
  /\b(?:S\d{1,2}[A-Z]|SV\d{1,2}[A-Z]|SM\d{1,2}[A-Z]|M\d{1,2}[A-Z])\b/i;

export type InferLanguageHintOptions = {
  /**
   * Pixelated OCR invents CJK glyphs and `S8b`-like tokens. Only treat the
   * scan as Japanese when the printed JPN label is present or kana is solid.
   */
  requireStrongScript?: boolean;
};

export function inferLanguageHints(
  scriptHint: ScriptHint,
  ocrText = "",
  options: InferLanguageHintOptions = {},
): CardLanguageCode[] {
  // Graded-slab labels print "JPN" / "JAPANESE" / "JPN.SWSH" in Latin even when
  // the card face itself is unreadable under glare — treat that as a hard JA hint.
  // OCR often concatenates the era (`JPNSWSH`) so word-boundaries alone miss it.
  if (/JPN|JAPANESE/i.test(ocrText)) {
    return ["ja"];
  }
  if (
    !options.requireStrongScript &&
    (JAPANESE_PRINT_LABEL.test(ocrText) || JAPANESE_SET_CODE.test(ocrText))
  ) {
    return ["ja"];
  }
  if (options.requireStrongScript) {
    if (kanaCount(ocrText) >= 3) return ["ja"];
    if (scriptHint === "korean" && /[\uac00-\ud7af]{2,}/u.test(ocrText)) {
      return ["ko"];
    }
    return [];
  }
  if (/\b(?:CS|CHS|SCHINESE)\b|\bsimplified\s*chinese\b/i.test(ocrText)) {
    return ["zh-cn"];
  }
  if (/\b(?:CT|CHT|TCHINESE)\b|\btraditional\s*chinese\b/i.test(ocrText)) {
    return ["zh-tw"];
  }
  if (scriptHint === "japanese") return ["ja"];
  if (scriptHint === "korean") return ["ko"];
  if (scriptHint === "chinese") return ["zh-tw"];
  if (scriptHint === "mixed") {
    const hints: CardLanguageCode[] = [];
    if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(ocrText)) hints.push("ja");
    if (/[\uac00-\ud7af]/u.test(ocrText)) hints.push("ko");
    return hints;
  }
  return [];
}

export function languageAgreementScore(
  cardLanguage: string | undefined,
  languageHints: CardLanguageCode[],
  scriptHint: ScriptHint,
): number {
  if (!cardLanguage) return 0.5;
  const lang = cardLanguage.toLowerCase();

  if (languageHints.length) {
    if (languageHints.some((hint) => hint.toLowerCase() === lang)) return 1;
    // Soft mismatch — never a hard filter when OCR confidence is low.
    return 0.15;
  }

  if (scriptHint === "japanese") {
    return lang === "ja" ? 1 : 0.2;
  }
  if (scriptHint === "korean") {
    return lang === "ko" ? 1 : 0.2;
  }
  if (scriptHint === "chinese") {
    return lang.startsWith("zh") ? 1 : 0.25;
  }
  // Latin / unknown: do not push English over other Latin-script catalogs.
  return 0.55;
}

export type PrintedIdentitySignals = {
  number?: string;
  languageHints?: CardLanguageCode[];
};

/**
 * Same illustration, different print: English Trainer Gallery vs Japanese CSR,
 * and any other localized reprint of the same art. True when the visual index
 * hit cannot be the scanned print.
 */
export function visualPrintConflictsWithPrintedIdentity(
  hit:
    | {
        lang?: string | null;
        localId?: string | null;
      }
    | null
    | undefined,
  printed: PrintedIdentitySignals,
): boolean {
  if (!hit) return false;
  const hitLang = (hit.lang || "en").toLowerCase();
  const hinted = printed.languageHints?.[0]?.toLowerCase();
  if (hinted && hinted !== hitLang) return true;
  if (printed.number && hit.localId) {
    const { score } = compareCollectorNumbers(printed.number, hit.localId);
    if (score < 0.7) return true;
  }
  return false;
}

/**
 * Camera/slab scans can land a 0.9 English art hash of a Japanese print.
 * Only skip OCR when printed language/number agrees with that hash.
 */
export function canAcceptFastVisualIdentity(
  hit:
    | {
        lang?: string | null;
        localId?: string | null;
      }
    | null
    | undefined,
  printed: PrintedIdentitySignals | null,
  options: { includePsaLabel?: boolean; verifyText?: boolean },
): boolean {
  if (!hit) return false;
  if (options.includePsaLabel) {
    if (!printed) return false;
    const hasPrintSignal =
      Boolean(printed.number?.trim()) || Boolean(printed.languageHints?.[0]);
    if (!hasPrintSignal) return false;
    return !visualPrintConflictsWithPrintedIdentity(hit, printed);
  }
  if (
    options.verifyText &&
    printed &&
    visualPrintConflictsWithPrintedIdentity(hit, printed)
  ) {
    return false;
  }
  return true;
}

/**
 * When the visual leader is the English same-art twin of a Japanese (or
 * number-mismatched) scan, live-search that language instead of CLIP-neighbors
 * from a sparse JA visual index.
 */
export function sameArtLanguageToExpand(
  leaderLanguage: string | undefined,
  languageHints: CardLanguageCode[],
  printedNumber?: string,
  leaderCollectorNumber?: string,
): CardLanguageCode | null {
  const leaderLang = (leaderLanguage || "en").toLowerCase();
  const hint = languageHints[0];
  if (hint && hint !== leaderLang) return hint;
  if (
    printedNumber &&
    leaderCollectorNumber &&
    compareCollectorNumbers(printedNumber, leaderCollectorNumber).score < 0.7 &&
    leaderLang === "en" &&
    (!hint || hint === "ja")
  ) {
    return "ja";
  }
  return null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function scoreNameAgreement(
  ocrNames: string[],
  cardName: string,
  englishName?: string,
  localizedName?: string,
): number {
  if (!ocrNames.length) return 0;
  const targets = [cardName, localizedName ?? "", englishName ?? ""]
    .map(normalizeIdentityName)
    .filter(Boolean);
  if (!targets.length) return 0;

  let best = 0;
  for (const candidate of ocrNames) {
    const normalized = normalizeIdentityName(candidate);
    if (!normalized) continue;
    for (const target of targets) {
      if (normalized === target) {
        best = 1;
        break;
      }
      best = Math.max(best, fuzzyNameScore(candidate, target));
      if (target.startsWith(normalized) || normalized.startsWith(target)) {
        best = Math.max(
          best,
          0.9 -
            (Math.abs(target.length - normalized.length) /
              Math.max(target.length, normalized.length)) *
              0.25,
        );
      } else if (target.includes(normalized) || normalized.includes(target)) {
        best = Math.max(best, 0.72);
      }
    }
    if (best >= 1) break;
  }
  return clamp01(best);
}

export function buildIdentityFlags(input: {
  nameScore: number;
  collectorScore: number;
  languageScore: number;
  visualScore: number;
  setMatch?: boolean;
}): IdentityMatchFlags {
  const exactName = input.nameScore >= 0.98;
  const nameAndNumber = exactName && input.collectorScore >= 0.85;
  const languageMatch = input.languageScore >= 0.9;
  const strongVisual = input.visualScore >= 0.78;
  const resolvedIdentity =
    exactName &&
    input.collectorScore >= 0.85 &&
    (languageMatch || Boolean(input.setMatch) || strongVisual);
  return { exactName, nameAndNumber, languageMatch, resolvedIdentity };
}

export function scoreEvidence(input: {
  visualScore?: number;
  clipScore?: number;
  nameScore?: number;
  collectorScore?: number;
  languageScore?: number;
  geometryQuality?: number;
  setMatch?: boolean;
}): EvidenceScoreBreakdown {
  const visualScore = clamp01(input.visualScore ?? 0);
  const clipScore = clamp01(input.clipScore ?? visualScore);
  const nameScore = clamp01(input.nameScore ?? 0);
  const collectorScore = clamp01(input.collectorScore ?? 0);
  const languageScore = clamp01(input.languageScore ?? 0.5);
  const geometryQuality = clamp01(input.geometryQuality ?? 0.5);

  const flags = buildIdentityFlags({
    nameScore,
    collectorScore,
    languageScore,
    visualScore: Math.max(visualScore, clipScore),
    setMatch: input.setMatch,
  });

  const languageMismatch = languageScore > 0 && languageScore < 0.35;

  let agreementBonus = 0;
  if (flags.exactName && collectorScore >= 0.85) agreementBonus += 0.3;
  if (flags.exactName && flags.languageMatch) agreementBonus += 0.15;
  if (collectorScore >= 0.85 && Math.max(visualScore, clipScore) >= 0.75) {
    agreementBonus += 0.2;
  }
  // Same-art reprints share a hash. Only boost that when language is unknown
  // or agrees — never when OCR/PSA already said this is a Japanese print.
  if (
    Math.max(visualScore, clipScore) >= 0.88 &&
    nameScore >= 0.8 &&
    languageScore >= 0.5
  ) {
    agreementBonus += 0.16;
  }
  if (Math.max(visualScore, clipScore) >= 0.88 && flags.languageMatch) {
    agreementBonus += 0.2;
  }
  if (flags.resolvedIdentity) agreementBonus += 0.08;

  let conflictPenalty = 0;
  const strongVisual = Math.max(visualScore, clipScore) >= 0.8;
  if (nameScore >= 0.9 && strongVisual === false && collectorScore < 0.35) {
    // Exact name alone is a reranker, not a forced winner.
    agreementBonus = Math.min(agreementBonus, 0.12);
  }
  if (
    nameScore >= 0.85 &&
    strongVisual &&
    collectorScore > 0 &&
    collectorScore < 0.35 &&
    languageScore < 0.4
  ) {
    conflictPenalty += 0.1;
  }
  if (languageMismatch && strongVisual) {
    conflictPenalty += 0.28;
  }
  const weighted =
    visualScore * VISUAL_WEIGHT +
    clipScore * CLIP_WEIGHT +
    nameScore * NAME_WEIGHT +
    collectorScore * COLLECTOR_WEIGHT +
    languageScore * LANGUAGE_WEIGHT +
    geometryQuality * QUALITY_WEIGHT;

  const artwork = Math.max(visualScore, clipScore);
  // OCR on foil / full-art / JP cards is often empty. The unused name/number
  // weights used to drag a 0.90 artwork match down to ~0.53, below the scanner
  // display floor — so even a clean HD scan vanished after fusion.
  if (artwork >= 0.62 && nameScore < 0.5 && !languageMismatch) {
    agreementBonus += 0.2;
  }
  const fused = weighted + agreementBonus - conflictPenalty;
  const artworkFloor =
    artwork >= 0.62
      ? languageMismatch
        ? Math.min(artwork - 0.18, 0.72)
        : artwork - 0.03
      : 0;
  const finalScore = clamp01(Math.max(fused, artworkFloor));

  return {
    visualScore,
    clipScore,
    nameScore,
    collectorScore,
    languageScore,
    geometryQuality,
    agreementBonus,
    conflictPenalty,
    finalScore,
    flags,
  };
}

export type RankableScanCandidate = {
  key: string;
  match: ScanMatch;
  evidence: EvidenceScoreBreakdown;
};

function cardLanguage(card: TcgCard): string {
  return card.language || "en";
}

function cardVisualIdentityKey(card: TcgCard): string {
  return `${cardLanguage(card).trim().toLowerCase()}:${card.id.trim().toLowerCase()}`;
}

/**
 * Fuse visually ranked candidates with OCR/catalog identity hits using a
 * unified score. Resolved identities may override visual order; bare name hits
 * only rerank.
 */
export type FuseScanCandidatesInput = {
  visualRanked: ScanMatch[];
  identityMatches: ScanMatch[];
  ocrNames: string[];
  collectorNumber?: string;
  languageHints: CardLanguageCode[];
  scriptHint: ScriptHint;
  geometryQuality?: number;
  method: ScanMatch["method"];
};

/**
 * Detailed fusion result used by development diagnostics. The ordinary
 * scanner API below intentionally keeps returning ScanMatch[] so existing
 * callers do not need to know about evidence bookkeeping.
 */
export function fuseScanCandidateEvidence(
  input: FuseScanCandidatesInput,
): RankableScanCandidate[] {
  const byKey = new Map<string, RankableScanCandidate>();
  const visualBySlug = new Map<string, ScanMatch>();
  const visualByIdentity = new Map<string, ScanMatch>();
  const rememberVisual = (map: Map<string, ScanMatch>, key: string, match: ScanMatch) => {
    if (!key) return;
    const existing = map.get(key);
    if (!existing || match.visualScore > existing.visualScore) {
      map.set(key, match);
    }
  };
  for (const match of input.visualRanked) {
    const card = match.result.card;
    rememberVisual(visualBySlug, card.slug.trim().toLowerCase(), match);
    rememberVisual(visualByIdentity, cardVisualIdentityKey(card), match);
  }
  const findActualVisual = (card: TcgCard): ScanMatch | undefined =>
    visualBySlug.get(card.slug.trim().toLowerCase()) ??
    visualByIdentity.get(cardVisualIdentityKey(card));
  const bestVisualScore = input.visualRanked.reduce(
    (best, match) => Math.max(best, match.visualScore),
    0,
  );
  const bestVisual = input.visualRanked[0] ?? null;
  const bestVisualNameScore = bestVisual
    ? scoreNameAgreement(
        input.ocrNames,
        bestVisual.result.card.name,
        bestVisual.result.card.englishName,
        bestVisual.result.card.localizedName,
      )
    : 0;

  const upsert = (match: ScanMatch, options: { identitySource?: boolean } = {}) => {
    const card = match.result.card;
    const key = card.slug;
    const nameScore = scoreNameAgreement(
      input.ocrNames,
      card.name,
      card.englishName,
      card.localizedName,
    );
    const collector = compareCollectorNumbers(
      input.collectorNumber,
      card.collectorNumber,
      {
        setCode: card.setCode,
        setPrintedTotal: card.setPrintedTotal,
      },
    );
    const languageScore = languageAgreementScore(
      cardLanguage(card),
      input.languageHints,
      input.scriptHint,
    );
    // Catalog identity scores are not image evidence. Reuse visual evidence only
    // when this exact card was independently present in the visual ranking.
    const actualVisual = options.identitySource ? findActualVisual(card) : match;
    const visualScore = actualVisual?.visualScore ?? 0;
    const visualMethod = actualVisual?.method ?? "none";
    let evidence = scoreEvidence({
      visualScore,
      clipScore:
        visualScore > 0
          ? visualMethod === "neural"
            ? visualScore
            : visualScore * 0.85
          : 0,
      nameScore,
      collectorScore: collector.score,
      languageScore,
      geometryQuality: input.geometryQuality,
    });

    // Weak OCR identity (generic name + number) must not crush a much stronger
    // visual/CLIP leader — e.g. OCR "Charizard" vs visual "Dark Charizard".
    const visualName = bestVisual
      ? normalizeIdentityName(bestVisual.result.card.name)
      : "";
    const identityName = normalizeIdentityName(card.name);
    const visualMoreSpecific =
      Boolean(visualName) &&
      visualName !== identityName &&
      visualName.includes(identityName);
    const conflictsWithStrongVisual =
      options.identitySource &&
      bestVisual &&
      bestVisual.result.card.slug !== card.slug &&
      bestVisualScore >= 0.8 &&
      visualScore < bestVisualScore - 0.12 &&
      (bestVisualNameScore + 0.08 >= nameScore || visualMoreSpecific);
    if (conflictsWithStrongVisual) {
      evidence = {
        ...evidence,
        conflictPenalty: evidence.conflictPenalty + 0.18,
        finalScore: clamp01(evidence.finalScore - 0.18),
        flags: {
          ...evidence.flags,
          // Keep nameAndNumber for reranking, but block resolved override.
          resolvedIdentity: false,
        },
      };
    }

    const existing = byKey.get(key);
    if (!existing || evidence.finalScore > existing.evidence.finalScore) {
      byKey.set(key, {
        key,
        match: {
          ...match,
          visualScore: evidence.finalScore,
          method: visualMethod,
        },
        evidence,
      });
    } else if (existing) {
      // Keep the stronger visual when evidence ties closely.
      existing.match = {
        ...existing.match,
        visualScore: Math.max(existing.match.visualScore, evidence.finalScore),
      };
    }
  };

  for (const match of input.visualRanked) {
    upsert(match);
  }
  for (const match of input.identityMatches) {
    upsert(match, { identitySource: true });
  }

  const ranked = [...byKey.values()].sort((left, right) => {
    const leftResolved = left.evidence.flags.resolvedIdentity ? 1 : 0;
    const rightResolved = right.evidence.flags.resolvedIdentity ? 1 : 0;
    if (leftResolved !== rightResolved) return rightResolved - leftResolved;

    const mayOverride = (entry: RankableScanCandidate) => {
      if (!entry.evidence.flags.nameAndNumber) return false;
      if (entry.evidence.flags.languageMatch) return true;
      // Compatible visual agreement — but not when a much stronger CLIP leader exists.
      if (entry.evidence.visualScore >= 0.7 && entry.evidence.visualScore + 0.12 >= bestVisualScore) {
        return true;
      }
      return false;
    };
    const leftMayOverride = mayOverride(left);
    const rightMayOverride = mayOverride(right);
    if (leftMayOverride !== rightMayOverride) {
      return Number(rightMayOverride) - Number(leftMayOverride);
    }

    return (
      right.evidence.finalScore - left.evidence.finalScore ||
      right.evidence.collectorScore - left.evidence.collectorScore ||
      right.evidence.languageScore - left.evidence.languageScore ||
      right.evidence.nameScore - left.evidence.nameScore
    );
  });

  return ranked;
}

export function fuseScanCandidates(
  input: FuseScanCandidatesInput,
): ScanMatch[] {
  return fuseScanCandidateEvidence(input).map((entry) => entry.match);
}

export function agreementConfidence(input: {
  top: ScanMatch | undefined;
  visualTop?: VisualIndexHit | null;
  identityTop?: VisualIndexHit | null;
  ocrNames: string[];
  collectorNumber?: string;
  languageHints: CardLanguageCode[];
  scriptHint: ScriptHint;
}): {
  level: "high" | "likely" | "possible" | "crop_uncertain";
  confident: boolean;
  notice?: string;
} {
  if (!input.top) {
    return { level: "possible", confident: false };
  }

  const card = input.top.result.card;
  const nameScore = scoreNameAgreement(
    input.ocrNames,
    card.name,
    card.englishName,
    card.localizedName,
  );
  const collector = compareCollectorNumbers(
    input.collectorNumber,
    card.collectorNumber,
    {
      setCode: card.setCode,
      setPrintedTotal: card.setPrintedTotal,
    },
  );
  const languageScore = languageAgreementScore(
    cardLanguage(card),
    input.languageHints,
    input.scriptHint,
  );
  const sameCardAndLanguage = (
    hit: VisualIndexHit | null | undefined,
  ): boolean =>
    Boolean(
      hit &&
        hit.id.trim().toLowerCase() === card.id.trim().toLowerCase() &&
        (hit.lang || "en").trim().toLowerCase() ===
          cardLanguage(card).trim().toLowerCase(),
    );
  // A same-name reprint (or a print in another language) cannot borrow the
  // visual leader's score when deciding whether the final row is confident.
  const sameAsVisual = sameCardAndLanguage(input.visualTop);
  const sameAsIdentity = sameCardAndLanguage(input.identityTop);
  const visualScore = sameAsVisual
    ? input.visualTop?.score ?? input.top.visualScore
    : input.top.visualScore;

  const flags = buildIdentityFlags({
    nameScore,
    collectorScore: collector.score,
    languageScore,
    visualScore,
  });

  if (flags.resolvedIdentity && (sameAsVisual || visualScore >= 0.7)) {
    return { level: "high", confident: true };
  }
  if (sameAsVisual && sameAsIdentity) {
    return { level: "high", confident: true };
  }
  if (flags.nameAndNumber && languageScore >= 0.9) {
    return { level: "high", confident: true };
  }
  if (
    (nameScore >= 0.9 && visualScore >= 0.72) ||
    (collector.score >= 0.85 && visualScore >= 0.78)
  ) {
    return { level: "likely", confident: true };
  }
  if (
    nameScore >= 0.9 &&
    visualScore >= 0.8 &&
    languageScore <= 0.25 &&
    !sameAsVisual
  ) {
    return {
      level: "possible",
      confident: false,
      notice:
        "Text and artwork disagree — showing the strongest candidates. Adjust the crop if needed.",
    };
  }
  if (input.top.visualScore < 0.72) {
    return {
      level: "possible",
      confident: false,
      notice: "Possible matches — major signals disagree, so review the top results.",
    };
  }
  return { level: "likely", confident: input.top.visualScore >= 0.8 };
}

/** Map catalog identity hits into SearchResult-backed ScanMatch rows. */
export function identityHitsToMatches(
  hits: VisualIndexHit[],
  results: SearchResult[],
  method: ScanMatch["method"],
): ScanMatch[] {
  const byId = new Map(results.map((result) => [result.card.id, result]));
  const matches: ScanMatch[] = [];
  for (const hit of hits) {
    const result = byId.get(hit.id);
    if (!result) continue;
    matches.push({
      result,
      visualScore: hit.score,
      method,
    });
  }
  return matches;
}
