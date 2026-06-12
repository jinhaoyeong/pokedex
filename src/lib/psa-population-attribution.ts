import type { PsaPopulationSnapshot } from "@/types/pokemon";

/** Client-safe helper — do not import psa-population.ts from client components. */
export function usesEnglishParallelPsaPopulation(snapshot: PsaPopulationSnapshot) {
  return snapshot.attribution === "english_parallel_psa";
}

export function hasPopulationTable(snapshot: PsaPopulationSnapshot | null | undefined) {
  return Boolean(snapshot && (snapshot.grades.length > 0 || typeof snapshot.totalCertified === "number"));
}
