"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";

import { SearchSelect } from "@/components/search/search-select";
import { addLocalCorrection } from "@/lib/corrections-store";
import { APP_SCROLL_ROOT_ID } from "@/lib/app-scroll";
import {
  FEEDBACK_ISSUE_OPTIONS,
  parseCardFeedback,
  type FeedbackIssueType,
} from "@/lib/feedback-parser";

const ISSUE_SELECT_OPTIONS = FEEDBACK_ISSUE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

function subscribeMounted() {
  return () => undefined;
}

function getMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

function lockAppScroll(locked: boolean) {
  const root = document.getElementById(APP_SCROLL_ROOT_ID);

  if (!root) {
    return () => undefined;
  }

  const previousOverflow = root.style.overflow;
  const previousTouchAction = root.style.touchAction;

  if (locked) {
    root.style.overflow = "hidden";
    root.style.touchAction = "none";
  }

  return () => {
    root.style.overflow = previousOverflow;
    root.style.touchAction = previousTouchAction;
  };
}

export function CardCorrectionPanel({ slug }: { slug: string }) {
  const mounted = useSyncExternalStore(subscribeMounted, getMounted, getServerMounted);
  const [isOpen, setIsOpen] = useState(false);
  const [issueType, setIssueType] = useState<FeedbackIssueType>("wrong_price");
  const [expectedPrice, setExpectedPrice] = useState("");
  const [expectedGrade, setExpectedGrade] = useState("");
  const [correctName, setCorrectName] = useState("");
  const [correctSet, setCorrectSet] = useState("");
  const [correctNumber, setCorrectNumber] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedIssue = FEEDBACK_ISSUE_OPTIONS.find((option) => option.value === issueType);

  const parsedPreview = useMemo(
    () =>
      parseCardFeedback({
        issueType,
        note,
        expectedPrice,
        expectedGrade,
        correctName,
        correctSet,
        correctNumber,
      }),
    [issueType, note, expectedPrice, expectedGrade, correctName, correctSet, correctNumber],
  );

  const showPriceFields =
    issueType === "wrong_price" || issueType === "wrong_grade_price" || issueType === "missing_data";
  const showGradeField = issueType === "wrong_grade_price" || issueType === "missing_data";
  const showNameField =
    issueType === "wrong_card" || issueType === "wrong_name" || issueType === "other";
  const showSetField = issueType === "wrong_set" || issueType === "wrong_card";
  const showNumberField = issueType === "wrong_number" || issueType === "wrong_card";

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    return lockAppScroll(true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        setMessage(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const resetForm = () => {
    setIssueType("wrong_price");
    setExpectedPrice("");
    setExpectedGrade("");
    setCorrectName("");
    setCorrectSet("");
    setCorrectNumber("");
    setNote("");
  };

  const close = () => {
    setIsOpen(false);
    setMessage(null);
  };

  const submit = () => {
    const parsed = parseCardFeedback({
      issueType,
      note,
      expectedPrice,
      expectedGrade,
      correctName,
      correctSet,
      correctNumber,
    });

    startTransition(async () => {
      const createdAt = new Date().toISOString();

      addLocalCorrection({
        slug,
        field: parsed.field,
        issueType: parsed.issueType,
        reportedValue: parsed.reportedValue,
        note: parsed.note || parsed.summary,
        parsed,
        createdAt,
      });

      await fetch("/api/card-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          field: parsed.field,
          issueType: parsed.issueType,
          reportedValue: parsed.reportedValue,
          note: parsed.note || undefined,
          parsed,
        }),
      }).catch(() => undefined);

      setMessage(
        parsed.confidence === "high"
          ? `Thanks — recorded: ${parsed.summary}. The app will prioritize this on the next refresh.`
          : `Thanks — flagged for review: ${parsed.summary}. Add a price, grade, or card detail next time for faster learning.`,
      );
      resetForm();
    });
  };

  const inputClass =
    "h-11 w-full rounded-2xl border border-white/10 bg-[#050816] px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-yellow-300/50";

  const modal = isOpen ? (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/78 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={close}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-correction-title"
        className="card-correction-sheet flex w-full max-h-[min(88dvh,calc(100dvh-env(safe-area-inset-bottom)-5.5rem))] flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#070b18] shadow-2xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-white/10 px-4 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/15 sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p id="card-correction-title" className="text-base font-semibold text-white sm:text-lg">
                Help the database learn
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Tell us what is wrong. Structured details help the app verify prices, names, and set
                matches automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-300 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        <div className="card-correction-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <label className="grid gap-2">
            <span
              id="card-correction-issue-label"
              className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400"
            >
              What looks wrong?
            </span>
            <SearchSelect
              name="feedbackIssue"
              labelledBy="card-correction-issue-label"
              value={issueType}
              options={ISSUE_SELECT_OPTIONS}
              onChange={(value) => setIssueType(value as FeedbackIssueType)}
            />
            {selectedIssue ? (
              <p className="text-xs leading-5 text-slate-500">{selectedIssue.hint}</p>
            ) : null}
          </label>

          {showPriceFields ? (
            <label className="mt-4 grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Expected price (USD)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={expectedPrice}
                onChange={(event) => setExpectedPrice(event.target.value)}
                placeholder="e.g. 450 or $450"
                className={inputClass}
              />
            </label>
          ) : null}

          {showGradeField ? (
            <label className="mt-4 grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Grade (optional)
              </span>
              <input
                type="text"
                value={expectedGrade}
                onChange={(event) => setExpectedGrade(event.target.value)}
                placeholder="e.g. PSA 10 or BGS 9.5"
                className={inputClass}
              />
            </label>
          ) : null}

          {showNameField ? (
            <label className="mt-4 grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Correct card name
              </span>
              <input
                type="text"
                value={correctName}
                onChange={(event) => setCorrectName(event.target.value)}
                placeholder="e.g. Charizard ex"
                className={inputClass}
              />
            </label>
          ) : null}

          {showSetField ? (
            <label className="mt-4 grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Correct set
              </span>
              <input
                type="text"
                value={correctSet}
                onChange={(event) => setCorrectSet(event.target.value)}
                placeholder="e.g. 151 or Paradox Rift"
                className={inputClass}
              />
            </label>
          ) : null}

          {showNumberField ? (
            <label className="mt-4 grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Correct number
              </span>
              <input
                type="text"
                value={correctNumber}
                onChange={(event) => setCorrectNumber(event.target.value)}
                placeholder="e.g. 071/067 or 203"
                className={inputClass}
              />
            </label>
          ) : null}

          <label className="mt-4 grid gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
              Extra details (optional)
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder='Example: "PSA 10 should be about $450" or "This is the Japanese version"'
              className="min-h-24 w-full rounded-2xl border border-white/10 bg-[#050816] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-yellow-300/50"
            />
          </label>

          <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-500/8 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-blue-200">
              How the app will use this
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-200">{parsedPreview.summary}</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
              {parsedPreview.learningActions.map((action) => (
                <li key={action}>• {action}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="shrink-0 border-t border-white/10 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:px-6">
          <button
            type="button"
            disabled={isPending}
            onClick={submit}
            className="trainer-button inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-blue-500 px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {isPending ? "Sending…" : "Send feedback"}
          </button>
          {message ? (
            <p aria-live="polite" className="mt-3 text-sm font-medium leading-6 text-emerald-200">
              {message}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <div className="flex justify-center pt-2 sm:justify-end">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-yellow-200/35 hover:bg-white/[0.07] hover:text-white"
        >
          <span aria-hidden>✦</span>
          Help the database learn
        </button>
      </div>

      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
