"use client";

import { useState, useTransition } from "react";

import { addLocalCorrection } from "@/lib/corrections-store";

export function CardCorrectionPanel({ slug }: { slug: string }) {
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

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <p className="text-sm font-semibold text-white">Help the database learn</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">
        If this card or price looks wrong, flag it. Popular flags are prioritized for automatic
        re-checks and accuracy improvements.
      </p>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional details (expected price, correct set, etc.)"
        className="mt-3 min-h-20 w-full rounded-2xl border border-white/10 bg-[#050816] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-yellow-300/50"
      />
      <div className="mt-3 flex flex-wrap gap-2">
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
      {message ? <p className="mt-3 text-xs font-medium text-emerald-200">{message}</p> : null}
    </section>
  );
}
