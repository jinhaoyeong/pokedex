import { NextResponse } from "next/server";

import {
  isVisualIndexReady,
  searchByHash,
  visualIndexSize,
} from "@/lib/scan/visual-index.server";

export const runtime = "nodejs";

/** Capability probe — lets the client know whether the index is populated. */
export async function GET() {
  return NextResponse.json({
    ready: isVisualIndexReady(),
    size: visualIndexSize(),
  });
}

interface VisualSearchBody {
  hash?: string;
  limit?: number;
}

/**
 * Match a scanned photo's perceptual hash against the catalog visual index.
 * The client sends only an 8-byte hash (as a decimal string) — the photo never
 * leaves the device.
 */
export async function POST(request: Request) {
  let body: VisualSearchBody;
  try {
    body = (await request.json()) as VisualSearchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawHash = typeof body.hash === "string" ? body.hash.trim() : "";
  if (!/^\d+$/.test(rawHash)) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  let hash: bigint;
  try {
    hash = BigInt(rawHash);
  } catch {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  const limit = Math.min(40, Math.max(1, Number(body.limit) || 24));
  const hits = searchByHash(hash, limit);

  return NextResponse.json(
    { ready: isVisualIndexReady(), hits },
    { headers: { "Cache-Control": "no-store" } },
  );
}
