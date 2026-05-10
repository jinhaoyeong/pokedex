"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getManualPsaPopulationSnapshot,
  subscribeToManualPsaPopulationSnapshots,
} from "@/lib/manual-psa-pop-store";
import { mergePsaPopulationSnapshot } from "@/lib/psa-population";
import type { PsaPopulationSnapshot } from "@/types/pokemon";

export function PsaPopulationSummary({
  cardId,
  initialPopulation,
}: {
  cardId: string;
  initialPopulation: PsaPopulationSnapshot;
}) {
  const [manualPopulation, setManualPopulation] = useState<PsaPopulationSnapshot | null>(null);

  useEffect(() => {
    const sync = () => {
      setManualPopulation(getManualPsaPopulationSnapshot(cardId));
    };

    sync();
    return subscribeToManualPsaPopulationSnapshots(sync);
  }, [cardId]);

  const population = useMemo(
    () => mergePsaPopulationSnapshot(initialPopulation, manualPopulation),
    [initialPopulation, manualPopulation],
  );

  const psa10 = population.grades.find((grade) => grade.grade === "PSA 10");
  const psa9 = population.grades.find((grade) => grade.grade === "PSA 9");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
      <p className="text-sm text-slate-400">PSA Pop</p>
      <div className="mt-2 space-y-1">
        <p className="text-2xl font-semibold text-white">
          {psa10 ? `10: ${psa10.count.toLocaleString()}` : "Pending"}
        </p>
        <p className="text-sm text-slate-400">
          {psa9
            ? `9: ${psa9.count.toLocaleString()}`
            : typeof population.totalCertified === "number"
              ? `Total: ${population.totalCertified.toLocaleString()}`
              : "Official PSA grade sync pending"}
        </p>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {population.fetchedAt
          ? `Updated ${new Date(population.fetchedAt).toLocaleString()}`
          : "No PSA import saved yet"}
      </p>
    </div>
  );
}
