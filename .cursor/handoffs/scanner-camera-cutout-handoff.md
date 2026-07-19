# Handoff: Camera Card Scanner Cutout & Matching

**Date:** 2026-07-19  
**Repo:** PokePokedex (Next.js 16 Pokemon TCG search / scan / portfolio)  
**Working branch:** `cursor/camera-scan-perspective-286b`  
**Base branch:** `redesign/premium-black`  
**PR:** https://github.com/jinhaoyeong/pokedex/pull/43  

---

## Goal

Make **Scan a card** accurate for **real-life camera photos**, not only clean digital catalog images.

Target UX (reference: TCG-style four-corner crop UI):

1. User takes / uploads a noisy angled photo of a physical card.
2. App **auto-finds the card** in the frame and places four corner handles.
3. App **cuts out + projectively flattens** the card into an upright card-only image.
4. Matching (dHash → CLIP → OCR → live search) identifies the correct catalog card.
5. User can still drag handles if auto-detect is slightly off.

Success criteria:

- Digital full-bleed uploads keep working (no false deskew).
- Camera English Dark Charizard (Team Rocket #4) matches confidently.
- Camera / rotated Japanese Charizard ex (e.g. JP #125) matches confidently.
- Auto cutout places handles tightly on card corners without manual drag when possible.

---

## What We Have Done

### Already solid (earlier on `redesign/premium-black` / prior commits)

- Local visual index (`data/scan-visual-index.sqlite` + `scan-visual-hashes.json.gz` fallback).
- Fast hash-first scan path; CLIP budgeted; OCR as fallback / tie-breaker.
- Letterbox trimming for digital black borders.
- Rotation deskew (`estimateCardFrame` + `autoDeskewCard`).
- OCR improvements for multi-word names / Japanese / inverted full-art slices.
- TCGdex thumbnail URL normalization (`normalizeScanCardImageUrl`).
- Production visual-search readiness checks.

### On this PR branch (`cursor/camera-scan-perspective-286b`)

| Commit | What it added |
|--------|----------------|
| `192df9e` | Four-corner crop UI + projective rectification (`perspective.ts`); OCR identity resolve against visual catalog names |
| `a73aaff` | Alignment-variant hashes; prefer CLIP on camera rectifications when dHash is not decisive |
| `7a66d35` | **Auto-detect card corners** from camera photos and pre-place handles; always cut out when auto-detected |

Key files:

- `src/components/search/scan-button.tsx` — capture → crop UI → `rectifyPerspective` → `processImage`
- `src/lib/scan/perspective.ts` — homography / projective transform helpers
- `src/lib/scan/card-geometry.ts` — foreground mask + convex-hull quad corners + rotated AABB fallback
- `src/lib/scan/ocr.ts` — HP-header priority for name candidates
- `src/lib/scan/visual-index-local.server.ts` — `searchLocalByNames` for exact card-name identity
- `src/app/api/visual-search/route.ts` — accepts `names` / `collectorNumber` for identity hits

### Verified locally

Fixtures (on agent VM):

- `/tmp/dark-charizard-camera-perspective.jpg`
- `/tmp/japanese-charizard-camera-perspective.jpg`

Results after auto-cutout:

- Dark Charizard auto-handles + Scan → **Team Rocket #4** first.
- Japanese Charizard auto-handles hug corners; OCR often reads `リザードンex 125`; ranking sometimes still prefers English Obsidian Flames #215 over JP #125.

Demo artifact:

- `/opt/cursor/artifacts/auto_card_cutout_camera_scan.mp4`

---

## What We Are Currently Fixing / Open Issues

1. **Japanese camera ranking inconsistency**  
   Auto cutout + OCR can detect JP identity (`リザードンex` / `#125`) but top catalog match sometimes becomes English Charizard ex (Obsidian Flames #215) instead of Japanese `SV3-125`. Prefer exact visual-catalog identity hits (lang + collector number) over weaker live-search / visual collisions.

2. **Auto-detect edge cases**  
   Works well on table photos with clear contrast. May still need manual handle nudge for:
   - Extreme glare / heavy foil bloom
   - Very busy backgrounds
   - PSA slabs + Instagram chrome mixed into the frame
   - Cards nearly same luminance as the table

3. **Deploy / merge**  
   Work lives on PR branch against `redesign/premium-black`, not yet merged to production `main`. Repo AGENTS.md normally prefers push-to-main; cloud task instructions used feature branch + PR for this redesign stream.

4. **No automated test suite**  
   There is no `npm test`. Validation is manual / browser computer-use + fixture hashes.

---

## How the Current Pipeline Works

```
Capture / upload
  → trimLetterboxBorders (digital black padding)
  → crop stage:
       - full-bleed digital → edge-to-edge handles
       - camera/table → detectCardPerspectiveQuad() auto-places corners
  → Scan:
       - if auto-detected OR user moved handles → rectifyPerspective (card-only flat PNG)
       - else → full image into processImage (legacy deskew path)
  → processImage:
       dHash (+ inset / alignment variants)
       → optional CLIP
       → OCR slices
       → visual-search (+ exact name identity)
       → rank / filter confident matches
```

Important flags in `scan-button.tsx`:

- `cropAutoDetectedRef` — auto cutout was found; Scan must rectify even if user never touched handles
- `cropTouchedRef` — user dragged a handle
- `verifyText: true` on rectified camera cutouts — force OCR / identity path, give CLIP more budget

---

## Suggested Next Steps for the Next AI

1. **Fix JP identity ranking** after auto cutout: when `identityHits` include a strong exact name + collector number (e.g. `リザードンex` + `125`), force those to the top of results / guess before English live-search alternatives.
2. Re-test both camera fixtures with **zero handle movement**.
3. Spot-check a glare-heavy Victini-style photo (user’s reference UI) if available.
4. Keep digital Umbreon / upright JP catalog images from regressing (full-bleed path must not force a bad cutout).
5. When redesign stream is ready, merge PR #43 into `redesign/premium-black` (or cherry-pick to `main` per deploy policy).

---

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm run lint
npm run build

# visual index status
curl -sS http://localhost:3000/api/visual-search
```

Smoke path: Home → `/search` → Scan a card → upload camera fixture → accept auto handles → Scan this card.

---

## Context Notes

- Product overview / deploy rules: `AGENTS.md`
- Market audit automation (unrelated): `.cursor/automations/market-accuracy-audit.md`
- Prefer low-context work: touch scan files only unless ranking needs live-search changes
- Do not invent paid API keys; market + visual index are free / local
