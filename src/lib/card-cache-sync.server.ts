import "server-only";

import type { TcgCard } from "@/types/pokemon";

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchBlob(card: TcgCard) {
  return normalizeSearchText(
    [
      card.name,
      card.localizedName,
      card.englishName,
      card.setName,
      card.setLocalizedName,
      card.setEnglishName,
      card.setCode,
      card.collectorNumber,
      card.rarity,
      card.supertype,
      ...(card.types ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Optional remote persistence for serverless deployments.
 * Configure TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for shared learning across instances.
 */
export async function syncCardToRemoteCache(card: TcgCard) {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (!url || !authToken || !card.slug) {
    return;
  }

  const now = new Date().toISOString();
  const searchBlob = buildSearchBlob(card);

  const statements = [
    {
      sql: `INSERT INTO card_search_cache (
        slug, language_code, collector_number, printed_total, card_json, query_text, search_blob,
        hit_count, last_searched_at, created_at, enriched_at, identity_status, price_status,
        trust_score, search_hits, detail_views, wrong_price_flags, wrong_card_flags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'estimated', 'estimated', ?, 0, 1, 0, 0)
      ON CONFLICT(slug) DO UPDATE SET
        card_json = excluded.card_json,
        search_blob = excluded.search_blob,
        hit_count = card_search_cache.hit_count + 1,
        last_searched_at = excluded.last_searched_at,
        enriched_at = excluded.enriched_at,
        detail_views = COALESCE(card_search_cache.detail_views, 0) + 1,
        trust_score = MAX(COALESCE(card_search_cache.trust_score, 0.5), excluded.trust_score)`,
      args: [
        card.slug,
        card.language,
        card.collectorNumber || null,
        card.setPrintedTotal ?? card.setTotal ?? null,
        JSON.stringify(card),
        null,
        searchBlob,
        now,
        now,
        now,
        0.5,
      ],
    },
  ];

  await fetch(`${url.replace("libsql://", "https://")}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: statements.map((statement) => ({ type: "execute", stmt: statement })),
    }),
  });
}
