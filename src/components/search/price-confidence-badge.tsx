import type { PriceDisplayMeta } from "@/lib/catalog/price-confidence";

const CONFIDENCE_STYLES: Record<
  PriceDisplayMeta["confidence"],
  { border: string; bg: string; text: string }
> = {
  high: {
    border: "border-emerald-400/35",
    bg: "bg-emerald-400/10",
    text: "text-emerald-100",
  },
  medium: {
    border: "border-blue-400/35",
    bg: "bg-blue-400/10",
    text: "text-blue-100",
  },
  low: {
    border: "border-amber-400/35",
    bg: "bg-amber-400/10",
    text: "text-amber-100",
  },
};

export function PriceConfidenceBadge({ meta }: { meta: PriceDisplayMeta }) {
  const styles = CONFIDENCE_STYLES[meta.confidence];

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${styles.border} ${styles.bg} ${styles.text}`}
      >
        {meta.label}
      </span>
      {meta.lastSoldAt && meta.lastSoldPriceUsd ? (
        <span className="text-[10px] font-semibold text-slate-400">
          Last sold ${meta.lastSoldPriceUsd.toFixed(2)}
        </span>
      ) : null}
    </div>
  );
}
