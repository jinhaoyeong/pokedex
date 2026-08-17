"use client";

import Image from "next/image";
import { useMemo } from "react";

import { ClientPrice } from "@/components/client-price";
import { BinderIcon } from "@/components/portfolio/binder-icons";
import {
  type BinderAnalyticsItem,
  type PortfolioHistoryPoint,
  computeAchievements,
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
          <Image src={item.image} alt={item.name} fill sizes="56px" className="object-contain" />
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

  const palette = ["#ffcb05", "#2d6cdf", "#42d77d", "#ff6b35", "#a855f7", "#64748b"];

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

    const values = history.map((point) => point.value).filter((value) => value > 0);
    const spark = sparklineGeometry(values, 100, 38);

    return {
      rank,
      highlights,
      diversification,
      achievements,
      rarityDist,
      setDist,
      spark,
      hasTrend: values.length >= 2,
    };
  }, [items, totalValueUsd, history]);

  const unlockedCount = analytics.achievements.filter((badge) => badge.unlocked).length;
  const trendUp = analytics.spark.changePercent >= 0;

  return (
    <section className="binder-insights">
      <div className="binder-insights-grid">
        {/* Collector rank — gamified tier + progress to next */}
        <div className="binder-rank-card">
          <p className="binder-eyebrow">Trainer rank</p>
          <div className="binder-rank-head">
            <span className="binder-rank-badge" aria-hidden>
              <BinderIcon name={analytics.rank.icon} className="binder-glyph" />
            </span>
            <div>
              <strong>{analytics.rank.title}</strong>
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

        {/* Portfolio value trend sparkline */}
        <div className="binder-trend-card">
          <div className="binder-trend-head">
            <p className="binder-eyebrow">Collection trend</p>
            {analytics.hasTrend ? (
              <span className={trendUp ? "binder-trend-up" : "binder-trend-down"}>
                {formatSignedPercent(analytics.spark.changePercent)}
              </span>
            ) : null}
          </div>
          {analytics.hasTrend ? (
            <svg
              className="binder-spark"
              viewBox="0 0 100 38"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Collection value trend, ${formatSignedPercent(analytics.spark.changePercent)}`}
            >
              <defs>
                <linearGradient id="binderSparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendUp ? "#42d77d" : "#ef233c"} stopOpacity="0.42" />
                  <stop offset="100%" stopColor={trendUp ? "#42d77d" : "#ef233c"} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={analytics.spark.areaPath} fill="url(#binderSparkFill)" />
              <path
                d={analytics.spark.linePath}
                fill="none"
                stroke={trendUp ? "#42d77d" : "#ef233c"}
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {analytics.spark.last ? (
                <circle
                  cx={analytics.spark.last.x}
                  cy={analytics.spark.last.y}
                  r="1.8"
                  fill={trendUp ? "#42d77d" : "#ef233c"}
                />
              ) : null}
            </svg>
          ) : (
            <p className="binder-trend-empty">
              Price history builds up as your cards gather market data.
            </p>
          )}
          <ClientPrice amountUsd={totalValueUsd} className="binder-trend-value" />
        </div>
      </div>

      {/* Standout holdings */}
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
        {analytics.highlights.biggestWinner && analytics.highlights.biggestWinner.gainLossUsd > 0 ? (
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

      {/* Distributions + diversity */}
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

      {/* Achievements */}
      <div className="binder-achievements">
        <div className="binder-achievements-head">
          <p className="binder-eyebrow">Trainer badges</p>
          <span>
            {unlockedCount}/{analytics.achievements.length} unlocked
          </span>
        </div>
        <ul className="binder-badge-grid">
          {analytics.achievements.map((badge) => (
            <li
              key={badge.id}
              className={badge.unlocked ? "binder-badge binder-badge-on" : "binder-badge"}
              title={badge.desc}
            >
              <span className="binder-badge-icon" aria-hidden>
                <BinderIcon name={badge.icon} className="binder-glyph" />
              </span>
              <strong>{badge.title}</strong>
              <span className="binder-badge-desc">{badge.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
