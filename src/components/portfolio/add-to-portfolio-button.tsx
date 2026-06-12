"use client";

import { useState } from "react";

import { resolveBinderGradeMarket } from "@/lib/binder-market";
import { portfolioItemKey, readPortfolio, writePortfolio } from "@/lib/portfolio-store";
import { readSettings } from "@/lib/settings-store";
import type { GradeLabel, PortfolioItem, TcgCard } from "@/types/pokemon";

const GRADING_SERVICES = ["PSA", "BGS", "CGC", "SGC", "TAG"] as const;
const GRADE_OPTIONS: Record<(typeof GRADING_SERVICES)[number], string[]> = {
  PSA: ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
  BGS: ["10 Black", "10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5"],
  CGC: ["10 Pristine", "10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5"],
  SGC: ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5"],
  TAG: ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
};

const CONTROL_CLASS =
  "h-12 min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 text-sm font-semibold text-white outline-none transition focus:border-yellow-300/70";

type HoldingType = "Ungraded" | "Graded";

function buildGradeLabel(
  holdingType: HoldingType,
  service: (typeof GRADING_SERVICES)[number],
  serviceGrade: string,
): GradeLabel {
  return holdingType === "Ungraded" ? "Ungraded" : `${service} ${serviceGrade}`;
}

function parseOptionalCostUsd(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return 0;
  }

  const parsed = Number.parseFloat(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function AddToPortfolioButton({
  card,
  embedded = false,
}: {
  card: TcgCard;
  embedded?: boolean;
}) {
  const binderDefaults = readSettings().binderDefaults;
  const [holdingType, setHoldingType] = useState<HoldingType>(binderDefaults.holdingType);
  const [gradingService, setGradingService] = useState<(typeof GRADING_SERVICES)[number]>(
    binderDefaults.gradingService,
  );
  const [serviceGrade, setServiceGrade] = useState(binderDefaults.serviceGrade);
  const grade = buildGradeLabel(holdingType, gradingService, serviceGrade);
  const [costBasisUsd, setCostBasisUsd] = useState("");
  const [status, setStatus] = useState<string>("");

  const selectedGradeMarket = resolveBinderGradeMarket(
    grade,
    card.gradedPrices,
    card.priceConsensus,
  ).value;
  const selectedGradeValue = selectedGradeMarket;
  const parsedCostBasis = parseOptionalCostUsd(costBasisUsd);
  const statusIsError = status.startsWith("Cost");

  const clearStatus = () => {
    setStatus("");
  };

  const addCard = () => {
    if (parsedCostBasis === null) {
      setStatus("Cost must be zero or a positive number.");
      return;
    }

    const currentPortfolio = readPortfolio();

    const resolvedMarket = resolveBinderGradeMarket(
      grade,
      card.gradedPrices,
      card.priceConsensus,
    );

    const nextItem: PortfolioItem = {
      cardId: card.id,
      slug: card.slug,
      name: card.name,
      setName: card.setName,
      setCode: card.setCode,
      setEnglishName: card.setEnglishName,
      language: card.language,
      englishName: card.englishName,
      setPrintedTotal: card.setPrintedTotal ?? card.setTotal,
      rarity: card.rarity,
      collectorNumber: card.collectorNumber,
      image: card.image,
      quantity: card.portfolioDefaultQuantity,
      grade,
      costBasisUsd: parsedCostBasis,
      marketValueUsd: resolvedMarket.value,
      marketValueUpdatedAt: resolvedMarket.value ? new Date().toISOString() : undefined,
      marketSource: resolvedMarket.value
        ? resolvedMarket.source ??
          card.priceConsensus?.methodology ??
          "Captured from card detail market value"
        : undefined,
      addedAt: new Date().toISOString(),
    };

    const existingItem = currentPortfolio.find(
      (item) => portfolioItemKey(item) === portfolioItemKey(nextItem),
    );

    if (existingItem) {
      writePortfolio(
        currentPortfolio.map((item) =>
          portfolioItemKey(item) === portfolioItemKey(nextItem)
            ? {
                ...item,
                quantity: item.quantity + nextItem.quantity,
                costBasisUsd:
                  (item.costBasisUsd * item.quantity + nextItem.costBasisUsd * nextItem.quantity) /
                  (item.quantity + nextItem.quantity),
                marketValueUsd: nextItem.marketValueUsd ?? item.marketValueUsd,
                marketValueUpdatedAt: nextItem.marketValueUpdatedAt ?? item.marketValueUpdatedAt,
                marketSource: nextItem.marketSource ?? item.marketSource,
              }
            : item,
        ),
      );
      setStatus("Updated existing portfolio item");
      return;
    }

    writePortfolio([...currentPortfolio, nextItem]);

    setStatus("Added to portfolio");
  };

  const shellClass = embedded
    ? "relative"
    : "glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-5 sm:p-6";

  return (
    <div className={shellClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-yellow-200">
            Binder
          </p>
          <h3 className="mt-1 font-[var(--font-game-copy)] text-lg font-semibold leading-tight text-white">
            Add to portfolio
          </h3>
        </div>
        <p className="rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-1.5 text-xs leading-5 text-slate-300 sm:text-sm">
          {selectedGradeMarket ? (
            <>
              Ref <span className="font-semibold text-yellow-100">${selectedGradeMarket.toFixed(2)}</span>
            </>
          ) : holdingType === "Graded" ? (
            "Slab — cost optional"
          ) : (
            "Cost optional"
          )}
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Holding
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["Ungraded", "Graded"] as HoldingType[]).map((type) => {
              const isSelected = holdingType === type;

              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setHoldingType(type);
                    clearStatus();
                  }}
                  className={`flex h-12 flex-col justify-center rounded-xl border px-3 text-left transition ${
                    isSelected
                      ? "border-yellow-200/70 bg-yellow-300/12 text-yellow-100"
                      : "border-white/10 bg-slate-950/45 text-slate-300 hover:border-yellow-200/35 hover:text-white"
                  }`}
                >
                  <span className="text-sm font-bold leading-none">{type}</span>
                  <span className="mt-0.5 text-[11px] leading-none text-slate-400">
                    {type === "Ungraded" ? "Raw card" : "Slab"}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {holdingType === "Graded" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Service
              </span>
              <select
                aria-label="Select grading service"
                value={gradingService}
                onChange={(event) => {
                  const nextService = event.target.value as (typeof GRADING_SERVICES)[number];
                  const nextServiceGrade = GRADE_OPTIONS[nextService][0];
                  setGradingService(nextService);
                  setServiceGrade(nextServiceGrade);
                  clearStatus();
                }}
                className={CONTROL_CLASS}
              >
                {GRADING_SERVICES.map((service) => (
                  <option key={service} value={service} className="bg-slate-950 text-white">
                    {service}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Grade
              </span>
              <select
                aria-label="Select slab grade"
                value={serviceGrade}
                onChange={(event) => {
                  setServiceGrade(event.target.value);
                  clearStatus();
                }}
                className={CONTROL_CLASS}
              >
                {GRADE_OPTIONS[gradingService].map((option) => (
                  <option key={option} value={option} className="bg-slate-950 text-white">
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Cost USD (optional)
          </span>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={costBasisUsd}
              onChange={(event) => {
                setCostBasisUsd(event.target.value);
                setStatus("");
              }}
              placeholder={
                typeof selectedGradeValue === "number" && selectedGradeValue > 0
                  ? `Optional — e.g. ${selectedGradeValue.toFixed(2)}`
                  : "Optional"
              }
              className={`${CONTROL_CLASS} placeholder:text-slate-600`}
            />
            <button
              type="button"
              onClick={addCard}
              className="trainer-button inline-flex h-12 w-full items-center justify-center rounded-xl bg-blue-500 px-4 text-sm font-bold leading-none text-white sm:w-[10.5rem]"
            >
              Add to binder
            </button>
          </div>
        </div>
      </div>

      {status ? (
        <p
          aria-live="polite"
          className={`mt-2 text-sm font-semibold leading-6 ${
            statusIsError ? "text-amber-200" : "text-emerald-300"
          }`}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
