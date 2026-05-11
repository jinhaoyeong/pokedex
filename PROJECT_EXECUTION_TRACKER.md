# Pokemon TCG Pokedex App Execution Tracker

## Purpose

This file is the working source of truth for implementation.
Use it to stay aligned with scope, avoid drifting, and track what is done next.

## Locked Product Goal

Build a Pokemon TCG app that:

- Searches Pokemon cards by set and collector number
- Shows card information, price, graded prices, charts, PSA population by grade, and last sold data
- Lets users add cards into a portfolio
- Defaults to USD and allows currency switching
- Supports scan-to-find for easier card lookup
- Works well on web and mobile

## Locked Technical Direction

- App type: Next.js full-stack
- Delivery target: web plus mobile-ready PWA first
- Language: TypeScript
- Styling: Tailwind CSS
- Database: PostgreSQL with Prisma
- Charts: app-integrated chart library
- Scanner: browser camera plus OCR and card matching
- Data model: self-engineered ingestion pipeline
- Constraint: no paid third-party API keys for card data

## Non-Negotiable Working Rules

- Keep this tracker updated as major phases complete or change
- Do not drift away from the agreed scope without user approval
- If a better approach appears, pause and ask the user before switching
- If an error, blocker, or ambiguous fix appears, ask the user before fixing it
- When asking, always provide clear choices
- Prefer one shared codebase over premature platform splitting
- Preserve provenance, timestamps, and confidence for all market data

## Accuracy Strategy

Accuracy will come from engineering controls, not from a single free source.

Use these rules:

- Normalize all card identities by set, number, variant, language, and grade
- Keep source provenance for every fetched record
- Timestamp every price, sold record, PSA population record, and FX rate
- Use multi-source comparison when possible
- Reject outliers and mismatched listings
- Show freshness and confidence in the UI
- Mark stale data instead of pretending it is current
- Queue suspicious or low-confidence records for manual review tooling

## High-Level Architecture

### Frontend

- Next.js App Router
- Responsive UI for desktop and mobile
- PWA installability
- Search experience
- Card detail experience
- Portfolio pages
- Scanner flow

### Backend

- Next.js route handlers for app APIs
- Background ingestion jobs
- Source adapters for each public source type
- Normalization and confidence scoring pipeline

### Storage

- PostgreSQL as source of truth
- Prisma schema for domain models
- Database-backed caching and snapshot history

## Core Features Checklist

- [ ] Search by set and collector number
- [ ] Search by Pokemon name and filters
- [ ] Card detail page
- [ ] Raw price view
- [ ] Graded price view by grade
- [ ] Price chart history
- [ ] Population view
- [ ] Last sold view
- [ ] Portfolio create and manage
- [ ] Currency selector with USD default
- [ ] FX conversion layer
- [ ] Camera scan-to-search
- [ ] Source health monitoring
- [ ] Stale-data and confidence indicators
- [ ] Admin review tooling

## Planned Data Domains

- Sets
- Cards
- Card variants
- Card images
- Market price snapshots
- Graded price snapshots
- Population snapshots
- Last sold records
- FX rates
- Portfolio items
- Portfolio transactions
- Ingestion jobs
- Source health events
- Manual review records

## Build Phases

### Phase 1 - Foundation

- Initialize Next.js app
- Configure TypeScript, linting, formatting, and Tailwind
- Add Prisma and PostgreSQL setup
- Add base UI structure
- Add PWA foundation
- Status: app scaffold, base UI shell, and PWA manifest completed; database wiring deferred for now due local install and package issues

### Phase 2 - Canonical Card Model

- Design schemas for sets, cards, variants, and images
- Seed or ingest the initial card metadata layer
- Build search indexing strategy
- Status: local sample dataset exists, and search now also uses a live public catalog for real set and card coverage

### Phase 3 - Ingestion Framework

- Build fetch utilities
- Build parser utilities
- Define source adapter interface
- Add ingestion job runner
- Add provenance and snapshot logic

### Phase 4 - Search and Card Detail

- Build search API
- Build search UI
- Build card detail route and layout
- Show normalized metadata
- Status: search now queries a live public card catalog; card detail can resolve live card ids as well as local records

### Phase 5 - Market Intelligence

- Add raw price ingestion
- Add graded price ingestion
- Add last sold ingestion
- Add price chart snapshots
- Add confidence and freshness display

### Phase 6 - Population

- Add PSA population ingestion pipeline
- Normalize grade labels
- Display totals and breakdowns
- Status: app now models PSA pop correctly and keeps automatic PSA sync as the target implementation; manual import UI has been removed

### Phase 7 - Portfolio and Currency

- Build portfolio CRUD
- Build valuation logic
- Add FX rate ingestion and conversion
- Persist currency preference
- Status: local-storage portfolio and currency preference are working while the database remains deferred

### Phase 8 - Scanner

- Add browser camera flow
- OCR collector number and set text
- Match against canonical database
- Rank likely results

### Phase 9 - Hardening

- Add source health checks
- Add stale-data fallbacks
- Add manual review queue
- Improve resilience and performance

## Decision Checkpoints

Pause and ask the user with options if any of these occur:

- Need to choose PWA-only versus adding native wrapper work now
- A source blocks scraping or changes structure significantly
- A different database or deployment path becomes clearly better
- OCR quality is too weak and an alternate approach is needed
- A legal or compliance concern appears around a public source
- A schema redesign would affect previously built modules

## Ask-The-User Format

When pausing for a decision, use this format:

1. State the issue briefly
2. Explain the impact
3. Give 2 to 4 options
4. Mark one option as recommended when appropriate
5. Wait for user approval before proceeding

## Validation Standards

- Search by exact set plus number must work reliably
- Market data must always show fetched time
- Confidence and stale states must be visible
- Currency conversion must be consistent across details and portfolio
- Scanner must return a ranked list even when confidence is imperfect
- No silent failures in ingestion jobs

## Initial Execution Order

1. Create the app scaffold
2. Set up Prisma and the base schema
3. Build the layout and navigation shell
4. Implement canonical set and card models
5. Implement search end to end
6. Implement card detail pages
7. Implement market ingestion pipeline
8. Implement portfolio and currency selector
9. Implement scanner
10. Add monitoring, hardening, and validation

## Current Status

- [x] Scope defined
- [x] Architecture defined
- [x] Constraints defined
- [x] Decision-pausing rule defined
- [x] App scaffold created
- [ ] Database initialized
- [x] Search implemented
- [x] Card detail implemented
- [ ] Market pipeline implemented
- [x] Portfolio implemented
- [x] Currency selector with USD default implemented
- [ ] Scanner implemented
- [ ] Hardening completed

## Next Immediate Action

Build the self-engineered ingestion framework for sold data, PSA population data, and historical market snapshots while the database work remains deferred.
