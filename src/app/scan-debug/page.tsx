import { notFound } from "next/navigation";

import { ScanButton } from "@/components/search/scan-button";

/**
 * Development-only scanner harness. It mounts the production scanner without
 * waiting for the search page's remote catalog query, which keeps fixture runs
 * deterministic when the upstream search service is offline or slow.
 */
export default function ScanDebugPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <>
      <style>{`
        html .app-shell--booting { opacity: 1; }
        html .app-boot-splash { display: none; }
      `}</style>
      <main className="min-h-screen bg-black p-6 text-white">
        <h1 className="sr-only">Scanner fixture harness</h1>
        <ScanButton startOpen />
      </main>
    </>
  );
}
