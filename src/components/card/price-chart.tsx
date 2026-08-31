"use client";

import { useMemo, useState } from "react";

import { useCurrency } from "@/components/currency-provider";
import { SearchSelect } from "@/components/search/search-select";
import { formatCurrency } from "@/lib/cards";
import { classifyMarketHistory } from "@/lib/market/market-history";
import { readSettings } from "@/lib/settings-store";
import type {
  GradedPrice,
  MarketConfidence,
  MarketHistorySummary,
  PricePoint,
  SaleRecord,
} from "@/types/pokemon";

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

/**
 * Fixed categorical order — the order is the colourblind-safety mechanism, so
 * it never changes and slots are never cycled.
 *
 * This replaces a 12-hue rainbow (coral, blue, orange, green, magenta, crimson,
 * cyan, amber, blue, pink, mint, purple) that cycled with `% length`. Measured
 * against this app's panel surface (#131419) it failed outright: five of its
 * first six hues sat outside the OKLCH dark lightness band, and slot 1 was the
 * brand accent, so a single-series chart painted a coral slab across the panel
 * and read as an alert rather than a price.
 *
 * These eight are the validated dark steps, re-checked on #131419: all pass the
 * lightness band, chroma floor, CVD separation (worst adjacent ΔE 8.4 protan),
 * the normal-vision floor (19.3) and 3:1 contrast. The common 1–3 series case
 * passes with a lot of room (CVD ΔE 9.4, normal 26.5).
 *
 * Verify after any edit:
 *   node validate_palette.js "<hexes>" --mode dark --surface "#131419"
 */
const SERIES_COLORS = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
  "#9085e9", // 7 violet
  "#e66767", // 8 red
];

/**
 * Past slot 8 identity stops being carried by hue: a generated ninth colour
 * cannot be kept separable, so the series falls back to ink and relies on its
 * label. Cycling the palette instead would give two different grades the same
 * colour, which is worse than no colour.
 */
const SERIES_OVERFLOW_COLOR = "#71757f";

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
const PREVIEW_SALE_SOURCE_PATTERN =
  /static grail preview|bundled grail preview|premium preview composite|preview model|partial cached/i;
const CHART_PLOT_LEFT_X = 3;
const CHART_RIGHT_AXIS_GUTTER_X = 28;
const CHART_PLOT_RIGHT_X = 100 - CHART_RIGHT_AXIS_GUTTER_X;
const Y_AXIS_LABEL_MIN_Y = 8;
const Y_AXIS_LABEL_MAX_Y = 92;
const Y_AXIS_LABEL_MIN_GAP = 13;

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

function todayUtcMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function isPreviewSale(sale: SaleRecord) {
  return PREVIEW_SALE_SOURCE_PATTERN.test(
    [sale.source, sale.listingUrl, sale.sourceUrl, (sale as SaleRecord & { url?: string }).url]
      .filter(Boolean)
      .join(" "),
  );
}

function normalizeSaleGrade(sale: SaleRecord) {
  return sale.condition?.trim() || "Ungraded";
}

function medianPrice(values: number[]) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);
  if (!sorted.length) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildSaleHistoryPoints(recentSales: SaleRecord[]) {
  const grouped = new Map<string, { date: string; grade: string; prices: number[] }>();

  for (const sale of recentSales) {
    if (isPreviewSale(sale)) {
      continue;
    }

    const parsed = Date.parse(sale.date);
    if (
      Number.isNaN(parsed) ||
      typeof sale.price !== "number" ||
      !Number.isFinite(sale.price) ||
      sale.price <= 0
    ) {
      continue;
    }

    const date = new Date(parsed).toISOString().slice(0, 10);
    const grade = normalizeSaleGrade(sale);
    const key = `${date}::${grade}`;
    const entry = grouped.get(key) ?? { date, grade, prices: [] };
    entry.prices.push(sale.price);
    grouped.set(key, entry);
  }

  const byDate = new Map<string, PricePoint>();

  for (const entry of grouped.values()) {
    const value = medianPrice(entry.prices);
    if (!(value > 0)) {
      continue;
    }

    const existing = byDate.get(entry.date);
    const gradeValues = {
      ...(existing?.gradeValues ?? {}),
      [entry.grade]: value,
    };

    byDate.set(entry.date, {
      date: entry.date,
      value:
        entry.grade === "Ungraded"
          ? value
          : existing?.value && existing.value > 0
            ? existing.value
            : 0,
      gradeValues,
    });
  }

  return [...byDate.values()].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

function mergeChartHistoryPoints(history: PricePoint[], sales: PricePoint[]): PricePoint[] {
  if (!sales.length) {
    return history;
  }

  if (!history.length) {
    return sales;
  }

  const byDate = new Map<string, PricePoint>();

  for (const point of history) {
    byDate.set(point.date, {
      ...point,
      gradeValues: point.gradeValues ? { ...point.gradeValues } : undefined,
    });
  }

  for (const point of sales) {
    const existing = byDate.get(point.date);

    if (!existing) {
      byDate.set(point.date, {
        ...point,
        gradeValues: point.gradeValues ? { ...point.gradeValues } : undefined,
      });
      continue;
    }

    byDate.set(point.date, {
      ...existing,
      value: point.value > 0 ? point.value : existing.value,
      gradeValues: {
        ...(existing.gradeValues ?? {}),
        ...(point.gradeValues ?? {}),
      },
      // Sale-backed days are real comps, not guide projections.
      isProjected: false,
    });
  }

  return [...byDate.values()].sort((left, right) => {
    const leftMs = Date.parse(left.date);
    const rightMs = Date.parse(right.date);
    if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs)) {
      return leftMs - rightMs;
    }
    return left.date.localeCompare(right.date);
  });
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
  const percent = Math.max(0, Math.min(100, ((dateMs - minDateMs) / span) * 100));
  return CHART_PLOT_LEFT_X + (percent / 100) * (CHART_PLOT_RIGHT_X - CHART_PLOT_LEFT_X);
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

function getScaleConfig(values: number[], options?: { preferLinear?: boolean }) {
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
  // Single-grade detail charts stay linear like the binder trend. Log compression
  // only helps when comparing wildly different grade bands on one axis.
  const useLog =
    !options?.preferLinear && minRaw > 0 && maxRaw / minRaw >= 12;
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
    const padding = Math.max(value * 0.28, 1);

    return [Math.max(0.01, value - padding), value, value + padding];
  }

  const min = Math.min(...positiveValues);
  const max = Math.max(...positiveValues);
  const span = Math.max(max - min, max * 0.08, 1);
  const padding = Math.max(span * 0.22, max * 0.05, 1);

  return [Math.max(0.01, min - padding), ...positiveValues, max + padding];
}

function resolveChartTimeDomain({
  selectedRange,
  startDateMs,
  latestDateMs,
  allDomainPoints,
}: {
  selectedRange: ChartRange;
  startDateMs: number;
  latestDateMs: number;
  allDomainPoints: PreparedPoint[];
}): { domainMinDateMs: number; domainMaxDateMs: number; fittedToData: boolean } {
  if (selectedRange === "all") {
    return {
      domainMinDateMs: allDomainPoints[0]?.dateMs ?? latestDateMs,
      domainMaxDateMs: latestDateMs,
      fittedToData: false,
    };
  }

  // Always keep the selected calendar window so 30D / 90D / 1Y stay distinct.
  // Sparse history is filled with a dashed lead-in hold instead of zooming.
  return {
    domainMinDateMs: startDateMs,
    domainMaxDateMs: latestDateMs,
    fittedToData: false,
  };
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

function getYAxisTickLabels(
  values: number[],
  mapValue: (value: number) => number,
  minMapped: number,
  mappedRange: number,
) {
  const labels = values
    .map((value, index) => ({
      value,
      index,
      y: yForValue(value, mapValue, minMapped, mappedRange),
      labelY: yForValue(value, mapValue, minMapped, mappedRange),
    }))
    .sort((left, right) => left.y - right.y);

  for (let index = 0; index < labels.length; index += 1) {
    labels[index].labelY = Math.min(
      Math.max(labels[index].labelY, Y_AXIS_LABEL_MIN_Y),
      Y_AXIS_LABEL_MAX_Y,
    );

    if (index > 0 && labels[index].labelY < labels[index - 1].labelY + Y_AXIS_LABEL_MIN_GAP) {
      labels[index].labelY = labels[index - 1].labelY + Y_AXIS_LABEL_MIN_GAP;
    }
  }

  const overflow = labels[labels.length - 1]?.labelY - Y_AXIS_LABEL_MAX_Y;
  if (overflow > 0) {
    for (const label of labels) {
      label.labelY -= overflow;
    }
  }

  for (let index = labels.length - 2; index >= 0; index -= 1) {
    if (labels[index].labelY > labels[index + 1].labelY - Y_AXIS_LABEL_MIN_GAP) {
      labels[index].labelY = labels[index + 1].labelY - Y_AXIS_LABEL_MIN_GAP;
    }
  }

  const underflow = Y_AXIS_LABEL_MIN_Y - (labels[0]?.labelY ?? Y_AXIS_LABEL_MIN_Y);
  if (underflow > 0) {
    for (const label of labels) {
      label.labelY += underflow;
    }
  }

  return labels.sort((left, right) => left.index - right.index);
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
      leadInPoints: [] as ChartDatum[],
    };
  }

  let firstRealIndex = 0;
  while (firstRealIndex < points.length && points[firstRealIndex].isProjected) {
    firstRealIndex += 1;
  }

  if (firstRealIndex >= points.length) {
    return {
      mainPoints: points,
      projectedPoints: [] as ChartDatum[],
      leadInPoints: [] as ChartDatum[],
    };
  }

  const leadInPoints =
    firstRealIndex > 0
      ? [points[firstRealIndex - 1], points[firstRealIndex]]
      : ([] as ChartDatum[]);
  const withoutLeadIn = points.slice(firstRealIndex);
  const lastPoint = withoutLeadIn[withoutLeadIn.length - 1];

  if (!lastPoint.isProjected) {
    return {
      mainPoints: withoutLeadIn,
      projectedPoints: [] as ChartDatum[],
      leadInPoints,
    };
  }

  return {
    mainPoints: withoutLeadIn.slice(0, -1),
    projectedPoints: withoutLeadIn.slice(-2),
    leadInPoints,
  };
}

function rangeButtonLabel(range: ChartRange) {
  return RANGE_LABELS.find((entry) => entry.value === range)?.label ?? "Max";
}

export function PriceChart({
  points,
  recentSales = [],
  selectedGrade,
  snapshotAmountUsd,
  gradedPrices = [],
  visibleGradeLabels,
  marketHistory,
  onSelectGrade,
  embedded = false,
}: {
  points: PricePoint[];
  recentSales?: SaleRecord[];
  selectedGrade: string;
  snapshotAmountUsd?: number;
  gradedPrices?: GradedPrice[];
  visibleGradeLabels?: string[];
  marketHistory?: MarketHistorySummary;
  onSelectGrade?: (grade: string) => void;
  embedded?: boolean;
}) {
  const [selectedRange, setSelectedRange] = useState<ChartRange>(
    () => readSettings().defaultChartRange,
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const { currency, exchangeRates } = useCurrency();
  const historySummary = useMemo(
    () => marketHistory ?? classifyMarketHistory(points, recentSales),
    [marketHistory, points, recentSales],
  );

  const chartModel = useMemo(() => {
    const saleHistoryPoints = buildSaleHistoryPoints(recentSales);
    // Never let a handful of sold comps wipe denser catalog/guide history.
    const chartInputPoints = mergeChartHistoryPoints(points, saleHistoryPoints);
    const anchoredPoints = buildAnchoredPoints(chartInputPoints);
    const latestDateMs = anchoredPoints.length
      ? Math.max(todayUtcMs(), ...anchoredPoints.map((point) => point.dateMs))
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
    const { domainMinDateMs, domainMaxDateMs, fittedToData } = resolveChartTimeDomain({
      selectedRange,
      startDateMs,
      latestDateMs,
      allDomainPoints,
    });
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

        const meta = priceMeta.get(grade);
        const liveGradeValue =
          typeof meta?.value === "number" && Number.isFinite(meta.value) && meta.value > 0
            ? meta.value
            : grade === "Ungraded" &&
                typeof snapshotAmountUsd === "number" &&
                Number.isFinite(snapshotAmountUsd) &&
                snapshotAmountUsd > 0
              ? snapshotAmountUsd
              : undefined;

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
          const lastKnownValue = lastKnownPoint ? getPointValue(lastKnownPoint, grade) : undefined;
          // Prefer the live grade/headline value over a stale pre-range sale so the
          // flat guide matches Raw Market / Grade Values instead of a mismatched comps.
          const fallbackValue =
            liveGradeValue &&
            typeof lastKnownValue === "number" &&
            Number.isFinite(lastKnownValue) &&
            lastKnownValue > 0 &&
            Math.abs(lastKnownValue - liveGradeValue) / liveGradeValue > 0.25
              ? liveGradeValue
              : typeof lastKnownValue === "number" &&
                  Number.isFinite(lastKnownValue) &&
                  lastKnownValue > 0
                ? lastKnownValue
                : liveGradeValue;

          if (typeof fallbackValue === "number" && Number.isFinite(fallbackValue) && fallbackValue > 0) {
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

        if (!pointValues.length && typeof liveGradeValue === "number") {
          pointValues = [
            {
              date: new Date(domainMinDateMs).toISOString(),
              dateMs: domainMinDateMs,
              value: liveGradeValue,
              x: xForDate(domainMinDateMs, domainMinDateMs, domainMaxDateMs),
              pointIndex: 0,
              isProjected: true,
            },
            {
              date: new Date(domainMaxDateMs).toISOString(),
              dateMs: domainMaxDateMs,
              value: liveGradeValue,
              x: xForDate(domainMaxDateMs, domainMinDateMs, domainMaxDateMs),
              pointIndex: 1,
              isProjected: true,
            },
          ];
        }

        // Sparse comps often start mid-window. Hold the first known price from the
        // range start as a dashed lead-in so the chart fills without inventing moves.
        if (
          pointValues.length >= 1 &&
          !pointValues.every((point) => point.isProjected) &&
          pointValues[0].dateMs > domainMinDateMs + 2 * DAY_MS
        ) {
          const firstReal = pointValues.find((point) => !point.isProjected) ?? pointValues[0];
          if (!pointValues[0].isProjected || pointValues[0].dateMs > domainMinDateMs + DAY_MS) {
            pointValues = [
              {
                date: new Date(domainMinDateMs).toISOString().slice(0, 10),
                dateMs: domainMinDateMs,
                value: firstReal.value,
                x: xForDate(domainMinDateMs, domainMinDateMs, domainMaxDateMs),
                pointIndex: -1,
                isProjected: true,
              },
              ...pointValues,
            ];
          }
        }

        // Extend the last real point to "now" with the live snapshot when needed.
        if (
          pointValues.length >= 1 &&
          typeof liveGradeValue === "number" &&
          liveGradeValue > 0
        ) {
          const lastPoint = pointValues[pointValues.length - 1];
          if (
            !lastPoint.isProjected &&
            domainMaxDateMs - lastPoint.dateMs > 2 * DAY_MS
          ) {
            pointValues = [
              ...pointValues,
              {
                date: new Date(domainMaxDateMs).toISOString().slice(0, 10),
                dateMs: domainMaxDateMs,
                value: liveGradeValue,
                x: xForDate(domainMaxDateMs, domainMinDateMs, domainMaxDateMs),
                pointIndex: pointValues.length,
                isProjected: true,
              },
            ];
          }
        }

        if (!pointValues.length) {
          return null;
        }

        const realPointCount = pointValues.filter((point) => !point.isProjected).length;

        return {
          grade,
          color: SERIES_COLORS[index] ?? SERIES_OVERFLOW_COLOR,
          confidence: meta?.confidence,
          points: pointValues,
          latestValue: pointValues[pointValues.length - 1]?.value ?? 0,
          isThin: meta?.confidence === "low" || realPointCount < 3,
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
    const scale = getScaleConfig(getPaddedScaleValues(safeScaleValues), {
      preferLinear: true,
    });
    const mappedRange = Math.max(scale.maxMapped - scale.minMapped, 1);
    const rangeLabel = rangeStartLabel(selectedRange);
    const isGuideChart =
      historySummary.status === "snapshot_only" ||
      (historySummary.historyUnavailable && (historySummary.realSaleCount ?? 0) === 0);
    const coverageLabel = isGuideChart
      ? historySummary.status === "snapshot_only"
        ? "Live market guide"
        : "Guide pending sales"
      : historySummary.status === "limited"
        ? "Limited sold history"
        : `Coverage ${rangeButtonLabel(selectedRange)}`;
    const coveragePoints =
      selectedRange === "all"
        ? chartSeries[0]?.points.filter((point) => !point.isProjected) ?? []
        : chartSeries[0]?.points.filter(
            (point) => !point.isProjected && point.dateMs >= startDateMs,
          ) ?? [];
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
      coveragePoints.length < 3;
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
      fittedToData,
      hasDrawableSeries,
      hasLimitedRangeCoverage: hasNoRangeData || hasLimitedRangeCoverage || hasThinRangeCoverage,
      hasNoRangeData,
      hasProjectedPoints,
      isGuideChart,
      selectedHasCatalogDates,
      highValue: Math.max(...safeScaleValues),
      latestValue: chartSeries[0]?.latestValue ?? safeScaleValues[safeScaleValues.length - 1] ?? 0,
      lowValue: Math.min(...safeScaleValues),
      mapValue: scale.mapValue,
      mappedRange,
      minMapped: scale.minMapped,
      plottedSeries: chartSeries.map((entry) => {
        const { mainPoints, projectedPoints, leadInPoints } = splitSeriesPoints(entry.points);
        const hoverPoints = [
          ...leadInPoints.slice(0, leadInPoints.length ? 1 : 0),
          ...mainPoints,
          ...projectedPoints.slice(mainPoints.length || leadInPoints.length ? 1 : 0),
        ];

        return {
          ...entry,
          hoverPoints,
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
  }, [gradedPrices, historySummary, points, recentSales, selectedGrade, selectedRange, snapshotAmountUsd, visibleGradeLabels]);

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
            <h3 className="mt-1.5 font-[var(--font-game-copy)] text-lg font-black leading-tight text-white sm:mt-2 sm:text-2xl">
              {historySummary.status === "snapshot_only"
                ? "Current valuation"
                : "Reliable history pending"}
            </h3>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-[6px] border border-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-slate-300">
            {selectedGrade}
          </span>
        </div>
        <div className="mt-3 rounded-[8px] border border-white/10 bg-white/5 p-3 text-sm leading-6 text-slate-300 sm:mt-5 sm:p-4">
          {historySummary.note ??
            "This range does not have enough dated market history to draw a reliable line. Latest snapshots stay visible below without being plotted as fake history."}
        </div>
        {hasSnapshot ? (
          <div className="info-box info-box--accent mt-3 p-3 sm:mt-4 sm:p-4">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Latest {selectedGrade}
            </p>
            <p className="mt-2 text-2xl font-black leading-none text-white sm:text-3xl">
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
          {chartModel.isGuideChart ? (
            <p className="mt-1 text-[11px] leading-4 text-slate-400">
              {historySummary.status === "snapshot_only"
                ? "Showing the current market guide until dated sold listings arrive."
                : "Waiting on dated sold listings. The latest snapshot stays plotted so the chart is not blank."}
            </p>
          ) : null}
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
                ? "note-tone note-ink"
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
        <SearchSelect
            name="chartGrade"
            ariaLabel="Chart grade"
            value={chartSelectValue}
            disabled={!onSelectGrade}
            options={chartModel.series.map((series) => ({
              value: series.grade,
              label: `${series.grade} / ${formatCurrency(series.latestValue, currency, exchangeRates)}`,
            }))}
            onChange={(nextGrade) => {
              setHoveredIndex(null);
              setHoverPercent(null);
              onSelectGrade?.(nextGrade);
            }}
          />
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
                const { mainPoints, projectedPoints, leadInPoints } = splitSeriesPoints(
                  series.points,
                );
                const mainPath =
                  mainPoints.length >= 2
                    ? straightPathFromPoints(
                        mainPoints,
                        chartModel.mapValue,
                        chartModel.minMapped,
                        chartModel.mappedRange,
                      )
                    : "";
                const leadInPath =
                  leadInPoints.length >= 2
                    ? straightPathFromPoints(
                        leadInPoints,
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
                  mainPoints.length === 1 && !leadInPath && !projectedPath
                    ? `M ${CHART_PLOT_LEFT_X + 4} ${yForValue(
                        mainPoints[0].value,
                        chartModel.mapValue,
                        chartModel.minMapped,
                        chartModel.mappedRange,
                      )} L ${CHART_PLOT_RIGHT_X} ${yForValue(
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
                        /* 0.16 painted a solid slab under a flat single-series
                           line, which is what made the panel read red. The line
                           carries the series; the fill only hints at volume. */
                        fillOpacity={series.grade === selectedGrade ? 0.09 : 0.03}
                      />
                    ) : null}
                    {singlePointGuide ? (
                      <>
                        <path
                          d={singlePointGuide}
                          fill="none"
                          stroke={series.color}
                          strokeWidth={5}
                          strokeOpacity="0.1"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                        />
                        <path
                          d={singlePointGuide}
                          fill="none"
                          stroke={series.color}
                          strokeWidth={2}
                          strokeOpacity="0.7"
                          strokeDasharray="3 3"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                        />
                      </>
                    ) : null}
                    {leadInPath ? (
                      <path
                        d={leadInPath}
                        fill="none"
                        stroke={series.color}
                        strokeWidth={series.grade === selectedGrade ? 2.2 : 1.1}
                        strokeOpacity={series.grade === selectedGrade ? 0.7 : 0.2}
                        strokeDasharray="2 2.8"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                    {series.grade === selectedGrade && mainPath ? (
                      <path
                        d={mainPath}
                        fill="none"
                        stroke={series.color}
                        strokeWidth={5}
                        strokeOpacity="0.14"
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
                        strokeWidth={series.grade === selectedGrade ? 2.4 : 1.1}
                        strokeOpacity={series.grade === selectedGrade ? 1 : 0.22}
                        strokeDasharray={
                          chartModel.isGuideChart ||
                          (series.isThin && !projectedPath && !leadInPath)
                            ? "2 2.6"
                            : undefined
                        }
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
                        strokeWidth={series.grade === selectedGrade ? 2.2 : 1.1}
                        strokeOpacity={series.grade === selectedGrade ? 0.85 : 0.24}
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
          {getYAxisTickLabels(
            chartModel.yTickValues,
            chartModel.mapValue,
            chartModel.minMapped,
            chartModel.mappedRange,
          ).map(({ value, labelY }, index) => {
            return (
              <span
                key={`${value}-${index}`}
                className="absolute right-3 z-20 min-w-[6.6rem] whitespace-nowrap rounded bg-slate-950/95 px-2 py-1 text-right text-[10px] font-semibold leading-none text-slate-200 shadow-[0_0_0_1px_rgba(15,23,42,0.9),0_8px_18px_rgba(0,0,0,0.35)] sm:right-4 sm:min-w-[7.35rem] sm:text-[11px]"
                style={{
                  top: `${labelY}%`,
                  transform: "translateY(-50%)",
                }}
              >
                {formatCurrency(value, currency, exchangeRates)}
              </span>
            );
          })}
        </div>

        {chartModel.yTickValues.map((value, index) => {
          const y = yForValue(
            value,
            chartModel.mapValue,
            chartModel.minMapped,
            chartModel.mappedRange,
          );

          return (
            <span
              key={`${value}-${index}-axis-guide`}
              className="pointer-events-none absolute right-[calc(6.6rem+0.75rem)] hidden h-px w-2 bg-slate-500/25 sm:right-[calc(7.35rem+1rem)] sm:block"
              style={{
                top: `${Math.min(Math.max(y, Y_AXIS_LABEL_MIN_Y), Y_AXIS_LABEL_MAX_Y)}%`,
              }}
            />
          );
        })}

        {chartModel.chartSeries.map((series) => {
          if (series.grade !== selectedGrade || !series.points.length) {
            return null;
          }

          const { mainPoints } = splitSeriesPoints(series.points);
          const markerPoints =
            series.isThin || mainPoints.length <= 6 ? mainPoints : mainPoints.slice(-1);

          return markerPoints.map((point, index) => {
            const y = yForValue(
              point.value,
              chartModel.mapValue,
              chartModel.minMapped,
              chartModel.mappedRange,
            );
            const isLatest = index === markerPoints.length - 1;

            return (
              <span
                key={`${series.grade}-${point.date}-${point.value}-marker`}
                className={`pointer-events-none absolute rounded-full border-2 border-slate-950 ${
                  isLatest ? "h-2.5 w-2.5" : "h-2 w-2"
                }`}
                style={{
                  left: `${point.x}%`,
                  top: `${y}%`,
                  transform: "translate(-50%, -50%)",
                  backgroundColor: series.color,
                  boxShadow: isLatest ? `0 0 0 3px ${series.color}22` : undefined,
                }}
              />
            );
          });
        })}

        {hoverX != null && hoverMarkerY != null && selectedHoveredSeries ? (
          <>
            <span
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/20"
              style={{ left: `${hoverX}%`, transform: "translateX(-50%)" }}
            />
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-[#050816]"
              style={{
                left: `${hoverX}%`,
                top: `${hoverMarkerY}%`,
                transform: "translate(-50%, -50%)",
                backgroundColor: selectedHoveredSeries.color,
                boxShadow: "0 0 0 3px rgba(255,255,255,0.14)",
              }}
            />
          </>
        ) : null}

        {hoveredPoint && selectedHoveredSeries && hoverX != null && hoverMarkerY != null ? (
          <div
            className="pointer-events-none absolute z-10 min-w-[6.75rem] rounded-xl border border-white/10 bg-slate-950/94 px-3 py-2 text-sm shadow-xl"
            style={{
              left: `${Math.min(Math.max(hoverX, 14), 86)}%`,
              top: `${hoverMarkerY}%`,
              transform:
                hoverMarkerY < 28
                  ? "translate(-50%, 0.75rem)"
                  : "translate(-50%, calc(-100% - 0.75rem))",
            }}
          >
            <p className="text-[11px] font-medium text-slate-300">
              {formatAxisDate(hoveredPoint.date)}
            </p>
            <p className="mt-1 font-bold text-white">
              {formatCurrency(selectedHoveredSeries.hoveredValue, currency, exchangeRates)}
            </p>
          </div>
        ) : null}

      </div>

      {chartModel.hasLimitedRangeCoverage && !chartModel.isGuideChart ? (
        <div className="mt-2.5 rounded-[6px] note-tone border px-2.5 py-1.5 text-[11px] font-bold uppercase leading-5 tracking-[0.06em] note-ink sm:mt-3 sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.07em]">
          {chartModel.selectedHasCatalogDates
            ? "Only current catalog movement is available. Use sold listings below for exact comps."
            : chartModel.hasNoRangeData
              ? "No sales in this period. Flat guide uses the last known price before this range."
              : "Limited dated comps in this range. Dashed segments hold known prices across gaps."}
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
            : "Linear scale matches the binder trend chart."}
        </span>
        <span>
          {chartModel.isGuideChart
            ? "Dashed guide from current snapshots until dated sold listings arrive."
            : selectedSeriesIsThin
            ? "Selected line is based on thin evidence."
            : !chartModel.hasDrawableSeries
              ? "Not enough dated points to draw a reliable path."
              : chartModel.hasProjectedPoints
                ? "Dashed segments hold or extend known prices where dated comps are missing."
            : "Hover the line to scrub dated market history."}
        </span>
      </div>
    </div>
  );
}
