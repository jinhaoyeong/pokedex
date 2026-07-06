import { NextResponse } from "next/server";

import {
  isEmbeddingIndexReady,
  isVisualIndexReady,
  searchByEmbedding,
  searchByHash,
  visualIndexSize,
} from "@/lib/scan/visual-index.server";

export const runtime = "nodejs";

/** Capability probe — which matchers are populated. */
export async function GET() {
  return NextResponse.json({
    ready: await isVisualIndexReady(),
    neural: await isEmbeddingIndexReady(),
    size: await visualIndexSize(),
  });
}

interface VisualSearchBody {
  hash?: string;
  embedding?: number[];
  limit?: number;
}

/**
 * Match a scanned photo against the catalog visual index. Prefers the CLIP
 * embedding (robust to foil/lighting) when provided, falling back to the
 * perceptual hash. Either way the photo never leaves the device — only a hash
 * or an embedding vector is sent.
 */
export async function POST(request: Request) {
  let body: VisualSearchBody;
  try {
    body = (await request.json()) as VisualSearchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const limit = Math.min(40, Math.max(1, Number(body.limit) || 24));

  // Embedding match (preferred).
  if (
    Array.isArray(body.embedding) &&
    body.embedding.length >= 128 &&
    body.embedding.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    const hits = await searchByEmbedding(body.embedding, limit);
    if (hits.length || !body.hash) {
      return NextResponse.json(
        { ready: await isVisualIndexReady(), method: "neural", hits },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // Perceptual-hash fallback.
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

  const hits = await searchByHash(hash, limit);
  return NextResponse.json(
    { ready: await isVisualIndexReady(), method: "phash", hits },
    { headers: { "Cache-Control": "no-store" } },
  );
}
