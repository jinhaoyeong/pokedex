"use client";

import Link from "next/link";
import { useState } from "react";

function DetailFact({
  label,
  value,
  href,
  quiet = false,
  compact = false,
}: {
  label: string;
  value: string;
  href?: string | null;
  quiet?: boolean;
  compact?: boolean;
}) {
  // `quiet` and `compact` used to swap background tints and min-heights.
  // The cells are ruled now, so there is no box to tint and every row is the
  // same height by construction; the props stay for call-site compatibility.
  void quiet;

  return (
    <div className="cd-fact">
      <p className="cd-fact-label">{label}</p>
      {href ? (
        <Link href={href} title={`Open the ${value} set list`} className="cd-fact-value">
          {value}
        </Link>
      ) : (
        <span className="cd-fact-value">{value}</span>
      )}
    </div>
  );
}

type DetailFactItem = {
  label: string;
  value: string;
  href?: string | null;
  quiet?: boolean;
};

export function CardDetailFacts({
  summaryLine,
  primaryFacts,
  secondaryFacts,
}: {
  summaryLine: string;
  primaryFacts: DetailFactItem[];
  secondaryFacts: DetailFactItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const fieldCount = primaryFacts.length + secondaryFacts.length;

  return (
    <>
      <div className="cd-facts hidden sm:grid lg:grid">
        {[...primaryFacts, ...secondaryFacts].map((fact) => (
          <DetailFact key={fact.label} {...fact} quiet={fact.quiet} />
        ))}
      </div>

      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="cd-facts-toggle"
        >
          <span className="min-w-0 flex-1">
            <span className="cd-facts-toggle-title">Card details</span>
            <span className="cd-facts-toggle-note">{summaryLine}</span>
          </span>
          <span className="cd-facts-toggle-count">
            {expanded ? "Hide" : `${fieldCount}`}
          </span>
        </button>
        {expanded ? (
          <div className="cd-facts cd-facts-compact">
            {[...primaryFacts, ...secondaryFacts].map((fact) => (
              <DetailFact key={fact.label} {...fact} compact quiet={fact.quiet} />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
