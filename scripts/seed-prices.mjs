#!/usr/bin/env node
/**
 * Background price warmer.
 *
 * Drives the app's own /api/price?refresh=1 endpoint for curated cards, gently
 * and throttled, so the local price cache (data/pokemon-prices-cache.sqlite) is
 * populated OUT OF BAND. The request path then serves prices from that cache with
 * zero external fetches — which is what keeps browsing from ever triggering an IP
 * block. Resumable: rows fresh within the TTL are skipped, so re-runs are cheap.
 *
 * Env:
 *   BASE_URL                 default http://localhost:3000
 *   INTERNAL_REFRESH_TOKEN   required for refresh=1 (must match the server)
 *   SEED_PRICES_CONCURRENCY  default 3
 *   SEED_PRICES_DELAY_MS     default 250  (delay between cards per worker)
 *   SEED_PRICES_TTL_HOURS    default 24   (skip cards warmed more recently)
 *   SEED_PRICES_MAX          default 0    (0 = all)
 */

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INTERNAL_TOKEN = process.env.INTERNAL_REFRESH_TOKEN ?? "";
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.SEED_PRICES_CONCURRENCY ?? "3", 10));
const DELAY_MS = Math.max(0, Number.parseInt(process.env.SEED_PRICES_DELAY_MS ?? "250", 10));
const TTL_MS = Math.max(0, Number.parseInt(process.env.SEED_PRICES_TTL_HOURS ?? "24", 10)) * 3_600_000;
const MAX = Math.max(0, Number.parseInt(process.env.SEED_PRICES_MAX ?? "0", 10));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadSeedCards() {
  const p = path.join(process.cwd(), "data", "pokemon-cards-seed.json");
  if (!fs.existsSync(p)) {
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Array.isArray(raw) ? raw : raw.cards ?? raw.data ?? [];
}

function freshSlugs() {
  const p = path.join(process.cwd(), "data", "pokemon-prices-cache.sqlite");
  const fresh = new Set();
  if (TTL_MS === 0 || !fs.existsSync(p)) {
    return fresh;
  }
  try {
    const db = new Database(p, { readonly: true, fileMustExist: true });
    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    for (const row of db
      .prepare("SELECT slug FROM price_cache WHERE ungraded_usd > 0 AND fetched_at >= ?")
      .iterate(cutoff)) {
      fresh.add(row.slug);
    }
    db.close();
  } catch {
    /* no cache yet */
  }
  return fresh;
}

function buildQuery(card) {
  const params = new URLSearchParams();
  params.set("slug", card.slug);
  params.set("name", card.name ?? "");
  params.set("language", card.language ?? "en");
  params.set("refresh", "1");
  if (card.cardId) params.set("cardId", card.cardId);
  if (card.setCode) params.set("setCode", card.setCode);
  if (card.setName) params.set("setName", card.setName);
  if (card.setEnglishName) params.set("setEnglishName", card.setEnglishName);
  if (card.collectorNumber) params.set("number", card.collectorNumber);
  if (card.englishName) params.set("englishName", card.englishName);
  if (card.rarity) params.set("rarity", card.rarity);
  return params.toString();
}

async function warmCard(card) {
  const url = `${BASE_URL}/api/price?${buildQuery(card)}`;
  try {
    const response = await fetch(url, {
      headers: INTERNAL_TOKEN ? { "x-internal-token": INTERNAL_TOKEN } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return { slug: card.slug, ok: false, reason: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return {
      slug: card.slug,
      ok: data.ungradedUsd > 0,
      price: data.ungradedUsd,
      provider: data.primaryProvider,
    };
  } catch (error) {
    return { slug: card.slug, ok: false, reason: error?.message ?? "fetch failed" };
  }
}

async function main() {
  if (!INTERNAL_TOKEN) {
    console.warn(
      "[seed-prices] INTERNAL_REFRESH_TOKEN is not set — refresh will be rejected and the cache won't update.",
    );
  }

  const fresh = freshSlugs();
  let cards = loadSeedCards().filter((card) => card?.slug && !fresh.has(card.slug));
  if (MAX > 0) {
    cards = cards.slice(0, MAX);
  }

  console.log(
    `[seed-prices] ${cards.length} card(s) to warm (skipped ${fresh.size} fresh) · concurrency ${CONCURRENCY} · base ${BASE_URL}`,
  );

  let priced = 0;
  let empty = 0;
  let index = 0;

  async function worker() {
    while (index < cards.length) {
      const card = cards[index++];
      const result = await warmCard(card);
      if (result.ok) {
        priced += 1;
        console.log(`  ✓ ${result.slug} → $${result.price} (${result.provider})`);
      } else {
        empty += 1;
        console.log(`  · ${result.slug} → no price${result.reason ? ` (${result.reason})` : ""}`);
      }
      if (DELAY_MS) {
        await sleep(DELAY_MS);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`[seed-prices] done — ${priced} priced, ${empty} without a price.`);
}

main().catch((error) => {
  console.error("[seed-prices] failed:", error);
  process.exit(1);
});
