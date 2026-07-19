#!/usr/bin/env node
/**
 * Deterministic regression checks for scan identity evidence fusion.
 * Mirrors the ranking rules in src/lib/scan/identity-evidence.ts so Japanese
 * Charizard / Dark Charizard collisions cannot silently regress without a
 * full browser fixture run.
 *
 * Usage: npm run validate:scan-identity
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

function normalizeIdentityName(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripLeadingZeros(value) {
  return value.replace(/^0+(?=\d)/, "") || value;
}

function parseCollectorNumber(rawInput) {
  const raw = rawInput.trim().replace(/\s+/g, " ");
  if (!raw) return { raw: "" };

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

function compareCollectorNumbers(queryRaw, candidateRaw) {
  if (!queryRaw?.trim() || !candidateRaw?.trim()) {
    return { tier: "none", score: 0 };
  }
  const query = parseCollectorNumber(queryRaw);
  const candidate = parseCollectorNumber(candidateRaw);
  const normalizeRaw = (value) =>
    value.toUpperCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");

  if (normalizeRaw(query.raw) && normalizeRaw(query.raw) === normalizeRaw(candidate.raw)) {
    return { tier: "exact_raw", score: 1 };
  }
  if (
    query.prefix &&
    query.primary &&
    candidate.prefix === query.prefix &&
    candidate.primary === query.primary
  ) {
    return { tier: "prefix_primary", score: 0.92 };
  }
  if (
    query.primary &&
    query.denominator &&
    candidate.primary === query.primary &&
    candidate.denominator === query.denominator
  ) {
    return { tier: "primary_denominator", score: 0.88 };
  }
  const queryPrimaryBare = query.primary?.replace(/^[A-Z]+/, "") || query.primary;
  const candidatePrimaryBare =
    candidate.primary?.replace(/^[A-Z]+/, "") || candidate.primary;
  if (
    queryPrimaryBare &&
    candidatePrimaryBare &&
    stripLeadingZeros(queryPrimaryBare) === stripLeadingZeros(candidatePrimaryBare)
  ) {
    return { tier: "primary_only", score: 0.35 };
  }
  return { tier: "none", score: 0 };
}

function inferScriptHint(ocrText) {
  const hasJapanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(ocrText);
  const hasKorean = /[\uac00-\ud7af]/u.test(ocrText);
  const hasLatin = /[A-Za-z]/.test(ocrText);
  // Latin suffixes like "ex" should not demote Japanese identity text.
  if (hasJapanese) return "japanese";
  if (hasKorean) return "korean";
  if (hasLatin) return "latin";
  return "unknown";
}

function inferLanguageHints(scriptHint) {
  if (scriptHint === "japanese" || scriptHint === "mixed") return ["ja"];
  if (scriptHint === "korean") return ["ko"];
  return [];
}

function languageAgreementScore(cardLanguage, languageHints, scriptHint) {
  const lang = (cardLanguage || "").toLowerCase();
  if (languageHints.length) {
    if (languageHints.some((hint) => hint.toLowerCase() === lang)) return 1;
    return 0.15;
  }
  if (scriptHint === "japanese") return lang === "ja" ? 1 : 0.2;
  return 0.55;
}

function scoreNameAgreement(ocrNames, cardName, englishName = "") {
  const targets = [cardName, englishName].map(normalizeIdentityName).filter(Boolean);
  let best = 0;
  for (const candidate of ocrNames) {
    const normalized = normalizeIdentityName(candidate);
    for (const target of targets) {
      if (normalized === target) best = 1;
      else if (target.includes(normalized) || normalized.includes(target)) {
        best = Math.max(best, 0.72);
      }
    }
  }
  return best;
}

function scoreEvidence({
  visualScore = 0,
  clipScore = visualScore,
  nameScore = 0,
  collectorScore = 0,
  languageScore = 0.5,
}) {
  const exactName = nameScore >= 0.98;
  const nameAndNumber = exactName && collectorScore >= 0.85;
  const languageMatch = languageScore >= 0.9;
  const strongVisual = Math.max(visualScore, clipScore) >= 0.78;
  const resolvedIdentity =
    exactName && collectorScore >= 0.85 && (languageMatch || strongVisual);

  let agreementBonus = 0;
  if (exactName && collectorScore >= 0.85) agreementBonus += 0.3;
  if (exactName && languageMatch) agreementBonus += 0.15;
  if (collectorScore >= 0.85 && Math.max(visualScore, clipScore) >= 0.75) {
    agreementBonus += 0.2;
  }
  if (resolvedIdentity) agreementBonus += 0.08;
  if (nameScore >= 0.9 && !strongVisual && collectorScore < 0.35) {
    agreementBonus = Math.min(agreementBonus, 0.12);
  }

  let conflictPenalty = 0;
  if (nameScore >= 0.85 && strongVisual && languageScore <= 0.2) {
    conflictPenalty += 0.1;
  }

  const weighted =
    visualScore * 0.34 +
    clipScore * 0.22 +
    nameScore * 0.18 +
    collectorScore * 0.14 +
    languageScore * 0.08 +
    0.5 * 0.04;

  return {
    finalScore: Math.max(0, Math.min(1, weighted + agreementBonus - conflictPenalty)),
    flags: { exactName, nameAndNumber, languageMatch, resolvedIdentity },
    collectorScore,
    languageScore,
    nameScore,
    visualScore,
  };
}

function fuseScanCandidates({
  visualRanked,
  identityMatches,
  ocrNames,
  collectorNumber,
  languageHints,
  scriptHint,
}) {
  const byKey = new Map();
  const bestVisualScore = visualRanked.reduce(
    (best, match) => Math.max(best, match.visualScore),
    0,
  );
  const bestVisual = visualRanked[0] ?? null;
  const bestVisualNameScore = bestVisual
    ? scoreNameAgreement(
        ocrNames,
        bestVisual.result.card.name,
        bestVisual.result.card.englishName,
      )
    : 0;

  const upsert = (match, { identitySource = false } = {}) => {
    const card = match.result.card;
    const nameScore = scoreNameAgreement(ocrNames, card.name, card.englishName);
    const collector = compareCollectorNumbers(collectorNumber, card.collectorNumber);
    const languageScore = languageAgreementScore(
      card.language,
      languageHints,
      scriptHint,
    );
    const visualScore = identitySource
      ? Math.min(match.visualScore, 0.72)
      : match.visualScore;
    let evidence = scoreEvidence({
      visualScore,
      clipScore: match.method === "neural" ? visualScore : visualScore * 0.85,
      nameScore,
      collectorScore: collector.score,
      languageScore,
    });
    const visualName = bestVisual
      ? normalizeIdentityName(bestVisual.result.card.name)
      : "";
    const identityName = normalizeIdentityName(card.name);
    const visualMoreSpecific =
      Boolean(visualName) &&
      visualName !== identityName &&
      visualName.includes(identityName);
    const conflictsWithStrongVisual =
      identitySource &&
      bestVisual &&
      bestVisual.result.card.slug !== card.slug &&
      bestVisualScore >= 0.8 &&
      visualScore < bestVisualScore - 0.12 &&
      (bestVisualNameScore + 0.08 >= nameScore || visualMoreSpecific);
    if (conflictsWithStrongVisual) {
      evidence = {
        ...evidence,
        finalScore: Math.max(0, evidence.finalScore - 0.18),
        flags: { ...evidence.flags, resolvedIdentity: false },
      };
    }
    const key = card.slug;
    const existing = byKey.get(key);
    if (!existing || evidence.finalScore > existing.evidence.finalScore) {
      byKey.set(key, {
        match: { ...match, visualScore: evidence.finalScore },
        evidence,
      });
    }
  };

  for (const match of visualRanked) upsert(match);
  for (const match of identityMatches) upsert(match, { identitySource: true });

  return [...byKey.values()]
    .sort((left, right) => {
      const leftResolved = left.evidence.flags.resolvedIdentity ? 1 : 0;
      const rightResolved = right.evidence.flags.resolvedIdentity ? 1 : 0;
      if (leftResolved !== rightResolved) return rightResolved - leftResolved;
      const mayOverride = (entry) => {
        if (!entry.evidence.flags.nameAndNumber) return false;
        if (entry.evidence.flags.languageMatch) return true;
        return (
          entry.evidence.visualScore >= 0.7 &&
          entry.evidence.visualScore + 0.12 >= bestVisualScore
        );
      };
      const leftMayOverride = mayOverride(left);
      const rightMayOverride = mayOverride(right);
      if (leftMayOverride !== rightMayOverride) {
        return Number(rightMayOverride) - Number(leftMayOverride);
      }
      return right.evidence.finalScore - left.evidence.finalScore;
    })
    .map((entry) => entry.match);
}

// --- Collector parsing ---
{
  const parsed = parseCollectorNumber("125/108");
  assert(parsed.primary === "125", "parse 125/108 primary");
  assert(parsed.denominator === "108", "parse 125/108 denominator");
}
{
  const parsed = parseCollectorNumber("SV3 125");
  assert(parsed.prefix === "SV3", "parse SV3 125 prefix");
  assert(parsed.primary === "125", "parse SV3 125 primary");
}
{
  const parsed = parseCollectorNumber("TG05/TG30");
  assert(parsed.primary === "TG05", "parse TG05/TG30 primary");
  assert(parsed.denominator === "TG30", "parse TG05/TG30 denominator");
}
{
  const parsed = parseCollectorNumber("SWSH262");
  assert(parsed.prefix === "SWSH", "parse SWSH262 prefix");
  assert(parsed.primary === "262", "parse SWSH262 primary");
}

assert(
  compareCollectorNumbers("125", "125/190").tier === "primary_only",
  "125 vs 125/190 is primary-only (weak)",
);
assert(
  compareCollectorNumbers("125/108", "125/108").tier === "exact_raw",
  "exact raw collector match",
);
assert(compareCollectorNumbers("125", "215").tier === "none", "125 does not match 215");

assert(inferScriptHint("リザードンex 125") === "japanese", "Japanese OCR script hint");
assert(inferLanguageHints("japanese")[0] === "ja", "Japanese script prefers ja catalog");
assert(inferScriptHint("Charizard ex 215") === "latin", "Latin OCR script hint");
assert(inferLanguageHints("latin").length === 0, "Latin script does not force English");

{
  const resolved = scoreEvidence({
    nameScore: 1,
    collectorScore: 1,
    languageScore: 1,
    visualScore: 0.6,
  });
  assert(resolved.flags.resolvedIdentity, "name+number+language is resolved identity");
}
{
  const nameOnly = scoreEvidence({
    nameScore: 1,
    collectorScore: 0,
    languageScore: 0.55,
    visualScore: 0.55,
  });
  assert(nameOnly.flags.exactName, "exact name flag without number");
  assert(!nameOnly.flags.resolvedIdentity, "exact name alone is not resolved identity");
}

{
  const jp = {
    result: {
      card: {
        id: "sv3-125",
        slug: "ja--sv3-125",
        language: "ja",
        name: "リザードンex",
        englishName: "Charizard ex",
        collectorNumber: "125",
      },
    },
    visualScore: 0.62,
    method: "phash",
  };
  const en = {
    result: {
      card: {
        id: "sv3-215",
        slug: "sv3-215",
        language: "en",
        name: "Charizard ex",
        englishName: "Charizard ex",
        collectorNumber: "215",
      },
    },
    visualScore: 0.88,
    method: "neural",
  };
  const ranked = fuseScanCandidates({
    visualRanked: [en, jp],
    identityMatches: [jp],
    ocrNames: ["リザードンex", "リザードン"],
    collectorNumber: "125",
    languageHints: ["ja"],
    scriptHint: "japanese",
  });
  assert(
    ranked[0]?.result.card.id === "sv3-125",
    "JP リザードンex + 125 beats English Obsidian Flames #215",
  );
}

{
  const visual = {
    result: {
      card: {
        id: "team-rocket-4",
        slug: "team-rocket-4",
        language: "en",
        name: "Dark Charizard",
        collectorNumber: "4",
      },
    },
    visualScore: 0.9,
    method: "neural",
  };
  const weakOcr = {
    result: {
      card: {
        id: "base1-4",
        slug: "base1-4",
        language: "en",
        name: "Charizard",
        collectorNumber: "4",
      },
    },
    visualScore: 0.95,
    method: "phash",
  };
  const ranked = fuseScanCandidates({
    visualRanked: [visual],
    identityMatches: [weakOcr],
    ocrNames: ["Charizard"],
    collectorNumber: "4",
    languageHints: [],
    scriptHint: "latin",
  });
  assert(
    ranked[0]?.result.card.id === "team-rocket-4",
    "strong visual Dark Charizard beats weaker OCR Charizard #4",
  );
}

{
  const manifest = JSON.parse(
    readFileSync(path.join(root, "data/scan-fixtures/manifest.json"), "utf8"),
  );
  assert(manifest.fixtures.length >= 5, "fixture manifest loaded");
  assert(
    manifest.fixtures.some((fixture) => fixture.expectedCardId === "sv3-125"),
    "manifest includes JP Charizard expected id",
  );
}

// Ordering regression from searchLocalByNames: collector agreement before OCR rank.
{
  const rows = [
    { name: "Charizard ex", number: "215", rank: 0 },
    { name: "リザードンex", number: "125", rank: 1 },
  ];
  const sorted = [...rows].sort((left, right) => {
    const leftNumber = compareCollectorNumbers("125", left.number).score;
    const rightNumber = compareCollectorNumbers("125", right.number).score;
    return rightNumber - leftNumber || left.rank - right.rank;
  });
  assert(
    sorted[0].name === "リザードンex",
    "collector-number agreement sorts before OCR name rank",
  );
}

if (failed) {
  console.error(`\n${failed} scan-identity check(s) failed.`);
  process.exit(1);
}
console.log("\nAll scan-identity checks passed.");
