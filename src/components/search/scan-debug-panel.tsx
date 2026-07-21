"use client";

/* eslint-disable @next/next/no-img-element -- debug previews may be data/blob URLs */

import {
  isScanDebugEnabled,
  sanitizeScanDebugReport,
  type ScanDebugImageVariantKey,
  type ScanDebugReport,
} from "@/lib/scan/scan-debug";

export interface ScanDebugPanelProps {
  report: ScanDebugReport | null;
}

const IMAGE_ORDER: ScanDebugImageVariantKey[] = [
  "original",
  "quadOverlay",
  "rectified",
  "expanded",
  "contracted",
  "legacy",
];

function formatScore(score: number | null) {
  return score == null ? "n/a" : score.toFixed(3);
}

export function ScanDebugPanel({ report }: ScanDebugPanelProps) {
  if (!isScanDebugEnabled()) return null;

  const variants = report
    ? IMAGE_ORDER.flatMap((key) => {
        const variant = report.imageVariants[key];
        return variant ? [{ key, ...variant }] : [];
      })
    : [];

  return (
    <details
      style={{
        marginTop: "0.75rem",
        border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
        borderRadius: "0.65rem",
        background: "color-mix(in srgb, Canvas 94%, transparent)",
        color: "CanvasText",
        fontSize: "0.75rem",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "0.65rem 0.75rem",
          fontWeight: 700,
          userSelect: "none",
        }}
      >
        Scan debug
        {report ? ` · ${report.classification.inputType} · ${report.scanId}` : " · no report"}
      </summary>

      <div style={{ display: "grid", gap: "0.75rem", padding: "0 0.75rem 0.75rem" }}>
        {!report ? (
          <p style={{ margin: 0, opacity: 0.72 }}>
            No scan diagnostics have been published for this view.
          </p>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem 0.9rem",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span>full bleed {formatScore(report.classification.fullBleedScore)}</span>
              <span>camera {formatScore(report.classification.cameraPhotoScore)}</span>
              <span>crop {formatScore(report.geometry.cropConfidence)}</span>
              <span>OCR slices {report.ocrSlices.length}</span>
              <span>ranked {report.finalRanking.length}</span>
              <span>
                elapsed {report.durationMs == null ? "n/a" : `${Math.round(report.durationMs)} ms`}
              </span>
            </div>

            {variants.length ? (
              <div
                aria-label="Scan image variants"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(7rem, 1fr))",
                  gap: "0.55rem",
                }}
              >
                {variants.map((variant) => (
                  <figure key={variant.key} style={{ margin: 0, minWidth: 0 }}>
                    <img
                      src={variant.src}
                      alt={variant.label}
                      style={{
                        display: "block",
                        width: "100%",
                        maxHeight: "10rem",
                        objectFit: "contain",
                        borderRadius: "0.4rem",
                        background: "#111",
                      }}
                    />
                    <figcaption
                      style={{
                        marginTop: "0.25rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {variant.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, opacity: 0.72 }}>No intermediate images attached.</p>
            )}

            <pre
              aria-label="Sanitized scan debug JSON"
              style={{
                margin: 0,
                maxHeight: "26rem",
                overflow: "auto",
                borderRadius: "0.45rem",
                background: "#111",
                color: "#e8e8e8",
                padding: "0.65rem",
                fontSize: "0.68rem",
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(sanitizeScanDebugReport(report), null, 2)}
            </pre>
          </>
        )}
      </div>
    </details>
  );
}

export default ScanDebugPanel;
