"use client";

import { useState, useTransition } from "react";

import { addLocalCorrection } from "@/lib/corrections-store";

export function CardCorrectionPanel({ slug }: { slug: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (field: "price" | "identity") => {
    startTransition(async () => {
      const createdAt = new Date().toISOString();

      addLocalCorrection({
        slug,
        field,
        note: note.trim() || undefined,
        createdAt,
      });

      await fetch("/api/card-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          field,
          note: note.trim() || undefined,
        }),
      }).catch(() => undefined);

      setMessage(
        field === "price"
          ? "Thanks — this price flag helps the database learn what to verify next."
          : "Thanks — this card identity flag was recorded for review.",
      );
      setNote("");
    });
  };

  const close = () => {
    setIsOpen(false);
    setMessage(null);
  };

  return (
    <>
      <div className="flex justify-center pt-2 sm:justify-end">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-yellow-200/35 hover:bg-white/[0.07] hover:text-white"
        >
          <span aria-hidden>✦</span>
          Help the database learn
        </button>
      </div>

      {isOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center"
          role="presentation"
          onClick={close}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-correction-title"
            className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#070b18] p-5 shadow-2xl shadow-blue-950/50 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p id="card-correction-title" className="text-base font-semibold text-white">
                  Help the database learn
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  If this card or price looks wrong, flag it. Popular flags are prioritized for
                  automatic re-checks and accuracy improvements.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-slate-300 hover:text-white"
              >
                Close
              </button>
            </div>

            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional details (expected price, correct set, etc.)"
              className="mt-4 min-h-24 w-full rounded-2xl border border-white/10 bg-[#050816] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-yellow-300/50"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => submit("price")}
                className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-60"
              >
                Wrong price?
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => submit("identity")}
                className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-60"
              >
                Wrong card?
              </button>
            </div>
            {message ? <p className="mt-3 text-sm font-medium text-emerald-200">{message}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
