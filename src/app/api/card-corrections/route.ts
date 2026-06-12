import { NextResponse } from "next/server";

import { listCardCorrections, recordCardCorrection } from "@/lib/pokemon-cards-cache.server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim();

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  return NextResponse.json({ corrections: listCardCorrections(slug) });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    slug?: string;
    field?: "price" | "identity";
    reportedValue?: string;
    note?: string;
  };

  const slug = payload.slug?.trim();
  const field = payload.field;

  if (!slug || (field !== "price" && field !== "identity")) {
    return NextResponse.json({ error: "slug and field are required" }, { status: 400 });
  }

  recordCardCorrection({
    slug,
    field,
    reportedValue: payload.reportedValue?.trim(),
    note: payload.note?.trim(),
  });

  return NextResponse.json({ ok: true });
}
