/**
 * Strict card-to-listing match scoring. Used to gate eBay sold/active comps so a
 * price is only accepted from a listing that confidently IS this exact card — the
 * "100% solid" requirement. Returns 0..1; >= SOLID_MATCH_THRESHOLD is solid.
 */

export const SOLID_MATCH_THRESHOLD = 0.85;

export type MatchQuery = {
  name: string;
  englishName?: string;
  collectorNumber?: string;
  setName?: string;
  setEnglishName?: string;
  language?: string;
};

// Listings that are not a single raw card of this exact print.
const NEGATIVE_PATTERN =
  /\b(lot|lots|bundle|playset|proxy|jumbo|oversized|sealed|booster|packs?|box|set of|sticker|coin|pin|binder|sleeve|toploader|custom|repro|reprint|metal card|choose|pick)\b/i;
// Graded slabs price very differently from a raw/ungraded card.
const GRADED_PATTERN = /\b(psa|bgs|cgc|sgc|ace|tag)\s?\d|\bgraded\b|\bgem\s?mint\b/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s/#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest alphabetic token of a name — the Pokémon/character word, e.g. "charizard". */
function primaryNameToken(name: string): string {
  const tokens = normalize(name)
    .split(" ")
    .filter((token) => /^[a-z]+$/.test(token) && token.length >= 3);
  return tokens.sort((a, b) => b.length - a.length)[0] ?? "";
}

function numberMatches(title: string, collectorNumber: string): boolean {
  const number = collectorNumber.trim().toLowerCase().replace(/^0+(?=\d)/, "");
  if (!number) {
    return false;
  }
  const escaped = escapeRegExp(number);
  // Match "201", "#201", "201/165", "201 /165" but not "1201" / "2015".
  return new RegExp(`(^|[^0-9])#?${escaped}([^0-9]|$|/| /)`).test(title);
}

export function scoreCardMatch(query: MatchQuery, rawTitle: string): number {
  const title = normalize(rawTitle);
  if (title.length < 3) {
    return 0;
  }

  // Hard requirement: the card's primary name token must be present.
  const nameTokens = [query.englishName, query.name]
    .filter((value): value is string => Boolean(value))
    .map(primaryNameToken)
    .filter(Boolean);
  const nameHit = nameTokens.some((token) => title.includes(token));
  if (!nameHit) {
    return 0;
  }

  // Hard requirement: the collector number must be present (when we have one).
  if (query.collectorNumber && !numberMatches(title, query.collectorNumber)) {
    return 0;
  }

  // Name + exact collector number is already a near-unique identifier.
  let score = 0.7;

  const setTokens = [query.setEnglishName, query.setName]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalize(value).split(" "))
    .filter((token) => token.length >= 3);
  if (setTokens.some((token) => title.includes(token))) {
    score += 0.2;
  }

  // Japanese prints should say so when sourced from an English marketplace.
  if (query.language && query.language !== "en" && /\bjapanese\b|\bjp\b/i.test(rawTitle)) {
    score += 0.15;
  }

  if (NEGATIVE_PATTERN.test(rawTitle)) {
    score -= 0.6;
  }
  if (GRADED_PATTERN.test(rawTitle)) {
    score -= 0.5;
  }

  return Math.max(0, Math.min(1, score));
}

export function isSolidMatch(query: MatchQuery, rawTitle: string): boolean {
  return scoreCardMatch(query, rawTitle) >= SOLID_MATCH_THRESHOLD;
}

/** Median of positive numbers, 0 when empty. */
export function median(values: number[]): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
