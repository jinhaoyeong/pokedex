# PokePokedex

Pokemon TCG search, pricing, grading market, and binder — Next.js web app.

**Branch:** `redesign/premium-black` (premium-black UI)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Native iOS companion

A SwiftUI iOS app lives beside this repo at [`../pokedex-ios`](../pokedex-ios) (or a sibling `pokedex-ios` checkout). It consumes the same APIs:

- `/api/live-search`
- `/api/price`
- `/api/grading-market`
- card detail routes

Run this web app locally, then point the iOS **Settings → API Base URL** at `http://127.0.0.1:3000` (simulator) or your Mac LAN IP (device).

See the iOS [README](../pokedex-ios/README.md) for Xcode setup and feature parity notes.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local Next.js server |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run db:seed:all` | Seed local name/set/card DBs |

Agent-oriented setup notes: [AGENTS.md](./AGENTS.md)
