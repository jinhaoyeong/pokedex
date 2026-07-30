---
target: Dex page rework from supplied Original and Improved screenshots
total_score: 22
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-07-30T04-22-16Z
slug: src-app-search-page-tsx
---
Method: dual-agent (A: dex_rework_design_review · B: dex_rework_detector)

## Design Health Score

**22/40 — Acceptable, but not yet a confident Dex.**

| # | Heuristic | Score | Evidence |
|---|---|---:|---|
| 1 | Visibility of status | 2 | Set/page status is detached from the result workspace. |
| 2 | Match with real world | 3 | Exact printing, set, language, and collector-number language fits collectors. |
| 3 | User control and freedom | 2 | Filters reverse cleanly, but there is no visible clear-all or active-filter context. |
| 4 | Consistency and standards | 2 | The search is restrained while result rows and the review dock dominate the page. |
| 5 | Error prevention | 2 | Examples help, but ambiguous printings are not proactively disambiguated. |
| 6 | Recognition rather than recall | 3 | Labels and examples help; collapsed specificity still hides useful context. |
| 7 | Flexibility and efficiency | 2 | Keyboard selects work, but expert browsing requires too much scrolling. |
| 8 | Aesthetic and minimalist design | 2 | Premium black is coherent; the page is sparse above and oversized below. |
| 9 | Error recovery | 2 | Empty guidance exists, while slow and ambiguous-result recovery is weak. |
| 10 | Help and documentation | 2 | First-query help exists, but not exact-printing comparison guidance. |

## Design Specificity Verdict

The dark palette, restrained red accents, card imagery, and collector language belong to this product. The composition does not: a generic large hero, generic form panel, and enormous list rows could be reused by an unrelated catalog. The result unit is a detail preview rather than a browsing tool.

The deterministic detector found **0 findings** across six target files. Browser evidence also found no desktop horizontal overflow or console errors. These clean signals do not contradict the design failure: the problem is information architecture, density, and prioritization.

## Cognitive Load and Emotional Journey

The page requires users to move through three disconnected zones: promise, search controls, then results. The long result page creates fatigue rather than confidence. The emotional peak should be recognition of the correct printing; currently the market price and empty row space overpower identity.

## Strengths

- “Find the exact printing” is the right product promise.
- Set, language, collector number, price confidence, and pending states already contain the necessary information.
- Keyboard-complete custom selects and meaningful card imagery provide a solid interaction base.

## Priority Issues

1. **P1 — Result rows are too tall:** 50 results become a fatigue scroll instead of a comparative browse surface.
2. **P1 — Search and results state are disconnected:** count, page, active filters, and sort lack one coherent toolbar.
3. **P1 — Empty-query discovery is vague:** “Trending & Hot Cards” reads like an arbitrary expensive list.
4. **P2 — The hero repeats the workflow:** “Name · Set · Collector number” consumes space without enabling action.
5. **P2 — Filters lack an obvious reset and desktop transparency:** specificity should be readable without reopening controls.

## Persona Red Flags

- **Alex:** known collector numbers still lead into a long, slow-scanning result list.
- **Sam:** structure is semantic, but faint status copy and disconnected state make orientation harder.
- **Casey:** the first screen spends too much height before a useful card comparison appears.

## Replacement Composition

Use three tight bands: a compact Dex title, one search command surface with desktop-visible filters and quick examples, then a results workspace with count, active-filter chips, and a responsive card grid. Exact identity leads each card; market value supports it.

## Questions

- How quickly can a collector distinguish two cards with the same name?
- Which visible metadata prevents a wrong-printing click?
- Does every vertical pixel help search, compare, or decide?
