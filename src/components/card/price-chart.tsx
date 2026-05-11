"use client";

import { useMemo, useState } from "react";

import { useCurrency } from "@/components/currency-provider";
import { formatCurrency } from "@/lib/cards";
import type { GradedPrice, PricePoint } from "@/types/pokemon";

type ChartRange = "6m" | "1y" | "5y" | "all";
type ChartDatum = { date: string; value: number; pointIndex: number };
type ChartSeries = {
  grade: string;
  color: string;
  strokeWidth: number;
  points: ChartDatum[];
};

const RANGE_LABELS: Array<{ value: ChartRange; label: string }> = [
  { value: "6m", label: "6m" },
  { value: "1y", label: "1y" },
  { value: "5y", label: "5y" },
  { value: "all", label: "All" },
];

const SERIES_COLORS = [
  "#0574df",
  "#e14a00",
  "#6b7280",
  "#525252",
  "#8b5cf6",
  "#059669",
  "#d97706",
  "#be123c",
];

const PRIORITY_GRADES = [
  "Ungraded",
  "PSA 10",
  "PSA 9",
  "PSA 8",
  "BGS 10",
  "BGS 9.5",
  "CGC 10",
  "CGC 9.5",
  "SGC 10",
  "TAG 10",
];
const FALLBACK_NOW_MS = Date.UTC(2026, 0, 1);

function getPointValue(point: PricePoint, selectedGrade: string): number | undefined {
  if (selectedGrade === "Ungraded") {
    if (typeof point.gradeValues?.Ungraded === "number") {
      return point.gradeValues.Ungraded;
    }

    if (!point.gradeValues || Object.keys(point.gradeValues).length === 0) {
      return point.value;
    }

    return undefined;
  }

  const graded = point.gradeValues?.[selectedGrade];
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
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function pathFromPoints(
  points: ChartDatum[],
  minValue: number,
  range: number,
  maxIndex: number,
) {
  return points
    .map((point, index) => {
      const x = (point.pointIndex / Math.max(maxIndex, 1)) * 100;
      const y = 100 - ((point.value - minValue) / range) * 100;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function rangeStartDate(range: ChartRange, latestDateMs: number) {
  const date = new Date(latestDateMs);

  if (range === "6m") {
    date.setMonth(date.getMonth() - 6);
    return date.getTime();
  }

  if (range === "1y") {
    date.setFullYear(date.getFullYear() - 1);
    return date.getTime();
  }

  if (range === "5y") {
    date.setFullYear(date.getFullYear() - 5);
    return date.getTime();
  }

  return Number.NEGATIVE_INFINITY;
}

function collectDisplayGrades(
  points: PricePoint[],
  selectedGrade: string,
  gradedPrices: GradedPrice[],
) {
  const availableGrades = new Set<string>();

  for (const point of points) {
    if (!point.gradeValues || Object.keys(point.gradeValues).length === 0) {
      availableGrades.add("Ungraded");
    }

    for (const grade of Object.keys(point.gradeValues ?? {})) {
      availableGrades.add(grade);
    }
  }

  for (const price of gradedPrices) {
    if (price.confidence !== "low" || (price.saleCount ?? 0) >= 2) {
      availableGrades.add(price.grade);
    }
  }

  const ordered = [
    selectedGrade,
    ...PRIORITY_GRADES,
    ...gradedPrices.map((price) => price.grade),
    ...availableGrades,
  ];

  return [...new Set(ordered)]
    .filter((grade) => availableGrades.has(grade))
    .slice(0, 5);
}

function nearestPointIndex(mouseX: number, width: number, maxIndex: number) {
  if (width <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(maxIndex, Math.round((mouseX / width) * maxIndex)));
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function PriceChart({
  points,
  selectedGrade,
  snapshotAmountUsd,
  gradedPrices = [],
}: {
  points: PricePoint[];
  selectedGrade: string;
  snapshotAmountUsd?: number;
  gradedPrices?: GradedPrice[];
}) {
  const [selectedRange, setSelectedRange] = useState<ChartRange>("all");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { currency, exchangeRates } = useCurrency();

  const chartModel = useMemo(() => {
    const indexedPoints = points.map((point, index) => ({
      ...point,
      dateMs: parseDateValue(point.date, index),
      originalIndex: index,
    }));
    const latestDateMs = Math.max(...indexedPoints.map((point) => point.dateMs), FALLBACK_NOW_MS);
    const startDateMs = rangeStartDate(selectedRange, latestDateMs);
    const rangedPoints = indexedPoints.filter((point) => point.dateMs >= startDateMs);
    const visiblePoints = rangedPoints.length ? rangedPoints : indexedPoints;
    const displayGrades = collectDisplayGrades(visiblePoints, selectedGrade, gradedPrices);
    const maxIndex = Math.max(visiblePoints.length - 1, 1);

    const rawSeries = displayGrades
      .map((grade, gradeIndex): ChartSeries | null => {
        const observedPoints = visiblePoints
          .map((point, pointIndex) => {
            const value = getPointValue(point, grade);

            if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
              return null;
            }

            return { date: point.date, value, pointIndex };
          })
          .filter((point): point is ChartDatum => Boolean(point));

        if (!observedPoints.length) {
          return null;
        }

        return {
          grade,
          color:
            grade === "Ungraded"
              ? SERIES_COLORS[0]
              : SERIES_COLORS[(gradeIndex % (SERIES_COLORS.length - 1)) + 1],
          strokeWidth: grade === selectedGrade ? 2.4 : 1.5,
          points: observedPoints,
        };
      })
      .filter((series): series is ChartSeries => Boolean(series));
    const selectedSeries = rawSeries.find((series) => series.grade === selectedGrade);
    const selectedMedian = selectedSeries ? median(selectedSeries.points.map((point) => point.value)) : 0;
    const series = rawSeries.filter((item) => {
      if (item.grade === selectedGrade) {
        return true;
      }

      if (!selectedMedian) {
        return item.grade === "Ungraded";
      }

      const itemMedian = median(item.points.map((point) => point.value));
      const ratio = Math.max(itemMedian / selectedMedian, selectedMedian / itemMedian);

      return ratio <= 8;
    });
    const allValues = series.flatMap((item) => item.points.map((point) => point.value));
    const minRaw = Math.min(...allValues);
    const maxRaw = Math.max(...allValues);
    const padding = Math.max((maxRaw - minRaw) * 0.12, maxRaw * 0.06, 1);
    const minValue = Math.max(0, minRaw - padding);
    const maxValue = maxRaw + padding;
    const range = maxValue - minValue || 1;
    const axisDates = visiblePoints.length > 3
      ? [
          visiblePoints[0],
          visiblePoints[Math.floor(visiblePoints.length / 3)],
          visiblePoints[Math.floor((visiblePoints.length / 3) * 2)],
          visiblePoints[visiblePoints.length - 1],
        ]
      : visiblePoints;

    const hasTrendLine = series.some((item) => item.points.length > 1);

    return {
      axisDates,
      hasTrendLine,
      maxIndex,
      maxValue,
      minValue,
      range,
      series,
      visiblePoints,
    };
  }, [gradedPrices, points, selectedGrade, selectedRange]);

  if (!chartModel.series.length || !chartModel.hasTrendLine) {
    const hasSnapshot =
      typeof snapshotAmountUsd === "number" &&
      Number.isFinite(snapshotAmountUsd) &&
      snapshotAmountUsd > 0;

    return (
      <div className="overflow-hidden rounded-3xl border border-yellow-200/20 bg-gradient-to-br from-slate-950 via-[#101a3a] to-slate-950 p-5 shadow-2xl shadow-blue-950/20 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-yellow-200">
              Price chart
            </p>
            <h3 className="mt-2 text-xl font-black text-white">Not enough trend data yet</h3>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-300">
            {selectedGrade}
          </span>
        </div>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          This card has snapshot pricing, but not enough dated sold comps to draw a reliable line chart. I’m showing the latest selected-grade value instead of drawing a misleading spike.
        </div>
        {hasSnapshot ? (
          <div className="mt-4 rounded-2xl border border-blue-300/30 bg-blue-500/10 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">
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

  const hoveredPoint =
    hoveredIndex == null ? null : chartModel.visiblePoints[hoveredIndex] ?? null;
  const tooltipSeries = hoveredPoint
    ? chartModel.series
        .map((series) => {
          const point = series.points.find((item) => item.pointIndex === hoveredIndex);
          return point ? { ...series, value: point.value } : null;
        })
        .filter((item): item is ChartSeries & { value: number } => Boolean(item))
        .slice(0, 4)
    : [];
  const hoverX =
    hoveredIndex == null
      ? null
      : (hoveredIndex / Math.max(chartModel.maxIndex, 1)) * 100;
  const yTicks = [chartModel.maxValue, (chartModel.maxValue + chartModel.minValue) / 2, chartModel.minValue];

  return (
    <div className="overflow-hidden rounded-3xl border border-blue-300/25 bg-gradient-to-br from-white via-slate-50 to-blue-50 p-4 text-slate-950 shadow-2xl shadow-blue-950/15 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-600">Zoom</span>
          {RANGE_LABELS.map((range) => (
            <button
              key={range.value}
              type="button"
              onClick={() => setSelectedRange(range.value)}
              className={`rounded px-2 py-1 font-semibold transition ${
                selectedRange === range.value
                  ? "bg-blue-50 text-blue-900"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        <a
          href="#graded-prices"
          className="text-right text-xs font-medium text-blue-700 underline underline-offset-2"
        >
          Compare vs Other Items
        </a>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-x-5 gap-y-2 border-t border-slate-200 pt-2 text-xs">
        {chartModel.series.map((series) => (
          <span key={series.grade} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            <span className="text-slate-800">{series.grade}</span>
          </span>
        ))}
      </div>

      <div
        className="relative mt-2 h-60 select-none overflow-visible pr-10"
        onMouseLeave={() => setHoveredIndex(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHoveredIndex(nearestPointIndex(event.clientX - bounds.left, bounds.width - 40, chartModel.maxIndex));
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-[calc(100%-2.5rem)] overflow-visible"
        >
          {[0, 25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth="0.45"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {chartModel.series.map((series) => (
            <path
              key={series.grade}
              d={pathFromPoints(series.points, chartModel.minValue, chartModel.range, chartModel.maxIndex)}
              fill="none"
              stroke={series.color}
              strokeWidth={series.strokeWidth}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {hoverX != null ? (
            <line
              x1={hoverX}
              x2={hoverX}
              y1="0"
              y2="100"
              stroke="#c7c7c7"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {hoverX != null
            ? tooltipSeries.map((series) => {
                const y = 100 - ((series.value - chartModel.minValue) / chartModel.range) * 100;

                return (
                  <circle
                    key={series.grade}
                    cx={hoverX}
                    cy={y}
                    r="2.2"
                    fill={series.color}
                    stroke="#fff"
                    strokeWidth="1.2"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })
            : null}
        </svg>

        <div className="pointer-events-none absolute bottom-0 right-0 top-0 flex flex-col justify-between text-right text-xs text-slate-900">
          {yTicks.map((tick) => (
            <span key={tick}>{formatCurrency(tick, currency, exchangeRates)}</span>
          ))}
        </div>

        {hoverX != null && hoveredPoint ? (
          <div
            className="pointer-events-none absolute top-[42%] z-10 min-w-36 -translate-y-1/2 rounded bg-neutral-600/85 px-2 py-1.5 text-xs text-white shadow-lg"
            style={{
              left: `${Math.min(Math.max(hoverX, 12), 82)}%`,
            }}
          >
            <div className="mb-1 border-b border-white/15 pb-1 text-[11px] text-neutral-200">
              {formatAxisDate(hoveredPoint.date)}
            </div>
            <div className="space-y-1">
              {tooltipSeries.map((series) => (
                <div key={series.grade} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: series.color }}
                    />
                    {series.grade}
                  </span>
                  <span>{formatCurrency(series.value, currency, exchangeRates)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 pr-10 text-xs text-slate-700 sm:flex sm:items-center sm:justify-between">
        {chartModel.axisDates.map((point, index) => (
          <span key={`${point.date}-${index}`} className="truncate">
            {formatAxisDate(point.date)}
          </span>
        ))}
      </div>
      <div className="mt-1 text-right text-[10px] text-slate-400">Market history</div>
    </div>
  );
}
