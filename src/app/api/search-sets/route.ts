import { NextRequest, NextResponse } from "next/server";

import { CARD_LANGUAGE_FILTERS, fetchSearchSets } from "@/lib/pokemon-tcg-api";
import type { CardLanguageFilter } from "@/types/pokemon";

export const runtime = "nodejs";
export const revalidate = 1800;
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const languageParam = request.nextUrl.searchParams.get("lang") ?? "all";
  const language = CARD_LANGUAGE_FILTERS.some((item) => item.code === languageParam)
    ? (languageParam as CardLanguageFilter)
    : "all";
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  try {
    const sets = await fetchSearchSets(language, query);

    if (!sets.length) {
      return NextResponse.json(
        { sets: [], error: "Set list unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      { sets },
      {
        headers: {
          "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=21600",
        },
      },
    );
  } catch (error) {
    console.error("search-sets failed", { language, query, error });

    return NextResponse.json(
      { sets: [], error: "Set list unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
