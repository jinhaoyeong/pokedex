import type { TcgSet } from "@/types/pokemon";

function releaseDateSortScore(releaseDate?: string) {
  const clean = releaseDate?.trim();

  if (!clean) {
    return 0;
  }

  const parsed = Date.parse(clean.replace(/\//g, "-"));

  return Number.isNaN(parsed) ? 0 : parsed;
}

function inferSetRecencyScore(setId: string) {
  const upper = setId.trim().toUpperCase();

  const matchEra = (pattern: RegExp, base: number) => {
    const match = upper.match(pattern);

    if (!match) {
      return null;
    }

    const number = Number.parseInt(match[1], 10);
    const suffix = match[2];

    if (suffix === "+") {
      return base + number + 0.5;
    }

    if (suffix && /[A-Z]/.test(suffix)) {
      return base + number + (suffix.charCodeAt(0) - 64) / 100;
    }

    return base + number;
  };

  return (
    matchEra(/^SV(\d+)([A-Z+]?)$/, 6000) ??
    matchEra(/^M(\d+)([A-Z]?)$/, 5900) ??
    matchEra(/^S(\d+)([A-Z]?)$/, 5000) ??
    matchEra(/^SM(\d+)([A-Z+]?)$/, 4000) ??
    matchEra(/^XY(\d+)([A-Z]?)$/, 3000) ??
    matchEra(/^CP(\d+)$/, 3500) ??
    matchEra(/^BW(\d+)([A-Z]?)$/, 2500) ??
    matchEra(/^DP(\d+)([A-Z]?)$/, 2000) ??
    0
  );
}

function setDisplaySortScore(set: TcgSet) {
  const inferred = inferSetRecencyScore(set.id);
  const dated = releaseDateSortScore(set.releaseDate);

  return Math.max(inferred, dated / 1_000_000);
}

export function compareTcgSetsForDisplay(left: TcgSet, right: TcgSet) {
  const scoreDelta = setDisplaySortScore(right) - setDisplaySortScore(left);

  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return left.name.localeCompare(right.name);
}

export function sortTcgSetsForDisplay(sets: TcgSet[]) {
  return sets.slice().sort(compareTcgSetsForDisplay);
}

/** Search set filter label: localized name, optional English gloss, then set code. */
export function formatSetFilterOptionLabel(set: TcgSet) {
  const localized = (set.localizedName ?? set.name).trim();
  const english = set.englishName?.trim();
  let displayName = set.name;

  if (
    english &&
    english.toLowerCase() !== localized.toLowerCase() &&
    !set.name.includes(`(${english})`)
  ) {
    displayName = `${localized} (${english})`;
  }

  return `${displayName} (${set.code})`;
}
