import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import {
  isUsableMarketPriceUsd,
  normalizeMarketGrade,
  POKEDEX_MARKET_MAX_USD,
  POKEDEX_MARKET_MIN_USD,
} from "@/lib/market/pokedex-market-guide";
import { recordPokedexMarketObservation } from "@/lib/market/pokedex-market-guide.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "pokedex_market_cid";
const HOUR_MS = 60 * 60 * 1000;
const MAX_POSTS_PER_HOUR = 40;
const recentPosts = new Map<string, number[]>();

function trimRecent(contributorKey: string) {
  const cutoff = Date.now() - HOUR_MS;
  const next = (recentPosts.get(contributorKey) ?? []).filter((at) => at >= cutoff);
  recentPosts.set(contributorKey, next);
  return next;
}

function allowPost(contributorKey: string) {
  const next = trimRecent(contributorKey);
  if (next.length >= MAX_POSTS_PER_HOUR) {
    return false;
  }
  next.push(Date.now());
  recentPosts.set(contributorKey, next);
  return true;
}

function newContributorId() {
  return crypto.randomUUID();
}

export async function POST(request: Request) {
  let payload: {
    slug?: string;
    grade?: string;
    priceUsd?: number;
    kind?: string;
    setCode?: string;
    collectorNumber?: string;
    language?: string;
    name?: string;
    rarity?: string;
    releaseDate?: string;
    finish?: string;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = payload.slug?.trim().toLowerCase();
  const priceUsd =
    typeof payload.priceUsd === "number" ? payload.priceUsd : Number(payload.priceUsd);
  const kind = payload.kind === "sold" ? "sold" : payload.kind === "paid" ? "paid" : null;

  if (!slug || !kind || !isUsableMarketPriceUsd(priceUsd)) {
    return NextResponse.json(
      {
        error: `slug, kind (sold|paid), and a USD price between ${POKEDEX_MARKET_MIN_USD} and ${POKEDEX_MARKET_MAX_USD} are required.`,
      },
      { status: 400 },
    );
  }

  const jar = await cookies();
  let anonymousId = jar.get(COOKIE_NAME)?.value?.trim();
  if (!anonymousId || anonymousId.length < 16) {
    anonymousId = newContributorId();
  }

  let userId: string | null = null;
  try {
    userId = await Promise.race([
      auth()
        .then((session) => session.userId ?? null)
        .catch(() => null),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 400);
        timer.unref?.();
      }),
    ]);
  } catch {
    userId = null;
  }
  const contributorKey = userId ? `clerk:${userId}` : `anon:${anonymousId}`;

  if (!allowPost(contributorKey)) {
    return NextResponse.json(
      { error: "Too many market reports from this collector." },
      { status: 429 },
    );
  }

  const stored = await recordPokedexMarketObservation({
    slug,
    grade: normalizeMarketGrade(payload.grade),
    priceUsd,
    kind,
    contributorKey,
    setCode: payload.setCode,
    collectorNumber: payload.collectorNumber,
    language: payload.language,
    name: payload.name,
    rarity: payload.rarity,
    releaseDate: payload.releaseDate,
    finish: payload.finish,
    source: kind === "sold" ? "pokedex-binder-sold" : "pokedex-binder-paid",
  });

  const response = NextResponse.json({
    ok: true,
    stored,
    grade: normalizeMarketGrade(payload.grade),
  });
  response.cookies.set({
    name: COOKIE_NAME,
    value: anonymousId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
