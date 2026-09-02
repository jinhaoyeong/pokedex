import { classifySoldCompJunk } from "@/lib/market/sold-comp-hygiene";
import type { MatchQuery } from "@/lib/price/match";

export type ActiveListingRejectReason =
  | "lot_or_bulk"
  | "proxy_or_fake"
  | "custom_or_altered"
  | "digital_or_sealed"
  | "mixed_quantity"
  | "name_mismatch"
  | "set_mismatch"
  | "number_mismatch"
  | "language_mismatch"
  | "finish_mismatch"
  | "grade_mismatch"
  | "junk_title";

export type ActiveListingGradeFilter = "Ungraded" | "PSA 9" | "PSA 10";

export type ActiveListingQuery = MatchQuery & {
  finish?: string | null;
  rarity?: string | null;
  requestedGrade: ActiveListingGradeFilter;
};

const LOT_PATTERN =
  /\b(lot|lots|bundle|playset|x\s*[2-9]\d*|\d+\s*x|qty\s*[2-9]|quantity\s*[2-9]|mixed|assorted|various cards|multi[- ]card)\b/i;
const PROXY_FAKE_PATTERN =
  /\b(proxy|proxies|fake|counterfeit|reproduction|repro|reprint|bootleg|unofficial)\b/i;
const CUSTOM_ALTERED_PATTERN = /\b(custom|altered|handmade|painted|signed|autograph)\b/i;
const DIGITAL_SEALED_PATTERN =
  /\b(digital|ptcgo|ptcgl|tcg live|code card|sealed|booster|etb|elite trainer|upc\b)\b/i;
const MIXED_QTY_PATTERN = /\b(set of \d+|cards included|\d+\s+cards)\b/i;
const LOCALIZED_PRINT = /\bjapanese\b|\bjp\b|\bchinese\b|\bkorean\b/i;

const FINISH_REVERSE = /\breverse(?:\s|-)?holo(?:foil)?\b|\breverse\s+h\b|\brh\b/i;
const FINISH_FIRST_ED = /\b1st(?:\s|-)?ed(?:ition)?\b|\bfirst\s+edition\b/i;
const FINISH_SHADOWLESS = /\bshadowless\b/i;

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s/#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function primaryNameToken(name: string) {
  const tokens = normalize(name)
    .split(" ")
    .filter((token) => /^[a-z]+$/.test(token) && token.length >= 3);
  return tokens.sort((a, b) => b.length - a.length)[0] ?? "";
}

function numberMatches(title: string, collectorNumber: string) {
  const number = collectorNumber.trim().toLowerCase().replace(/^0+(?=\d)/, "");
  if (!number) {
    return false;
  }
  const escaped = escapeRegExp(number);
  return new RegExp(`(^|[^0-9])#?0*${escaped}([^0-9]|$|/| /)`).test(title);
}

function setTokens(query: ActiveListingQuery) {
  return [query.setEnglishName, query.setName]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalize(value).split(" "))
    .filter((token) => token.length >= 3);
}

function finishMismatch(query: ActiveListingQuery, title: string) {
  const finish = query.finish ?? "";
  if (!finish) {
    return false;
  }
  const wantsReverse = /reverse/i.test(finish);
  const wantsFirstEd = /firstEdition/i.test(finish);
  const wantsShadowless = /\bshadowless\b/i.test(`${query.setName ?? ""} ${query.rarity ?? ""}`);

  if (wantsReverse !== FINISH_REVERSE.test(title)) {
    return true;
  }
  if (wantsFirstEd && !FINISH_FIRST_ED.test(title)) {
    return true;
  }
  if (!wantsFirstEd && FINISH_FIRST_ED.test(title)) {
    return true;
  }
  if (wantsShadowless && !FINISH_SHADOWLESS.test(title)) {
    return true;
  }
  return false;
}

function gradeMismatch(requested: ActiveListingGradeFilter, title: string) {
  if (requested === "Ungraded") {
    return /\b(psa|bgs|cgc|sgc|ace|tag)\s?\d|\bgraded\b|\bgem\s?mint\b/i.test(title);
  }
  if (requested === "PSA 9") {
    return !/\bpsa\s*9(?!\d)/i.test(title) || /\bpsa\s*10\b/i.test(title) || /\b(bgs|beckett|cgc|sgc|tag)\s*\d/i.test(title);
  }
  return !/\bpsa\s*10\b/i.test(title) || /\b(bgs|beckett|cgc|sgc|tag)\s*\d/i.test(title);
}

export function classifyActiveListingReject(
  title: string,
  query: ActiveListingQuery,
): ActiveListingRejectReason | null {
  if (DIGITAL_SEALED_PATTERN.test(title)) {
    return "digital_or_sealed";
  }
  if (PROXY_FAKE_PATTERN.test(title)) {
    return "proxy_or_fake";
  }
  if (CUSTOM_ALTERED_PATTERN.test(title)) {
    return "custom_or_altered";
  }
  if (MIXED_QTY_PATTERN.test(title)) {
    return "mixed_quantity";
  }
  if (LOT_PATTERN.test(title)) {
    return "lot_or_bulk";
  }

  const junk = classifySoldCompJunk(title, { cardName: query.name, rarity: query.rarity ?? undefined });
  if (junk === "bundle_proxy_reprint") {
    return "lot_or_bulk";
  }
  if (junk) {
    return "junk_title";
  }

  const normalized = normalize(title);
  const nameTokens = [query.englishName, query.name]
    .filter((value): value is string => Boolean(value))
    .map(primaryNameToken)
    .filter(Boolean);
  if (!nameTokens.some((token) => normalized.includes(token))) {
    return "name_mismatch";
  }
  if (query.collectorNumber && !numberMatches(title, query.collectorNumber)) {
    return "number_mismatch";
  }
  const tokens = setTokens(query);
  if (tokens.length && !tokens.some((token) => normalized.includes(token))) {
    return "set_mismatch";
  }

  const localizedTitle = LOCALIZED_PRINT.test(title);
  if (query.language && query.language !== "en" && !localizedTitle) {
    return "language_mismatch";
  }
  if ((!query.language || query.language === "en") && localizedTitle) {
    return "language_mismatch";
  }

  if (finishMismatch(query, title)) {
    return "finish_mismatch";
  }
  if (gradeMismatch(query.requestedGrade, title)) {
    return "grade_mismatch";
  }
  return null;
}

export function isAcceptedActiveListing(title: string, query: ActiveListingQuery) {
  return classifyActiveListingReject(title, query) == null;
}
