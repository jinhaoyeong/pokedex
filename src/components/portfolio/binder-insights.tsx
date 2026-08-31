"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { usePrintOnView } from "@/components/fx/use-print-on-view";
import { BinderIcon } from "@/components/portfolio/binder-icons";
import {
  type BinderAnalyticsItem,
  type BinderPulseInsight,
  type PortfolioHistoryPoint,
  type SparklineGeometry,
  computeAchievements,
  computeBinderPulse,
  computeCollectorRank,
  computeDiversification,
  distributionByValue,
  pickHighlights,
  sparklineGeometry,
} from "@/lib/binder-analytics";

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatTrendDate(date?: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
    return null;
  }

  const parsed = new Date(`${date.slice(0, 10)}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return date.slice(0, 10);
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The one measuring instrument in this file, reused everywhere a 0–100 share
 * is drawn: pulse score, rank progress, vault diversity. It quotes the
 * registry's P/L scale rather than inventing a third bar style — ruled track,
 * ticks, a fill that draws in from the left.
 */
function Scale({
  percent,
  ticks = [0, 25, 50, 75, 100],
  marks,
}: {
  percent: number;
  ticks?: number[];
  marks?: [string, string];
}) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className="bx-scale">
      <div className="bx-scale-track">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="bx-scale-tick"
            data-major={tick === 0 || tick === 100 ? "true" : undefined}
            style={{ left: `${tick}%` }}
          />
        ))}
        <span className="bx-scale-fill" style={{ width: `${clamped}%` }} />
      </div>
      {marks ? (
        <div className="bx-scale-marks">
          <span>{marks[0]}</span>
          <span>{marks[1]}</span>
        </div>
      ) : null}
    </div>
  );
}

function CollectionTrendChart({
  history,
  totalValueUsd,
  spark,
  trendUp,
}: {
  history: PortfolioHistoryPoint[];
  totalValueUsd: number;
  spark: SparklineGeometry;
  trendUp: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const points = spark.points;
  const activePoint =
    activeIndex != null && points[activeIndex] ? points[activeIndex] : null;
  const focusPoint = activePoint ?? spark.last;
  const displayValue = activePoint?.value ?? totalValueUsd;
  const displayDate = formatTrendDate(activePoint?.date ?? history[history.length - 1]?.date);
  const markerLeft = focusPoint ? `${(focusPoint.x / 100) * 100}%` : "100%";
  const markerTop = focusPoint ? `${(focusPoint.y / 38) * 100}%` : "50%";
  const dir = trendUp ? "up" : "down";

  const syncActiveFromClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || points.length < 2) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const index = Math.round(ratio * (points.length - 1));
    setActiveIndex(index);
  };

  return (
    <div className="bx-trend" data-dir={dir}>
      <div className="bx-trend-head">
        <div className="min-w-0">
          <p className="bx-label">Value tracked</p>
          {displayDate ? <p className="bx-trend-date">{displayDate}</p> : null}
        </div>
        <span className="bx-trend-delta" data-dir={dir}>
          {formatSignedPercent(spark.changePercent)}
        </span>
      </div>

      <div
        className={`bx-spark-wrap${activePoint ? " is-scrubbing" : ""}`}
        onPointerLeave={() => setActiveIndex(null)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          syncActiveFromClientX(event.clientX);
        }}
        onPointerMove={(event) => syncActiveFromClientX(event.clientX)}
        onPointerUp={(event) => {
          try {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          } catch {
            // Ignore capture release errors from browsers that already cleared it.
          }
        }}
      >
        <svg
          ref={svgRef}
          className="bx-spark"
          viewBox="0 0 100 38"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Collection value trend, ${formatSignedPercent(spark.changePercent)}`}
        >
          <defs>
            {/* Keyed to currentColor so the direction is stated once, on the
                wrapper, instead of being threaded through as a hex string. */}
            <linearGradient id="bxSparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
              <stop offset="72%" stopColor="currentColor" stopOpacity="0.04" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="bx-spark-area" d={spark.areaPath} fill="url(#bxSparkFill)" />
          <path
            className="bx-spark-line"
            d={spark.linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            /* Normalised length: lets the draw-in animation use a plain
               dasharray of 1 without measuring the path at runtime. */
            pathLength={1}
          />
        </svg>

        {activePoint ? <span className="bx-spark-guide" style={{ left: markerLeft }} /> : null}

        {focusPoint ? (
          <span
            className={`bx-spark-dot${activePoint ? " is-active" : ""}`}
            style={{ left: markerLeft, top: markerTop }}
            aria-hidden
          />
        ) : null}

        {activePoint ? (
          <div
            className={`bx-spark-tip${activePoint.y < 14 ? " is-below" : " is-above"}`}
            style={{
              left: `${Math.min(Math.max((activePoint.x / 100) * 100, 14), 86)}%`,
              top: markerTop,
            }}
          >
            <span>{displayDate ?? "Snapshot"}</span>
            <strong>
              <ClientPrice amountUsd={activePoint.value} />
            </strong>
          </div>
        ) : null}
      </div>

      <ClientPrice amountUsd={displayValue} className="bx-figure bx-trend-value" />
    </div>
  );
}

function HighlightCell({
  label,
  item,
  metric,
  dir,
  index,
}: {
  label: string;
  item: BinderAnalyticsItem;
  metric: React.ReactNode;
  dir: "neutral" | "up" | "down";
  index: number;
}) {
  return (
    <article className="bx-highlight" style={{ "--row": index } as React.CSSProperties}>
      <p className="bx-label">{label}</p>
      <div className="bx-highlight-id">
        <span className="bx-thumb">
          <Image
            src={item.image}
            alt={item.name}
            fill
            sizes="56px"
            unoptimized
            className="object-contain"
          />
        </span>
        <span className="min-w-0">
          <strong className="bx-highlight-name" title={item.name}>
            {item.name}
          </strong>
          <span className="bx-highlight-grade mono">
            {item.grade === "Ungraded" ? "Raw" : item.grade}
          </span>
        </span>
      </div>
      <p className="bx-highlight-metric" data-dir={dir}>
        {metric}
      </p>
    </article>
  );
}

/**
 * Distribution as a ruled list. The bars carry no hue: rank is already stated
 * by order and length, so a six-colour palette only added noise and put four
 * saturated colours on screen that meant nothing. A single ink stepping down
 * in opacity says the same thing quietly.
 */
function DistributionColumn({
  title,
  slices,
}: {
  title: string;
  slices: ReturnType<typeof distributionByValue>;
}) {
  if (!slices.length) {
    return null;
  }

  return (
    <div className="bx-col">
      <p className="bx-label">{title}</p>
      <ul className="bx-dist">
        {slices.map((slice, index) => (
          <li key={slice.key} style={{ "--i": index, "--row": index } as React.CSSProperties}>
            <div className="bx-dist-head">
              <span className="bx-dist-name" title={slice.key}>
                {slice.key}
              </span>
              <span className="bx-dist-pct">{Math.round(slice.share * 100)}%</span>
            </div>
            <div className="bx-bar">
              <span style={{ width: `${Math.max(slice.share * 100, 2)}%` }} />
            </div>
            <p className="bx-dist-meta">
              {slice.count} {slice.count === 1 ? "card" : "cards"} ·{" "}
              <ClientPrice amountUsd={slice.value} />
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BinderInsights({
  items,
  totalValueUsd,
  history,
}: {
  items: BinderAnalyticsItem[];
  totalValueUsd: number;
  history: PortfolioHistoryPoint[];
}) {
  const analytics = useMemo(() => {
    const rank = computeCollectorRank(totalValueUsd);
    const highlights = pickHighlights(items);
    const diversification = computeDiversification(items, totalValueUsd);
    const achievements = computeAchievements(items, diversification, totalValueUsd);
    const rarityDist = distributionByValue(items, (item) => item.rarity || "Unknown");
    const setDist = distributionByValue(items, (item) => item.setName || "Unknown");

    const trendPoints = history.filter(
      (point) => Number.isFinite(point.value) && point.value >= 0,
    );
    const values = trendPoints.map((point) => point.value);
    const dates = trendPoints.map((point) => point.date);
    const spark = sparklineGeometry(values, 100, 38, 3, dates);
    const pulse = computeBinderPulse(items, diversification, totalValueUsd, history);

    return {
      rank,
      highlights,
      diversification,
      achievements,
      rarityDist,
      setDist,
      spark,
      pulse,
      hasTrend: values.length >= 2,
    };
  }, [items, totalValueUsd, history]);

  const unlockedCount = analytics.achievements.filter((badge) => badge.unlocked).length;
  const trendUp = analytics.spark.changePercent >= 0;

  const { ref: pulseRef, phase: pulsePhase } = usePrintOnView<HTMLElement>();
  const { ref: standoutRef, phase: standoutPhase } = usePrintOnView<HTMLElement>();
  const { ref: allocationRef, phase: allocationPhase } = usePrintOnView<HTMLElement>();
  const { ref: rankRef, phase: rankPhase } = usePrintOnView<HTMLElement>();
  const { ref: trendRef, phase: trendPhase } = usePrintOnView<HTMLElement>();
  const { ref: badgesRef, phase: badgesPhase } = usePrintOnView<HTMLElement>();

  const highlightCells: Array<{
    key: string;
    label: string;
    item: BinderAnalyticsItem;
    metric: React.ReactNode;
    dir: "neutral" | "up" | "down";
  }> = [];

  if (analytics.highlights.crownJewel) {
    highlightCells.push({
      key: "crown",
      label: "Crown jewel",
      item: analytics.highlights.crownJewel,
      dir: "neutral",
      metric: <ClientPrice amountUsd={analytics.highlights.crownJewel.totalCurrentUsd} />,
    });
  }

  if (analytics.highlights.topMover) {
    const up = analytics.highlights.topMover.dayChangePercent >= 0;
    highlightCells.push({
      key: "mover",
      label: "Top mover today",
      item: analytics.highlights.topMover,
      dir: up ? "up" : "down",
      metric: formatSignedPercent(analytics.highlights.topMover.dayChangePercent),
    });
  }

  if (analytics.highlights.biggestWinner && analytics.highlights.biggestWinner.gainLossUsd > 0) {
    highlightCells.push({
      key: "winner",
      label: "Biggest winner",
      item: analytics.highlights.biggestWinner,
      dir: "up",
      metric: <ClientPrice amountUsd={analytics.highlights.biggestWinner.gainLossUsd} />,
    });
  }

  if (analytics.highlights.biggestLoser) {
    highlightCells.push({
      key: "loser",
      label: "Needs a comeback",
      item: analytics.highlights.biggestLoser,
      dir: "down",
      metric: <ClientPrice amountUsd={analytics.highlights.biggestLoser.gainLossUsd} />,
    });
  }

  return (
    <div className="binder-insights">
      {/* ---------- Pulse ---------- */}
      <section className="sheet bx" ref={pulseRef} data-print={pulsePhase}>
        <header className="sheet-band">
          <h2 className="sheet-band-title">Binder pulse</h2>
          <p className="sheet-meta">
            <span>{analytics.pulse.tone}</span>
            <span>{analytics.pulse.score}/100</span>
          </p>
        </header>

        <div className="bx-pulse">
          <div className="bx-pulse-lead">
            <p className="bx-label">Signal score</p>
            <span className="bx-figure bx-figure-lg">{analytics.pulse.score}</span>
            <h3 className="bx-heading">{analytics.pulse.title}</h3>
            <p className="bx-note">{analytics.pulse.summary}</p>
            <Scale percent={analytics.pulse.score} marks={["0", "100"]} />
          </div>

          <div className="bx-pulse-action">
            <p className="bx-label">Next move</p>
            <strong className="bx-heading bx-heading-sm">{analytics.pulse.actionTitle}</strong>
            <p className="bx-note">{analytics.pulse.actionText}</p>
          </div>
        </div>

        <dl className="bx-metrics">
          {analytics.pulse.metrics.map((metric, index) => (
            <div key={metric.label} style={{ "--row": index } as React.CSSProperties}>
              <dt className="bx-label">{metric.label}</dt>
              <dd className="bx-metric-value">{metric.value}</dd>
              <p className="bx-note bx-note-sm">{metric.helper}</p>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------- Standout holdings ---------- */}
      {highlightCells.length ? (
        <section className="sheet bx" ref={standoutRef} data-print={standoutPhase}>
          <header className="sheet-band">
            <h2 className="sheet-band-title">Standout holdings</h2>
            <p className="sheet-meta">
              <span>
                {highlightCells.length} {highlightCells.length === 1 ? "pick" : "picks"}
              </span>
            </p>
          </header>

          <div className="bx-highlights" data-count={highlightCells.length}>
            {highlightCells.map((cell, index) => (
              <HighlightCell
                key={cell.key}
                label={cell.label}
                item={cell.item}
                metric={cell.metric}
                dir={cell.dir}
                index={index}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------- Allocation ---------- */}
      <section className="sheet bx" ref={allocationRef} data-print={allocationPhase}>
        <header className="sheet-band">
          <h2 className="sheet-band-title">Allocation</h2>
          <p className="sheet-meta">
            <span>By value</span>
            <span>{analytics.diversification.uniqueSets} sets</span>
          </p>
        </header>

        <div className="bx-allocation">
          <DistributionColumn title="By rarity" slices={analytics.rarityDist} />
          <DistributionColumn title="By set" slices={analytics.setDist} />

          <div className="bx-col">
            <p className="bx-label">Vault balance</p>

            <div className="bx-vault-score">
              <span className="bx-figure">{analytics.diversification.diversityScore}</span>
              <span className="bx-note bx-note-sm">
                Diversity
                <br />
                score
              </span>
            </div>

            <Scale percent={analytics.diversification.diversityScore} />

            {/* Ruled rows, not four nested tiles — the label/value pairs read
                down a column the way the ledger's figures do. */}
            <dl className="bx-vault-stats">
              <div>
                <dt>Unique</dt>
                <dd>{analytics.diversification.uniqueCards}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{analytics.diversification.totalCards}</dd>
              </div>
              <div>
                <dt>Sets</dt>
                <dd>{analytics.diversification.uniqueSets}</dd>
              </div>
              <div>
                <dt>Graded</dt>
                <dd>{Math.round(analytics.diversification.gradedShare * 100)}%</dd>
              </div>
            </dl>

            <p className="bx-note bx-note-sm">
              Top card is {Math.round(analytics.diversification.topHoldingShare * 100)}% of value.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Rank + trend ---------- */}
      <div className="bx-pair">
        <section className="sheet bx" ref={rankRef} data-print={rankPhase}>
          <header className="sheet-band">
            <h2 className="sheet-band-title">Trainer rank</h2>
            <p className="sheet-meta">
              <span>{Math.round(analytics.rank.progress * 100)}% to next</span>
            </p>
          </header>

          <div className="bx-rank">
            <div className="bx-rank-id">
              <span className="bx-rank-mark" aria-hidden>
                <BinderIcon name={analytics.rank.icon} className="bx-glyph" />
              </span>
              <span className="min-w-0">
                <strong className="bx-heading">{analytics.rank.title}</strong>
                <span className="bx-note">{analytics.rank.blurb}</span>
              </span>
            </div>

            <Scale percent={analytics.rank.progress * 100} />

            <p className="bx-note bx-rank-foot">
              {analytics.rank.nextTitle ? (
                <>
                  <ClientPrice amountUsd={analytics.rank.toNextUsd} /> to{" "}
                  <strong>{analytics.rank.nextTitle}</strong>
                </>
              ) : (
                <>Max rank reached — Hall of Fame.</>
              )}
            </p>
          </div>
        </section>

        <section className="sheet bx" ref={trendRef} data-print={trendPhase}>
          <header className="sheet-band">
            <h2 className="sheet-band-title">Collection trend</h2>
            <p className="sheet-meta">
              <span>{analytics.hasTrend ? "Tracked" : "Awaiting history"}</span>
            </p>
          </header>

          <div className="bx-trend-body">
            {analytics.hasTrend ? (
              <CollectionTrendChart
                history={history}
                totalValueUsd={totalValueUsd}
                spark={analytics.spark}
                trendUp={trendUp}
              />
            ) : (
              <div className="bx-trend" data-dir="up">
                <p className="bx-label">Value tracked</p>
                <p className="bx-note">
                  Add cards to start tracking how your binder value grows over time.
                </p>
                <ClientPrice amountUsd={totalValueUsd} className="bx-figure bx-trend-value" />
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ---------- Badges — always last ---------- */}
      <section className="sheet bx" ref={badgesRef} data-print={badgesPhase}>
        <header className="sheet-band">
          <h2 className="sheet-band-title">Trainer badges</h2>
          <p className="sheet-meta">
            <span>
              {unlockedCount}/{analytics.achievements.length} unlocked
            </span>
          </p>
        </header>

        <ul className="bx-badges">
          {analytics.achievements.map((badge, index) => (
            <li
              key={badge.id}
              className="bx-badge"
              data-on={badge.unlocked ? "true" : "false"}
              style={{ "--row": index } as React.CSSProperties}
            >
              <span className="bx-badge-mark" aria-hidden>
                <BinderIcon name={badge.icon} className="bx-glyph" />
              </span>
              <strong className="bx-badge-title">{badge.title}</strong>
              <span className="bx-note bx-note-sm">{badge.desc}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
