import type { PopulationGradeCount, TcgCard } from "@/types/pokemon";

function gradeSortKey(grade: string) {
  const serviceOrder: Record<string, number> = {
    PSA: 0,
    BGS: 1,
    BECKETT: 1,
    CGC: 2,
    SGC: 3,
    TAG: 4,
  };
  const service = grade.match(/^[A-Z+]+/)?.[0]?.replace(/\+.*/, "") ?? "ZZZ";
  const gradeNumber = Number.parseFloat(grade.match(/\d+(?:\.\d+)?/)?.[0] ?? "0");

  return (serviceOrder[service] ?? 8) * 100 + (10 - gradeNumber);
}

function sortPopulationGrades(grades: PopulationGradeCount[]) {
  return [...grades].sort((left, right) => gradeSortKey(left.grade) - gradeSortKey(right.grade));
}

/** Prefer official PSA grade rows, then derive counts from graded price snapshots when needed. */
export function resolvePopulationGrades(card: TcgCard): PopulationGradeCount[] {
  if (card.psaPopulation.grades.length > 0) {
    return sortPopulationGrades(card.psaPopulation.grades);
  }

  const derived = new Map<string, PopulationGradeCount>();

  for (const price of card.gradedPrices) {
    if (price.grade === "Ungraded" || price.populationCount <= 0) {
      continue;
    }

    if (!/^(PSA|BGS|BECKETT|CGC|SGC|TAG)\b/i.test(price.grade)) {
      continue;
    }

    derived.set(price.grade, {
      grade: price.grade,
      count: price.populationCount,
      service: price.service,
      confidence: price.confidence ?? "medium",
      confidenceScore: price.confidenceScore ?? 0.58,
      evidenceType: "population",
      sourceUrl: price.sourceUrl,
      warning: price.warning,
    });
  }

  if (derived.size > 0) {
    return sortPopulationGrades([...derived.values()]);
  }

  return [];
}

export function resolvePopulationTotal(card: TcgCard, grades: PopulationGradeCount[]) {
  if (typeof card.psaPopulation.totalCertified === "number") {
    return card.psaPopulation.totalCertified;
  }

  if (!grades.length) {
    return null;
  }

  return grades.reduce((sum, grade) => sum + grade.count, 0);
}
