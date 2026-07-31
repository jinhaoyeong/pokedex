---
target: dex tab
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-31T07-47-51Z
slug: src-app-search-page-tsx
---
Method: dual-agent (A: a2e1c87d-4074-4c7c-bd2c-df3b8510949d · B: 92e72cad-e299-4c06-a6ae-ced76823937f)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2 | Catalog outage can render as “No cards found.” without a retry control; prices pulse in later with no list-level “still resolving” cue. |
| 2 | Match System / Real World | 3 | Collector language is strong; “All supported languages” and “Sort: relevant” still sound system-facing. |
| 3 | User Control and Freedom | 3 | Filter chips / clear / pagination work; switching Language silently clears Set with no undo besides re-picking. |
| 4 | Consistency and Standards | 2 | Original vs Improved dual UI + Compare dock; “Popular cards” vs boot “Trending & Hot Cards”; nav “Dex” vs footer “Card Dex”. |
| 5 | Error Prevention | 2 | ~365-set listbox is non-typeahead; price sorts can reorder as lazy `/api/price` resolves. |
| 6 | Recognition Rather Than Recall | 2 | Try chips help; no recent searches; set discovery requires recalling names in an unscannable menu. |
| 7 | Flexibility and Efficiency | 2 | Scan + URL state help; no set typeahead, no shortcuts beyond native form, no saved searches. |
| 8 | Aesthetic and Minimalist Design | 2 | Task-first header is cleaner, but desktop forces Set/Language/Sort open and the Compare dock sits in the thumb zone. |
| 9 | Error Recovery | 2 | Outage reuses the empty-results shell instead of a recoverable error state with Retry. |
| 10 | Help and Documentation | 2 | Scan line + Try examples help; nothing teaches how to disambiguate ~196 “pikachu” printings. |
| **Total** | | **22/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** The Improved Dex is recognizably a TCG printing hunter — “Find the right card.”, collector-number placeholders, Try chips (`Pikachu` / `Base Set` / `4/102`), Scan, and result rows keyed as `Set · #collectorNumber` with language/rarity chips. The visual system still reads as dark glass SaaS (rounded panels, premium kickers, floating Compare dock) that could host almost any catalog search with a rename. Product character lives more in copy and domain fields than in a distinctive Dex instrument metaphor, especially once the Original `DexHeroScanner` bay is hidden behind the Improved variant.

**Deterministic scan:** `detect.mjs --json` over eight Dex source files returned **0 findings** (exit 0). That clean source-level result does not contradict the interaction and IA issues above; the detector found no mechanical anti-patterns in the scanned markup.

**Visual overlays:** Live `detect.js` injection was **not** available (Assessment B: no browser mutation MCP in that pass). Supplemental computerUse screenshots of empty Dex and `?q=pikachu` (desktop ~1280 and mobile ~390) confirm the task-first header, always-visible Refine trio on desktop, Compare Original/Improved dock in the thumb zone, all-language warning banner on results, and dense same-name result grids. No reliable user-visible detector overlay is present in the browser.

## Overall Impression

The Improved Dex finally leads with the collector’s job — search, scan, then refine — and that is real progress. The biggest opportunity is to finish the hunt: turn catalog failure into a recoverable state, collapse expert filters until needed, remove the design-lab Compare dock from the Operate surface, and make a successful “pikachu” search end as a printing decision — not a flat wall of near-identical rows.

## What's Working

- Query-first Improved form: labeled field, primary **Search cards**, secondary **Scan a card**, and concrete Try chips that teach the query grammar.
- Result identity is printing-aware: `setName · #collectorNumber`, JP/localized tags, rarity chips, Market price with loading placeholders.
- Copy frames the real job (“Add filters when the printing matters”) instead of generic database search.

## Priority Issues

### [P0] Outage masquerades as empty results

**Why it matters:** “No cards found.” paired with “Search is temporarily unavailable…” and no Retry makes catalog failure look like user failure and stalls the primary task.

**Fix:** Dedicated error panel (not the empty shell): plain cause, Retry button, keep query/filters, optional cached-popular fallback.

**Suggested command:** `/impeccable harden`

### [P1] Desktop Refine trio always open + unsearchable 365-set list

**Why it matters:** Forces Set / Language / Sort before they are needed; set picking is recall-heavy and error-prone.

**Fix:** Collapse filters until needed on all breakpoints; make Set a typeahead/combobox; keep “Optional” honest.

**Suggested command:** `/impeccable distill`

### [P1] Compare Original/Improved dock on the Dex Operate surface

**Why it matters:** A persistent design A/B control competes with search, eats mobile thumb space (above the nav dock), and signals unfinished product.

**Fix:** Remove from production Dex or gate behind an explicit lab/settings flag; never float over results.

**Suggested command:** `/impeccable quieter`

### [P1] Printing disambiguation collapses after search

**Why it matters:** “196 matching cards for pikachu” is a dense grid of same-name rows; the end of the hunt is scanning, not deciding.

**Fix:** Lead with set/era grouping, stronger variant badges, and “narrow by set” prompts when name matches explode.

**Suggested command:** `/impeccable layout`

### [P2] Status/copy inconsistencies across boot vs settled Dex

**Why it matters:** “Popular cards” vs “Trending & Hot Cards”, Dex vs Card Dex, and the all-language amber banner dump jargon mid-browse.

**Fix:** One empty-state name, one product name in chrome, shorten the cross-language notice to an actionable chip.

**Suggested command:** `/impeccable clarify`

## Persona Red Flags

**Alex (Power User):** Set `SearchSelect` with ~365 options and no typeahead; seven sort peers including price sorts that reshuffle as lazy prices land; Compare dock noise while hunting printings.

**Jordan (First-Timer):** Lands on Popular browse + open Refine controls + Scan + Try chips before understanding the job; outage can show “No cards found.”; 196 Pikachu rows look nearly identical with little help choosing a printing.

**Casey (Distracted Mobile):** Full-width submit under the field; scan help copy hides on small screens; sticky Compare bar fights the bottom Dex nav; Filters toggle helps, but status chrome still competes between taps.

## Minor Observations

- Original `DexHeroScanner` (Dex-01 bay) is more product-authored than the Improved command header, but is correctly demoted on mobile; Improved doesn’t replace that character with anything equally specific.
- “Page 1.” / “Showing page N” in filter status is operator telemetry on page 1.
- Per-tile “View card →” is redundant with the whole-card link.
- Boot splash can own the first Dex visit for seconds — clear status, delayed Operate surface.

## Questions to Consider

- If the job is finding the *right printing*, why does a successful “pikachu” search end as a flat wall instead of a set/era decision tree?
- Why is a design-comparison dock shipping on the primary Operate surface collectors open to hunt cards?
- What would Dex feel like if Set were a search field, not a 365-item listbox?
- Should a catalog outage ever be allowed to reuse the “No cards found.” empty state?
- Is “Popular cards” on empty Dex helpful scaffolding — or a second product competing with Search?
