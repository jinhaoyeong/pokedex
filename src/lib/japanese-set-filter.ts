import type { TcgSet } from "@/types/pokemon";

export function canonicalJapaneseSetFilterValue(set: Pick<TcgSet, "id" | "code" | "language">) {
  if (set.language !== "ja") {
    return set.id.trim();
  }

  return (set.code?.trim() || set.id.trim()).toUpperCase();
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
