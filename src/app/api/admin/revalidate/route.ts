import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { invalidateCacheWhere } from "@/lib/server-response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RevalidateType = "card" | "price";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function isRevalidateType(value: unknown): value is RevalidateType {
  return value === "card" || value === "price";
}

function slugVariants(slug: string) {
  const variants = new Set([slug]);

  try {
    variants.add(decodeURIComponent(slug));
  } catch {
    // Keep the original slug if it is not URI encoded.
  }

  return variants;
}

function cardCacheKeyMatchesSlug(key: string, slug: string) {
  return [...slugVariants(slug)].some(
    (variant) => key === `card:${variant}` || key === variant,
  );
}

function priceCacheKeyMatchesSlug(key: string, slug: string) {
  if (key === slug || key === `price:${slug}`) {
    return true;
  }

  if (!key.startsWith("price:")) {
    return false;
  }

  const params = new URLSearchParams(key.slice("price:".length));
  const keySlug = params.get("slug");
  return Boolean(keySlug && slugVariants(slug).has(keySlug));
}

export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_SECRET_KEY;
  const authorization = request.headers.get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return unauthorized();
  }

  const body = (await request.json().catch(() => null)) as {
    slug?: unknown;
    type?: unknown;
  } | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const type = body?.type;

  if (!slug || !isRevalidateType(type)) {
    return NextResponse.json(
      { error: "Request body must include slug and type ('card' or 'price')." },
      { status: 400 },
    );
  }

  const deletedMemoryEntries =
    type === "card"
      ? invalidateCacheWhere((key) => cardCacheKeyMatchesSlug(key, slug))
      : invalidateCacheWhere((key) => priceCacheKeyMatchesSlug(key, slug));

  if (type === "card") {
    revalidatePath(`/api/cards/${slug}`);
    revalidatePath(`/cards/${slug}`);
  } else {
    revalidatePath("/api/price");
  }

  return NextResponse.json({
    success: true,
    slug,
    type,
    deletedMemoryEntries,
    revalidatedPaths:
      type === "card" ? [`/api/cards/${slug}`, `/cards/${slug}`] : ["/api/price"],
  });
}
