const DEFAULT_MISMATCH_RATIO = 0.25;

export function isPositiveFinite(value: number | undefined | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Snapshot/guide charts must plot the same Ungraded figure as Grade Values.
 * Leftover priceHistory snapshots (or a lone sold-comp median) otherwise show
 * a different MYR amount than the selected TCGPlayer catalog row.
 */
export function resolveGuideChartValue(
  liveGradeValue: number | undefined,
  historyValues: number[],
  historyStatus?: string,
  mismatchRatio = DEFAULT_MISMATCH_RATIO,
): number | undefined {
  const live = isPositiveFinite(liveGradeValue) ? liveGradeValue : undefined;
  const lastHistory = [...historyValues].reverse().find(isPositiveFinite);

  if (!live) {
    return lastHistory;
  }

  if (historyStatus === "snapshot_only" || historyStatus === "unavailable") {
    return live;
  }

  if (!lastHistory) {
    return live;
  }

  if (Math.abs(lastHistory - live) / live > mismatchRatio) {
    return live;
  }

  return lastHistory;
}
