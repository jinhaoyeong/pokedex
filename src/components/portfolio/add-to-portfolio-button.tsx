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

export function AddToPortfolioButton({ card }: { card: TcgCard }) {
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

  return (
    <div className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/25 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.11em] text-yellow-200">
            Binder
          </p>
          <h3 className="mt-1.5 font-[var(--font-game-copy)] text-lg font-semibold leading-tight text-white">
            Add to portfolio
          </h3>
        </div>
        <p className="rounded-xl border border-white/10 bg-slate-950/35 px-2.5 py-1.5 text-sm leading-5 text-slate-300 sm:px-3 sm:py-2">
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
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end">
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0 sm:col-span-2 lg:col-span-1">
          <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Holding
          </legend>
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            {(["Ungraded", "Graded"] as HoldingType[]).map((type) => {
              const isSelected = holdingType === type;

              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    const nextGrade = buildGradeLabel(type, gradingService, serviceGrade);
                    setHoldingType(type);
                    clearStatus();
                  }}
                  className={`min-h-11 rounded-xl border px-2.5 py-2 text-left transition sm:min-h-12 sm:px-3 ${
                    isSelected
                      ? "border-yellow-200/70 bg-yellow-300/12 text-yellow-100"
                      : "border-white/10 bg-slate-950/45 text-slate-300 hover:border-yellow-200/35 hover:text-white"
                  }`}
                >
                  <span className="block text-sm font-bold leading-none">{type}</span>
                  <span className="mt-1 block text-[11px] leading-tight text-slate-400">
                    {type === "Ungraded" ? "Raw card" : "Slab"}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="grid min-w-0 gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Service
          </span>
          <select
            aria-label="Select grading service"
            value={gradingService}
            disabled={holdingType === "Ungraded"}
            onChange={(event) => {
              const nextService = event.target.value as (typeof GRADING_SERVICES)[number];
              const nextServiceGrade = GRADE_OPTIONS[nextService][0];
              const nextGrade = buildGradeLabel("Graded", nextService, nextServiceGrade);
              setGradingService(nextService);
              setServiceGrade(nextServiceGrade);
              clearStatus();
            }}
            className="h-11 min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 text-sm font-semibold text-white outline-none transition focus:border-yellow-300/70 disabled:opacity-45"
          >
            {GRADING_SERVICES.map((service) => (
              <option key={service} value={service} className="bg-slate-950 text-white">
                {service}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Grade
          </span>
          <select
            aria-label="Select slab grade"
            value={serviceGrade}
            disabled={holdingType === "Ungraded"}
            onChange={(event) => {
              const nextServiceGrade = event.target.value;
              const nextGrade = buildGradeLabel("Graded", gradingService, nextServiceGrade);
              setServiceGrade(nextServiceGrade);
              clearStatus();
            }}
            className="h-11 min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 text-sm font-semibold text-white outline-none transition focus:border-yellow-300/70 disabled:opacity-45"
          >
            {GRADE_OPTIONS[gradingService].map((option) => (
              <option key={option} value={option} className="bg-slate-950 text-white">
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Cost USD (optional)
          </span>
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
                : holdingType === "Graded"
                  ? "Optional for slabs"
                  : "Optional"
            }
            className="h-11 min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-300/70"
          />
        </label>
        <div className="grid min-w-0 gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="button"
            onClick={addCard}
            className="trainer-button inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-500 px-5 py-2.5 text-center text-sm font-bold leading-none text-white"
          >
            Add to binder
          </button>
        </div>
      </div>
      {status ? (
        <p
          aria-live="polite"
          className={`mt-3 text-sm font-semibold leading-6 ${
            statusIsError ? "text-amber-200" : "text-emerald-300"
          }`}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
