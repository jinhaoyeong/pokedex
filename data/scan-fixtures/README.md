# Card scanner regression fixtures

This directory contains deterministic inputs for diagnosing the card-scanner pipeline. `manifest.json` is the source of truth for expected card identity, language, collector number, geometry behavior, and fixture provenance.

The set intentionally mixes exact catalog images, one recovered recording frame, and controlled synthetic stress cases. These categories are not interchangeable: synthetic fixtures are useful for repeatable regression work, but they are not evidence of real-world camera accuracy.

## Fixture inventory

| Fixture | Expected result | Geometry expectation | Provenance |
| --- | --- | --- | --- |
| `clean-digital-english-umbreon.png` | `swsh7-215` (Umbreon VMAX, English, 215) | Do not auto-cut out a full-bleed digital image | Exact TCGdex catalog pixels recovered for the prior Umbreon regression; not a camera capture |
| `clean-digital-japanese-charizard.png` | `SV3-125` (Japanese, 125) | Do not auto-cut out a full-bleed digital image | Exact TCGdex catalog pixels; not a camera capture |
| `jp-charizard-camera-rotated.png` | `SV3-125` (Japanese, 125) | Auto-detect the declared normalized quad | Synthetic reconstruction of the rotated scene shown in a recovered scanner recording, built from exact `SV3-125` pixels and the demonstrated background/rotation |
| `dark-charizard-camera-perspective.png` | `base5-4` (Dark Charizard, English, 4) | Auto-detect the declared normalized quad | Intact frame recovered from `robust_rotated_english_japanese_scanner.mp4`; this is a recording frame of the demonstrated scan scene, not an asserted raw camera original |
| `black-letterboxed-digital.png` | `swsh7-215` (English, 215) | Do not auto-cut out the letterboxed digital image | Synthetic black-canvas stress variant made from exact Umbreon VMAX 215 pixels |
| `camera-glare.png` | `SV3-125` (Japanese, 125) | Auto-detect the declared normalized quad | Synthetic glare variant derived from the rotated `SV3-125` reconstruction |
| `psa-slab.png` | `base5-4` (English, 4) | Classify as a slab and prefer the declared inner-card quad | Synthetic slab variant made from exact Dark Charizard #4 pixels |
| `social-screenshot.png` | `base5-4` (English, 4) | Auto-detect the declared normalized quad | Synthetic social-app variant based on the prior Dark Charizard Instagram test |
| `non-card.png` | No card ID; return an uncertain result | Do not auto-detect a card | Synthetic negative control containing no card pixels |

Quad coordinates in the manifest are normalized to the fixture dimensions. Keep the image bytes, expected quad, and provenance entry in sync when a fixture changes.

## Capture runtime evidence

The capture harness drives the real scanner UI in headless Chrome. Before running it, start the application at the URL expected by the harness and make sure the local visual index is present:

```bash
npm run dev -- --port 3001
```

Then, in a second terminal, capture either the full manifest or one named fixture:

```bash
npm run scan:capture
npm run scan:capture -- --fixture=jp-charizard-camera-rotated.png
```

The default page is `http://localhost:3001/scan-debug`. Set `SCAN_APP_URL` when the application is served elsewhere. The harness requires Google Chrome or Chromium; set `CHROME_PATH` if it is not installed at one of the paths listed in `scripts/capture-scan-fixtures.mjs`.

For each successful run, the harness writes the runtime sidecar described below, crop/result screenshots under `evidence/`, and any image variants published by the debug report (for example, original, quad overlay, rectified, expanded, contracted, and legacy crops). A `*-failed.png` screenshot is diagnostic only: it is not measured evidence. The harness removes a fixture's previous sidecar before recapturing it, so an interrupted or failed scan cannot leave an older result looking current.

### Runtime debug sidecars

A browser fixture run can be preserved beside its image as `<fixture filename>.scan-debug.json`. Keep the image extension in the sidecar name. For example:

```text
dark-charizard-camera-perspective.png
dark-charizard-camera-perspective.png.scan-debug.json
```

Use this envelope so a result remains attributable to its input and timing:

```json
{
  "schemaVersion": 2,
  "fixture": "dark-charizard-camera-perspective.png",
  "captureSource": "camera",
  "recordedAt": "2026-07-19T10:00:00.000Z",
  "wallClockDurationMs": 13000,
  "durationMs": 12345,
  "runtimeFingerprint": "<64-character SHA-256 digest>",
  "runtimeFingerprintFileCount": 16,
  "report": {
    "schemaVersion": 1,
    "scanId": "scan-id",
    "createdAt": "2026-07-19T10:00:00.000Z",
    "classification": {},
    "geometry": {},
    "imageVariants": {},
    "ocrSlices": [],
    "retrieval": {},
    "finalRanking": [],
    "notes": []
  }
}
```

The envelope is schema version 2; the nested `report` currently follows `ScanDebugReport` schema version 1 in `src/lib/scan/scan-debug.ts`. It records classification scores, the detected quad and crop quality, OCR text/confidence/region/rotation/preprocessing, retrieval candidates, and final ranking components. Persist the sanitized report: embedded base64 image data should be replaced by the sanitizer's omission marker rather than copied into JSON. `durationMs` is scanner-reported processing time, while `wallClockDurationMs` covers the harness's full per-fixture operation.

`runtimeFingerprint` is a deterministic SHA-256 over the sorted paths and bytes of the scanner runtime sources. The capture harness verifies that it did not change during a scan. For manifest version 2, the benchmark compares the saved digest with the current runtime and blocks missing, unverifiable, or stale evidence. A bare `ScanDebugReport` remains parse-compatible, but it has no verifiable capture envelope and therefore cannot count as measured evidence. A sidecar proves what one browser run reported; it is not a permanent claim about every run or physical camera.

## Benchmark command and evidence boundary

Run the bounded benchmark from the repository root:

```bash
npm run scan:benchmark
npm run scan:benchmark -- --output=data/scan-fixtures/benchmark-report.json
```

It writes the JSON report to standard output. `--output=<path>` additionally saves the same report to the requested path, resolved from the current working directory. The harness validates the manifest, required fixture binaries, each declared fixture SHA-256, expected identities, metadata, hashes, and embeddings against the local visual index. Fixture hashes protect against unnoticed byte changes; they do not independently prove the provenance statements in the manifest. When runtime-current sidecars are present, the benchmark aggregates their recorded browser observations into fixture and summary metrics.

The command does **not** itself launch the browser or run image classification, perspective detection, OCR, visual retrieval, or final ranking. Without valid current sidecars, per-fixture observations remain unmeasured and image-derived metrics remain `null` where no current run is available.

The report-level `status` is one of:

- `MEASURED`: every declared fixture has valid, runtime-current evidence and there are no validation errors or blockers.
- `BLOCKED`: required evidence or prerequisites are missing, stale, unverified, or otherwise blocked. This can coexist with `accuracy_claim: "PARTIALLY_MEASURED"` when only a subset of fixtures has current sidecars; metrics then describe that subset only.
- `FAILED`: the manifest, sidecar structure, output operation, or another benchmark input is invalid.

`MEASURED` describes evidence completeness, not accuracy success. It does not mean every expected identity, OCR assertion, geometry threshold, or score threshold passed. Review `required_regressions`, per-fixture observations, metrics, and metric counts separately. A `PASS` in `required_regressions` requires every gate declared for that required fixture: top-1 identity plus any configured minimum score, classification, auto-detection, corner-error, and explicit `ocrExpect` checks. General identity metadata does not silently create a strict OCR gate.

For diagnostic work where a blocked preflight should still emit its complete report without a failing exit status, run:

```bash
npm run scan:benchmark -- --allow-blocked
```

`--allow-blocked` only changes the exit behavior for a `BLOCKED` report; it does not convert missing evidence into measured results.

## Current evidence limitation

The rotated Japanese Charizard camera fixture is a synthetic reconstruction, not a raw camera original. Current captured evidence can retain Japanese script and recover collector primary `125`, and identity fusion can rank `SV3-125` first, but OCR has not reliably recovered the exact printed name `リザードン`. Treat exact-name OCR as an open limitation and do not describe this fixture—or the suite—as a complete Japanese OCR pass until a runtime-current sidecar demonstrates it.

### Acceptance mapping (handoff vs strict OCR gate)

Against the original camera-scanner handoff acceptance criteria:

| Required case | Identity / geometry / language / collector | Exact printed-name OCR |
| --- | --- | --- |
| Dark Charizard camera | Pass (`base5-4`, auto-detect, score ≥ 0.8) | Not required by handoff |
| Japanese Charizard camera | Pass (`SV3-125` over English `#215`, Japanese script, collector `125`) | Still fails (`ocrExpect.nameIncludes: ["リザードン"]`) |
| Digital Umbreon | Pass (no false perspective cutout) | Not required by handoff |

`npm run scan:benchmark` therefore reports `status: MEASURED` with `regression_status: FAIL` until exact Japanese name OCR passes. Do not weaken that gate to force a green status.
