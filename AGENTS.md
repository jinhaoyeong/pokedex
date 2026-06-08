# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

**PokePokedex** is a single Next.js 16 app (Pokemon TCG card search, pricing, and portfolio/binder). There is no monorepo, database, or docker-compose — only the Next.js dev server is required locally.

### Services

| Service | Required | Command |
|---------|----------|---------|
| Next.js app | Yes | `npm run dev` → http://localhost:3000 |

External APIs (Pokemon TCG API, TCGdex, etc.) are called over HTTPS at runtime. Outbound network is needed for live search and pricing; the app degrades gracefully when sources fail.

### Standard commands

See `package.json` scripts:

- **Install:** `npm install`
- **Dev:** `npm run dev`
- **Lint:** `npm run lint`
- **Typecheck:** `npm run typecheck`
- **Build:** `npm run build`
- **Production run:** `npm run start` (after build)

There is no `test` script or test runner configured.

### Environment variables (optional)

- `DATABASE_URL` — PostgreSQL connection for catalog persistence, sold listings, and market cache (optional; file cache used when unset)
- `CRON_SECRET` — authorizes `/api/cron/ingest` (Vercel Cron runs every 6 hours)
- `PRICECHARTING_TOKEN` — enables paid PriceCharting API enrichment
- `MARKET_DATA_CACHE=false` — disables in-memory server-side market cache

### Catalog ingest

- `npm run ingest:catalog` — rebuilds `data/catalog/set-mappings.json` and live FX rates from TCGdex
- Build runs ingest automatically before `next build`

### Dev server notes

- Use **tmux** for long-running `npm run dev` sessions in Cloud Agent VMs.
- First request to `/search` or card pages may be slow while external APIs respond.
- Portfolio/binder state is stored in **browser localStorage**; persistence is per-browser session, not server-side.

### Smoke test path

Home → Search (`/search`) → search "pikachu" → open a card → `/portfolio` (binder).
