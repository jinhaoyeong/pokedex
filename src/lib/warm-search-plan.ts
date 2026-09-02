export type WarmSearchLanguage = "all" | "en" | "ja";
export type WarmSearchSort = "price-desc" | "number-asc";

export type WarmSearchJob = {
  setId: string;
  language: WarmSearchLanguage;
  sort: WarmSearchSort;
};

export const WARM_SEARCH_MAX_JOBS = 12;

/**
 * Sets collectors actually open. Cron fills remaining slots from these after
 * live hit counts, so a quiet morning still has a warm Dex for chase releases.
 */
export const DEFAULT_WARM_SEARCH_JOBS: WarmSearchJob[] = [
  { setId: "me2pt5", language: "all", sort: "price-desc" },
  { setId: "me2pt5", language: "en", sort: "price-desc" },
  { setId: "me4", language: "all", sort: "price-desc" },
  { setId: "me3", language: "all", sort: "price-desc" },
  { setId: "me2", language: "all", sort: "price-desc" },
  { setId: "sv10", language: "en", sort: "price-desc" },
  { setId: "sv8pt5", language: "en", sort: "price-desc" },
  { setId: "base1", language: "en", sort: "price-desc" },
  { setId: "M5", language: "ja", sort: "price-desc" },
];

export function setBrowseHitKey(setId: string, language: string, sort: string) {
  return `${setId.trim().toLowerCase()}|${language}|${sort}`;
}

export function parseSetBrowseHitKey(key: string): WarmSearchJob | null {
  const [setId, language, sort] = key.split("|");

  if (!setId || (language !== "all" && language !== "en" && language !== "ja")) {
    return null;
  }

  if (sort !== "price-desc" && sort !== "number-asc") {
    return null;
  }

  return { setId, language, sort };
}

export function selectWarmSearchJobs(
  hits: Record<string, number>,
  defaults: WarmSearchJob[] = DEFAULT_WARM_SEARCH_JOBS,
  maxJobs = WARM_SEARCH_MAX_JOBS,
): WarmSearchJob[] {
  const ranked = Object.entries(hits)
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => parseSetBrowseHitKey(key))
    .filter((job): job is WarmSearchJob => Boolean(job));

  const selected: WarmSearchJob[] = [];
  const seen = new Set<string>();

  const push = (job: WarmSearchJob) => {
    const id = setBrowseHitKey(job.setId, job.language, job.sort);
    if (seen.has(id) || selected.length >= maxJobs) {
      return;
    }
    seen.add(id);
    selected.push(job);
  };

  for (const job of ranked) {
    push(job);
  }

  for (const job of defaults) {
    push(job);
  }

  return selected;
}
