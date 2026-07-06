"use client";

import { useActionState } from "react";

import {
  addCardAction,
  type AddCardActionState,
} from "@/app/portfolio/vault/actions";

const INITIAL_STATE: AddCardActionState = { ok: true, message: "" };

export function VaultAddCardForm() {
  const [state, formAction, pending] = useActionState(addCardAction, INITIAL_STATE);

  return (
    <form action={formAction} className="glass-card rounded-2xl p-5 sm:p-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)] sm:text-[11px]">
        Cloud vault
      </p>
      <h3 className="mt-1 text-lg font-semibold text-white">Add a card by slug</h3>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Card slug
          </span>
          <input
            name="slug"
            required
            placeholder="e.g. base-set-charizard-4"
            className="form-input"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Card name
          </span>
          <input name="name" required placeholder="Charizard" className="form-input" autoComplete="off" />
        </label>
        <label className="grid gap-1.5 sm:col-span-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Image URL
          </span>
          <input
            name="imageUrl"
            required
            placeholder="https://images.pokemontcg.io/..."
            className="form-input"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Grade
          </span>
          <input
            name="grade"
            placeholder="Ungraded, PSA 10, ..."
            defaultValue="Ungraded"
            className="form-input"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Quantity
          </span>
          <input
            name="quantity"
            type="number"
            min={1}
            step={1}
            defaultValue={1}
            className="form-input"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Price paid USD (optional)
          </span>
          <input
            name="pricePaidUsd"
            inputMode="decimal"
            placeholder="0.00"
            className="form-input"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Current market USD (optional)
          </span>
          <input
            name="marketPriceUsd"
            inputMode="decimal"
            placeholder="Captured as a price snapshot"
            className="form-input"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "Adding…" : "Add to vault"}
        </button>
        {state.message ? (
          <p
            aria-live="polite"
            className={`text-sm font-semibold ${state.ok ? "text-emerald-300" : "text-amber-200"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
