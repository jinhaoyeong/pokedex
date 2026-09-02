"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const LoadedScanButton = dynamic(
  () => import("@/components/search/scan-button").then((mod) => mod.ScanButton),
  {
    ssr: false,
    loading: () => (
      <button type="button" className="scan-trigger" disabled aria-label="Loading scanner">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="scan-trigger-label">Loading scanner</span>
      </button>
    ),
  },
);

function ScanIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
      />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

export function LazyScanButton() {
  const [activated, setActivated] = useState(false);

  if (activated) {
    return <LoadedScanButton startOpen />;
  }

  return (
    <button
      type="button"
      onClick={() => setActivated(true)}
      className="scan-trigger"
      aria-label="Scan a card"
    >
      <ScanIcon />
      <span className="scan-trigger-label">Scan a card</span>
    </button>
  );
}
