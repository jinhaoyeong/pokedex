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
  const valueClassName = `min-w-0 font-semibold leading-snug ${
    compact
      ? "truncate text-right text-[0.8rem]"
      : "mt-1 line-clamp-2 text-[0.84rem] sm:text-[0.92rem]"
  }`;

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-lg border px-2.5 py-1.5 sm:px-3 sm:py-2.5 ${
        quiet
          ? "border-white/10 bg-white/[0.035]"
          : "border-white/10 bg-white/[0.045]"
      } ${compact ? "flex min-h-0 flex-row items-baseline justify-between gap-2" : "flex min-h-[3.5rem] flex-col justify-center sm:min-h-[3.75rem]"}`}
    >
      <p
        className={`font-bold uppercase tracking-[0.08em] text-slate-400 ${
          compact ? "shrink-0 text-[9px]" : "text-[10px]"
        }`}
      >
        {label}
      </p>
      {href ? (
        <Link
          href={href}
          title={`Open the ${value} set list`}
          className={`${valueClassName} card-detail-fact-link text-sky-200 underline-offset-2 hover:text-white hover:underline`}
        >
          {value}
        </Link>
      ) : (
        <p className={`${valueClassName} text-white`}>{value}</p>
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
      <div className="hidden gap-2 sm:grid sm:grid-cols-3 lg:grid">
        {[...primaryFacts, ...secondaryFacts].map((fact) => (
          <DetailFact key={fact.label} {...fact} quiet={fact.quiet} />
        ))}
      </div>

      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight text-slate-200">
              Card details
            </span>
            <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-500">
              {summaryLine}
            </span>
          </span>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            {expanded ? "Hide" : `${fieldCount}`}
          </span>
        </button>
        {expanded ? (
          <div className="mt-1.5 grid gap-1">
            {[...primaryFacts, ...secondaryFacts].map((fact) => (
              <DetailFact key={fact.label} {...fact} compact quiet={fact.quiet} />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
