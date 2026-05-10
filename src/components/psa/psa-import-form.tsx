"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { saveManualPsaPopulationSnapshot } from "@/lib/manual-psa-pop-store";
import {
  createManualPsaPopulationSnapshot,
  parsePsaPopulationInput,
} from "@/lib/psa-population";

export function PsaImportForm({
  card,
}: {
  card: {
    id: string;
    name: string;
    collectorNumber: string;
    setName: string;
  } | null;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [pastedInput, setPastedInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedValues, setParsedValues] = useState<{
    psa9: number;
    psa10: number;
    totalCertified: number;
    matchedLine?: string;
  } | null>(null);
  const [manualValues, setManualValues] = useState({
    psa9: "",
    psa10: "",
    totalCertified: "",
  });
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const manualNumbers = useMemo(() => {
    const psa9 = Number.parseInt(manualValues.psa9, 10);
    const psa10 = Number.parseInt(manualValues.psa10, 10);
    const totalCertified = Number.parseInt(manualValues.totalCertified, 10);

    if (
      Number.isNaN(psa9) ||
      Number.isNaN(psa10) ||
      Number.isNaN(totalCertified) ||
      totalCertified < psa9 ||
      totalCertified < psa10
    ) {
      return null;
    }

    return { psa9, psa10, totalCertified };
  }, [manualValues]);

  if (!card) {
    return (
      <div className="glass-card rounded-3xl p-6">
        <h1 className="text-2xl font-semibold text-white">PSA Import</h1>
        <p className="mt-4 text-sm text-slate-300">
          Open a specific card first, then use the import link from that card
          page so this form knows which PSA row to parse.
        </p>
        <Link
          href="/search"
          className="mt-5 inline-flex rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
        >
          Find a card
        </Link>
      </div>
    );
  }

  const saveSnapshot = (values: {
    psa9: number;
    psa10: number;
    totalCertified: number;
  }) => {
    const snapshot = createManualPsaPopulationSnapshot({
      ...values,
      sourceUrl,
    });

    saveManualPsaPopulationSnapshot(card.id, snapshot);
    setSavedMessage("Saved manual PSA population snapshot for this card.");
  };

  return (
    <div className="space-y-6">
      <section className="glass-card rounded-3xl p-6">
        <p className="text-sm uppercase tracking-[0.24em] text-blue-200">Manual PSA Import</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">{card.name}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {card.setName} · #{card.collectorNumber}
        </p>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/4 p-4 text-sm text-slate-300">
          <p className="font-medium text-white">How to import</p>
          <ol className="mt-3 space-y-2">
            <li>1. Open the official PSA population page for this card manually.</li>
            <li>2. Copy the exact table row for the matching card.</li>
            <li>3. Paste it below and parse the row locally in your browser.</li>
            <li>4. If the parser misses, enter PSA 9, PSA 10, and Total manually.</li>
          </ol>
        </div>
      </section>

      <section className="glass-card rounded-3xl p-6">
        <label className="block text-sm font-medium text-white" htmlFor="psa-source-url">
          PSA page URL
        </label>
        <input
          id="psa-source-url"
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://www.psacard.com/pop/..."
          className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
        />

        <label className="mt-5 block text-sm font-medium text-white" htmlFor="psa-row-input">
          Pasted PSA row
        </label>
        <textarea
          id="psa-row-input"
          value={pastedInput}
          onChange={(event) => setPastedInput(event.target.value)}
          placeholder="Paste the copied row from the official PSA table here"
          rows={8}
          className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
        />

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              const result = parsePsaPopulationInput(pastedInput, card);

              if (!result.success) {
                setParsedValues(null);
                setParseError(result.error);
                setSavedMessage(null);
                return;
              }

              setParsedValues({
                ...result.parsed,
                matchedLine: result.matchedLine,
              });
              setParseError(null);
              setSavedMessage(null);
            }}
            className="rounded-2xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
          >
            Parse PSA row
          </button>
          {parsedValues ? (
            <button
              type="button"
              onClick={() => saveSnapshot(parsedValues)}
              className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20"
            >
              Save parsed snapshot
            </button>
          ) : null}
        </div>

        {parseError ? (
          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
            {parseError}
          </p>
        ) : null}

        {parsedValues ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="text-sm font-medium text-white">Parsed preview</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950 p-3">
                <p className="text-xs text-slate-400">PSA 9</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {parsedValues.psa9.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950 p-3">
                <p className="text-xs text-slate-400">PSA 10</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {parsedValues.psa10.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950 p-3">
                <p className="text-xs text-slate-400">Total</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {parsedValues.totalCertified.toLocaleString()}
                </p>
              </div>
            </div>
            {parsedValues.matchedLine ? (
              <p className="mt-4 text-xs text-slate-500">{parsedValues.matchedLine}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="glass-card rounded-3xl p-6">
        <p className="text-sm font-medium text-white">Manual fallback</p>
        <p className="mt-2 text-sm text-slate-400">
          Use this only if the parser cannot reliably read the copied PSA row.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <input
            type="number"
            min="0"
            value={manualValues.psa9}
            onChange={(event) =>
              setManualValues((current) => ({ ...current, psa9: event.target.value }))
            }
            placeholder="PSA 9"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <input
            type="number"
            min="0"
            value={manualValues.psa10}
            onChange={(event) =>
              setManualValues((current) => ({ ...current, psa10: event.target.value }))
            }
            placeholder="PSA 10"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <input
            type="number"
            min="0"
            value={manualValues.totalCertified}
            onChange={(event) =>
              setManualValues((current) => ({
                ...current,
                totalCertified: event.target.value,
              }))
            }
            placeholder="Total certified"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>
        <button
          type="button"
          disabled={!manualNumbers}
          onClick={() => manualNumbers && saveSnapshot(manualNumbers)}
          className="mt-4 rounded-2xl border border-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save manual snapshot
        </button>

        {savedMessage ? (
          <p className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
            {savedMessage}
          </p>
        ) : null}

        <Link
          href={`/cards/${card.id}`}
          className="mt-5 inline-flex rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:text-white"
        >
          Back to card
        </Link>
      </section>
    </div>
  );
}
