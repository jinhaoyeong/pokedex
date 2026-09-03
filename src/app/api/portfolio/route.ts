import { NextResponse } from "next/server";

import {
  addCardToPortfolio,
  ensureDbUser,
  getPortfolioOverview,
  isPortfolioBackendConfigured,
} from "@/lib/portfolio-db.server";

/**
 * Authenticated portfolio API. This is the ONLY /api namespace behind Clerk
 * (see src/proxy.ts); every pre-existing pricing/search API stays public.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser() {
  if (!isPortfolioBackendConfigured()) {
    return {
      user: null,
      error: NextResponse.json(
        { error: "Portfolio backend is not configured." },
        { status: 503 },
      ),
    };
  }

  const user = await ensureDbUser();

  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  return { user, error: null };
}

export async function GET() {
  const { user, error } = await requireUser();

  if (!user) {
    return error;
  }

  const overview = await getPortfolioOverview(user);

  return NextResponse.json(overview, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const { user, error } = await requireUser();

  if (!user) {
    return error;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const slug = typeof input.slug === "string" ? input.slug : "";

  if (!slug.trim()) {
    return NextResponse.json({ error: "A card slug is required." }, { status: 400 });
  }

  try {
    const item = await addCardToPortfolio(user, {
      slug,
      name: typeof input.name === "string" ? input.name : undefined,
      setName: typeof input.setName === "string" ? input.setName : undefined,
      setCode: typeof input.setCode === "string" ? input.setCode : undefined,
      collectorNumber:
        typeof input.collectorNumber === "string" ? input.collectorNumber : undefined,
      language: typeof input.language === "string" ? input.language : undefined,
      rarity: typeof input.rarity === "string" ? input.rarity : undefined,
      releaseDate: typeof input.releaseDate === "string" ? input.releaseDate : undefined,
      finish: typeof input.finish === "string" ? input.finish : undefined,
      grade: typeof input.grade === "string" ? input.grade : undefined,
      quantity: typeof input.quantity === "number" ? input.quantity : undefined,
      pricePaidUsd:
        typeof input.pricePaidUsd === "number" ? input.pricePaidUsd : undefined,
      marketPriceUsd:
        typeof input.marketPriceUsd === "number" ? input.marketPriceUsd : undefined,
      imageUrl: typeof input.imageUrl === "string" ? input.imageUrl : undefined,
    });

    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Could not add card." },
      { status: 400 },
    );
  }
}
