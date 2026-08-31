# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: Pokemon TCG collectors who already own or are buying cards, checking a binder on desktop for ledger work and on a phone for a fast value glance, then searching or adding a card.

## Product Purpose

PokePokedex is a Pokemon TCG intelligence app for searching cards, tracking market prices, following graded populations, and managing a personal portfolio. Success is identifying a card quickly (name, set, language, collector number) and seeing honest holdings value, daily move, and unrealized P/L without leaving the binder.

## Positioning

One searchable index across English, Japanese, and Chinese sets, with live market quotes for raw and graded copies, kept beside a local (and optional cloud) binder. A neighboring price site can show a quote; it cannot keep this collector's cost basis, grade mix, and holdings ledger in the same place.

## Operating Context

Collectors scan or search a card, open its detail, optionally add it to the binder with quantity and unit cost, then return to Portfolio to read total value and P/L. Currency defaults to MYR and can be switched. Grading states include raw (Ungraded) and slab grades such as PSA 10. An iOS companion exists beside this repo but this record covers the Next.js web app.

## Capabilities and Constraints

Confirmed in this app: search by name/set/number/language, card detail with market and graded prices, portfolio holdings with sort (recent, value, P/L, A–Z) and grade filters, quantity and cost-basis editing, add-from-search, client currency conversion.

This redesign covers two existing regions only: the portfolio summary + holdings ledger, and the search hero. Layout may change aggressively so the tool feels like collector paperwork rather than a stock dashboard. The same product facts and actions must remain. Do not invent prices, customers, or capabilities.

Undecided: whether the separate Portfolio page hero (above the summary) is in scope. Treat it as out of scope unless later requested.

## Brand Commitments

Name: PokePokedex. Dark operating surface already in the product. User-binding constraints for these two regions: no generic fintech KPI-card dashboard, no sci-fi scanner HUD, no game-skin/toy treatment, numbers and filters must stay scannable, no looping glow or decorative motion while reading prices. Scroll or object motion is welcome when it explains the object (a slab, a ledger printing in).

## Evidence on Hand

Live product copy and screens of the incumbent summary cards, holdings ledger, and Card Dex Scanner hero. Real catalog card images and market figures from the app. Do not fabricate testimonials, benchmarks, or unaudited prices.

## Product Principles

- Identify the physical card first; money is a consequence of identity.
- Desktop is for comparing holdings in columns; phone is for a glance, then an action.
- Show empty, pending, and uncosted states honestly rather than filling them with fake figures.
- Motion may demonstrate a slab or a printed ledger; it must never compete with a price.
- Stay a collector's instrument, not a trading-app skin or a merch drop.
