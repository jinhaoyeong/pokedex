#!/usr/bin/env node
/**
 * Sidecar-driven card scanner benchmark.
 *
 * Browser scans write one `<fixture filename>.scan-debug.json` sidecar beside
 * each fixture. A sidecar may be the ScanDebugReport itself or an envelope of
 * `{ durationMs, report }`. This runner never executes or approximates the
 * browser pipeline: missing reports stay unmeasured and block a normal run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import {
  computeScanRuntimeFingerprint,
  sha256File,
} from "./lib/scan-runtime-fingerprint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "data", "scan-fixtures", "manifest.json");
const fixturesDir = path.dirname(manifestPath);
const indexPath = path.join(root, "data", "scan-visual-index.sqlite");
const allowBlocked = process.argv.includes("--allow-blocked");
const requiredRegressionKeys = [
  "dark_charizard_camera",
  "japanese_charizard_camera",
  "digital_umbreon",
];

const blockers = [];
const errors = [];
const outputArguments = process.argv.filter((argument) =>
  argument.startsWith("--output="),
);
let outputPath = null;

if (outputArguments.length > 1) {
  errors.push({
    code: "output_path_ambiguous",
    fixture: null,
    detail: "Pass --output=<path> at most once",
  });
} else if (outputArguments.length === 1) {
  const requestedPath = outputArguments[0].slice("--output=".length).trim();
  if (!requestedPath) {
    errors.push({
      code: "output_path_missing",
      fixture: null,
      detail: "--output=<path> requires a non-empty path",
    });
  } else {
    outputPath = path.resolve(process.cwd(), requestedPath);
  }
}

function relativeToRoot(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function addBlocker(code, fixture, detail) {
  blockers.push({ code, fixture: fixture ?? null, detail });
}

function addError(code, detail, fixture = null) {
  errors.push({ code, fixture, detail });
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedSha256(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase().replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function fingerprintFromPayload(payload) {
  if (typeof payload?.runtimeFingerprint === "string") {
    return normalizedSha256(payload.runtimeFingerprint);
  }
  if (isObject(payload?.runtimeFingerprint)) {
    return normalizedSha256(
      payload.runtimeFingerprint.digest ??
        payload.runtimeFingerprint.value ??
        payload.runtimeFingerprint.sha256,
    );
  }
  return null;
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function normalizedSearchText(value) {
  return normalizedText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizedCollector(value) {
  const text = String(value ?? "").trim().toUpperCase();
  return text.replace(/^0+(?=\d)/, "");
}

function candidateCardId(candidate) {
  if (!isObject(candidate)) return null;
  const id = candidate.cardId ?? candidate.id ?? null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function candidateMatchesExpected(candidate, expectedCardId) {
  if (!expectedCardId || !isObject(candidate)) return null;
  const expected = normalizedText(expectedCardId);
  const id = normalizedText(candidateCardId(candidate));
  if (id && id === expected) return true;
  const slug = normalizedText(candidate.slug);
  return Boolean(slug && (slug === expected || slug.endsWith(`--${expected}`)));
}

function candidateScore(candidate) {
  if (!isObject(candidate)) return null;
  return finiteNumber(candidate.totalScore) ?? finiteNumber(candidate.score);
}

function normalizeQuad(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map((point) => {
    if (!isObject(point)) return null;
    const x = finiteNumber(point.x);
    const y = finiteNumber(point.y);
    return x === null || y === null ? null : { x, y };
  });
  return points.every(Boolean) ? points : null;
}

function quadCornerRmse(observedValue, expectedValue) {
  const observed = normalizeQuad(observedValue);
  const expected = normalizeQuad(expectedValue);
  if (!observed || !expected) return null;

  // Quad producers should use TL/TR/BR/BL ordering. Best cyclic/reversed
  // alignment also makes this robust to a different starting corner while
  // preserving the actual geometric error.
  const alignments = [];
  for (const candidate of [observed, [...observed].reverse()]) {
    for (let offset = 0; offset < 4; offset += 1) {
      alignments.push(expected.map((_, index) => candidate[(index + offset) % 4]));
    }
  }
  return Math.min(
    ...alignments.map((aligned) => {
      const squaredError = expected.reduce((sum, point, index) => {
        const dx = aligned[index].x - point.x;
        const dy = aligned[index].y - point.y;
        return sum + dx * dx + dy * dy;
      }, 0);
      return Math.sqrt(squaredError / expected.length);
    }),
  );
}

function inferOcrLanguage(slices) {
  const text = slices
    .map((slice) => String(slice?.normalizedText ?? slice?.text ?? ""))
    .join(" ");
  if (!text.trim()) return null;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) {
    return "ja";
  }
  if (/[A-Za-z]/.test(text)) return "en";
  return null;
}

function languageFromOcrScriptHint(value) {
  const hint = normalizedText(value);
  if (["ja", "jp", "japanese"].includes(hint)) return "ja";
  if (["en", "english", "latin"].includes(hint)) return "en";
  return null;
}

function reportUncertain(report, fixture) {
  const ranking = Array.isArray(report?.finalRanking) ? report.finalRanking : [];
  if (!ranking.length) return true;
  const topScore = candidateScore(ranking[0]);
  const threshold = finiteNumber(fixture?.minimumTop1Score) ?? 0.8;
  if (topScore === null || topScore < threshold) return true;
  return Array.isArray(report?.notes)
    ? report.notes.some((note) =>
        /\b(uncertain|not confident|no (?:card )?match|rejected)\b/i.test(String(note)),
      )
    : false;
}

function readDebugSidecar(fixtureName, fixturePath) {
  const sidecarPath = `${fixturePath}.scan-debug.json`;
  const base = {
    path: relativeToRoot(sidecarPath),
    present: fs.existsSync(sidecarPath),
    valid: false,
    bytes: null,
    format: null,
    freshness: {
      required: runtimeFingerprintRequired,
      status: "NO_SIDECAR",
      current: currentRuntimeFingerprint?.digest ?? null,
      observed: null,
    },
  };
  if (!base.present) {
    addBlocker(
      "scan_debug_sidecar_missing",
      fixtureName,
      `${base.path} is required for measured scanner results`,
    );
    return {
      metadata: base,
      report: null,
      durationMs: null,
      unavailableReason: "scan_debug_sidecar_missing",
    };
  }

  try {
    base.bytes = fs.statSync(sidecarPath).size;
    const payload = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    const hasEnvelope = isObject(payload?.report);
    const report = hasEnvelope ? payload.report : payload;
    base.format = hasEnvelope ? "envelope" : "bare_report";
    base.freshness.observed = fingerprintFromPayload(payload);
    const durationMs =
      finiteNumber(payload?.durationMs) ??
      finiteNumber(payload?.duration_ms) ??
      finiteNumber(report?.durationMs) ??
      finiteNumber(report?.duration_ms);
    const invalidFields = [];
    if (!isObject(report)) invalidFields.push("report");
    if (isObject(report) && report.schemaVersion !== 1) {
      invalidFields.push("report.schemaVersion");
    }
    if (!isObject(report?.classification)) invalidFields.push("report.classification");
    if (!isObject(report?.geometry)) invalidFields.push("report.geometry");
    if (!Array.isArray(report?.ocrSlices)) invalidFields.push("report.ocrSlices");
    if (!Array.isArray(report?.finalRanking)) invalidFields.push("report.finalRanking");
    if (
      typeof payload?.fixture === "string" &&
      normalizedText(payload.fixture) !== normalizedText(fixtureName)
    ) {
      invalidFields.push("fixture (does not match manifest entry)");
    }
    if (invalidFields.length) {
      addError(
        "scan_debug_sidecar_invalid",
        `${base.path}: ${invalidFields.join(", ")}`,
        fixtureName,
      );
      return {
        metadata: base,
        report: null,
        durationMs: null,
        unavailableReason: "scan_debug_sidecar_invalid",
      };
    }
    base.valid = true;

    if (!currentRuntimeFingerprint) {
      base.freshness.status = "CURRENT_UNAVAILABLE";
      return {
        metadata: base,
        report: null,
        durationMs: null,
        unavailableReason: "scan_runtime_fingerprint_unavailable",
      };
    }
    if (!hasEnvelope) {
      base.freshness.status = "UNVERIFIED_BARE_REPORT";
      addBlocker(
        "scan_debug_sidecar_fingerprint_unverified",
        fixtureName,
        `${base.path} is a bare report without a verifiable capture envelope`,
      );
      return {
        metadata: base,
        report: null,
        durationMs: null,
        unavailableReason: "scan_debug_sidecar_fingerprint_unverified",
      };
    }
    if (!base.freshness.observed) {
      base.freshness.status = "MISSING";
      if (runtimeFingerprintRequired) {
        addBlocker(
          "scan_debug_sidecar_fingerprint_missing",
          fixtureName,
          `${base.path} has no valid runtimeFingerprint for manifest v${manifest?.version}`,
        );
        return {
          metadata: base,
          report: null,
          durationMs: null,
          unavailableReason: "scan_debug_sidecar_fingerprint_missing",
        };
      }
      return { metadata: base, report, durationMs, unavailableReason: null };
    }
    if (base.freshness.observed !== currentRuntimeFingerprint.digest) {
      base.freshness.status = "STALE";
      addBlocker(
        "scan_debug_sidecar_fingerprint_mismatch",
        fixtureName,
        `${base.path} was captured with ${base.freshness.observed}; current runtime is ${currentRuntimeFingerprint.digest}`,
      );
      return {
        metadata: base,
        report: null,
        durationMs: null,
        unavailableReason: "scan_debug_sidecar_fingerprint_mismatch",
      };
    }

    base.freshness.status = "CURRENT";
    return { metadata: base, report, durationMs, unavailableReason: null };
  } catch (error) {
    addError(
      "scan_debug_sidecar_unreadable",
      `${base.path}: ${String(error?.message ?? error)}`,
      fixtureName,
    );
    return {
      metadata: base,
      report: null,
      durationMs: null,
      unavailableReason: "scan_debug_sidecar_unreadable",
    };
  }
}

function emptyObserved(reason, sidecar) {
  const status =
    sidecar?.freshness?.status === "STALE"
      ? "STALE"
      : sidecar?.freshness?.status === "MISSING" ||
          sidecar?.freshness?.status === "UNVERIFIED_BARE_REPORT" ||
          sidecar?.freshness?.status === "CURRENT_UNAVAILABLE"
        ? "UNVERIFIED"
        : "NOT_RUN";
  return {
    status,
    reason,
    sidecar,
    top1: null,
    top3: null,
    geometry: null,
    ocr: null,
    uncertain_or_rejected: null,
    duration_ms: null,
  };
}

function emptyMetrics() {
  return {
    top1_accuracy: null,
    top3_accuracy: null,
    geometry: {
      auto_detection_rate: null,
      corner_rmse_normalized: null,
      corner_error: null,
      corner_threshold_pass_rate: null,
      false_auto_cutout_on_digital: null,
      mean_crop_confidence: null,
    },
    ocr: {
      name_accuracy: null,
      collector_number_accuracy: null,
      language_accuracy: null,
    },
    average_scan_time_ms: null,
    uncertain_rate: null,
  };
}

function ratio(passed, measured) {
  return measured > 0 ? passed / measured : null;
}

function mean(values) {
  const measured = values.filter((value) => finiteNumber(value) !== null);
  return measured.length
    ? measured.reduce((sum, value) => sum + value, 0) / measured.length
    : null;
}

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  addError("manifest_unreadable", String(error?.message ?? error));
}

const manifestFixtures = Array.isArray(manifest?.fixtures) ? manifest.fixtures : [];
if (manifest && !Array.isArray(manifest.fixtures)) {
  addError("manifest_fixtures_invalid", "manifest.fixtures must be an array");
}
if (manifest && manifestFixtures.length === 0) {
  addBlocker("manifest_fixtures_empty", null, "manifest.fixtures has no benchmark cases");
}

const runtimeFingerprintRequired = Number(manifest?.version) >= 2;
let currentRuntimeFingerprint = null;
try {
  currentRuntimeFingerprint = computeScanRuntimeFingerprint(root);
} catch (error) {
  addError(
    "scan_runtime_fingerprint_unavailable",
    String(error?.message ?? error),
  );
}

let db = null;
let lookupExpectedCard = null;
const index = {
  path: relativeToRoot(indexPath),
  present: fs.existsSync(indexPath),
  readable: false,
  card_count: null,
  embedding_count: null,
};

if (!index.present) {
  addBlocker("visual_index_missing", null, `${index.path} does not exist`);
} else {
  try {
    db = new Database(indexPath, { readonly: true, fileMustExist: true });
    const tables = new Set(
      db
        .prepare("select name from sqlite_master where type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (!tables.has("card_hashes") || !tables.has("card_embeddings")) {
      addBlocker(
        "visual_index_schema_incomplete",
        null,
        "card_hashes and card_embeddings tables are required",
      );
    } else {
      index.readable = true;
      index.card_count = db.prepare("select count(*) as count from card_hashes").get().count;
      index.embedding_count = db
        .prepare("select count(*) as count from card_embeddings")
        .get().count;
      lookupExpectedCard = db.prepare(`
        select
          h.id,
          h.name,
          h.set_id,
          h.set_name,
          h.local_id,
          h.lang,
          h.image,
          h.hash,
          case when e.id is null then 0 else 1 end as has_embedding,
          length(e.embedding) as embedding_bytes
        from card_hashes h
        left join card_embeddings e on e.id = h.id
        where lower(h.id) = lower(?)
        order by h.id
      `);
    }
  } catch (error) {
    addBlocker("visual_index_unreadable", null, String(error?.message ?? error));
  }
}

const seenFixtureNames = new Set();
const fixtures = manifestFixtures.map((fixture, position) => {
  const fixtureName = typeof fixture?.fixture === "string" ? fixture.fixture.trim() : "";
  const reportName = fixtureName || `<manifest entry ${position}>`;
  const imageRequired = fixture?.imageRequired !== false;
  const expectedIdRequired =
    typeof fixture?.expectedCardIdRequired === "boolean"
      ? fixture.expectedCardIdRequired
      : fixture?.expectUncertain !== true;
  const expectedCardId =
    typeof fixture?.expectedCardId === "string" && fixture.expectedCardId.trim()
      ? fixture.expectedCardId.trim()
      : null;
  const declaredOcrNameExpectations = Array.isArray(fixture?.ocrExpect?.nameIncludes)
    ? fixture.ocrExpect.nameIncludes.filter(
        (value) => typeof value === "string" && value.trim(),
      )
    : [];
  const declaredOcrCollectorExpectation =
    typeof fixture?.ocrExpect?.collectorPrimary === "string" &&
    fixture.ocrExpect.collectorPrimary.trim()
      ? fixture.ocrExpect.collectorPrimary.trim()
      : null;
  const declaredOcrScriptHint =
    typeof fixture?.ocrExpect?.scriptHint === "string" &&
    fixture.ocrExpect.scriptHint.trim()
      ? fixture.ocrExpect.scriptHint.trim()
      : null;
  const declaredOcrLanguageExpectation = languageFromOcrScriptHint(
    declaredOcrScriptHint,
  );
  const fixturePath = fixtureName ? path.resolve(fixturesDir, fixtureName) : fixturesDir;
  const fixtureInsideDirectory =
    fixturePath === fixturesDir || fixturePath.startsWith(`${fixturesDir}${path.sep}`);
  const imagePresent =
    Boolean(fixtureName) && fixtureInsideDirectory && fs.existsSync(fixturePath);
  const imageBytes = imagePresent ? fs.statSync(fixturePath).size : null;
  const fixtureShaDeclared = Object.prototype.hasOwnProperty.call(fixture ?? {}, "sha256");
  const expectedFixtureSha = normalizedSha256(fixture?.sha256);
  let observedFixtureSha = null;

  if (fixtureShaDeclared && !expectedFixtureSha) {
    addError(
      "fixture_sha256_invalid",
      "sha256 must be a 64-character hexadecimal digest",
      reportName,
    );
  }
  if (imagePresent) {
    try {
      observedFixtureSha = sha256File(fixturePath);
    } catch (error) {
      addError(
        "fixture_sha256_unreadable",
        String(error?.message ?? error),
        reportName,
      );
    }
  }
  if (
    expectedFixtureSha &&
    observedFixtureSha &&
    expectedFixtureSha !== observedFixtureSha
  ) {
    addBlocker(
      "fixture_sha256_mismatch",
      reportName,
      `expected ${expectedFixtureSha}; observed ${observedFixtureSha}`,
    );
  }

  if (!fixtureName) {
    addBlocker("fixture_name_missing", reportName, "fixture must be a non-empty path");
  } else if (!fixtureInsideDirectory) {
    addBlocker(
      "fixture_path_outside_directory",
      reportName,
      "fixture paths must remain under data/scan-fixtures",
    );
  } else if (seenFixtureNames.has(fixtureName.toLocaleLowerCase())) {
    addBlocker("fixture_duplicate", reportName, "fixture path is declared more than once");
  } else {
    seenFixtureNames.add(fixtureName.toLocaleLowerCase());
  }

  if (imageRequired && !imagePresent) {
    addBlocker("fixture_binary_missing", reportName, "required image binary is absent");
  }
  if (expectedIdRequired && !expectedCardId) {
    addBlocker(
      "expected_card_id_missing",
      reportName,
      "identity-scored fixture has no expectedCardId",
    );
  }

  let expectedCard = null;
  let expectationStatus = expectedCardId ? "INDEX_UNAVAILABLE" : "NOT_DECLARED";
  let checks = {
    id_case_insensitive_match: null,
    metadata_complete: null,
    language_match: null,
    collector_number_match: null,
    set_id_match: null,
    name_match: null,
    hash_present: null,
    embedding_present: null,
    embedding_bytes: null,
  };

  if (expectedCardId && lookupExpectedCard) {
    const matches = lookupExpectedCard.all(expectedCardId);
    if (matches.length === 0) {
      expectationStatus = "NOT_FOUND";
      addBlocker(
        "expected_card_not_in_visual_index",
        reportName,
        `${expectedCardId} was not found (case-insensitive)`,
      );
    } else if (matches.length > 1) {
      expectationStatus = "AMBIGUOUS";
      addBlocker(
        "expected_card_id_ambiguous",
        reportName,
        `${expectedCardId} matched ${matches.length} case-insensitive rows`,
      );
    } else {
      const row = matches[0];
      const requiredMetadata = [
        row.id,
        row.name,
        row.set_id,
        row.set_name,
        row.local_id,
        row.lang,
        row.image,
      ];
      const expectedCollectorNumber =
        fixture.expectedCollectorNumber ?? fixture.ocrExpect?.collectorPrimary ?? null;
      const expectedSetId = fixture.expectedSetId ?? null;
      const expectedName = fixture.expectedNameIncludes ?? null;
      checks = {
        id_case_insensitive_match: normalizedText(row.id) === normalizedText(expectedCardId),
        metadata_complete: requiredMetadata.every(
          (value) => typeof value === "string" && value.trim().length > 0,
        ),
        language_match: fixture.expectedLanguage
          ? normalizedText(row.lang) === normalizedText(fixture.expectedLanguage)
          : null,
        collector_number_match: expectedCollectorNumber
          ? normalizedCollector(row.local_id) === normalizedCollector(expectedCollectorNumber)
          : null,
        set_id_match: expectedSetId
          ? normalizedText(row.set_id) === normalizedText(expectedSetId)
          : null,
        name_match: expectedName
          ? normalizedText(row.name).includes(normalizedText(expectedName))
          : null,
        hash_present: /^\d+$/.test(String(row.hash ?? "")),
        embedding_present: Boolean(row.has_embedding),
        embedding_bytes: row.embedding_bytes ?? null,
      };
      expectedCard = {
        id: row.id,
        name: row.name,
        set_id: row.set_id,
        set_name: row.set_name,
        collector_number: row.local_id,
        language: row.lang,
        image: row.image,
        hash: row.hash,
        embedding_bytes: row.embedding_bytes ?? null,
      };

      const failedChecks = Object.entries(checks)
        .filter(([key, value]) => key !== "embedding_bytes" && value === false)
        .map(([key]) => key);
      if (checks.embedding_bytes !== 512) failedChecks.push("embedding_bytes");
      if (failedChecks.length) {
        expectationStatus = "INVALID";
        addBlocker(
          "expected_card_index_metadata_invalid",
          reportName,
          `${expectedCardId}: ${failedChecks.join(", ")}`,
        );
      } else {
        expectationStatus = "VERIFIED";
      }
    }
  }

  const sidecarResult =
    fixtureName && fixtureInsideDirectory
      ? readDebugSidecar(reportName, fixturePath)
      : {
          metadata: {
            path: null,
            present: false,
            valid: false,
            bytes: null,
            format: null,
            freshness: {
              required: runtimeFingerprintRequired,
              status: "NO_SIDECAR",
              current: currentRuntimeFingerprint?.digest ?? null,
              observed: null,
            },
          },
          report: null,
          durationMs: null,
          unavailableReason: "scan_debug_sidecar_invalid",
        };
  let observed = emptyObserved(
    !imagePresent
      ? "fixture_binary_missing"
      : sidecarResult.unavailableReason ?? "scan_debug_sidecar_missing_or_invalid",
    sidecarResult.metadata,
  );

  if (sidecarResult.report) {
    const debugReport = sidecarResult.report;
    const ranking = debugReport.finalRanking;
    const topThree = ranking.slice(0, 3);
    const top = topThree[0] ?? null;
    const expectedNames = [
      ...(typeof fixture.expectedNameIncludes === "string"
        ? [fixture.expectedNameIncludes]
        : []),
      ...(Array.isArray(fixture.ocrExpect?.nameIncludes)
        ? fixture.ocrExpect.nameIncludes
        : []),
    ].filter((value) => typeof value === "string" && value.trim());
    const ocrText = debugReport.ocrSlices
      .map((slice) => slice?.normalizedText ?? slice?.text ?? "")
      .join(" ");
    const normalizedOcrText = normalizedSearchText(ocrText);
    const matchedNameExpectation =
      expectedNames.find((name) =>
        normalizedOcrText.includes(normalizedSearchText(name)),
      ) ?? null;
    const matchedDeclaredOcrName =
      declaredOcrNameExpectations.find((name) =>
        normalizedOcrText.includes(normalizedSearchText(name)),
      ) ?? null;
    const nameSuccess = expectedNames.length
      ? matchedNameExpectation !== null
      : null;
    const collectorExpectation =
      fixture.expectedCollectorNumber ?? fixture.ocrExpect?.collectorPrimary ?? null;
    const observedCollectorNumbers = [
      ...new Set(
        debugReport.ocrSlices
          .map((slice) => normalizedCollector(slice?.parsedCollector?.primary))
          .filter(Boolean),
      ),
    ];
    const collectorSuccess = collectorExpectation
      ? observedCollectorNumbers.includes(normalizedCollector(collectorExpectation))
      : null;
    const inferredLanguage = inferOcrLanguage(debugReport.ocrSlices);
    const languageSuccess = fixture.expectedLanguage
      ? normalizedText(inferredLanguage) === normalizedText(fixture.expectedLanguage)
      : null;
    const declaredOcrCollectorSuccess = declaredOcrCollectorExpectation
      ? observedCollectorNumbers.includes(
          normalizedCollector(declaredOcrCollectorExpectation),
        )
      : null;
    const declaredOcrLanguageSuccess = declaredOcrLanguageExpectation
      ? normalizedText(inferredLanguage) ===
        normalizedText(declaredOcrLanguageExpectation)
      : null;
    const observedQuad = normalizeQuad(debugReport.geometry.quad);
    const cornerRmse = fixture.expectedQuad
      ? quadCornerRmse(observedQuad, fixture.expectedQuad)
      : null;
    const maximumCornerError = finiteNumber(fixture.maximumCornerError);
    const uncertain = reportUncertain(debugReport, fixture);

    observed = {
      status: "MEASURED",
      reason: null,
      sidecar: sidecarResult.metadata,
      scan_id: typeof debugReport.scanId === "string" ? debugReport.scanId : null,
      captured_at:
        typeof debugReport.createdAt === "string" ? debugReport.createdAt : null,
      classification: {
        input_type: debugReport.classification.inputType ?? null,
        full_bleed_score: finiteNumber(debugReport.classification.fullBleedScore),
        camera_photo_score: finiteNumber(debugReport.classification.cameraPhotoScore),
      },
      top1: top
        ? {
            card_id: candidateCardId(top),
            slug: typeof top.slug === "string" ? top.slug : null,
            score: candidateScore(top),
            expected_match: expectedCardId
              ? candidateMatchesExpected(top, expectedCardId)
              : null,
          }
        : {
            card_id: null,
            slug: null,
            score: null,
            expected_match: expectedCardId ? false : null,
          },
      top3: {
        card_ids: topThree.map(candidateCardId),
        expected_match: expectedCardId
          ? topThree.some((candidate) => candidateMatchesExpected(candidate, expectedCardId))
          : null,
      },
      geometry: {
        auto_detected: Boolean(debugReport.geometry.autoDetected),
        quad: observedQuad,
        corner_rmse_normalized: cornerRmse,
        maximum_corner_error: maximumCornerError,
        corner_threshold_pass:
          cornerRmse !== null && maximumCornerError !== null
            ? cornerRmse <= maximumCornerError
            : null,
        crop_confidence: finiteNumber(debugReport.geometry.cropConfidence),
        coverage_ratio: finiteNumber(debugReport.geometry.coverageRatio),
        sharpness_score: finiteNumber(debugReport.geometry.sharpnessScore),
      },
      ocr: {
        slice_count: debugReport.ocrSlices.length,
        name_expectations: expectedNames,
        name_matched_expectation: matchedNameExpectation,
        name_success: nameSuccess,
        collector_expectation: collectorExpectation,
        collector_observed: observedCollectorNumbers,
        collector_success: collectorSuccess,
        inferred_language: inferredLanguage,
        expected_language: fixture.expectedLanguage ?? null,
        language_success: languageSuccess,
        declared_name_matched_expectation: matchedDeclaredOcrName,
        declared_collector_success: declaredOcrCollectorSuccess,
        declared_language_success: declaredOcrLanguageSuccess,
      },
      uncertain_or_rejected: uncertain,
      rejected: ranking.length === 0,
      expected_uncertain_pass:
        fixture.expectUncertain === true ? uncertain : null,
      duration_ms: sidecarResult.durationMs,
    };
  }

  return {
    fixture: reportName,
    group: fixture?.group ?? null,
    declared: {
      required_regression:
        typeof fixture?.requiredRegression === "string" &&
        fixture.requiredRegression.trim()
          ? fixture.requiredRegression.trim()
          : null,
      minimum_top1_score: finiteNumber(fixture?.minimumTop1Score),
      expected_input_type:
        typeof fixture?.expectedInputType === "string" &&
        fixture.expectedInputType.trim()
          ? fixture.expectedInputType.trim()
          : null,
      ocr_expect: {
        name_includes: declaredOcrNameExpectations,
        collector_primary: declaredOcrCollectorExpectation,
        script_hint: declaredOcrScriptHint,
        expected_language: declaredOcrLanguageExpectation,
      },
      must_auto_detect:
        typeof fixture?.mustAutoDetect === "boolean" ? fixture.mustAutoDetect : null,
      expect_uncertain: fixture?.expectUncertain === true,
      synthetic: fixture?.synthetic === true,
    },
    image: {
      path: fixtureName ? relativeToRoot(fixturePath) : null,
      required: imageRequired,
      present: imagePresent,
      bytes: imageBytes,
      sha256: {
        expected: expectedFixtureSha,
        observed: observedFixtureSha,
        match:
          expectedFixtureSha && observedFixtureSha
            ? expectedFixtureSha === observedFixtureSha
            : null,
      },
    },
    expectation: {
      expected_card_id_required: expectedIdRequired,
      expected_card_id: expectedCardId,
      status: expectationStatus,
      checks,
      index_card: expectedCard,
    },
    observed,
  };
});

if (db) db.close();

const measuredFixtures = fixtures.filter((fixture) => fixture.observed.status === "MEASURED");
const identityFixtures = measuredFixtures.filter(
  (fixture) => fixture.expectation.expected_card_id,
);
const top1Passed = identityFixtures.filter(
  (fixture) => fixture.observed.top1.expected_match === true,
).length;
const top3Passed = identityFixtures.filter(
  (fixture) => fixture.observed.top3.expected_match === true,
).length;
const autoDetectionFixtures = measuredFixtures.filter(
  (fixture) => fixture.declared.must_auto_detect === true,
);
const autoDetected = autoDetectionFixtures.filter(
  (fixture) => fixture.observed.geometry.auto_detected,
).length;
const cornerFixtures = measuredFixtures.filter(
  (fixture) => fixture.observed.geometry.corner_rmse_normalized !== null,
);
const cornerThresholdFixtures = cornerFixtures.filter(
  (fixture) => fixture.observed.geometry.corner_threshold_pass !== null,
);
const cornerThresholdPassed = cornerThresholdFixtures.filter(
  (fixture) => fixture.observed.geometry.corner_threshold_pass,
).length;
const digitalFixtures = measuredFixtures.filter(
  (fixture) =>
    fixture.declared.must_auto_detect === false &&
    /digital/i.test(String(fixture.group ?? "")),
);
const falseDigitalCutouts = digitalFixtures.filter(
  (fixture) => fixture.observed.geometry.auto_detected,
).length;
const nameFixtures = measuredFixtures.filter(
  (fixture) => fixture.observed.ocr.name_success !== null,
);
const collectorFixtures = measuredFixtures.filter(
  (fixture) => fixture.observed.ocr.collector_success !== null,
);
const languageFixtures = measuredFixtures.filter(
  (fixture) => fixture.observed.ocr.language_success !== null,
);
const uncertainFixtures = measuredFixtures.filter(
  (fixture) => fixture.observed.uncertain_or_rejected,
);
const rejectedFixtures = measuredFixtures.filter((fixture) => fixture.observed.rejected);

const metrics = measuredFixtures.length
  ? {
      top1_accuracy: ratio(top1Passed, identityFixtures.length),
      top3_accuracy: ratio(top3Passed, identityFixtures.length),
      geometry: {
        auto_detection_rate: ratio(autoDetected, autoDetectionFixtures.length),
        corner_rmse_normalized: mean(
          cornerFixtures.map((fixture) => fixture.observed.geometry.corner_rmse_normalized),
        ),
        // Backward-compatible alias retained for the manifest's corner_error name.
        corner_error: mean(
          cornerFixtures.map((fixture) => fixture.observed.geometry.corner_rmse_normalized),
        ),
        corner_threshold_pass_rate: ratio(
          cornerThresholdPassed,
          cornerThresholdFixtures.length,
        ),
        false_auto_cutout_on_digital: ratio(
          falseDigitalCutouts,
          digitalFixtures.length,
        ),
        mean_crop_confidence: mean(
          measuredFixtures.map((fixture) => fixture.observed.geometry.crop_confidence),
        ),
      },
      ocr: {
        name_accuracy: ratio(
          nameFixtures.filter((fixture) => fixture.observed.ocr.name_success).length,
          nameFixtures.length,
        ),
        collector_number_accuracy: ratio(
          collectorFixtures.filter(
            (fixture) => fixture.observed.ocr.collector_success,
          ).length,
          collectorFixtures.length,
        ),
        language_accuracy: ratio(
          languageFixtures.filter(
            (fixture) => fixture.observed.ocr.language_success,
          ).length,
          languageFixtures.length,
        ),
      },
      average_scan_time_ms: mean(
        measuredFixtures.map((fixture) => fixture.observed.duration_ms),
      ),
      uncertain_rate: ratio(uncertainFixtures.length, measuredFixtures.length),
    }
  : emptyMetrics();

const metricCounts = {
  top1: { passed: top1Passed, measured: identityFixtures.length },
  top3: { passed: top3Passed, measured: identityFixtures.length },
  auto_detection: { passed: autoDetected, measured: autoDetectionFixtures.length },
  corner_error: { measured: cornerFixtures.length },
  corner_threshold: {
    passed: cornerThresholdPassed,
    measured: cornerThresholdFixtures.length,
  },
  false_auto_cutout_on_digital: {
    false_cutouts: falseDigitalCutouts,
    measured: digitalFixtures.length,
  },
  crop_confidence: {
    measured: measuredFixtures.filter(
      (fixture) => fixture.observed.geometry.crop_confidence !== null,
    ).length,
  },
  ocr_name: {
    passed: nameFixtures.filter((fixture) => fixture.observed.ocr.name_success).length,
    measured: nameFixtures.length,
  },
  ocr_collector_number: {
    passed: collectorFixtures.filter(
      (fixture) => fixture.observed.ocr.collector_success,
    ).length,
    measured: collectorFixtures.length,
  },
  ocr_language: {
    passed: languageFixtures.filter(
      (fixture) => fixture.observed.ocr.language_success,
    ).length,
    measured: languageFixtures.length,
  },
  duration: {
    measured: measuredFixtures.filter(
      (fixture) => fixture.observed.duration_ms !== null,
    ).length,
  },
  uncertain_or_rejected: {
    count: uncertainFixtures.length,
    rejected: rejectedFixtures.length,
    measured: measuredFixtures.length,
  },
};

function regressionGate(gate, expected, observed, passed) {
  return {
    gate,
    status: passed ? "PASS" : "FAIL",
    expected,
    observed,
  };
}

function regressionResult(regressionKey) {
  const matches = fixtures.filter(
    (entry) => entry.declared.required_regression === regressionKey,
  );
  const fixture = matches.length === 1 ? matches[0] : null;

  if (matches.length !== 1) {
    addError(
      "required_regression_manifest_invalid",
      `${regressionKey} must be declared by exactly one fixture; found ${matches.length}`,
    );
  }

  if (!fixture || fixture.observed.status !== "MEASURED") {
    return {
      fixture: fixture?.fixture ?? null,
      measurement_status: fixture?.observed.status ?? "NOT_DECLARED",
      status: "UNMEASURED",
      expected_card_id: fixture?.expectation.expected_card_id ?? null,
      observed_card_id: null,
      top1_score: null,
      gates: [],
      failed_gates: [],
    };
  }

  const gates = [];
  gates.push(
    regressionGate(
      "top1_identity",
      fixture.expectation.expected_card_id,
      fixture.observed.top1.card_id,
      fixture.observed.top1.expected_match === true,
    ),
  );

  if (fixture.declared.minimum_top1_score !== null) {
    const score = fixture.observed.top1.score;
    gates.push(
      regressionGate(
        "minimum_top1_score",
        `>= ${fixture.declared.minimum_top1_score}`,
        score,
        score !== null && score >= fixture.declared.minimum_top1_score,
      ),
    );
  }

  if (fixture.declared.expected_input_type) {
    gates.push(
      regressionGate(
        "input_classification",
        fixture.declared.expected_input_type,
        fixture.observed.classification.input_type,
        normalizedText(fixture.observed.classification.input_type) ===
          normalizedText(fixture.declared.expected_input_type),
      ),
    );
  }

  if (fixture.declared.must_auto_detect !== null) {
    const gate = fixture.declared.must_auto_detect
      ? "auto_detection"
      : "no_false_auto_crop";
    gates.push(
      regressionGate(
        gate,
        fixture.declared.must_auto_detect,
        fixture.observed.geometry.auto_detected,
        fixture.observed.geometry.auto_detected ===
          fixture.declared.must_auto_detect,
      ),
    );
  }

  if (fixture.observed.geometry.maximum_corner_error !== null) {
    gates.push(
      regressionGate(
        "maximum_corner_rmse",
        `<= ${fixture.observed.geometry.maximum_corner_error}`,
        fixture.observed.geometry.corner_rmse_normalized,
        fixture.observed.geometry.corner_threshold_pass === true,
      ),
    );
  }

  if (fixture.declared.ocr_expect.expected_language) {
    gates.push(
      regressionGate(
        "ocr_language",
        fixture.declared.ocr_expect.expected_language,
        fixture.observed.ocr.inferred_language,
        fixture.observed.ocr.declared_language_success === true,
      ),
    );
  }

  if (fixture.declared.ocr_expect.collector_primary) {
    gates.push(
      regressionGate(
        "ocr_collector_number",
        fixture.declared.ocr_expect.collector_primary,
        fixture.observed.ocr.collector_observed,
        fixture.observed.ocr.declared_collector_success === true,
      ),
    );
  }

  if (fixture.declared.ocr_expect.name_includes.length) {
    gates.push(
      regressionGate(
        "ocr_name",
        fixture.declared.ocr_expect.name_includes,
        fixture.observed.ocr.declared_name_matched_expectation,
        fixture.observed.ocr.declared_name_matched_expectation !== null,
      ),
    );
  }

  const failedGates = gates
    .filter((gate) => gate.status === "FAIL")
    .map((gate) => gate.gate);
  return {
    fixture: fixture.fixture,
    measurement_status: fixture.observed.status,
    status: failedGates.length ? "FAIL" : "PASS",
    expected_card_id: fixture.expectation.expected_card_id,
    observed_card_id: fixture.observed.top1.card_id,
    top1_score: fixture.observed.top1.score,
    gates,
    failed_gates: failedGates,
  };
}

const requiredRegressions = Object.fromEntries(
  requiredRegressionKeys.map((key) => [key, regressionResult(key)]),
);
const requiredRegressionResults = Object.values(requiredRegressions);
const requiredRegressionMeasured = requiredRegressionResults.filter(
  (result) => result.measurement_status === "MEASURED",
).length;
const requiredRegressionPassed = requiredRegressionResults.filter(
  (result) => result.status === "PASS",
).length;
const requiredRegressionFailed = requiredRegressionResults.filter(
  (result) => result.status === "FAIL",
).length;
const requiredRegressionDeclared = fixtures.filter((fixture) =>
  requiredRegressionKeys.includes(fixture.declared.required_regression),
).length;
const regressionStatus =
  requiredRegressionMeasured !== requiredRegressionResults.length
    ? "NOT_FULLY_MEASURED"
    : requiredRegressionFailed
      ? "FAIL"
      : "PASS";

const verifiedExpectations = fixtures.filter(
  (fixture) => fixture.expectation.status === "VERIFIED",
).length;
const missingBinaries = fixtures.filter(
  (fixture) => fixture.image.required && !fixture.image.present,
).length;
const missingExpectedIds = fixtures.filter(
  (fixture) =>
    fixture.expectation.expected_card_id_required &&
    !fixture.expectation.expected_card_id,
).length;
const missingSidecars = fixtures.filter(
  (fixture) => !fixture.observed.sidecar?.present,
).length;
const invalidSidecars = fixtures.filter(
  (fixture) =>
    fixture.observed.sidecar?.present && !fixture.observed.sidecar?.valid,
).length;
const currentSidecars = fixtures.filter(
  (fixture) => fixture.observed.sidecar?.freshness?.status === "CURRENT",
).length;
const staleSidecars = fixtures.filter(
  (fixture) => fixture.observed.sidecar?.freshness?.status === "STALE",
).length;
const unverifiedSidecars = fixtures.filter((fixture) =>
  ["MISSING", "UNVERIFIED_BARE_REPORT", "CURRENT_UNAVAILABLE"].includes(
    fixture.observed.sidecar?.freshness?.status,
  ),
).length;
const fixtureShaDeclared = fixtures.filter(
  (fixture) => fixture.image.sha256.expected !== null,
).length;
const fixtureShaVerified = fixtures.filter(
  (fixture) => fixture.image.sha256.match === true,
).length;
const fixtureShaMismatched = fixtures.filter(
  (fixture) => fixture.image.sha256.match === false,
).length;

const status = errors.length ? "FAILED" : blockers.length ? "BLOCKED" : "MEASURED";
const accuracyClaim =
  measuredFixtures.length === 0
    ? "NOT_MEASURED"
    : measuredFixtures.length === fixtures.length
      ? "MEASURED_FROM_SCAN_DEBUG_SIDECARS"
      : "PARTIALLY_MEASURED";
const report = {
  schema_version: 2,
  generated_at: new Date().toISOString(),
  status,
  measurement_status: status,
  regression_status: regressionStatus,
  accuracy_claim: accuracyClaim,
  note:
    measuredFixtures.length === fixtures.length && fixtures.length > 0
      ? "All declared fixtures have valid, runtime-current browser scan-debug sidecars. MEASURED describes evidence completeness, not regression success; see regression_status and required_regressions."
      : "Missing, invalid, stale, or unverified scan-debug sidecars remain unmeasured. Recapture each affected fixture with the current scanner runtime before claiming suite accuracy.",
  definitions: {
    sidecar: "data/scan-fixtures/<fixture filename>.scan-debug.json; verified evidence is an envelope containing runtimeFingerprint and report. Bare reports remain parse-compatible but unverified and blocked.",
    runtime_fingerprint: "SHA-256 over sorted scanner runtime source paths and bytes with deterministic length framing.",
    top_accuracy: "Case-insensitive expected card ID in finalRanking position 1 or positions 1-3; non-card controls are excluded.",
    corner_rmse_normalized: "Best cyclic/reversed alignment, sqrt(mean((dx^2 + dy^2))) across four normalized corners.",
    false_auto_cutout_on_digital: "geometry.autoDetected on a measured *digital* fixture whose manifest declares mustAutoDetect=false.",
    ocr_name: "Any declared expectedNameIncludes/ocrExpect.nameIncludes occurs in OCR slice text after Unicode alphanumeric normalization.",
    ocr_collector: "Any OCR slice parsedCollector.primary equals the declared collector number after leading-zero normalization.",
    ocr_language: "Japanese if OCR contains Han/Hiragana/Katakana, otherwise English if it contains Latin letters; no script is a failed inference.",
    uncertain_or_rejected: "Empty finalRanking, missing/low top score (< fixture minimumTop1Score or 0.8), or an explicit uncertainty/rejection note.",
    regression_status: "PASS only when every required regression is runtime-current and passes every declared identity, score, classification, geometry, and OCR gate. Measurement status is independent of gate success.",
    regression_ocr_gates: "Required-regression OCR gates come only from manifest ocrExpect fields. General expectedLanguage, expectedCollectorNumber, and expectedNameIncludes remain identity/metric metadata and do not create strict OCR gates.",
  },
  manifest: {
    path: relativeToRoot(manifestPath),
    version: manifest?.version ?? null,
    fixture_count: fixtures.length,
    runtime_fingerprint_required: runtimeFingerprintRequired,
  },
  runtime_integrity: {
    schema_version: currentRuntimeFingerprint?.schemaVersion ?? 1,
    algorithm: currentRuntimeFingerprint?.algorithm ?? "sha256",
    current_fingerprint: currentRuntimeFingerprint?.digest ?? null,
    source_file_count: currentRuntimeFingerprint?.files.length ?? null,
    source_files: currentRuntimeFingerprint?.files ?? [],
  },
  index,
  summary: {
    fixtures_declared: fixtures.length,
    fixtures_measured: measuredFixtures.length,
    required_binaries_missing: missingBinaries,
    scan_debug_sidecars_missing: missingSidecars,
    scan_debug_sidecars_invalid: invalidSidecars,
    scan_debug_sidecars_current: currentSidecars,
    scan_debug_sidecars_stale: staleSidecars,
    scan_debug_sidecars_unverified: unverifiedSidecars,
    fixture_sha256_declared: fixtureShaDeclared,
    fixture_sha256_verified: fixtureShaVerified,
    fixture_sha256_mismatched: fixtureShaMismatched,
    required_expected_ids_missing: missingExpectedIds,
    expected_index_records_verified: verifiedExpectations,
    required_regressions_expected: requiredRegressionResults.length,
    required_regressions_declared: requiredRegressionDeclared,
    required_regressions_measured: requiredRegressionMeasured,
    required_regressions_passed: requiredRegressionPassed,
    required_regressions_failed: requiredRegressionFailed,
    blocker_count: blockers.length,
    error_count: errors.length,
  },
  required_regressions: requiredRegressions,
  metrics,
  metric_counts: metricCounts,
  blockers,
  errors,
  fixtures,
};

const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
let outputWriteFailed = false;

if (outputPath) {
  try {
    fs.writeFileSync(outputPath, serializedReport, "utf8");
  } catch (error) {
    outputWriteFailed = true;
    process.stderr.write(
      `Could not write scan benchmark output to ${outputPath}: ${String(error?.message ?? error)}\n`,
    );
  }
}

process.stdout.write(serializedReport);

if (outputWriteFailed || status === "FAILED") {
  process.exitCode = 1;
} else if (status === "BLOCKED" && !allowBlocked) {
  process.exitCode = 2;
} else if (status === "MEASURED" && regressionStatus === "FAIL") {
  process.exitCode = 3;
}
