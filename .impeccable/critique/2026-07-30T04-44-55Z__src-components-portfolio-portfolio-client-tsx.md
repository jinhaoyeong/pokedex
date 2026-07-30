---
target: Binder page regions from screenshots 1-3; hero excluded
total_score: 29
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 3
timestamp: 2026-07-30T04-44-55Z
slug: src-components-portfolio-portfolio-client-tsx
---
⚠️ DEGRADED: single-context (Assessment B sub-agent spawn failed: agent thread limit reached)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Prices and performance are visible, but trend confidence is not. |
| 2 | Match system / real world | 4 | Card, grade, value, and collector language fit the product. |
| 3 | User control and freedom | 3 | Editing and disclosure are available; secondary actions stay hidden. |
| 4 | Consistency and standards | 4 | The premium black Binder language is cohesive. |
| 5 | Error prevention | 3 | Cost and market states are guarded, but thin trend history can mislead. |
| 6 | Recognition rather than recall | 3 | Main values are visible; icon-only row actions require interpretation. |
| 7 | Flexibility and efficiency | 3 | Sort/filter controls help, but the ledger is not optimized for fast comparison. |
| 8 | Aesthetic and minimalist design | 2 | Nested cards and repeated metrics create an artificial dashboard density. |
| 9 | Error recovery | 2 | Recovery exists for holding edits, but analytic confidence gaps have no explanation. |
| 10 | Help and documentation | 2 | Terms are concise, but concentration and trend methodology lack context. |
| **Total** |  | **29/40** | **Good foundation; substantial hierarchy and truthfulness polish needed.** |

## Design Specificity Verdict

The Binder is product-authored rather than category-interchangeable: trading-card art, grading, collector rank, and collection progression belong to PokePokedex. The AI feeling comes from presentation, not concept. Nearly every fact is placed in another bordered, rounded surface with an uppercase label, so meaningful portfolio information reads like generated dashboard furniture.

The deterministic detector returned no findings for `portfolio-client.tsx` or `binder-insights.tsx`. That is useful negative evidence for obvious markup anti-patterns, but it does not contradict the visual review: the core issues are information hierarchy, repeated framing, and analytic credibility. Live inspection confirmed no horizontal overflow at 1440px or 390px. The assessment browser had an empty local Binder, so the supplied populated screenshots and source markup were the fallback evidence for populated ledger and insight states. No reliable overlay was available because browser evaluation is read-only.

## Overall Impression

The ledger contains the right information and the collector framing is memorable, but a two-card collection is asked to support the visual weight of a professional analytics terminal. The largest opportunity is to make the ledger operational and the insights earned: fewer containers, clearer primary values, and honest early-data states.

## What’s Working

- Card identity, grade, set, quantity, market value, and gain/loss are all present.
- The premium black visual system feels consistent with the rest of the product.
- Insights are progressively disclosed rather than permanently blocking the ledger.

## Priority Issues

### [P0] Insight depth exceeds data maturity

Two holdings produce pulse, three highlights, two distributions, diversity, rank, trend, and eleven badges. Several modules repeat the same Umbreon and Gengar facts.

**Fix:** introduce early-collection states. Show collection foundations, coverage, concentration, and one next action for small binders; reveal distributions and full achievement analysis as the collection grows.

### [P1] Trend confidence is overstated

“+100.0%” reads as investment performance even when history is too thin to support that conclusion.

**Fix:** show the observation count and timeframe, suppress percentage performance below the minimum history threshold, and use a baseline-building state.

### [P1] Pulse language conflicts with concentration evidence

“Binder is balanced” conflicts with the adjacent warning that one holding carries most of the value.

**Fix:** use a precise assessment such as “Concentrated, well tracked,” explain the score, and give one measurable next step.

### [P1] Badges compete with the portfolio

Eleven equally framed badges create a dense wall; locked criteria receive nearly the same attention as earned accomplishments.

**Fix:** prioritize unlocked badges, expose criteria without relying on `title`, and collapse the remaining locked goals behind one disclosure.

### [P2] Ledger values are over-framed

Four inset metric cards repeat labels per holding and make unit detail as prominent as current value and total P/L.

**Fix:** use a stable table-like column rhythm, emphasize current value and total P/L, and keep unit details as secondary text without nested cards.

## Persona Red Flags

**Alex (power user):** repeated metric boxes slow row comparison, and the three-dot action is the only visible path to operational changes.

**Sam (accessibility-dependent):** the chart is pointer-scrubbable without a keyboard-equivalent point list; badge criteria rely partly on `title`; color carries some performance emphasis despite signed values.

## Minor Observations

- The decorative collection-grade meter has no readable scale or decision value.
- Repeated uppercase tracking makes labels feel manufactured rather than editorial.
- Green borders make static summary cards look like interactive success states.
- The fourth-image hero is explicitly outside scope and should remain unchanged.

## Questions to Consider

- What is the minimum amount of history required before Binder can make a performance claim?
- Which three facts should a collector understand within five seconds?
- Can every insight answer a different question instead of restating the same holding?

Questions skipped: the user already specified full polish scope for screenshots 1–3 and explicitly excluded screenshot 4.
