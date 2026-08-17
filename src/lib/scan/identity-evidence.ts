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

export function inferScriptHint(ocrText: string): ScriptHint {
  const hasJapanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(ocrText);
  const hasKorean = /[\uac00-\ud7af]/u.test(ocrText);
  const hasChineseExclusive =
    /[\u4e00-\u9fff]/u.test(ocrText) && !/[\u3040-\u30ff]/u.test(ocrText);
  const hasLatin = /[A-Za-z]/.test(ocrText);

  // CJK identity text often includes Latin suffixes ("ex", "VMAX") — that is not
  // a mixed-language card. Prefer the non-Latin script when present.
  if (hasJapanese) return "japanese";
  if (hasKorean) return "korean";
  if (hasChineseExclusive) return "chinese";
  if (hasLatin) return "latin";
  return "unknown";
}

/**
 * Cheap language preferences from OCR script. Latin does NOT imply English —
 * French/German/Italian/Spanish/Portuguese share the script.
 */
export function inferLanguageHints(
  scriptHint: ScriptHint,
  ocrText = "",
): CardLanguageCode[] {
  // Graded-slab labels print "JPN" / "JAPANESE" in Latin even when the card
  // face itself is unreadable under glare — treat that as a hard JA hint.
  if (/\bJPN\.?\b|\bJAPANESE\b/i.test(ocrText)) {
    return ["ja"];
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

  let agreementBonus = 0;
  if (flags.exactName && collectorScore >= 0.85) agreementBonus += 0.3;
  if (flags.exactName && flags.languageMatch) agreementBonus += 0.15;
  if (collectorScore >= 0.85 && Math.max(visualScore, clipScore) >= 0.75) {
    agreementBonus += 0.2;
  }
  // A near-exact art match plus independently observed text/script evidence is
  // strong even when tiny foil/footer text prevents an exact OCR identity.
  // This resolves same-art language collisions without inventing collector or
  // CLIP evidence for identity-only rows.
  if (Math.max(visualScore, clipScore) >= 0.88 && nameScore >= 0.8) {
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
  const weighted =
    visualScore * VISUAL_WEIGHT +
    clipScore * CLIP_WEIGHT +
    nameScore * NAME_WEIGHT +
    collectorScore * COLLECTOR_WEIGHT +
    languageScore * LANGUAGE_WEIGHT +
    geometryQuality * QUALITY_WEIGHT;

  const finalScore = clamp01(weighted + agreementBonus - conflictPenalty);

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
