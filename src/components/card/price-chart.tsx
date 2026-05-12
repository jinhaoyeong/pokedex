"use client";

import { useMemo, useState } from "react";

import { useCurrency } from "@/components/currency-provider";
import { formatCurrency } from "@/lib/cards";
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
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

const SERIES_COLORS = [
  "#ffcb05",
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
    trend: 0,
    now: 0,
  };
  const relativeDays = relativeLabels[date.toLowerCase()];

  if (typeof relativeDays === "number") {
    return FALLBACK_NOW_MS - relativeDays * 24 * 60 * 60 * 1000 - index;
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
  const date = new Date(latestDateMs);

  if (range === "1m") {
    date.setMonth(date.getMonth() - 1);
    return date.getTime();
  }

  if (range === "3m") {
    date.setMonth(date.getMonth() - 3);
    return date.getTime();
  }

  if (range === "6m") {
    date.setMonth(date.getMonth() - 6);
    return date.getTime();
  }

  if (range === "1y") {
    date.setFullYear(date.getFullYear() - 1);
    return date.getTime();
  }

  return Number.NEGATIVE_INFINITY;
}

function rangeStartLabel(range: ChartRange) {
  if (range === "1m") return "1M";
  if (range === "3m") return "3M";
  if (range === "6m") return "6M";
  if (range === "1y") return "1Y";
  return null;
}

function pointsForRange(points: PreparedPoint[], startDateMs: number) {
  if (startDateMs === Number.NEGATIVE_INFINITY) {
    return points;
  }

  const firstInRangeIndex = points.findIndex((point) => point.dateMs >= startDateMs);

  if (firstInRangeIndex < 0) {
    return [];
  }

  const ranged = points.slice(firstInRangeIndex);
  const previous = firstInRangeIndex > 0 ? points[firstInRangeIndex - 1] : null;

  return previous ? [previous, ...ranged] : ranged;
}

function xForDate(dateMs: number, minDateMs: number, maxDateMs: number) {
  const span = Math.max(maxDateMs - minDateMs, 1);
  return Math.max(0, Math.min(100, ((dateMs - minDateMs) / span) * 100));
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

  if (positiveValues.length < 2) {
    return positiveValues;
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
    return "border-blue-300/30 bg-blue-500/10 text-blue-100";
  }
  return "border-yellow-200/30 bg-yellow-300/10 text-yellow-100";
}

export function PriceChart({
  points,
  selectedGrade,
  snapshotAmountUsd,
  gradedPrices = [],
  visibleGradeLabels,
  onSelectGrade,
}: {
  points: PricePoint[];
  selectedGrade: string;
  snapshotAmountUsd?: number;
  gradedPrices?: GradedPrice[];
  visibleGradeLabels?: string[];
  onSelectGrade?: (grade: string) => void;
}) {
  const [selectedRange, setSelectedRange] = useState<ChartRange>("all");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const { currency, exchangeRates } = useCurrency();

  const chartModel = useMemo(() => {
    const anchoredPoints = buildAnchoredPoints(points);
    const latestDateMs = Math.max(
      ...anchoredPoints.map((point) => point.dateMs),
      FALLBACK_NOW_MS,
    );
    const startDateMs = rangeStartDate(selectedRange, latestDateMs);
    const visiblePoints = pointsForRange(anchoredPoints, startDateMs);
    const domainMinDateMs = visiblePoints[0]?.dateMs ?? latestDateMs;
    const domainMaxDateMs = visiblePoints[visiblePoints.length - 1]?.dateMs ?? latestDateMs;
    const displayGrades = collectDisplayGrades({
      points: visiblePoints,
      selectedGrade,
      gradedPrices,
      visibleGradeLabels,
    });
    const priceMeta = new Map(gradedPrices.map((price) => [price.grade, price]));
    const series = displayGrades
      .map((grade, index): ChartSeries | null => {
        let pointValues = visiblePoints
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
    const axisDates =
      visiblePoints.length > 4
        ? [
            visiblePoints[0],
            visiblePoints[Math.floor(visiblePoints.length / 3)],
            visiblePoints[Math.floor((visiblePoints.length / 3) * 2)],
            visiblePoints[visiblePoints.length - 1],
          ]
        : visiblePoints;

    const rangeLabel = rangeStartLabel(selectedRange);

    return {
      axisLabels: rangeLabel
        ? [rangeLabel, "Now"]
        : axisDates.map((point) => formatAxisDate(point.date)),
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
      ].filter((value) => Number.isFinite(value) && value > 0),
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

  if (!chartModel.series.length) {
    const hasSnapshot =
      typeof snapshotAmountUsd === "number" &&
      Number.isFinite(snapshotAmountUsd) &&
      snapshotAmountUsd > 0;

    return (
      <div className="overflow-hidden rounded-[10px] border-2 border-yellow-200/50 bg-gradient-to-br from-slate-950 via-[#101a3a] to-slate-950 p-3 shadow-[6px_6px_0_rgba(0,0,0,0.42)] sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
              Price chart
            </p>
            <h3 className="mt-2 text-base font-black text-white sm:text-xl">Reliable history pending</h3>
          </div>
          <span className="rounded-[6px] border border-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-300">
            {selectedGrade}
          </span>
        </div>
        <div className="mt-5 rounded-[8px] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          This range does not have enough dated market history to draw a reliable line. Latest
          snapshots stay visible below without being plotted as fake history.
        </div>
        {hasSnapshot ? (
          <div className="mt-4 rounded-[8px] border border-blue-300/25 bg-blue-500/10 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">
              Latest {selectedGrade}
            </p>
            <p className="mt-2 text-3xl font-black text-white">
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

  return (
    <div className="overflow-hidden rounded-[10px] border-2 border-yellow-200/50 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.025)_0_2px,transparent_2px_10px),linear-gradient(180deg,rgba(6,13,28,0.98),rgba(8,18,36,0.96))] p-3 shadow-[0_0_0_3px_#050816,8px_8px_0_rgba(0,0,0,0.42)] sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-yellow-200 sm:text-xs sm:tracking-[0.24em]">
            Price chart
          </p>
          <h3 className="text-base font-black text-white sm:text-2xl">
            {selectedGrade} market path
          </h3>
          <p className="hidden text-xs font-bold uppercase tracking-[0.18em] text-slate-400 sm:block">
            Active grade: <span className="text-yellow-100">{selectedGrade}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end sm:gap-2">
          <span className="hidden rounded-[6px] border border-blue-200/20 bg-blue-400/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-100 sm:inline-flex">
            {chartModel.scaleLabel}
          </span>
          {RANGE_LABELS.map((range) => (
            <button
              key={range.value}
              type="button"
              onClick={() => {
                setHoveredIndex(null);
                setHoverPercent(null);
                setSelectedRange(range.value);
              }}
              className={`rounded-[6px] border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] transition sm:px-3 sm:text-xs sm:tracking-[0.16em] ${
                selectedRange === range.value
                  ? "border-yellow-200/70 bg-yellow-300/12 text-yellow-100"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-yellow-200/35 hover:text-white"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-[8px] border border-white/10 bg-slate-950/60 p-2.5 sm:mt-4 sm:p-3">
        <label
          htmlFor="price-chart-grade"
          className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 sm:text-[11px] sm:tracking-[0.18em]"
        >
          Chart grade
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
          <select
            id="price-chart-grade"
            value={chartSelectValue}
            onChange={(event) => {
              setHoveredIndex(null);
              setHoverPercent(null);
              onSelectGrade?.(event.target.value);
            }}
            disabled={!onSelectGrade}
            className="w-full rounded-[8px] border border-yellow-200/25 bg-[#050816] px-3 py-2 text-xs font-bold text-white outline-none transition focus:border-yellow-200/75 disabled:opacity-60 sm:text-sm"
          >
            {chartModel.series.map((series) => (
              <option key={series.grade} value={series.grade}>
                {series.grade} / {series.confidence ?? "low"} /{" "}
                {formatCurrency(series.latestValue, currency, exchangeRates)}
              </option>
            ))}
          </select>
          <div className="hidden flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.14em] sm:flex">
            {chartModel.chartSeries.map((series) => (
              <span
                key={series.grade}
                className={`inline-flex items-center gap-2 rounded-[6px] border px-2.5 py-1 ${confidenceClass(series.confidence)}`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                {series.confidence ?? "low"} confidence
              </span>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">
          {hoveredPoint && selectedHoveredSeries ? (
            <span className="basis-full">
              Hover {formatAxisDate(hoveredPoint.date)}{" "}
              <strong className="font-black text-yellow-100">
                {formatCurrency(selectedHoveredSeries.hoveredValue, currency, exchangeRates)}
              </strong>
            </span>
          ) : null}
          <span>
            Latest{" "}
            <strong className="font-black text-yellow-100">
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
        className="relative mt-3 h-52 touch-none select-none overflow-visible sm:mt-5 sm:h-80"
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
                return (
                  <>
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

          {hoverX != null
            ? tooltipSeries.map((series) => {
                const hoverMarkerY = yForValue(
                  series.hoveredValue,
                  chartModel.mapValue,
                  chartModel.minMapped,
                  chartModel.mappedRange,
                );
                const markerSize = series.grade === selectedGrade ? 2.7 : 2;

                return (
                  <circle
                    key={`${series.grade}-hover-marker`}
                    cx={hoverX}
                    cy={hoverMarkerY}
                    r={markerSize}
                    fill={series.color}
                    fillOpacity={series.grade === selectedGrade ? 1 : 0.62}
                    stroke="#050816"
                    strokeWidth="0.85"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })
            : null}

        </svg>

      </div>

      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-400 sm:mt-3 sm:flex sm:items-center sm:justify-between sm:text-xs">
        {chartModel.axisLabels.map((label, index) => (
          <span key={`${label}-${index}`} className="truncate">
            {label}
          </span>
        ))}
      </div>

      <div className="mt-3 hidden flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 sm:flex">
        <span>
          {chartModel.useLog
            ? "Compressed scale keeps high and low grade prices readable together."
            : "Linear scale is active for the selected grade group."}
        </span>
        <span>
          {selectedSeriesIsThin
            ? "Selected line is based on thin evidence."
            : "Line uses dated market history only."}
        </span>
      </div>
    </div>
  );
}
