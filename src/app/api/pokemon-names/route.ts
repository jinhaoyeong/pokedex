import { NextResponse } from "next/server";

import {
  getPokemonNameDatabaseStats,
  isPokemonNameDatabaseReady,
  searchPokemonNames,
} from "@/lib/pokemon-name-db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20)));

  if (!isPokemonNameDatabaseReady()) {
    return NextResponse.json(
      {
        ready: false,
        results: [],
        stats: null,
        message: "Pokemon name database is not seeded. Run npm run db:seed.",
      },
      { status: 503 },
    );
  }

  if (!query) {
    return NextResponse.json({
      ready: true,
      results: [],
      stats: getPokemonNameDatabaseStats(),
    });
  }

  return NextResponse.json({
    ready: true,
    results: searchPokemonNames(query, limit),
    stats: getPokemonNameDatabaseStats(),
  });
}
