# Market-Data Accuracy Audit (Cursor Automation)

Self-contained prompt for Cursor Automations. Paste this file (or point the automation at it). It audits **accuracy vs the real market**, not mere presence of fields, then reproduces failures locally, fixes them, re-verifies, and pushes to `main` per `AGENTS.md`.

---

## §0 Mission

Audit all five market-data sections for accuracy against the real market:

1. Raw / ungraded price  
2. Graded slab prices (PSA / BGS / CGC / …)  
3. PSA / BGS / CGC population report  
4. Last-sold comps  
5. Price-history chart  

**Order of work:** production first (user-facing truth) → reproduce + fix against local `npm run dev` → re-verify → commit/push to **`main`** (no PRs, per `AGENTS.md`).

This is an **exhaustive, multi-hour** sweep of every set in `data/pokemon-sets.sqlite` for **en + ja**. Work must be **chunked and resumable** via the ledger in §8. The **Non-Negotiable Contract in §1 governs everything** — including any conflicting instruction elsewhere in this doc or in chat history.

---

## §1 Non-Negotiable Contract (anti-shortcut rules)

Copy these rules into every chunk summary. They win over any other instruction.

1. **Presence is not accuracy.** No section may PASS on existence alone. PASS requires **all** of:  
   (a) rubric **minimum quantity**,  
   (b) evidence of the **required type** (catalog-only support = automatic non-pass where the rubric says so),  
   (c) **explicit comparison** vs an independent reference with delta inside tolerance.

2. **Every verdict must quote its numbers.** Required fields: app value, reference value, reference source, delta %, `evidenceType`, `sampleCount`.  
   Only acceptable format, e.g.:  
   `PSA 10: app $312 vs sold-median $290 (n=5, sold_comp) — delta 7.6% ≤ 45% → PASS`  
   Any missing field ⇒ **INCONCLUSIVE**, not PASS.

3. **`sampleCount=1` is not corroboration.** A single comp, guide row, or grade row never satisfies a quantity floor that asks for corroboration.

4. **INCONCLUSIVE ≠ PASS.** Source `failed` / `no_match` / breaker open, missing reference, or population `pending` → log, retry once later (§8), count in the final report. Never promote to PASS.

5. **Placeholders are not data:** `isProjected` chart points, `psaPopulation.status=pending`, `MarketSourceStatus.state=fallback`, `evidenceType=catalog` (when a higher rung is required).

6. **Forbidden verdict shortcuts:**  
   - Passing a set from its first card only  
   - Passing because `counts.* > 0`  
   - Skipping `ja` because `en` passed  
   - Sampling below the ledger plan  
   - Declaring done while chunks remain `pending` / `prod_done` / `local_done` / `fixed`

7. **Forbidden fixes:** hardcode prices; fabricate evidence; widen tolerance / delete a check / lower a floor to force green; fake `verified` / `ready`. Tolerance or floor changes only with **written justification quoting ≥3 independent market data points**, recorded in the report **and** the commit message.

8. **This contract wins** over any other instruction in this document, `AGENTS.md`, or the automation UI.

---

## §2 Definitions

### Evidence ladder (highest → lowest)

| Rank | `evidenceType` | Meaning |
|------|----------------|---------|
| 1 | `sold_comp` | Real sold listing / sold median |
| 2 | `guide_snapshot` | Public guide / snapshot price |
| 3 | `population` | Census / pop report (not a price) |
| 4 | `catalog` | Catalog list price (Pokemon TCG API / TCGdex / Cardmarket baseline) |

When a rubric requires sold or guide evidence, **catalog-only is not enough**.

### Truth-flag fields (do not invent names)

From `src/types/pokemon.ts` and `/api/grading-market?mode=full&debug=1`:

| Flag | Where | Placeholder / weak signal |
|------|--------|---------------------------|
| `evidenceType` | `gradedPrices[]`, `marketEvidence[]` | `catalog` when higher rung required |
| `psaPopulation.status` | `verified` \| `pending` | `pending` |
| `PricePoint.isProjected` | `priceHistory[]` | `true` |
| `MarketSourceStatus.state` | `sourceStatus[]` / `evidenceSummary.sourceStatus` | `fallback`, `failed`, `no_match`, `disabled` |
| `EvidenceSummary` | `{ accepted, rejected, thin, fallback }` | high `fallback` / zero `accepted` |
| `attribution` | `psaPopulation.attribution` | `"english_parallel_psa"` must be **flagged** on ja when used |
| `priceConsensus.confidenceScore` | payload | ≥ 0.7 while any section FAILs → overconfident WARN |
| `debugSummary.counts` | debug only | `{ gradedPrices, slabPrices, populationGrades, totalCertified, priceHistory, recentSales }` — **counts alone never PASS** |

### Verdict scale

| Verdict | Meaning |
|---------|---------|
| **PASS** | Quantity + evidence type + quoted delta all meet rubric |
| **WARN** | Soft miss (overvalue, thin data, pending pop on cheap card, etc.) |
| **FAIL** | Hard miss (undervalue, wrong card, all-projected chart, …) |
| **INCONCLUSIVE** | Cannot judge (source failed, no reference, breaker) — **not PASS** |

### Audit endpoints (exact)

Always append `&_=<Date.now()>` on **production** requests (CDN: `s-maxage=3600, stale-while-revalidate=86400` on grading-market and price).

```text
GET /api/grading-market?setName=...&cardName=...&cardNumber=...&setCode=...&setTotal=...&language=en|ja&rarity=...&rawMarketPriceUsd=...&englishCardName=...&mode=full&debug=1&_=<Date.now()>
GET /api/price?slug=...&name=...&language=...&setCode=...&setName=...&number=...&cardId=...&englishName=...&rarity=...&_=<Date.now()>
  → ungradedUsd, psa10 (and aliases under prices.*)
GET /api/bootstrap          → readiness (200 + keys like setsByLanguage / previewCards)
GET /api/search-sets?q=151&lang=en|all  → prod URL discovery probe (non-empty sets when healthy)
```

Local validators (prefer these for breadth; manual debug rubrics catch chart + quoted-number gaps):

```bash
VALIDATE_BASE_URL=<url> VALIDATE_SWEEP=true VALIDATE_SWEEP_LANG=en|ja \
  VALIDATE_SWEEP_SAMPLES=3 VALIDATE_SWEEP_MIN_PRICE=20 \
  npm run validate:card-data

VALIDATE_BASE_URL=<url> npm run validate:market
npm run validate:psa-pop
# fix-loop template:
npm run validate:fix-loop
```

Shared thresholds live in:

- `scripts/lib/market-accuracy-checks.mjs` — raw `0.35` / over `0.35×1.5=0.525`, graded `0.45`, population `0.3`, PSA10≥raw×`0.85`, guide spread `1+0.45`
- `scripts/lib/card-data-checks.mjs` — monotonicity ×`0.88` for ranks ≥7, tile/grid ratio `3`, sold bands `saleBandRatio` (0.7 graded / ≥1.5 raw)
- `scripts/validate-psa-population.mjs` — hit rate ≥ `0.6` (`VALIDATE_MIN_POP_RATE`)

---

## §3 Environment setup

```bash
npm install
npm run db:seed:sets          # required for sweep / ledger
npm run db:seed:psa-pop       # population gate
npm run db:seed:prices        # optional warm; do not block audit on it
# Dev server via tmux (AGENTS.md):
SESSION_NAME="next-dev-server"
tmux -f /exec-daemon/tmux.portal.conf has-session -t "=$SESSION_NAME" 2>/dev/null \
  || tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION_NAME" -c "$PWD" -- "${SHELL:-zsh}" -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t "$SESSION_NAME:0.0" 'npm run dev' C-m
# Readiness:
curl -sf http://localhost:3000/api/bootstrap | head -c 200
```

### Env knobs (read-only for tolerances unless §6 justification)

| Env | Role |
|-----|------|
| `VALIDATE_BASE_URL` | Prod or local base (no trailing slash) |
| `VALIDATE_SWEEP` / `VALIDATE_SWEEP_LANG` / `VALIDATE_SWEEP_SAMPLES` / `VALIDATE_SWEEP_MAX_SETS` / `VALIDATE_SWEEP_OFFSET_SETS` / `VALIDATE_SWEEP_MIN_PRICE` | Exhaustive set walk (`OFFSET_SETS` skips newest N after release_date DESC for resume) |
| `VALIDATE_POLL_ATTEMPTS` / `VALIDATE_POLL_INTERVAL_MS` / `VALIDATE_SETTLE_STREAK` / `VALIDATE_SWEEP_POLL_ATTEMPTS` | Settle polling |
| `VALIDATE_CARD_FILTER` | Re-verify failing subset |
| `VALIDATE_REQUIRE_SOLD` | default `true` — sold shortfall FAIL; `false` → WARN |
| `VALIDATE_RAW_TOLERANCE` / `VALIDATE_GRADED_TOLERANCE` / `VALIDATE_POPULATION_TOLERANCE` | **Do not raise** without §6 justification |
| `VALIDATE_MIN_POP_RATE` | PSA pop hit rate floor (default `0.6`) |
| `VALIDATE_OUTPUT` | Report path override |
| `AUDIT_PROD_URL` | Explicit production URL (§9) |
| `MARKET_DATA_CACHE=false` | Optional local cache disable |

---

## §4 Phase plan

### Phase 0 — Bootstrap

1. Install + seed sets (+ psa-pop).  
2. Start local dev (tmux). Probe `/api/bootstrap`.  
3. Discover prod URL (§9). If unverifiable → mark prod phases `SKIPPED-WITH-REASON` and continue local-only.  
4. Create or resume ledger `data/validate-audit-ledger-report.json` (§8).  
5. Dry-check one curated canary with `mode=full&debug=1` and confirm `debugSummary.counts`, `gradedPrices[].evidenceType`, `psaPopulation.status`, `priceHistory[].isProjected`, `recentSales`, `marketEvidence`, `sourceStatus`, `evidenceSummary`, `priceConsensus.confidenceScore` exist.

### Phase 1 — Production audit (breadth)

For each incomplete ledger chunk:

1. Run canary `CARD_CASES` (6 cards in `scripts/validate-card-data.mjs`) against prod first.  
2. Chunked sweep:  
   `VALIDATE_BASE_URL=<prod> VALIDATE_SWEEP=true VALIDATE_SWEEP_LANG=en` (then `ja`) with `VALIDATE_SWEEP_MAX_SETS` / set-id filters matching the chunk.  
   Also run `VALIDATE_BASE_URL=<prod> npm run validate:market` when the chunk includes market-accuracy cases.  
3. **Manual spot-audits:** ≥ **N=3** cards per chunk via `mode=full&debug=1`, applying **§5 rubrics by hand** (especially **B5 Chart**, which has no script validator). Quote numbers per §1.  
4. Write `data/validate-audit-chunk-<NN>-report.json`. Mark chunk `prod_done`.

### Phase 2 — Local reproduce

For every prod **FAIL** (and serious WARN you intend to fix):

1. Hit the same card on `http://localhost:3000` with cache-buster.  
2. Classify: **code-bug** (reproduces) vs **prod-only** (edge cache / env drift / seed).  
3. Mark chunk `local_done` when classification is complete.

### Phase 3 — Fix (validate-fix-loop style)

1. Allowed fixes only (§6).  
2. Loop: run validator → parse `data/validate-*-report.json` → tally failure codes → targeted fix in `src/lib/**` → re-run.  
3. Population failures → `npm run validate:psa-pop` + seed refresh if needed.  
4. Mark chunk `fixed` when local FAILs for that chunk are addressed or explicitly deferred with reason.

### Phase 4 — Local re-verify

1. Failing subset: `VALIDATE_CARD_FILTER=... npm run validate:card-data`  
2. Re-run affected chunk sweep.  
3. `npm run lint` && `npm run typecheck` && `npm run build`  
4. Mark chunk `verified`.

### Phase 5 — Commit / push

Per `AGENTS.md`: **push to `main`**, no PRs.

```bash
git checkout main
git pull origin main
# ... commits ...
git push origin main
```

Commit **per logical bug** (not per chunk). Messages must reference finding codes (e.g. `fix: graded.psa10_mismatch for Base Set Charizard`).

### Phase 6 — Prod re-verify

After Vercel deploy settles, re-hit failing cards with `&_=<Date.now()>`. Label remaining misses:  
`prod residual (edge cache: s-maxage 3600 + SWR 86400)`.

### Phase 7 — Final report + ledger closeout

Human summary (§7) + every chunk `verified` or explicitly `SKIPPED-WITH-REASON` / deferred.

---

## §5 Per-section rubrics

**Scope:** every set in `data/pokemon-sets.sqlite`, languages **en** and **ja**. Per set sample **top 3 cards** by price-desc with `marketPriceUsd ≥ 20` (`VALIDATE_SWEEP_SAMPLES=3`, `VALIDATE_SWEEP_MIN_PRICE=20`).  
**Canary first each chunk:** the 6 `CARD_CASES` in `scripts/validate-card-data.mjs` (Base Charizard, Vivid Voltage Charizard, 151 Charizard ex, Celebrations Classic Charizard, Ascended Heroes Grimmsnarl ex, JP 151 Mew ex).

Thresholds below match `market-accuracy-checks.mjs` / `card-data-checks.mjs` unless marked **NEW (chart)**.

### B1 — Raw / ungraded

| Check | Rule | Verdict |
|-------|------|---------|
| Positive ungraded | `gradedPrices` has Ungraded/`RAW` with `value > 0`, or card `marketPriceUsd > 0` | missing → **FAIL** |
| vs TCGdex / catalog ref | `compareRawPrice`: under `app < ref×(1−0.35)` → **FAIL**; over `app > ref×(1+0.525)` → **WARN**; no ref → **INCONCLUSIVE** | quote both $ |
| Catalog-only on expensive card | If headline ≥ **$25** and supporting evidence is **only** `evidenceType=catalog` (no sold/guide for raw) | **FAIL** |
| Tile vs `/api/price` | `|ungradedUsd − tile| / max(ref,1) ≤ 0.15` | else **WARN** |

### B2 — Graded slabs

| Check | Rule | Verdict |
|-------|------|---------|
| Quantity | ≥ **2** positive graded tiers (rank > 0); curated/vintage canaries use case `minGradedPrices` (**3** for Base Charizard, **2** otherwise in CARD_CASES) | sweep shortfall → **WARN**; curated shortfall → **FAIL** |
| PSA 10 vs market | Prefer sold-median with **n≥3** `sold_comp`; else guide-median; delta ≤ **0.45** (`DEFAULT_GRADED_TOLERANCE`) | undershooting **guide-sourced** ref → **FAIL**; otherwise mismatch → **WARN** (matches card-data “app above ref / sold_comp / unreliable guides” demotion) |
| Monotonicity | Within same service; ranks ≥ **7**; higher ≥ lower × **0.88** | **FAIL** only if **both** tiers multi-sale `sold_comp`; else **WARN** |
| PSA 10 vs raw | `psa10 ≥ ungraded × 0.85` | else **FAIL** (wrong-match signal); card-data may WARN if PSA10 still top graded |
| Cross-guide spread | PSA 10 guides from ≥2 sources: `high/low > 1.45` (`1 + 0.45`) | **WARN** |
| JA parallel pop prices | If ja uses English PSA pricing/pop, `attribution` / UI must show `english_parallel_psa` | missing flag → **FAIL** |

### B3 — Population

| Check | Rule | Verdict |
|-------|------|---------|
| Quantity | ≥ **3** grades (≥ **4** vintage/canary `minPopulationGrades`); ≥1 nonzero count | below floor → **FAIL**; all-zero → **FAIL** |
| Status | Prefer `verified` | `pending` → **WARN**; if card ≥ **$50** after full polling still pending → **FAIL** |
| Tile vs grid | For matching service+rank, `max/min ≤ 3` | else **WARN** (quote both counts) |
| External magnitude | vs independent pop reference, relative error ≤ **0.3** (`DEFAULT_POPULATION_TOLERANCE`) | else **FAIL** |
| totalCertified | `totalCertified ≥ 0.9 × sum(grade.counts)` when both present | else **WARN** |
| Local gate | `npm run validate:psa-pop` hit rate ≥ **0.6** | else **FAIL** for pop subsystem |

### B4 — Sold comps

| Check | Rule | Verdict |
|-------|------|---------|
| Quantity | Curated vintage floors from CARD_CASES (`minRecentSales` 1–2); modern sweep ≥ **1** when price ≥ sales threshold | if `VALIDATE_REQUIRE_SOLD=true` shortfall → **FAIL**, else **WARN**; **always quote** sold source `state` |
| Date | Future date (> now+24h) → **FAIL**; unparseable non-empty date → **WARN** |
| Band vs tile | Graded: delta ≤ case `saleBandRatio` (**0.7** typical); raw: ≤ **max(saleBandRatio, 1.5)** | else **WARN** |
| Sold-median vs PSA 10 tile | delta ≤ **0.6** → OK/WARN boundary; **> 1.0** with **n≥3** → **FAIL**; **> 0.6** → **WARN** |
| Identity | Comp **titles must reference the audited card**; quote **one title per card** | wrong card → **FAIL** (`sold.wrong_card`) |

### B5 — Chart (**NEW** — no existing script validator)

| Check | Rule | Verdict |
|-------|------|---------|
| Point count | For cards with headline ≥ **$25**, `priceHistory.length ≥ 6` | below → **WARN**; **0** → **FAIL** |
| Real share | Non-`isProjected` points ≥ **50%** of series | **100% projected** → **FAIL** |
| Last real vs headline | Among non-projected points, last `value` vs headline ungraded: ≤25% **PASS**; ≤50% **WARN**; >50% **FAIL** |
| Dates | Strictly increasing; none in the future | else **FAIL** |
| Grade series | If `gradeValues["PSA 10"]` present on last real point, within **45%** of PSA 10 tile | else **WARN** |

### B6 — Cross-section

| Check | Rule | Verdict |
|-------|------|---------|
| Chart ↔ headline | Same as B5 last-real rule | |
| Sold-median ↔ tile | Same as B4 | |
| Pop tile ↔ grid | Same as B3 | |
| `/api/price.psa10` ↔ grading PSA 10 | relative delta ≤ **15%** | else **WARN** |
| Overconfidence | `priceConsensus.confidenceScore ≥ 0.7` while any of B1–B5 is **FAIL** | **WARN** `cross.overconfident` |

---

## §6 Fix policy

### Allowed freely

Matching / slug / parsing / fallback logic under:

- `src/lib/market-enrichment*` / `src/lib/pokemon-tcg/market-enrichment.ts`
- `src/lib/grading-market*`
- `src/lib/psa-population*` / `src/lib/psa-population-attribution.ts`
- `src/lib/public-page-fetch*` (or equivalent fetch helpers)
- `src/lib/price/**` (resolve, providers, overlay/sanity)

Also: source ordering, timeout / poll env bumps for the **run**, seed refresh (`db:seed:sets`, `db:seed:psa-pop`), alias mappings **backed by quoted sources**.

### With justification only

Tolerance / threshold / floor changes — require **≥3 quoted independent market data points**, recorded in the chunk report **and** the commit message. Prefer fixing matching over widening tolerance.

### Never

- Violate §1 forbidden fixes  
- Change dependencies / lockfile for this audit  
- Commit report artifacts (`data/validate-*-report.json`) or sqlite caches  
- Edit `CARD_CASES` quantity floors to silence failures  
- Fabricate sold comps, pop counts, or chart points  

---

## §7 Report format

### Per-chunk JSON (gitignored)

Path: `data/validate-audit-chunk-<NN>-report.json`  
Must match `.gitignore` glob `data/validate-*-report.json`.

```json
{
  "chunkId": "03",
  "prodBaseUrl": "https://…",
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601",
  "cards": [
    {
      "id": "base1-charizard",
      "language": "en",
      "verdicts": {
        "raw": "PASS|WARN|FAIL|INCONCLUSIVE",
        "graded": "…",
        "population": "…",
        "sold": "…",
        "chart": "…",
        "cross": "…"
      },
      "findings": [
        {
          "section": "graded",
          "code": "graded.psa10_mismatch",
          "severity": "FAIL",
          "appValue": 312,
          "refValue": 290,
          "refSource": "sold_comps",
          "deltaPct": 7.6,
          "evidenceType": "sold_comp",
          "sampleCount": 5,
          "sourceStates": ["Public sold-listing comps:ready"]
        }
      ]
    }
  ]
}
```

### Failure-code taxonomy (extend as needed; keep stable prefixes)

`raw.undervalued`, `raw.overvalued`, `raw.catalog_only`, `raw.missing`, `raw.tile_api_mismatch`,  
`graded.missing_tiers`, `graded.psa10_mismatch`, `graded.monotonicity`, `graded.psa10_below_raw`, `graded.guide_spread`, `graded.ja_parallel_unflagged`,  
`pop.pending`, `pop.missing_grades`, `pop.all_zero`, `pop.tile_grid_mismatch`, `pop.external_mismatch`, `pop.total_certified`, `pop.hit_rate`,  
`sold.shortfall`, `sold.future_date`, `sold.unparseable_date`, `sold.band`, `sold.median_mismatch`, `sold.wrong_card`,  
`chart.too_few_points`, `chart.all_projected`, `chart.last_point_divergence`, `chart.date_order`, `chart.psa10_series`,  
`cross.overconfident`, `cross.price_api_psa10`,  
`env.source_failed`, `env.no_match`, `env.prod_residual_cache`

### Final human summary

Totals per verdict × section × language; top-10 codes; fixes with commit SHAs; prod residuals; INCONCLUSIVE retry outcomes; ledger status counts.

---

## §8 Chunking / ledger / resume / rate limits

### Ledger

`data/validate-audit-ledger-report.json` (also covered by `data/validate-*-report.json` gitignore):

```json
{
  "version": 1,
  "createdAt": "ISO-8601",
  "prodBaseUrl": "https://… or null",
  "chunks": [
    {
      "id": "01",
      "setIds": ["…"],
      "languages": ["en", "ja"],
      "status": "pending|prod_done|local_done|fixed|verified|SKIPPED-WITH-REASON",
      "notes": ""
    }
  ]
}
```

- Chunk size: **10–15 sets** per chunk (both langs audited inside the chunk or as paired sub-passes).  
- On start: **read ledger** and resume the first incomplete chunk; else build set list from `data/pokemon-sets.sqlite`.

### Rate limits / pacing

- **Serial** prod grading-market requests (one card at a time).  
- Keep existing **~450ms/host** pacing; do **not** disable circuit breakers.  
- **60–120s** pause between chunks.  
- Same source `failed` across **≥5 consecutive cards** → mark those findings **INCONCLUSIVE**, queue **one** end-of-run retry, move on.  
- If **>50%** of a chunk is INCONCLUSIVE from all-source failures → **abort chunk** (§9), do not “fix” by inventing data.

### Commits

Commit **per logical bug** so an interrupted run leaves `main` deployable.

---

## §9 Prod URL discovery + abort conditions

### Discovery ladder

1. `AUDIT_PROD_URL` or `VALIDATE_BASE_URL` if it is not localhost.  
2. `npx vercel ls` / `vercel inspect` when a token is available.  
3. Derive `https://<repo-name>.vercel.app` from `git remote` (repo `pokedex` → try common Vercel hostnames).  

**Trust only after:**

```bash
curl -sf "$PROD/api/bootstrap" | head -c 200   # expect 200
curl -sf "$PROD/api/search-sets?q=151&lang=en"  # expect non-empty sets when healthy
```

If unverifiable → run **local-only**, set `prodBaseUrl: null`, mark prod phases **`SKIPPED-WITH-REASON`**.

### Abort (report, don’t thrash fixes)

- Dev server fails readiness **3×**  
- Required seeds fail  
- **>50%** of a chunk INCONCLUSIVE from all-source outages  
- `git push` rejected after **one** `pull --rebase` / conflict resolution attempt — stop and report  

---

## Operator checklist (copy into automation run notes)

- [ ] §1 contract acknowledged  
- [ ] Seeds + local `/api/bootstrap` OK  
- [ ] Prod URL verified or SKIPPED-WITH-REASON  
- [ ] Ledger resumed / created  
- [ ] Canary CARD_CASES quoted-number verdicts  
- [ ] Chunks exhausted (en+ja)  
- [ ] Fixes on `main` with finding codes  
- [ ] Prod re-verify cache-busted  
- [ ] Final summary + ledger closeout  

**Related:** repo root `AGENTS.md` (dev server, push-to-main). Validators: `npm run validate:card-data`, `validate:market`, `validate:psa-pop`, `validate:fix-loop`.
