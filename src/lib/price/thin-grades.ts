import type { GradedPrice } from "@/types/pokemon";

const THIN_SALE_COUNT = 3;
const SLAB_VS_RAW_FLOOR = 0.45;

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function thinGradeWarning(price: GradedPrice, rawUsd: number): string | undefined {
  if (price.grade === "Ungraded") {
    return price.warning;
  }

  const notes: string[] = [];
  const saleCount = price.saleCount;

  if (typeof saleCount === "number" && saleCount > 0 && saleCount < THIN_SALE_COUNT) {
    notes.push("Thin sample (fewer than 3 sold comps).");
  }

  const slabUsd = positive(price.value);
  if (rawUsd > 0 && slabUsd > 0 && slabUsd < rawUsd * SLAB_VS_RAW_FLOOR) {
    notes.push("Slab is well below the raw/sold guide; treat as lower confidence.");
  }

  if (!notes.length) {
    return price.warning;
  }

  const combined = notes.join(" ");
  if (price.warning && price.warning.includes(combined)) {
    return price.warning;
  }

  return price.warning ? `${price.warning} ${combined}` : combined;
}

/** Flag thin or inverted slabs so the UI does not treat them as equal-confidence. */
export function flagThinGradedPrices(gradedPrices: GradedPrice[]): GradedPrice[] {
  const rawUsd = positive(gradedPrices.find((price) => price.grade === "Ungraded")?.value);

  return gradedPrices.map((price) => {
    const warning = thinGradeWarning(price, rawUsd);
    if (warning === price.warning) {
      return price;
    }

    return {
      ...price,
      warning,
      confidence:
        price.confidence === "high"
          ? "medium"
          : (price.confidence ?? "low"),
      confidenceScore: Math.min(price.confidenceScore ?? 0.42, 0.42),
    };
  });
}
