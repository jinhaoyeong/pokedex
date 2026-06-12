import { NextResponse } from "next/server";

import { refreshCardInBackground } from "@/lib/card-learning.server";

export const maxDuration = 60;

function isAuthorized(request: Request) {
  const requiredToken = process.env.INTERNAL_REFRESH_TOKEN?.trim();

  if (!requiredToken) {
    return true;
  }

  return request.headers.get("x-internal-token") === requiredToken;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as { slug?: string };
  const slug = payload.slug?.trim();

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const card = await refreshCardInBackground(slug);

  if (!card) {
    return NextResponse.json({ error: "Card refresh failed" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, card });
}
