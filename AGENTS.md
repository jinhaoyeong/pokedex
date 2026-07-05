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

### Context and token discipline

Keep context usage low and avoid carrying stale history across tasks.

- Start each task with a short plan and search only the files directly related to the request.
- Do not scan the whole repository unless the task clearly requires cross-cutting investigation.
- Prefer reading targeted file sections instead of entire files when possible.
- Do not open large logs, generated files, lockfiles, dependency folders, or build output unless required.
- Summarize findings briefly instead of pasting large outputs or repeating prior reasoning.
- Keep answers concise by default unless the user explicitly asks for detail.
- Use subagents only for clearly separate, high-noise work such as broad repo search, large log analysis, or multi-module investigation.
- Do not use subagents for simple edits, small bug fixes, documentation tweaks, or formatting tasks.
- If a subagent is used, ask it to return only a short summary, changed files, key findings, and next steps.
- When a task becomes long or research-heavy, create a short state summary and recommend `/compact`.
- When switching to an unrelated task, recommend `/clear` and start fresh.
- Preserve durable project decisions in this file instead of relying on old chat history.

### Environment variables (optional)

- `MARKET_DATA_CACHE=false` — disables in-memory server-side market cache

All market enrichment uses free public sources (Pokemon TCG API / TCGdex catalog prices, PriceCharting public pages, TCGFish, Magery sold comps). No paid API keys are required.

### Dev server notes

- Use **tmux** for long-running `npm run dev` sessions in Cloud Agent VMs.
- First request to `/search` or card pages may be slow while external APIs respond.
- Portfolio/binder state on `/portfolio` is stored in **browser localStorage**; persistence is per-browser session, not server-side.
- **Cloud vault (optional):** `/portfolio/vault` + `/api/portfolio` provide server-side portfolios backed by Supabase Postgres (Drizzle ORM, schema in `src/db/schema.ts`, migrations in `drizzle/`) and Clerk auth (`src/proxy.ts`). Requires `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`; without them the app runs exactly as before and the vault shows a setup notice. Apply schema with `npm run db:migrate` (or `db:push`). The auth proxy matcher never touches the existing public APIs.
- **Learning cache:** successful searches and card views write through to `data/pokemon-cards-cache.sqlite` (query→card affinity, trust scores, user corrections). Optional `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` sync learned cards across serverless instances.

### Smoke test path

Home → Search (`/search`) → search "pikachu" → open a card → `/portfolio` (binder).

### Git and deploy workflow

**Always push directly to `main`. Do not open pull requests.**

This repo deploys from `main`. Cloud agents and contributors must:

1. **Work on `main`** — check out `main`, pull latest, commit there. Do not create feature branches unless the user explicitly asks.
2. **Push to `main` when done** — `git push origin main` after every completed task.
3. **Never open PRs** unless the user explicitly asks for one. If a PR was opened by mistake, merge or cherry-pick into `main`, push, then close the PR.
4. Use clear commit messages. Treat every completed task as production-ready on `main`.

```bash
git checkout main
git pull origin main
# ... make changes, commit ...
git push origin main
```
