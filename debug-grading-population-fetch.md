# Debug Session: grading-population-fetch
- **Status**: [OPEN]
- **Issue**: Some cards load raw market data but fail to load graded slab values and/or population tables. The user does not want preload data or fake data; live fetches must be accurate and reliable.
- **Debug Server**: `http://127.0.0.1:7777/event` (Node fallback collector)
- **Log File**: `.dbg/trae-debug-log-grading-population-fetch.ndjson`

## Reproduction Steps
1. Open a card detail page that shows raw market value but missing graded values or population.
2. Wait for the market intelligence panel to finish loading.
3. Inspect whether `grade values`, `population`, and `sold comps` all resolve from live sources.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Upstream source responses are partial or mismatched, and the app currently treats them as final success instead of retrying or escalating failure correctly. | High | Low | Partially confirmed: `core` uses shorter source budgets than `full`, so partial/empty core responses can occur and need escalation. |
| B | Cache entries for partial failures are being reused as if they were valid complete results, so later visits keep showing missing data. | High | Low | Inconclusive: cache instrumentation added, but the strongest reproducible issue was the client not escalating incomplete `core` responses. |
| C | The fetch pipeline resolves raw price and graded/population through different code paths, and one branch exits early before population/grading enrichment finishes. | High | Medium | Confirmed: [use-card-grading-market.ts](file:///c:/Users/jinhao/Documents/trae_projects/pokedex/pokedex/src/hooks/use-card-grading-market.ts) only auto-escalated empty `core` results for localized cards, leaving English cards stuck with partial data. |
| D | Source matching logic for set/card identity is too brittle for some cards, causing silent no-match outcomes for population rows. | Medium | Medium | Rejected for the validated canaries: direct `/api/grading-market` checks returned real population + graded values for EN and JA sample cards. |
| E | Client-side rendering or response normalization drops valid graded/population payload fields when trust/source metadata is missing. | Medium | Medium | Rejected: API validation and payload checks showed the data shape is preserved once fetched. |

## Log Evidence
- `npm run validate:grading` against `http://localhost:3000` passed `7/7`, confirming the live API can return real population and graded values.
- Direct `core` vs `full` checks for Aquapolis Lugia, Celebrations Charizard, and SV2A Mew ex showed both modes can produce population + slab values, but `core` intentionally runs with shorter budgets and skips sold comps.
- The client hook in [use-card-grading-market.ts](file:///c:/Users/jinhao/Documents/trae_projects/pokedex/pokedex/src/hooks/use-card-grading-market.ts) only escalated no-signal `core` payloads for localized cards, which can strand English cards in a partial raw-only state after a short-budget miss.

## Verification Conclusion
- Minimal fixes applied:
  - after `core` enrichment, the detail page now auto-escalates to `full` whenever primary grading data is still incomplete (missing population rows or missing slab values), regardless of language.
  - preview PSA/population placeholders are now purged during live merges instead of surviving when live enrichment returns empty or partial data.
- Validation after the fix still passes `7/7` on the grading-market canaries.
