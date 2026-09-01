import { NextResponse } from "next/server";

import {
  findJapaneseCardNameSearchAliases,
  getPokemonNameDatabaseStats,
  isPokemonNameDatabaseReady,
  searchPokemonNames,
} from "@/lib/pokemon-name-db.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20)));

  const ready = await isPokemonNameDatabaseReady();

  if (!ready) {
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
      aliases: [],
      stats: await getPokemonNameDatabaseStats(),
    });
  }

  const aliases =
    searchParams.get("aliases") === "ja"
      ? await findJapaneseCardNameSearchAliases(query)
      : [];

  return NextResponse.json({
    ready: true,
    results: await searchPokemonNames(query, limit),
    aliases,
    stats: await getPokemonNameDatabaseStats(),
  });
}
