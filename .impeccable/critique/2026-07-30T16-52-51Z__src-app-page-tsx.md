---
target: all four tabs
total_score: 29
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 2
timestamp: 2026-07-30T16-52-51Z
slug: src-app-page-tsx
---
# Four-tab design critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Search and binder expose loading and recovery, but page-level readiness is quiet. |
| 2 | Match system / real world | 4 | Card, printing, binder, grade, and market language fit collectors. |
| 3 | User control and freedom | 3 | Filters, comparison states, undo, and reset are present; the floating comparison dock can obstruct work. |
| 4 | Consistency and standards | 3 | Controls are coherent, but the four routes use different hero and container geometry. |
| 5 | Error prevention | 3 | Destructive binder and settings actions confirm; some dense secondary actions compete. |
| 6 | Recognition rather than recall | 3 | Primary actions are named; Settings exposes too many peer anchors at once on small screens. |
| 7 | Flexibility and efficiency | 2 | Search is efficient, but Binder content is pushed below a promotional hero on mobile. |
| 8 | Aesthetic and minimalist design | 3 | The dark collector identity is authored, though nested surfaces and uniformly faint metadata dilute hierarchy. |
| 9 | Error recovery | 3 | Binder undo and clear confirmation are strong; recovery cues are not equally prominent across routes. |
| 10 | Help and documentation | 2 | Helpful inline copy exists, but advanced settings and filter behavior rely on terse helper text. |
| **Total** |  | **29/40** | **Good foundation; hierarchy and responsive balance need a unified pass.** |

## Design specificity verdict

The product feels authored for Pokémon card collectors: card imagery, source-aware pricing language, binder terminology, and the red-on-black instrument-like shell form a coherent identity. The weak point is not personality; it is structural drift. Home behaves like a centered campaign, Dex like a command surface, Binder like a second landing page before becoming a ledger, and Settings like a stack of admin cards.

The deterministic layout detector returned zero findings across the seven targeted page and component files. That is useful mechanical evidence, but it does not contradict the rendered hierarchy problems below.

## What is working

- Home has a clear emotional peak: the headline, direct card search, and physical card fan explain the product in one view.
- Dex exposes a useful progression from broad query to optional printing filters, with real labels and visible example searches.
- Binder and Settings have unusually good recovery fundamentals: confirm-before-delete, undo, export, and explicit local-storage language.

## Priority issues

### P1 — The four routes do not share one spatial system

Home uses a narrower container than the app routes, Dex separates its explanation from its heading, Binder uses a large framed hero, and Settings mixes a hero card, account card, directory, and section cards. The user has to re-learn density and alignment on every tab. Use one content rail, one route-heading pattern, and one consistent large/tight spacing rhythm.

### P1 — Binder delays the primary task on mobile

The collection image, centered marketing copy, and stacked actions consume most of the first viewport while holdings and value appear below the fold. Compact the hero, remove decorative preview chrome at small widths, and bring the collection snapshot into the first screen.

### P2 — Secondary surfaces carry too much visual weight

Search filters, Settings cards, Binder metric cells, and the comparison dock use multiple borders and containers. Flatten related rows, reserve strong surfaces for command areas, and use proximity plus dividers for secondary information.

### P2 — Small metadata is consistently too faint

Several labels sit around 0.58–0.72rem and use the faintest text token. Important distinctions such as market status, filter state, and cost/value labels become slow to scan. Raise the floor for operational labels and keep faint text for genuinely optional notes.

### P2 — The comparison dock competes with mobile navigation and content

It is useful, but fixed placement overlaps the active page near the bottom and is especially intrusive above the mobile dock. Reduce its footprint, reserve bottom space, and make the active state more obvious without a large white block.

## Persona red flags

- **Alex, power user:** Binder requires scrolling past a non-operational hero before reaching sort, grade, and edit controls; Settings presents seven peer anchors without prioritizing frequent tasks.
- **Sam, accessibility-dependent:** very small faint labels and fixed overlays increase zoom and focus-order friction; important state must not depend on subtle color alone.
- **Casey, mobile user:** Binder’s hero and image push the collection below the first viewport, while two fixed docks reduce the usable thumb-zone area.

## Questions skipped

The user explicitly requested all three passes—layout, critique, and polish—across all four tabs, so priority and scope are already resolved.
