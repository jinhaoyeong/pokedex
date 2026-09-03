export type CollectionHolding = {
  contributorKey: string;
  grade: string | null | undefined;
  quantity: number;
};

export type CollectionPopulation = {
  total: number;
  holderCount: number;
  grades: Array<{ grade: string; count: number }>;
};

const GRADE_PATTERN = /^(PSA|CGC|BGS|SGC|TAG)\s+(10(?:\s+BLACK|\s+PRISTINE)?|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)$/i;

export function normalizeCollectionGrade(value?: string | null) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  const match = normalized.match(GRADE_PATTERN);
  if (!match) return null;
  return `${match[1].toUpperCase()} ${match[2].toUpperCase().replace("PRISTINE", "Pristine").replace("BLACK", "Black")}`;
}

function gradeScore(label: string) {
  const service = label.match(/^(PSA|CGC|BGS|SGC|TAG)/)?.[1] ?? "ZZZ";
  const numeric = Number.parseFloat(label.match(/\b(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)\b/)?.[1] ?? "0");
  return `${service}:${String(100 - numeric).padStart(5, "0")}:${label}`;
}

/** Deduplicates the same holder/grade across cloud-vault storage paths. */
export function aggregateCollectionPopulation(rows: CollectionHolding[]): CollectionPopulation | null {
  const perHolderGrade = new Map<string, { grade: string; quantity: number; holder: string }>();
  for (const row of rows) {
    const holder = row.contributorKey.trim();
    const grade = normalizeCollectionGrade(row.grade);
    const quantity = Math.trunc(row.quantity);
    if (!holder || !grade || quantity < 1 || quantity > 10_000) continue;
    const key = `${holder}|${grade}`;
    const current = perHolderGrade.get(key);
    if (!current || quantity > current.quantity) {
      perHolderGrade.set(key, { grade, quantity, holder });
    }
  }
  if (!perHolderGrade.size) return null;

  const counts = new Map<string, number>();
  const holders = new Set<string>();
  let total = 0;
  for (const row of perHolderGrade.values()) {
    counts.set(row.grade, (counts.get(row.grade) ?? 0) + row.quantity);
    holders.add(row.holder);
    total += row.quantity;
  }
  return {
    total,
    holderCount: holders.size,
    grades: [...counts.entries()]
      .map(([grade, count]) => ({ grade, count }))
      .sort((left, right) => gradeScore(left.grade).localeCompare(gradeScore(right.grade))),
  };
}
