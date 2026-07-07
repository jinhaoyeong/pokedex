"use client";

import { useMemo, useState } from "react";

import { useCurrency } from "@/components/currency-provider";
import { SearchSelect } from "@/components/search/search-select";
import { formatCurrency } from "@/lib/cards";
import { readSettings } from "@/lib/settings-store";
import type { GradedPrice, MarketConfidence, PricePoint } from "@/types/pokemon";

type ChartRange = "1m" | "3m" | "6m" | "1y" | "all";
type PreparedPoint = PricePoint & {
  dateMs: number;
  isProjected?: boolean;
};
type ChartDatum = {
  date: string;
  dateMs: number;
  value: number;
  x: number;
  pointIndex: number;
  isProjected?: boolean;
};
type ChartSeries = {
  grade: string;
  color: string;
  confidence?: MarketConfidence;
  points: ChartDatum[];
  latestValue: number;
  isThin: boolean;
};

const RANGE_LABELS: Array<{ value: ChartRange; label: string }> = [
  { value: "1m", label: "30D" },
  { value: "3m", label: "90D" },
  { value: "6m", label: "180D" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "Max" },
];

const SERIES_COLORS = [
  "#ff5147",
  "#42a5ff",
  "#ff6b35",
  "#42d77d",
  "#d95cff",
  "#ef233c",
  "#6ee7ff",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#c084fc",
];

const PRIORITY_GRADES = [
  "Ungraded",
  "PSA 10",
  "PSA 9",
  "PSA 8",
  "BGS 10 Black",
  "BGS 10",
  "BGS 9.5",
  "CGC 10 Pristine",
  "CGC 10",
  "CGC 9.5",
  "SGC 10",
  "TAG 10",
];

const FALLBACK_NOW_MS = Date.UTC(2026, 0, 1);
const SPARSE_RANGE_FILL_THRESHOLD = 0.85;
const DAY_MS = 24 * 60 * 60 * 1000;

function getPointValue(point: PricePoint, grade: string): number | undefined {
  if (grade === "Ungraded") {
    if (typeof point.gradeValues?.Ungraded === "number") {
      return point.gradeValues.Ungraded;
    }

    if (!point.gradeValues || Object.keys(point.gradeValues).length === 0) {
      return point.value;
    }

    return undefined;
  }

  const graded = point.gradeValues?.[grade];
  return typeof graded === "number" ? graded : undefined;
}

function parseDateValue(date: string, index: number) {
  const relativeLabels: Record<string, number> = {
    "30d": 30,
    "7d": 7,
    "1d": 1,
    trend: 0.5,
    now: 0,
  };
  const relativeDays = relativeLabels[date.toLowerCase()];

  if (typeof relativeDays === "number") {
    return FALLBACK_NOW_MS - relativeDays * 24 * 60 * 60 * 1000 + index;
  }

  const parsed = Date.parse(date);

  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  return FALLBACK_NOW_MS - (5 - index) * 24 * 60 * 60 * 1000;
}

function formatAxisDate(date: string) {
  const relativeLabels: Record<string, string> = {
    "30d": "30d",
    "7d": "7d",
    "1d": "1d",
    trend: "Trend",
    now: "Now",
  };
  const relative = relativeLabels[date.toLowerCase()];

  if (relative) {
    return relative;
  }

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function rangeStartDate(range: ChartRange, latestDateMs: number) {
  const days = rangeDays(range);
  return days === null ? Number.NEGATIVE_INFINITY : latestDateMs - days * DAY_MS;
}

function rangeStartLabel(range: ChartRange) {
  if (range === "1m") return "30D";
  if (range === "3m") return "90D";
  if (range === "6m") return "180D";
  if (range === "1y") return "1Y";
  return null;
}

function rangeDays(range: ChartRange) {
  if (range === "1m") return 30;
  if (range === "3m") return 90;
  if (range === "6m") return 180;
  if (range === "1y") return 365;
  return null;
}

function isRelativeCatalogDate(date: string) {
  return ["30d", "7d", "1d", "trend", "now"].includes(date.toLowerCase());
}

function pointsForRange(points: PreparedPoint[], startDateMs: number) {
  if (startDateMs === Number.NEGATIVE_INFINITY) {
    return points;
  }

  return points.filter((point) => point.dateMs >= startDateMs);
}

function xForDate(dateMs: number, minDateMs: number, maxDateMs: number) {
  if (maxDateMs <= minDateMs) {
    return 50;
  }

  const span = Math.max(maxDateMs - minDateMs, 1);
  const leftPadding = 3;
  const rightAxisPadding = 22;
  const percent = Math.max(0, Math.min(100, ((dateMs - minDateMs) / span) * 100));
  return leftPadding + (percent / 100) * (100 - leftPadding - rightAxisPadding);
}

function buildAnchoredPoints(points: PricePoint[]) {
  return points
    .map((point, index) => ({
      ...point,
      dateMs: parseDateValue(point.date, index),
    }))
    .sort((left, right) => left.dateMs - right.dateMs);
}

function collectDisplayGrades({
  points,
  selectedGrade,
  gradedPrices,
  visibleGradeLabels,
}: {
  points: PreparedPoint[];
  selectedGrade: string;
  gradedPrices: GradedPrice[];
  visibleGradeLabels?: string[];
}) {
  const availableGrades = new Set<string>();

  for (const point of points) {
    if (!point.gradeValues || Object.keys(point.gradeValues).length === 0) {
      availableGrades.add("Ungraded");
    }

    for (const grade of Object.keys(point.gradeValues ?? {})) {
      availableGrades.add(grade);
    }
  }

  const ordered = visibleGradeLabels?.length
    ? visibleGradeLabels
    : [...new Set([selectedGrade, ...PRIORITY_GRADES, ...gradedPrices.map((price) => price.grade)])];

  return ordered.filter((grade) => availableGrades.has(grade));
}

function nearestPointIndex(mousePercent: number, points: Array<{ x: number }>) {
  if (!points.length) {
    return null;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const distance = Math.abs(points[index].x - mousePercent);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function getScaleConfig(values: number[]) {
  const positiveValues = values.filter((value) => value > 0);

  if (!positiveValues.length) {
    return {
      useLog: false,
      mapValue: (value: number) => value,
      minMapped: 0,
      maxMapped: 1,
      label: "Linear scale",
    };
  }

  const minRaw = Math.min(...positiveValues);
  const maxRaw = Math.max(...positiveValues);
  const useLog = minRaw > 0 && maxRaw / minRaw >= 8;
  const mappedValues = positiveValues.map((value) => (useLog ? Math.log10(value + 1) : value));
  const minMapped = Math.min(...mappedValues);
  const maxMapped = Math.max(...mappedValues);

  return {
    useLog,
    mapValue: (value: number) => (useLog ? Math.log10(value + 1) : value),
    minMapped,
    maxMapped,
    label: useLog ? "Compressed scale" : "Linear scale",
  };
}

function getPaddedScaleValues(values: number[]) {
  const positiveValues = values.filter((value) => value > 0);

  if (!positiveValues.length) {
    return positiveValues;
  }

  if (positiveValues.length === 1) {
    const value = positiveValues[0];
    const padding = Math.max(value * 0.22, 1);

    return [Math.max(0.01, value - padding), value, value + padding];
  }

  const minValue = Math.min(...positiveValues);
  const maxValue = Math.max(...positiveValues);
  const padding = Math.max((maxValue - minValue) * 0.14, maxValue * 0.035, 1);

  return [Math.max(0.01, minValue - padding), ...positiveValues, maxValue + padding];
}

function yForValue(
  value: number,
  mapValue: (value: number) => number,
  minMapped: number,
  mappedRange: number,
) {
  const y = 100 - ((mapValue(value) - minMapped) / mappedRange) * 100;
  return Math.max(0, Math.min(100, y));
}

function straightPathFromPoints(
  points: ChartDatum[],
  mapValue: (value: number) => number,
  minMapped: number,
  mappedRange: number,
) {
  return points
    .map((point, index) => {
      const y = yForValue(point.value, mapValue, minMapped, mappedRange);
      return `${index === 0 ? "M" : "L"} ${point.x} ${y}`;
    })
    .join(" ");
}

function areaPathFromPoints(
  points: ChartDatum[],
  mapValue: (value: number) => number,
  minMapped: number,
  mappedRange: number,
) {
  if (points.length < 2) {
    return "";
  }

  const linePath = straightPathFromPoints(points, mapValue, minMapped, mappedRange);
  const first = points[0];
  const last = points[points.length - 1];

  return `${linePath} L ${last.x} 100 L ${first.x} 100 Z`;
}

function inverseMappedValue(value: number, useLog: boolean) {
  return useLog ? 10 ** value - 1 : value;
}

function interpolatedValueAtX({
  points,
  x,
  mapValue,
  useLog,
  requireDrawnSegment = false,
}: {
  points: ChartDatum[];
  x: number;
  mapValue: (value: number) => number;
  useLog: boolean;
  requireDrawnSegment?: boolean;
}) {
  if (!points.length) {
    return null;
  }

  if (requireDrawnSegment && points.length < 2) {
    return null;
  }

  if (points.length === 1) {
    return Math.abs(x - points[0].x) <= 1.5 ? points[0].value : null;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const edgeTolerance = 0.0001;

  if (x < first.x - edgeTolerance || x > last.x + edgeTolerance) {
    return null;
  }

  if (x <= first.x) {
    return first.value;
  }

  if (x >= last.x) {
    return last.value;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index];
    const right = points[index + 1];

    if (x < left.x || x > right.x) {
      continue;
    }

    const span = Math.max(right.x - left.x, 0.0001);
    const ratio = (x - left.x) / span;
    const mappedLeft = mapValue(left.value);
    const mappedRight = mapValue(right.value);
    return inverseMappedValue(mappedLeft + (mappedRight - mappedLeft) * ratio, useLog);
  }

  return last.value;
}

function splitSeriesPoints(points: ChartDatum[]) {
  if (points.length <= 1) {
    return {
      mainPoints: points,
      projectedPoints: [] as ChartDatum[],
    };
  }

  const lastPoint = points[points.length - 1];

  if (!lastPoint.isProjected) {
    return {
      mainPoints: points,
      projectedPoints: [] as ChartDatum[],
    };
  }

  return {
    mainPoints: points.slice(0, -1),
    projectedPoints: points.slice(-2),
  };
}

function confidenceClass(confidence?: MarketConfidence) {
  if (confidence === "high") {
    return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  }
  if (confidence === "medium") {
    return "status-badge--medium";
  }
  return "border-amber-300/35 bg-amber-400/10 text-amber-100";
}

function rangeButtonLabel(range: ChartRange) {
  return RANGE_LABELS.find((entry) => entry.value === range)?.label ?? "Max";
}

export function PriceChart({
  points,
  selectedGrade,
  snapshotAmountUsd,
  gradedPrices = [],
  visibleGradeLabels,
  onSelectGrade,
  embedded = false,
}: {
  points: PricePoint[];
  selectedGrade: string;
  snapshotAmountUsd?: number;
  gradedPrices?: GradedPrice[];
  visibleGradeLabels?: string[];
  onSelectGrade?: (grade: string) => void;
  embedded?: boolean;
}) {
  const [selectedRange, setSelectedRange] = useState<ChartRange>(
    () => readSettings().defaultChartRange,
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const { currency, exchangeRates } = useCurrency();

  const chartModel = useMemo(() => {
    const anchoredPoints = buildAnchoredPoints(points);
    const latestDateMs = anchoredPoints.length
      ? Math.max(...anchoredPoints.map((point) => point.dateMs))
      : FALLBACK_NOW_MS;
    const startDateMs = rangeStartDate(selectedRange, latestDateMs);
    const visiblePoints = pointsForRange(anchoredPoints, startDateMs);
    const targetRangeDays = rangeDays(selectedRange);
    const displayGrades = collectDisplayGrades({
      points: visiblePoints.length ? visiblePoints : anchoredPoints,
      selectedGrade,
      gradedPrices,
      visibleGradeLabels,
    });
    const primaryGrade = displayGrades.includes(selectedGrade)
      ? selectedGrade
      : displayGrades[0] ?? selectedGrade;
    const primaryRangePoints = visiblePoints.filter((point) => {
      const value = getPointValue(point, primaryGrade);

      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        (selectedRange === "all" || point.dateMs >= startDateMs)
      );
    });
    const plotPoints = visiblePoints;
    const allDomainPoints = anchoredPoints.length ? anchoredPoints : visiblePoints;
    const domainMinDateMs =
      selectedRange === "all"
        ? allDomainPoints[0]?.dateMs ?? latestDateMs
        : startDateMs;
    const domainMaxDateMs =
      selectedRange === "all"
        ? allDomainPoints[allDomainPoints.length - 1]?.dateMs ?? latestDateMs
        : latestDateMs;
    const priceMeta = new Map(gradedPrices.map((price) => [price.grade, price]));
    const series = displayGrades
      .map((grade, index): ChartSeries | null => {
        let pointValues = plotPoints
          .map((point, pointIndex): ChartDatum | null => {
            const value = getPointValue(point, grade);

            if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
              return null;
            }

            return {
              date: point.date,
              dateMs: point.dateMs,
              value,
              x: xForDate(point.dateMs, domainMinDateMs, domainMaxDateMs),
              pointIndex,
              isProjected: point.isProjected,
            };
          })
          .filter((point): point is ChartDatum => point !== null);

        if (!pointValues.length && selectedRange !== "all") {
          const lastKnownPoint = [...anchoredPoints]
            .reverse()
            .find((point) => {
              const value = getPointValue(point, grade);
              return (
                point.dateMs < startDateMs &&
                typeof value === "number" &&
                Number.isFinite(value) &&
                value > 0
              );
            });
          const fallbackValue = lastKnownPoint ? getPointValue(lastKnownPoint, grade) : undefined;

          if (
            lastKnownPoint &&
            typeof fallbackValue === "number" &&
            Number.isFinite(fallbackValue) &&
            fallbackValue > 0
          ) {
            pointValues = [
              {
                date: new Date(domainMinDateMs).toISOString(),
                dateMs: domainMinDateMs,
                value: fallbackValue,
                x: xForDate(domainMinDateMs, domainMinDateMs, domainMaxDateMs),
                pointIndex: 0,
                isProjected: true,
              },
              {
                date: new Date(domainMaxDateMs).toISOString(),
                dateMs: domainMaxDateMs,
                value: fallbackValue,
                x: xForDate(domainMaxDateMs, domainMinDateMs, domainMaxDateMs),
                pointIndex: 1,
                isProjected: true,
              },
            ];
          }
        }

        if (!pointValues.length) {
          return null;
        }

        const meta = priceMeta.get(grade);

        return {
          grade,
          color: SERIES_COLORS[index % SERIES_COLORS.length],
          confidence: meta?.confidence,
          points: pointValues,
          latestValue: pointValues[pointValues.length - 1]?.value ?? 0,
          isThin: meta?.confidence === "low" || pointValues.length < 2,
        };
      })
      .filter((series): series is ChartSeries => Boolean(series));

    const allValues = series.flatMap((entry) => entry.points.map((point) => point.value));
    const selectedSeries = series.find((entry) => entry.grade === selectedGrade);
    const chartSeries = selectedSeries ? [selectedSeries] : series.slice(0, 1);
    const scaleValues = selectedSeries?.points.length
      ? selectedSeries.points.map((point) => point.value)
      : allValues;
    const safeScaleValues = scaleValues.length
      ? scaleValues
      : [
          typeof snapshotAmountUsd === "number" &&
          Number.isFinite(snapshotAmountUsd) &&
          snapshotAmountUsd > 0
            ? snapshotAmountUsd
            : 1,
        ];
    const scale = getScaleConfig(getPaddedScaleValues(safeScaleValues));
    const mappedRange = Math.max(scale.maxMapped - scale.minMapped, 1);
    const rangeLabel = rangeStartLabel(selectedRange);
    const coverageLabel = `Coverage ${rangeButtonLabel(selectedRange)}`;
    const coveragePoints =
      selectedRange === "all"
        ? chartSeries[0]?.points ?? []
        : chartSeries[0]?.points.filter((point) => point.dateMs >= startDateMs) ?? [];
    const selectedSpanMs =
      coveragePoints.length >= 2
        ? coveragePoints[coveragePoints.length - 1].dateMs - coveragePoints[0].dateMs
        : 0;
    const selectedCoverageDays = selectedSpanMs / DAY_MS;
    const selectedHasCatalogDates =
      chartSeries[0]?.points.some((point) => isRelativeCatalogDate(point.date)) ?? false;
    const hasLimitedRangeCoverage =
      targetRangeDays !== null &&
      coveragePoints.length >= 2 &&
      selectedCoverageDays < targetRangeDays * SPARSE_RANGE_FILL_THRESHOLD;
    const hasThinRangeCoverage =
      targetRangeDays !== null &&
      coveragePoints.length > 0 &&
      coveragePoints.length < 2;
    const hasNoRangeData =
      selectedRange !== "all" && primaryRangePoints.length === 0 && anchoredPoints.length > 0;
    const hasDrawableSeries = chartSeries.some((entry) => entry.points.length >= 2);
    const hasProjectedPoints = chartSeries.some((entry) =>
      entry.points.some((point) => point.isProjected),
    );
    return {
      axisLabels:
        selectedRange === "all"
          ? [
              allDomainPoints[0],
              allDomainPoints[Math.floor(allDomainPoints.length / 3)],
              allDomainPoints[Math.floor((allDomainPoints.length / 3) * 2)],
              allDomainPoints[allDomainPoints.length - 1],
            ]
              .filter(Boolean)
              .map((point) => formatAxisDate(point.date))
          : [rangeLabel ?? "", "Now"].filter(Boolean),
      coverageLabel,
      hasDrawableSeries,
      hasLimitedRangeCoverage: hasNoRangeData || hasLimitedRangeCoverage || hasThinRangeCoverage,
      hasNoRangeData,
      hasProjectedPoints,
      selectedHasCatalogDates,
      highValue: Math.max(...safeScaleValues),
      latestValue: chartSeries[0]?.latestValue ?? safeScaleValues[safeScaleValues.length - 1] ?? 0,
      lowValue: Math.min(...safeScaleValues),
      mapValue: scale.mapValue,
      mappedRange,
      minMapped: scale.minMapped,
      plottedSeries: chartSeries.map((entry) => {
        const { mainPoints, projectedPoints } = splitSeriesPoints(entry.points);

        return {
          ...entry,
          hoverPoints: [...mainPoints, ...projectedPoints.slice(mainPoints.length ? 1 : 0)],
        };
      }),
      scaleLabel: scale.label,
      selectedSeries,
      chartSeries,
      series,
      useLog: scale.useLog,
      visiblePoints,
      yTickValues: [
        Math.max(...safeScaleValues),
        (Math.max(...safeScaleValues) + Math.min(...safeScaleValues)) / 2,
        Math.min(...safeScaleValues),
      ].filter(
        (value, index, values) =>
          Number.isFinite(value) &&
          value > 0 &&
          values.findIndex((item) => Math.abs(item - value) < 0.01) === index,
      ),
    };
  }, [gradedPrices, points, selectedGrade, selectedRange, snapshotAmountUsd, visibleGradeLabels]);

  const hoveredPoint =
    hoveredIndex == null ? null : chartModel.plottedSeries[0]?.hoverPoints[hoveredIndex] ?? null;
  const hoverX =
    hoverPercent == null
      ? null
      : hoverPercent;
  const tooltipSeries = hoveredPoint
    ? chartModel.plottedSeries
        .map((series) => {
          if (hoverX == null) {
            return null;
          }

          const hoveredValue = interpolatedValueAtX({
            points: series.hoverPoints,
            x: hoverX,
            mapValue: chartModel.mapValue,
            useLog: chartModel.useLog,
            requireDrawnSegment: true,
          });

          return hoveredValue == null ? null : { ...series, hoveredValue };
        })
        .filter(
          (
            series,
          ): series is ChartSeries & { hoverPoints: ChartDatum[]; hoveredValue: number } =>
            series !== null,
        )
        .sort((left, right) => {
          if (left.grade === selectedGrade) return -1;
          if (right.grade === selectedGrade) return 1;
          return right.hoveredValue - left.hoveredValue;
        })
    : [];

  const selectedHoveredSeries = tooltipSeries.find((series) => series.grade === selectedGrade);
  const hoverY =
    selectedHoveredSeries == null
      ? null
      : yForValue(
          selectedHoveredSeries.hoveredValue,
          chartModel.mapValue,
          chartModel.minMapped,
          chartModel.mappedRange,
        );

  const selectedSeriesIsThin = chartModel.chartSeries.every((series) => series.isThin);
  const hoverMarkerY = hoverY == null ? null : Math.max(0, Math.min(100, hoverY));

  if (!chartModel.series.length) {
    const hasSnapshot =
      typeof snapshotAmountUsd === "number" &&
      Number.isFinite(snapshotAmountUsd) &&
      snapshotAmountUsd > 0;

    return (
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(180deg,var(--surface),var(--bg-2))] p-3 shadow-2xl sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--text-faint)]">
              Price chart
            </p>
            <h3 className="mt-1.5 font-[var(--font-game-copy)] text-lg font-black leading-tight text-white sm:mt-2 sm:text-2xl">Reliable history pending</h3>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-[6px] border border-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-slate-300">
            {selectedGrade}
          </span>
        </div>
        <div className="mt-3 rounded-[8px] border border-white/10 bg-white/5 p-3 text-sm leading-6 text-slate-300 sm:mt-5 sm:p-4">
          This range does not have enough dated market history to draw a reliable line. Latest
          snapshots stay visible below without being plotted as fake history.
        </div>
        {hasSnapshot ? (
          <div className="info-box info-box--accent mt-3 p-3 sm:mt-4 sm:p-4">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Latest {selectedGrade}
            </p>
            <p className="mt-2 text-2xl font-black leading-none text-white sm:text-4xl">
              {formatCurrency(snapshotAmountUsd, currency, exchangeRates)}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  const chartSelectValue =
    chartModel.series.find((series) => series.grade === selectedGrade)?.grade ??
    chartModel.series[0]?.grade ??
    selectedGrade;

  const shellClass = embedded
    ? "flex h-full flex-col"
    : "overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(180deg,var(--surface),var(--bg-2))] p-3 shadow-2xl sm:p-5";

  return (
    <div className={shellClass}>
      <div className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
            Price chart
          </p>
          <h3 className="mt-0.5 break-words font-[var(--font-game-copy)] text-base font-semibold leading-tight text-white sm:text-lg">
            {selectedGrade}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {!embedded ? (
            <span className="hidden min-h-8 items-center rounded-[6px] border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-dim)] lg:inline-flex">
              {chartModel.scaleLabel}
            </span>
          ) : null}
          <span
            className={`inline-flex min-h-8 items-center rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.06em] sm:text-[11px] ${
              chartModel.hasLimitedRangeCoverage
                ? "border-amber-300/35 bg-amber-400/10 text-amber-100"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            {chartModel.coverageLabel}
          </span>
          <div className="segment-control">
            {RANGE_LABELS.map((range) => (
              <button
                key={range.value}
                type="button"
                onClick={() => {
                  setHoveredIndex(null);
                  setHoverPercent(null);
                  setSelectedRange(range.value);
                }}
                className={`segment-btn ${
                  selectedRange === range.value ? "segment-btn--active" : ""
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-2.5 ${embedded ? "" : "sm:p-3"}`}>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <SearchSelect
            name="chartGrade"
            ariaLabel="Chart grade"
            value={chartSelectValue}
            disabled={!onSelectGrade}
            options={chartModel.series.map((series) => ({
              value: series.grade,
              label: `${series.grade} / ${series.confidence ?? "low"} / ${formatCurrency(series.latestValue, currency, exchangeRates)}`,
            }))}
            onChange={(nextGrade) => {
              setHoveredIndex(null);
              setHoverPercent(null);
              onSelectGrade?.(nextGrade);
            }}
          />
          {chartModel.chartSeries[0] ? (
            <span
              className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] sm:inline-flex ${confidenceClass(chartModel.chartSeries[0].confidence)}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: chartModel.chartSeries[0].color }}
              />
              {chartModel.chartSeries[0].confidence ?? "low"}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400 sm:text-[11px]">
          {hoveredPoint && selectedHoveredSeries ? (
            <span className="basis-full">
              Hover {formatAxisDate(hoveredPoint.date)}{" "}
              <strong className="font-black text-[var(--text)]">
                {formatCurrency(selectedHoveredSeries.hoveredValue, currency, exchangeRates)}
              </strong>
            </span>
          ) : null}
          <span>
            Latest{" "}
            <strong className="font-black text-[var(--text)]">
              {formatCurrency(chartModel.latestValue, currency, exchangeRates)}
            </strong>
          </span>
          <span>
            High{" "}
            <strong className="font-black text-slate-200">
              {formatCurrency(chartModel.highValue, currency, exchangeRates)}
            </strong>
          </span>
          <span>
            Low{" "}
            <strong className="font-black text-slate-200">
              {formatCurrency(chartModel.lowValue, currency, exchangeRates)}
            </strong>
          </span>
        </div>
      </div>

      <div
        className={`relative mt-3 touch-none select-none overflow-visible rounded-lg border border-white/10 bg-slate-950/35 ${embedded ? "h-44 sm:h-52" : "h-44 sm:h-80"}`}
        onPointerLeave={() => {
          setHoveredIndex(null);
          setHoverPercent(null);
        }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const mousePercent = Math.max(
            0,
            Math.min(
              100,
              ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 100,
            ),
          );
          setHoverPercent(mousePercent);
          setHoveredIndex(
            nearestPointIndex(
              mousePercent,
              chartModel.plottedSeries[0]?.hoverPoints.map((point) => ({
                x: point.x,
              })) ?? [],
            ),
          );
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {[0, 20, 40, 60, 80, 100].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="0.45"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[0, 25, 50, 75, 100].map((x) => (
            <line
              key={`x-${x}`}
              x1={x}
              x2={x}
              y1="0"
              y2="100"
              stroke="rgba(255,255,255,0.035)"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {chartModel.chartSeries.map((series) => (
            <g key={series.grade}>
              {(() => {
                const { mainPoints, projectedPoints } = splitSeriesPoints(series.points);
                const mainPath =
                  mainPoints.length >= 2
                    ? straightPathFromPoints(
                        mainPoints,
                        chartModel.mapValue,
                        chartModel.minMapped,
                        chartModel.mappedRange,
                      )
                    : "";
                const projectedPath =
                  projectedPoints.length >= 2
                    ? straightPathFromPoints(
                        projectedPoints,
                        chartModel.mapValue,
                        chartModel.minMapped,
                        chartModel.mappedRange,
                      )
                    : "";
                const areaPath = mainPoints.length >= 2
                  ? areaPathFromPoints(
                      mainPoints,
                      chartModel.mapValue,
                      chartModel.minMapped,
                      chartModel.mappedRange,
                    )
                  : "";
                const singlePointGuide =
                  mainPoints.length === 1
                    ? `M 7 ${yForValue(
                        mainPoints[0].value,
                        chartModel.mapValue,
                        chartModel.minMapped,
                        chartModel.mappedRange,
                      )} L 93 ${yForValue(
                        mainPoints[0].value,
                        chartModel.mapValue,
                        chartModel.minMapped,
                        chartModel.mappedRange,
                      )}`
                    : "";
                return (
                  <>
                    {areaPath ? (
                      <path
                        d={areaPath}
                        fill={series.color}
                        fillOpacity={series.grade === selectedGrade ? 0.1 : 0.04}
                      />
                    ) : null}
                    {singlePointGuide ? (
                      <>
                        <path
                          d={singlePointGuide}
                          fill="none"
                          stroke={series.color}
                          strokeWidth={6}
                          strokeOpacity="0.12"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                        />
                        <path
                          d={singlePointGuide}
                          fill="none"
                          stroke={series.color}
                          strokeWidth={2.25}
                          strokeOpacity="0.75"
                          strokeDasharray="3 3"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                        />
                      </>
                    ) : null}
                    {series.grade === selectedGrade && mainPath ? (
                      <path
                        d={mainPath}
                        fill="none"
                        stroke={series.color}
                        strokeWidth={7}
                        strokeOpacity="0.18"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                    {mainPath ? (
                      <path
                        d={mainPath}
                        fill="none"
                        stroke={series.color}
                        strokeWidth={series.grade === selectedGrade ? 3.3 : 1.15}
                        strokeOpacity={series.grade === selectedGrade ? 1 : 0.26}
                        strokeDasharray={series.isThin && !projectedPath ? "2 2.6" : undefined}
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                    {projectedPath ? (
                      <path
                        d={projectedPath}
                        fill="none"
                        stroke={series.color}
                        strokeWidth={series.grade === selectedGrade ? 3 : 1.1}
                        strokeOpacity={series.grade === selectedGrade ? 0.95 : 0.24}
                        strokeDasharray="2 2.8"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                  </>
                );
              })()}
            </g>
          ))}

        </svg>

        <div className="pointer-events-none absolute inset-0">
          {chartModel.yTickValues.map((value, index) => {
            const y = yForValue(
              value,
              chartModel.mapValue,
              chartModel.minMapped,
              chartModel.mappedRange,
            );

            return (
              <span
                key={`${value}-${index}`}
                className="absolute right-2 min-w-[5.75rem] whitespace-nowrap rounded bg-slate-950/80 px-1.5 py-0.5 text-right text-[10px] font-semibold leading-none text-slate-300 sm:right-3 sm:min-w-[6.75rem] sm:px-2 sm:py-1 sm:text-[11px]"
                style={{
                  top: `${Math.min(Math.max(y, 6), 94)}%`,
                  transform: "translateY(-50%)",
                }}
              >
                {formatCurrency(value, currency, exchangeRates)}
              </span>
            );
          })}
        </div>

        {chartModel.chartSeries.map((series) =>
          series.points.map((point, index) => {
            const y = yForValue(
              point.value,
              chartModel.mapValue,
              chartModel.minMapped,
              chartModel.mappedRange,
            );
            const isLatestPoint = index === series.points.length - 1;
            const isSelectedSeries = series.grade === selectedGrade;

            return (
              <span
                key={`${series.grade}-${point.date}-${point.value}-marker`}
                className={`pointer-events-none absolute rounded-full border-2 border-slate-950 ${
                  isSelectedSeries
                    ? isLatestPoint
                      ? "h-4 w-4"
                      : "h-3.5 w-3.5"
                    : "h-2.5 w-2.5 opacity-60"
                }`}
                style={{
                  left: `${point.x}%`,
                  top: `${y}%`,
                  transform: "translate(-50%, -50%)",
                  backgroundColor: series.color,
                  boxShadow: isSelectedSeries
                    ? `0 0 0 2px rgba(255,255,255,0.16), 0 0 18px ${series.color}80`
                    : undefined,
                }}
              />
            );
          }),
        )}

        {hoverX != null && hoverMarkerY != null && selectedHoveredSeries ? (
          <span
            className="pointer-events-none absolute h-5 w-5 rounded-full border-2 border-[#050816] shadow-[0_0_0_2px_rgba(255,255,255,0.22),0_0_18px_rgba(255,81,71,0.7)]"
            style={{
              left: `${hoverX}%`,
              top: `${hoverMarkerY}%`,
              transform: "translate(-50%, -50%)",
              backgroundColor: selectedHoveredSeries.color,
            }}
          />
        ) : null}

        {hoveredPoint && selectedHoveredSeries && hoverX != null && hoverMarkerY != null ? (
          <div
            className="pointer-events-none absolute z-10 rounded-[7px] border border-white/12 bg-slate-950/90 px-3 py-2 text-sm shadow-xl"
            style={{
              left: `${Math.min(Math.max(hoverX, 15), 85)}%`,
              top: `${Math.min(Math.max(hoverMarkerY - 12, 10), 82)}%`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <p className="font-semibold text-white">{formatAxisDate(hoveredPoint.date)}</p>
            <p className="mt-1 font-bold text-[var(--text)]">
              {formatCurrency(selectedHoveredSeries.hoveredValue, currency, exchangeRates)}
            </p>
          </div>
        ) : null}

      </div>

      {chartModel.hasLimitedRangeCoverage ? (
        <div className="mt-2.5 rounded-[6px] border border-amber-300/25 bg-slate-950/70 px-2.5 py-1.5 text-[11px] font-bold uppercase leading-5 tracking-[0.06em] text-amber-100 sm:mt-3 sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.07em]">
          {chartModel.selectedHasCatalogDates
            ? "Only current catalog movement is available. Use sold listings below for exact comps."
            : chartModel.hasNoRangeData
              ? "No sales in this period. Flat guide uses the last known price before this range."
              : "Limited dated comps in this range. The X-axis still spans the selected calendar window."}
        </div>
      ) : null}

      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[11px] text-slate-400 sm:mt-3 sm:flex sm:items-center sm:justify-between sm:text-xs">
        {chartModel.axisLabels.map((label, index) => (
          <span key={`${label}-${index}`} className="truncate">
            {label}
          </span>
        ))}
      </div>

      <div className="mt-4 hidden flex-wrap items-center justify-between gap-3 text-xs leading-5 text-slate-400 sm:flex">
        <span>
          {chartModel.useLog
            ? "Compressed scale keeps high and low grade prices readable together."
            : "Linear scale is active for the selected grade group."}
        </span>
        <span>
          {selectedSeriesIsThin
            ? "Selected line is based on thin evidence."
            : !chartModel.hasDrawableSeries
              ? "Not enough dated points to draw a reliable path."
              : chartModel.hasProjectedPoints
                ? "Dashed segment extends last sold history to the current fetched snapshot."
            : "Line uses dated market history only."}
        </span>
      </div>
    </div>
  );
}
