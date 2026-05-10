"use client";

import type { PsaPopulationSnapshot } from "@/types/pokemon";

const STORAGE_KEY = "pokedex-manual-psa-populations-v1";
const STORAGE_EVENT = "pokedex:manual-psa-populations-updated";

function readSnapshotMap() {
  if (typeof window === "undefined") {
    return {} as Record<string, PsaPopulationSnapshot>;
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return {} as Record<string, PsaPopulationSnapshot>;
  }

  try {
    return JSON.parse(rawValue) as Record<string, PsaPopulationSnapshot>;
  } catch {
    return {} as Record<string, PsaPopulationSnapshot>;
  }
}

function writeSnapshotMap(map: Record<string, PsaPopulationSnapshot>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

export function getManualPsaPopulationSnapshot(cardId: string) {
  return readSnapshotMap()[cardId] ?? null;
}

export function getAllManualPsaPopulationSnapshots() {
  return readSnapshotMap();
}

export function saveManualPsaPopulationSnapshot(
  cardId: string,
  snapshot: PsaPopulationSnapshot,
) {
  const snapshotMap = readSnapshotMap();
  snapshotMap[cardId] = snapshot;
  writeSnapshotMap(snapshotMap);
}

export function subscribeToManualPsaPopulationSnapshots(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorageEvent = () => callback();

  window.addEventListener("storage", handleStorageEvent);
  window.addEventListener(STORAGE_EVENT, handleStorageEvent);

  return () => {
    window.removeEventListener("storage", handleStorageEvent);
    window.removeEventListener(STORAGE_EVENT, handleStorageEvent);
  };
}
