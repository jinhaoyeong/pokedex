"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";

import { ClientPrice } from "@/components/client-price";
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
  const stroke = trendUp ? "#42d77d" : "#ef233c";
  const markerLeft = focusPoint ? `${(focusPoint.x / 100) * 100}%` : "100%";
  const markerTop = focusPoint ? `${(focusPoint.y / 38) * 100}%` : "50%";

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
    <>
      <div className="binder-trend-head">
        <div className="min-w-0">
          <h3 className="binder-insight-title">Collection trend</h3>
          {displayDate ? <p className="binder-trend-date">{displayDate}</p> : null}
        </div>
        <div className="binder-trend-change">
          <span className={trendUp ? "binder-trend-up" : "binder-trend-down"}>
            {formatSignedPercent(spark.changePercent)}
          </span>
          <small>{history.length} snapshots</small>
        </div>
      </div>
      <div
        className={`binder-spark-wrap${activePoint ? " is-scrubbing" : ""}`}
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
          className="binder-spark"
          viewBox="0 0 100 38"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Collection value trend, ${formatSignedPercent(spark.changePercent)}`}
        >
          <defs>
            <linearGradient id="binderSparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="70%" stopColor={stroke} stopOpacity="0.08" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={spark.areaPath} fill="url(#binderSparkFill)" />
          <path
            d={spark.linePath}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <ul className="sr-only" aria-label="Collection value snapshots">
          {points.map((point, index) => (
            <li key={`${point.date ?? "snapshot"}-${index}`}>
              {formatTrendDate(point.date) ?? `Snapshot ${index + 1}`}:{" "}
              <ClientPrice amountUsd={point.value} />
            </li>
          ))}
        </ul>

        {activePoint ? <span className="binder-spark-guide" style={{ left: markerLeft }} /> : null}

        {focusPoint ? (
          <span
            className={`binder-spark-dot${activePoint ? " is-active" : ""}`}
            style={{ left: markerLeft, top: markerTop, background: stroke }}
            aria-hidden
          />
        ) : null}

        {activePoint ? (
          <div
            className={`binder-spark-tooltip${activePoint.y < 14 ? " is-below" : " is-above"}`}
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
      <ClientPrice amountUsd={displayValue} className="binder-trend-value" />
    </>
  );
}

function HighlightCard({
  label,
  icon,
  item,
  metric,
  tone,
}: {
  label: string;
  icon: string;
  item: BinderAnalyticsItem;
  metric: React.ReactNode;
  tone: "neutral" | "up" | "down";
}) {
  return (
    <div className={`binder-highlight binder-highlight-${tone}`}>
      <div className="binder-highlight-head">
        <BinderIcon name={icon} className="binder-glyph" />
        <p>{label}</p>
      </div>
      <div className="binder-highlight-body">
        <div className="binder-highlight-thumb">
          <Image
            src={item.image}
            alt={item.name}
            fill
            sizes="56px"
            unoptimized
            className="object-contain"
          />
        </div>
        <div className="min-w-0">
          <strong title={item.name}>{item.name}</strong>
          <span>{item.grade === "Ungraded" ? "Raw" : item.grade}</span>
        </div>
      </div>
      <div className="binder-highlight-metric">{metric}</div>
    </div>
  );
}

function BinderPulseCard({
  pulse,
  holdingCount,
  topHoldingShare,
}: {
  pulse: BinderPulseInsight;
  holdingCount: number;
  topHoldingShare: number;
}) {
  const icon = pulse.tone === "hot" ? "sparkles" : pulse.tone === "steady" ? "scale" : "shield";
  const isFoundation = holdingCount < 3;
  const isConcentrated = topHoldingShare >= 0.6;
  const title = isFoundation
    ? isConcentrated
      ? "Concentrated, well tracked"
      : "Collection foundations"
    : pulse.title;
  const summary = isFoundation
    ? `${holdingCount} ${holdingCount === 1 ? "holding is" : "holdings are"} tracked. Add one more position before treating distribution and trend as reliable signals.`
    : pulse.summary;
  const actionTitle = isConcentrated ? "Reduce concentration over time" : pulse.actionTitle;
  const actionText = isConcentrated
    ? `Your largest holding represents ${Math.round(topHoldingShare * 100)}% of the collection value.`
    : pulse.actionText;

  return (
    <div className={`binder-pulse binder-pulse-${pulse.tone}`}>
      <div className="binder-pulse-main">
        <div className="binder-pulse-score">
          <strong>{pulse.score}</strong>
          <span>Readiness score</span>
        </div>
        <div className="min-w-0">
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
      </div>
      <div className="binder-pulse-action">
        <span className="binder-pulse-action-icon">
          <BinderIcon name={icon} className="binder-glyph" />
        </span>
        <div>
          <strong>{actionTitle}</strong>
          <p>{actionText}</p>
        </div>
      </div>
      <dl className="binder-pulse-metrics">
        {pulse.metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            <span>{metric.helper}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DistributionBars({
  title,
  slices,
}: {
  title: string;
  slices: ReturnType<typeof distributionByValue>;
}) {
  if (!slices.length) {
    return null;
  }

  const palette = ["#ff5147", "#ff7a5c", "#6ee7b7", "#94a3b8", "#a78bfa", "#64748b"];

  return (
    <div className="binder-dist">
      <p className="binder-dist-title">{title}</p>
      <ul className="binder-dist-list">
        {slices.map((slice, index) => (
          <li key={slice.key}>
            <div className="binder-dist-row">
              <span className="binder-dist-label" title={slice.key}>
                {slice.key}
              </span>
              <span className="binder-dist-pct">{Math.round(slice.share * 100)}%</span>
            </div>
            <div className="binder-dist-track">
              <span
                style={{
                  width: `${Math.max(slice.share * 100, 3)}%`,
                  background: palette[index % palette.length],
                }}
              />
            </div>
            <span className="binder-dist-meta">
              {slice.count} {slice.count === 1 ? "card" : "cards"} ·{" "}
              <ClientPrice amountUsd={slice.value} />
            </span>
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
      hasTrend: values.length >= 3,
    };
  }, [items, totalValueUsd, history]);

  const unlockedCount = analytics.achievements.filter((badge) => badge.unlocked).length;
  const unlockedBadges = analytics.achievements.filter((badge) => badge.unlocked);
  const lockedBadges = analytics.achievements.filter((badge) => !badge.unlocked);
  const isFoundation = items.length < 3;
  const pricedCount = items.filter((item) => item.currentValueUsd > 0).length;
  const costedCount = items.filter((item) => item.hasTrackedCost).length;
  const trendUp = analytics.spark.changePercent >= 0;

  return (
    <section className="binder-insights">
      <BinderPulseCard
        pulse={analytics.pulse}
        holdingCount={items.length}
        topHoldingShare={analytics.diversification.topHoldingShare}
      />

      {/* Standout holdings */}
      <section className="binder-standouts">
        <header>
          <h3 className="binder-insight-title">Standout holdings</h3>
          <p>Distinct signals from the cards already in your ledger.</p>
        </header>
        <div className="binder-highlight-grid">
        {analytics.highlights.crownJewel ? (
          <HighlightCard
            label="Crown jewel"
            icon="gem"
            tone="neutral"
            item={analytics.highlights.crownJewel}
            metric={
              <ClientPrice
                amountUsd={analytics.highlights.crownJewel.totalCurrentUsd}
                className="binder-highlight-value"
              />
            }
          />
        ) : null}
        {analytics.highlights.topMover ? (
          <HighlightCard
            label="Top mover today"
            icon={
              analytics.highlights.topMover.dayChangePercent >= 0
                ? "trending-up"
                : "trending-down"
            }
            tone={analytics.highlights.topMover.dayChangePercent >= 0 ? "up" : "down"}
            item={analytics.highlights.topMover}
            metric={
              <span
                className={
                  analytics.highlights.topMover.dayChangePercent >= 0
                    ? "binder-highlight-value text-emerald-300"
                    : "binder-highlight-value text-rose-300"
                }
              >
                {formatSignedPercent(analytics.highlights.topMover.dayChangePercent)}
              </span>
            }
          />
        ) : null}
        {!isFoundation &&
        analytics.highlights.biggestWinner &&
        analytics.highlights.biggestWinner.gainLossUsd > 0 ? (
          <HighlightCard
            label="Biggest winner"
            icon="trending-up"
            tone="up"
            item={analytics.highlights.biggestWinner}
            metric={
              <ClientPrice
                amountUsd={analytics.highlights.biggestWinner.gainLossUsd}
                className="binder-highlight-value text-emerald-300"
              />
            }
          />
        ) : null}
        {analytics.highlights.biggestLoser ? (
          <HighlightCard
            label="Needs a comeback"
            icon="trending-down"
            tone="down"
            item={analytics.highlights.biggestLoser}
            metric={
              <ClientPrice
                amountUsd={analytics.highlights.biggestLoser.gainLossUsd}
                className="binder-highlight-value text-rose-300"
              />
            }
          />
        ) : null}
      </div>

      {/* Full distributions need at least three holdings to avoid overstating tiny samples. */}
      {isFoundation ? (
        <div className="binder-foundations">
          <div>
            <h3>Build stronger signals</h3>
            <p>
              Add one more holding to unlock set, rarity, and diversification comparisons.
            </p>
          </div>
          <dl>
            <div>
              <dt>Market coverage</dt>
              <dd>
                {pricedCount}/{items.length}
              </dd>
            </div>
            <div>
              <dt>Cost coverage</dt>
              <dd>
                {costedCount}/{items.length}
              </dd>
            </div>
            <div>
              <dt>Largest position</dt>
              <dd>{Math.round(analytics.diversification.topHoldingShare * 100)}%</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="binder-breakdown-grid">
          <DistributionBars title="By rarity" slices={analytics.rarityDist} />
          <DistributionBars title="By set" slices={analytics.setDist} />
          <div className="binder-diversity">
            <p className="binder-dist-title">Vault balance</p>
            <div className="binder-diversity-score">
              <span>{analytics.diversification.diversityScore}</span>
              <p>
                Diversity
                <br />
                score
              </p>
            </div>
            <div className="binder-dist-track binder-diversity-track">
              <span style={{ width: `${Math.max(analytics.diversification.diversityScore, 3)}%` }} />
            </div>
            <ul className="binder-diversity-stats">
              <li>
                <span>Unique cards</span>
                <strong>{analytics.diversification.uniqueCards}</strong>
              </li>
              <li>
                <span>Total cards</span>
                <strong>{analytics.diversification.totalCards}</strong>
              </li>
              <li>
                <span>Sets</span>
                <strong>{analytics.diversification.uniqueSets}</strong>
              </li>
              <li>
                <span>Graded</span>
                <strong>{Math.round(analytics.diversification.gradedShare * 100)}%</strong>
              </li>
            </ul>
            <p className="binder-diversity-foot">
              Top card is {Math.round(analytics.diversification.topHoldingShare * 100)}% of value.
            </p>
          </div>
        </div>
      )}

      <div className="binder-insights-grid">
        <div className="binder-rank-card">
          <div className="binder-rank-head">
            <span className="binder-rank-badge" aria-hidden>
              <BinderIcon name={analytics.rank.icon} className="binder-glyph" />
            </span>
            <div>
              <strong>{analytics.rank.title}</strong>
              <span>Trainer rank</span>
              <p>{analytics.rank.blurb}</p>
            </div>
          </div>
          <div className="binder-rank-meter">
            <span style={{ width: `${Math.round(analytics.rank.progress * 100)}%` }} />
          </div>
          <p className="binder-rank-foot">
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

        <div className="binder-trend-card">
          {analytics.hasTrend ? (
            <CollectionTrendChart
              history={history}
              totalValueUsd={totalValueUsd}
              spark={analytics.spark}
              trendUp={trendUp}
            />
          ) : (
            <>
              <div className="binder-trend-head">
                <h3 className="binder-insight-title">Collection trend</h3>
                <span className="binder-trend-building">{history.length}/3 snapshots</span>
              </div>
              <p className="binder-trend-empty">
                Building a reliable baseline. Binder will show performance after three value
                snapshots.
              </p>
              <ClientPrice amountUsd={totalValueUsd} className="binder-trend-value" />
            </>
          )}
        </div>
      </div>

      {/* Achievements — always last */}
      <div className="binder-achievements">
        <div className="binder-achievements-head">
          <h3 className="binder-insight-title">Trainer badges</h3>
          <span>
            {unlockedCount}/{analytics.achievements.length} unlocked
          </span>
        </div>
        <ul className="binder-badge-grid surface-original-only">
          {analytics.achievements.map((badge) => (
            <li
              key={badge.id}
              className={badge.unlocked ? "binder-badge binder-badge-on" : "binder-badge"}
            >
              <span className="binder-badge-icon" aria-hidden>
                <BinderIcon name={badge.icon} className="binder-glyph" />
              </span>
              <strong>{badge.title}</strong>
              <span className="binder-badge-desc">{badge.desc}</span>
            </li>
          ))}
        </ul>
        <div className="surface-improved-only">
          <ul className="binder-badge-grid binder-badge-grid-unlocked">
            {unlockedBadges.map((badge) => (
              <li key={badge.id} className="binder-badge binder-badge-on">
                <span className="binder-badge-icon" aria-hidden>
                  <BinderIcon name={badge.icon} className="binder-glyph" />
                </span>
                <strong>{badge.title}</strong>
                <span className="binder-badge-desc">{badge.desc}</span>
              </li>
            ))}
          </ul>
          {lockedBadges.length ? (
            <details className="binder-locked-badges">
              <summary>
                <span>{lockedBadges.length} goals to unlock</span>
                <small>View criteria</small>
              </summary>
              <ul className="binder-badge-grid">
                {lockedBadges.map((badge) => (
                  <li key={badge.id} className="binder-badge">
                    <span className="binder-badge-icon" aria-hidden>
                      <BinderIcon name={badge.icon} className="binder-glyph" />
                    </span>
                    <strong>{badge.title}</strong>
                    <span className="binder-badge-desc">{badge.desc}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
      </section>
    </section>
  );
}
