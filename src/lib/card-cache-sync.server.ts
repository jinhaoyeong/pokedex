import "server-only";

import type { TcgCard } from "@/types/pokemon";

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

  const statements = [
    {
      sql: `INSERT INTO card_search_cache (
        slug, language_code, collector_number, printed_total, card_json, query_text,
        hit_count, last_searched_at, created_at, enriched_at, trust_score
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        card_json = excluded.card_json,
        hit_count = card_search_cache.hit_count + 1,
        last_searched_at = excluded.last_searched_at,
        enriched_at = excluded.enriched_at,
        trust_score = MAX(card_search_cache.trust_score, excluded.trust_score)`,
      args: [
        card.slug,
        card.language,
        card.collectorNumber || null,
        card.setPrintedTotal ?? card.setTotal ?? null,
        JSON.stringify(card),
        null,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
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
    body: JSON.stringify({ requests: statements.map((statement) => ({ type: "execute", stmt: statement })) }),
  });
}
