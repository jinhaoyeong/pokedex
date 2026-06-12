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
- **Seed name DB:** `npm run db:seed` (builds `data/pokemon-names.sqlite` from PokeAPI; required for multilingual search aliases)
- **Seed sets DB:** `npm run db:seed:sets` (builds `data/pokemon-sets.sqlite` for fast set search)
- **Seed cards index:** `npm run db:seed:cards-index` (EN/JP card identities, 1998–2026 sets → `pokemon-cards-index.sqlite`)
- **Seed all local DBs:** `npm run db:seed:all` (names + sets + cards index)
- **Export learned cards:** `npm run db:export:cards-cache` (writes high-trust cards from `pokemon-cards-cache.sqlite` into `data/pokemon-cards-seed.json` for new deploys)
- **Dev:** `npm run dev`
- **Lint:** `npm run lint`
- **Typecheck:** `npm run typecheck`
- **Build:** `npm run build`
- **Production run:** `npm run start` (after build)

There is no `test` script or test runner configured.

### Environment variables (optional)

- `MARKET_DATA_CACHE=false` — disables in-memory server-side market cache

All market enrichment uses free public sources (Pokemon TCG API / TCGdex catalog prices, PriceCharting public pages, TCGFish, Magery sold comps). No paid API keys are required.

### Dev server notes

- Use **tmux** for long-running `npm run dev` sessions in Cloud Agent VMs.
- First request to `/search` or card pages may be slow while external APIs respond.
- Portfolio/binder state is stored in **browser localStorage**; persistence is per-browser session, not server-side.
- **Learning cache:** successful searches and card views write through to `data/pokemon-cards-cache.sqlite` (query→card affinity, trust scores, user corrections). Optional `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` sync learned cards across serverless instances.

### Smoke test path

Home → Search (`/search`) → search "pikachu" → open a card → `/portfolio` (binder).

### Git and deploy workflow

**Always deploy to `main`.** Cloud agents should:

1. Work on the `main` branch (or merge into `main` before finishing).
2. Commit with clear messages and `git push origin main` when done.
3. **Do not** open feature-branch PRs unless the user explicitly asks for one.

Treat every completed task as production-ready on `main`.
