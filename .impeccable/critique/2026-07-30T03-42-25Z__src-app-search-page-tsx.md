---
target: Dex, Binder, and Settings pages
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-07-30T03-42-25Z
slug: src-app-search-page-tsx
---
Method: dual-agent (A: surface_design_review · B: surface_detector_evidence)

## Design Health Score

**26/40 — Acceptable.** The product has a distinctive TCG visual language, but routine tasks compete with decoration, analytics, and too many simultaneous controls.

| # | Heuristic | Score | Evidence |
|---|---|---:|---|
| 1 | Visibility of status | 3 | Search and market loading states exist; some transient settings feedback disappears quickly. |
| 2 | Match with the real world | 4 | Scanner, binder, grading, set, and collector language fit the collecting domain. |
| 3 | User control and freedom | 3 | Filters and drawers can be exited, but destructive actions lack recovery. |
| 4 | Consistency and standards | 3 | Shared visual language is strong; control behavior varies across custom selects and drawers. |
| 5 | Error prevention | 2 | Clearing a binder and deleting a holding are immediate. |
| 6 | Recognition rather than recall | 3 | Main actions are visible, but search fields rely on placeholders and ARIA-only labels. |
| 7 | Flexibility and efficiency | 2 | Binder management lacks condensed controls, bulk paths, and accelerators. |
| 8 | Aesthetic and minimalist design | 3 | Premium and specific, but Binder exposes too much analytics at once. |
| 9 | Error recovery | 2 | Empty and pending states are useful; destructive recovery is weak. |
| 10 | Help and documentation | 1 | Contextual guidance is sparse around filters, storage, and market behavior. |

## Design Specificity Verdict

The dark navy, red action color, card imagery, scanner framing, and binder language feel authored for Pokémon card collecting. Search and Settings still fall into a reusable hero-plus-card template, and Binder lets its dashboard spectacle outrank the holdings task.

The deterministic detector found **0 findings** across the ten target markup files. This does not contradict the design review: the priority problems are hierarchy, progressive disclosure, destructive-action safety, and custom-control behavior rather than prohibited code patterns.

## Cognitive Load

Four checklist failures: single focus, visual hierarchy, minimal choices, and progressive disclosure. Search presents five peer controls. Binder presents five sorts, grade filters, four metrics per holding, and multiple analytics blocks in one continuous path.

## Emotional Journey

The pages begin with premium, confident framing. The experience dips when users reach dense controls or irreversible actions. The finish should reassure: Search should make the exact-card path obvious, Binder should make the next holding action obvious, and Settings should make backup and recovery feel safe.

## Strengths

- Pokémon-specific visual motifs and domain copy make the product recognizable.
- Search already communicates price loading, pending, and empty states well.
- Settings clearly explains browser-local storage and offers export/import.

## Priority Issues

1. **P1 — Binder mobile hierarchy:** the decorative poster precedes the title and Add Cards action.
2. **P1 — Binder task overload:** holdings compete with always-visible analytics and too many sort/filter buttons.
3. **P1 — Destructive action safety:** Clear binder and Delete card need contextual confirmation and recovery.
4. **P2 — Custom-control accessibility:** SearchSelect needs complete arrow-key behavior, selection focus, and focus restoration.
5. **P2 — Search hierarchy:** query/search must lead; optional filters need persistent labels and progressive disclosure.

## Persona Red Flags

- **Alex:** repeated per-card drawers and visible button groups slow routine binder management.
- **Sam:** incomplete listbox keyboard behavior and nested interactive semantics make Search and Binder unreliable.
- **Casey:** the mobile Binder hero buries the primary action, while immediate deletion conflicts with backup-first messaging.

## Minor Observations

- Price-driven result reordering can feel unstable without an explanation.
- Long local storage keys need safe wrapping.
- Settings status should remain announced without forcing the user to search for it.

## Questions

- Which Binder analytics change a collecting decision today?
- Can exact-card search feel like one decision first, with filters revealed only when needed?
- Should every destructive action name the affected card or item count before it runs?
