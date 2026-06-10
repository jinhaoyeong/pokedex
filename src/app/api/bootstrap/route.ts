import { NextResponse } from "next/server";

import { getFeaturedCards } from "@/lib/cards";
import { getLivePreviewCards } from "@/lib/preview-cards";
import { fetchSearchSets } from "@/lib/pokemon-tcg-api";

export const revalidate = 1800;
export const maxDuration = 30;

export async function GET() {
  const fallbackCards = getFeaturedCards(3);

  const [setsResult, previewResult] = await Promise.allSettled([
    fetchSearchSets("all"),
    getLivePreviewCards(3),
  ]);

  const sets = setsResult.status === "fulfilled" ? setsResult.value : [];
  const previewCards =
    previewResult.status === "fulfilled" && previewResult.value.length
      ? previewResult.value
      : fallbackCards;

  return NextResponse.json(
    {
      sets,
      previewCards,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
