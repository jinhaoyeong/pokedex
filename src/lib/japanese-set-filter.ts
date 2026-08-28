import type { CardLanguageCode, TcgSet } from "@/types/pokemon";

export function canonicalJapaneseSetFilterValue(set: Pick<TcgSet, "id" | "code" | "language">) {
  if (set.language !== "ja") {
    return set.id.trim();
  }

  return (set.code?.trim() || set.id.trim()).toUpperCase();
}

/** Official JP codes such as SM12, SV2a, S10P, DPs-B. */
export function isLikelyOfficialJapaneseSetCode(value: string) {
  const trimmed = value.trim();

  return /^(?:[A-Za-z]{1,6}\d+[A-Za-z]?|[A-Za-z]{1,3}-[A-Za-z]|[A-Za-z]{2,6}-B)$/.test(
    trimmed,
  );
}

export function encodeSetFilterOptionValue(set: Pick<TcgSet, "id" | "code" | "language">) {
  return `${set.language}:${canonicalJapaneseSetFilterValue(set)}`;
}

export function decodeSetFilterValue(raw?: string | null): {
  languageHint?: CardLanguageCode;
  setFilter: string;
} {
  const trimmed = raw?.trim() ?? "";

  if (!trimmed) {
    return { setFilter: "" };
  }

  const match = trimmed.match(
    /^(en|ja|ko|zh-cn|zh-tw|fr|es|it|de|pt|pt-br|pt-pt|nl|pl|id|th):(.+)$/i,
  );

  if (!match) {
    return { setFilter: trimmed };
  }

  return {
    languageHint: match[1].toLowerCase() as CardLanguageCode,
    setFilter: match[2],
  };
}

export function buildJapaneseOfficialBrowseCodeVariants(setIdOrCode: string) {
  const trimmed = setIdOrCode.trim();

  if (!trimmed) {
    return [];
  }

  const candidates = new Set<string>();
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();

  candidates.add(upper);
  candidates.add(trimmed);

  if (lower !== upper) {
    candidates.add(lower);
  }

  if (trimmed.includes("+")) {
    candidates.add(trimmed.replace(/\+/g, "P").toUpperCase());
    candidates.add(trimmed.replace(/\+/g, "").toUpperCase());
  }

  const subsetMatch = trimmed.match(/^([A-Za-z]{1,6}\d+(?:\.\d+)?)([A-Za-z])$/);
  if (subsetMatch?.[1]) {
    candidates.add(subsetMatch[1].toUpperCase());
    candidates.add(subsetMatch[1]);
  }

  return [...candidates].filter(Boolean);
}

export function mergeJapaneseOfficialBrowseCodeCandidates(
  ...inputs: Array<string | null | undefined>
) {
  const merged = new Set<string>();

  for (const input of inputs) {
    if (!input?.trim()) {
      continue;
    }

    for (const candidate of buildJapaneseOfficialBrowseCodeVariants(input)) {
      merged.add(candidate);
    }
  }

  return [...merged];
}
