import { NextRequest, NextResponse } from "next/server";

import { CARD_LANGUAGE_FILTERS, fetchSearchSets } from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter } from "@/types/pokemon";

export const revalidate = 1800;

export async function GET(request: NextRequest) {
  const languageParam = request.nextUrl.searchParams.get("lang") ?? "all";
  const language = CARD_LANGUAGE_FILTERS.some((item) => item.code === languageParam)
    ? (languageParam as CardLanguageFilter)
    : "all";
  const sets = await fetchSearchSets(language);

  return NextResponse.json(
    { sets },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=21600",
      },
    },
  );
}
