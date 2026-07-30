---
target: homepage
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
timestamp: 2026-07-30T03-05-56Z
slug: src-app-page-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/detector_evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Count-up/reveal motion can briefly read as data state rather than presentation. |
| 2 | Match System / Real World | 3 | “Terminal” and “Dex” are evocative but can be niche without a plain-language bridge. |
| 3 | User Control and Freedom | 3 | The moving showcase has no obvious pause or motion control. |
| 4 | Consistency and Standards | 4 | The dark editorial visual system is unusually coherent across the page. |
| 5 | Error Prevention | 2 | Market claims are not qualified with source, freshness, or confidence in the landing context. |
| 6 | Recognition Rather Than Recall | 2 | Scanning is promised in prose but has no visible action entry point. |
| 7 | Flexibility and Efficiency | 2 | Search requires a route change rather than starting from the hero. |
| 8 | Aesthetic and Minimalist Design | 3 | The hero is strong, but motion, whitespace, and repeated CTAs dilute the decision hierarchy. |
| 9 | Error Recovery | 1 | There is no visible framing for stale, unavailable, or uncertain market data. |
| 10 | Help and Documentation | 1 | Graded, sold comps, confidence, and scanning are not explained where first encountered. |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** Authored for collectors rather than a generic finance or card marketplace: the layered-card hero, dark terminal/editorial treatment, “Dex” language, and physical-card imagery form a clear product point of view. The product story, however, remains one layer too abstract: the first-screen action is navigation, not the promised act of finding or scanning a card.

**Deterministic scan:** `detect.mjs --json src/app/page.tsx` returned zero findings. That clean source-level result does not contradict the interaction issues above; it means the detector found no mechanical anti-patterns in this target. No false positives were reported.

## Overall Impression

This is an unusually polished, memorable homepage with a credible collector sensibility. Its largest opportunity is to turn the hero from a beautiful brand statement into the shortest path to a collector’s first useful answer: find, scan, or understand a card’s value.

## What's Working

- The card stack makes the subject matter immediate and tactile; it earns the premium, collector-first positioning before the visitor reads a word.
- The restrained dark palette, editorial type scale, hairlines, and numbered feature index create a single coherent system instead of a generic dashboard shell.
- “Today’s picks” translates the abstract market proposition into actual cards and makes the value promise tangible.

## Priority Issues

### [P1] The primary collector task has no immediate entry

**Why it matters:** A visitor who arrives with a card in hand must interpret “Open Card Dex,” navigate, then begin searching. The copy also promises scan-to-find, but scanning is not presented as an action. This loses both impatient collectors and uncertain newcomers.

**Fix:** Put a real search field in the hero with a clear “Search card, set, or number” prompt, plus a sibling “Scan a card” action. Preserve the existing destination routes; make the landing page the task launcher.

**Suggested command:** `$impeccable shape`

### [P1] Market trust is asserted rather than demonstrated

**Why it matters:** “Live market signals you can trust,” raw/graded/sold comps, and price-source claims are high-stakes statements. Without freshness, source, and confidence context near the first market cards, they can read as marketing rather than evidence.

**Fix:** Add compact, honest market-status metadata near Today’s picks: source count, updated timestamp or freshness state, and an unobtrusive “How pricing works” disclosure. Use an unavailable state when the data is not reliable; do not show ambiguous claims.

**Suggested command:** `$impeccable harden`

### [P2] Decorative motion competes with comprehension

**Why it matters:** The hero scene, reveal effects, count-up values, and moving card marquee create an impressive first impression, but stack several independent motion systems before a user can orient. The marquee and card treatment lack visible controls.

**Fix:** Keep one signature movement in the hero, honor reduced-motion preferences, and provide a clear pause/static treatment for the marquee. Do not place essential meaning solely in animated transitions.

**Suggested command:** `$impeccable quieter`

### [P2] Explanatory gaps make specialist terms feel exclusionary

**Why it matters:** “Card Dex,” raw, graded, sold comps, confidence, and scan-to-find mean different things to different collectors. The page gives no first-use explanation or help path, increasing hesitation precisely where confidence is needed.

**Fix:** Use one short plain-language supporting line at the key decision points, then expose contextual help for pricing and scanning concepts instead of burying definitions elsewhere.

**Suggested command:** `$impeccable clarify`

### [P3] The closing CTA repeats the hero’s decision

**Why it matters:** “Open Card Dex” and “View Binder” appear in both hero and closing band. Repetition adds length without progressing the visitor’s commitment.

**Fix:** Either remove the second pair or make it an activation step that complements the page, such as scanning a first card or starting an empty binder.

**Suggested command:** `$impeccable distill`

## Persona Red Flags

**Alex (Power User):** Alex cannot begin a search from the page, sees no shortcut or direct card-number path, and must route through the Dex before checking a known card. The visual experience is premium, but it adds a navigation step to a task that could begin immediately.

**Jordan (First-Timer):** Jordan has no clear visual entry to scanning despite the promise in the Card Dex description. “Raw,” “graded,” “sold comps,” and “confidence” are unexplained, and there is no visible help path to resolve uncertainty before committing.

**Casey (Distracted Mobile User):** The bottom dock helps navigation, but the long, motion-heavy path to a useful action makes return-after-interruption less focused. Hero card navigation takes multiple taps with no strong cue, and the repeated CTA pair asks Casey to make the same decision twice.

## Minor Observations

- Make the animated number treatment unmistakably decorative, rather than temporarily resembling live values that start at zero.
- The feature index is elegant but dense; on narrow screens, prioritize the action label before the descriptive sentence.
- The page benefits from a small explicit promise boundary: pricing data can be fresh, delayed, or unavailable; each deserves a legible state.

## Questions to Consider

- What should a collector be able to accomplish within five seconds of landing here?
- Can “scan a card” become the strongest mobile action without weakening search for experts?
- What proof would make a cautious collector believe the market number before they open a detail page?
