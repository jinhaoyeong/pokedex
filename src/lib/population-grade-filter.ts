import type { PsaPopulationSnapshot } from "@/types/pokemon";

export const POPULATION_GRADER_FILTERS = ["all", "psa", "cgc"] as const;
export type PopulationGraderFilter = (typeof POPULATION_GRADER_FILTERS)[number];

function parsePopulationGradeNumber(gradeLabel: string) {
  const match = gradeLabel.match(/(\d+(?:\.\d+)?)$/);
  return match ? match[1] : null;
}

export function comparePopulationGradeDesc(
  left: { grade: string },
  right: { grade: string },
) {
  return (
    Number(parsePopulationGradeNumber(right.grade) ?? 0) -
    Number(parsePopulationGradeNumber(left.grade) ?? 0)
  );
}

export function sortPopulationGradesDesc<T extends { grade: string }>(grades: T[]): T[] {
  return [...grades].sort(comparePopulationGradeDesc);
}

export function aggregatePopulationGrades(
  grades: PsaPopulationSnapshot["grades"],
  filter: PopulationGraderFilter,
): PsaPopulationSnapshot["grades"] {
  if (filter === "psa") {
    return sortPopulationGradesDesc(
      grades.filter((grade) => grade.grade.startsWith("PSA ") && !grade.grade.includes("+")),
    );
  }

  if (filter === "cgc") {
    return sortPopulationGradesDesc(grades.filter((grade) => grade.grade.startsWith("CGC ")));
  }

  const byGrade = new Map<string, { psa: number; cgc: number }>();

  for (const grade of grades) {
    const gradeNumber = parsePopulationGradeNumber(grade.grade);

    if (!gradeNumber) {
      continue;
    }

    const entry = byGrade.get(gradeNumber) ?? { psa: 0, cgc: 0 };

    if (grade.grade.startsWith("PSA+CGC ")) {
      entry.cgc += grade.count;
    } else if (grade.grade.startsWith("PSA ")) {
      entry.psa += grade.count;
    } else if (grade.grade.startsWith("CGC ")) {
      entry.cgc += grade.count;
    }

    byGrade.set(gradeNumber, entry);
  }

  return [...byGrade.entries()]
    .sort((left, right) => Number(right[0]) - Number(left[0]))
    .map(([gradeNumber, counts]) => {
      const total = counts.psa + counts.cgc;
      const label =
        counts.psa > 0 && counts.cgc > 0
          ? `PSA+CGC ${gradeNumber}`
          : counts.psa > 0
            ? `PSA ${gradeNumber}`
            : `CGC ${gradeNumber}`;

      return {
        grade: label,
        count: total,
        service: counts.psa > 0 && counts.cgc > 0 ? undefined : counts.psa > 0 ? "PSA" : "CGC",
        confidence: "medium" as const,
        confidenceScore: counts.psa > 0 && counts.cgc > 0 ? 0.66 : counts.psa > 0 ? 0.72 : 0.68,
        evidenceType: "population" as const,
      };
    });
}

export function getFilteredPopulationTotal(
  grades: PsaPopulationSnapshot["grades"],
  filter: PopulationGraderFilter,
  snapshotTotal: number | null | undefined,
) {
  const filtered = aggregatePopulationGrades(grades, filter);
  const sum = filtered.reduce((total, grade) => total + grade.count, 0);

  if (sum > 0) {
    return sum;
  }

  return filter === "all" ? snapshotTotal ?? null : null;
}
