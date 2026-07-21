import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Same-origin proxy for official card art so the browser can draw catalog
 * images onto a canvas (for perceptual hashing / on-device embeddings) without
 * tripping cross-origin canvas tainting. Only known image hosts are allowed.
 */
const ALLOWED_HOSTS = new Set([
  "images.pokemontcg.io",
  "images.scrydex.com",
  "assets.tcgdex.net",
  "www.pokemon-card.com",
  "storage.googleapis.com",
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        accept: "image/*",
        // pokemon-card.com hotlink-protects assets without a same-site referer.
        ...(parsed.hostname === "www.pokemon-card.com"
          ? {
              Referer: "https://www.pokemon-card.com/",
              "User-Agent":
                "Mozilla/5.0 (compatible; PokePokedex/1.0; +https://pokepokedex.app)",
            }
          : {}),
      },
      // Card art is immutable per URL; let the platform cache aggressively.
      cache: "force-cache",
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Upstream fetch failed" },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";

    return new NextResponse(upstream.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=604800, immutable",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return NextResponse.json({ error: "Proxy error" }, { status: 502 });
  }
}
