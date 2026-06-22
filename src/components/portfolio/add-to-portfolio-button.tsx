"use client";

import { useState } from "react";

import { SearchSelect } from "@/components/search/search-select";
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

const INPUT_CLASS = "form-input sm:h-12";

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
    : "glass-card relative overflow-hidden rounded-2xl p-5 sm:p-6";

  return (
    <div className={shellClass}>
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-yellow-200 sm:text-[11px]">
            Binder
          </p>
          <h3 className="mt-0.5 font-[var(--font-game-copy)] text-base font-semibold leading-tight text-white sm:mt-1 sm:text-lg">
            Add to portfolio
          </h3>
        </div>
        <p className="rounded-lg border border-white/10 bg-slate-950/35 px-2 py-1 text-[11px] leading-4 text-slate-300 sm:px-2.5 sm:py-1.5 sm:text-sm sm:leading-5">
          {selectedGradeMarket ? (
            <>
              Ref <span className="font-semibold text-[var(--text)]">${selectedGradeMarket.toFixed(2)}</span>
            </>
          ) : holdingType === "Graded" ? (
            "Slab — cost optional"
          ) : (
            "Cost optional"
          )}
        </p>
      </div>

      <div className={`flex flex-col gap-2 ${embedded ? "mt-2" : "mt-3 sm:gap-3"}`}>
        <fieldset className="m-0 grid gap-1.5 border-0 p-0 sm:gap-2">
          <legend className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 sm:text-[11px]">
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
                    setHoldingType(type);
                    clearStatus();
                  }}
                  className={`toggle-card h-11 sm:h-12 ${isSelected ? "toggle-card--active" : ""}`}
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
              <span
                id="binder-grading-service-label"
                className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400"
              >
                Service
              </span>
              <SearchSelect
                name="gradingService"
                labelledBy="binder-grading-service-label"
                value={gradingService}
                options={GRADING_SERVICES.map((service) => ({
                  value: service,
                  label: service,
                }))}
                onChange={(nextService) => {
                  const typedService = nextService as (typeof GRADING_SERVICES)[number];
                  const nextServiceGrade = GRADE_OPTIONS[typedService][0];
                  setGradingService(typedService);
                  setServiceGrade(nextServiceGrade);
                  clearStatus();
                }}
              />
            </label>
            <label className="grid gap-2">
              <span
                id="binder-service-grade-label"
                className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400"
              >
                Grade
              </span>
              <SearchSelect
                name="serviceGrade"
                labelledBy="binder-service-grade-label"
                value={serviceGrade}
                options={GRADE_OPTIONS[gradingService].map((option) => ({
                  value: option,
                  label: option,
                }))}
                onChange={(nextGrade) => {
                  setServiceGrade(nextGrade);
                  clearStatus();
                }}
              />
            </label>
          </div>
        ) : null}

        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 sm:text-[11px]">
            Cost USD (optional)
          </span>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:mt-2 sm:grid-cols-[minmax(0,1fr)_10.5rem] sm:gap-2">
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
              className={`${INPUT_CLASS} placeholder:text-slate-600`}
            />
            <button
              type="button"
              onClick={addCard}
              className="btn btn-primary btn-sm h-11 w-full sm:h-12 sm:w-[10.5rem]"
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
