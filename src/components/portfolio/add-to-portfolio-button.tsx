"use client";

import { useState } from "react";

import { portfolioItemKey, readPortfolio, writePortfolio } from "@/lib/portfolio-store";
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

export function AddToPortfolioButton({ card }: { card: TcgCard }) {
  const [holdingType, setHoldingType] = useState<HoldingType>("Ungraded");
  const [gradingService, setGradingService] =
    useState<(typeof GRADING_SERVICES)[number]>("PSA");
  const [serviceGrade, setServiceGrade] = useState("10");
  const grade = buildGradeLabel(holdingType, gradingService, serviceGrade);
  const initialCost =
    card.gradedPrices.find((price) => price.grade === "Ungraded")?.value ??
    card.marketPriceUsd;
  const [costBasisUsd, setCostBasisUsd] = useState(
    initialCost > 0 ? initialCost.toFixed(2) : "",
  );
  const [status, setStatus] = useState<string>("");

  const selectedGradeValue =
    card.gradedPrices.find((price) => price.grade === grade)?.value ??
    (holdingType === "Ungraded" ? card.marketPriceUsd : undefined);
  const selectedGradeMarket =
    typeof selectedGradeValue === "number" &&
    Number.isFinite(selectedGradeValue) &&
    selectedGradeValue > 0
      ? selectedGradeValue
      : undefined;
  const parsedCostBasis = Number.parseFloat(costBasisUsd);
  const canAddCard = Number.isFinite(parsedCostBasis) && parsedCostBasis >= 0;

  const syncCostFromGrade = (nextGrade: GradeLabel, nextHoldingType: HoldingType) => {
    const nextMarketValue =
      card.gradedPrices.find((price) => price.grade === nextGrade)?.value ??
      (nextHoldingType === "Ungraded" ? card.marketPriceUsd : undefined);

    setCostBasisUsd(
      typeof nextMarketValue === "number" && nextMarketValue > 0
        ? nextMarketValue.toFixed(2)
        : "",
    );
    setStatus("");
  };

  const addCard = () => {
    if (!canAddCard) {
      setStatus("Enter the cost you paid before adding this card.");
      return;
    }

    const currentPortfolio = readPortfolio();

    const nextItem: PortfolioItem = {
      cardId: card.id,
      slug: card.slug,
      name: card.name,
      setName: card.setName,
      setCode: card.setCode,
      rarity: card.rarity,
      collectorNumber: card.collectorNumber,
      image: card.image,
      quantity: card.portfolioDefaultQuantity,
      grade,
      costBasisUsd: parsedCostBasis,
      marketValueUsd: selectedGradeMarket,
      marketValueUpdatedAt: selectedGradeMarket ? new Date().toISOString() : undefined,
      marketSource: selectedGradeMarket
        ? card.priceConsensus?.methodology ?? "Captured from card detail market value"
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
    <div className="glass-card relative overflow-hidden rounded-2xl border-yellow-200/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-200">
            Binder
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">Add to portfolio</h3>
        </div>
        <p className="text-xs text-slate-400">
          {selectedGradeMarket ? (
            <>
              Ref <span className="font-semibold text-yellow-100">${selectedGradeMarket.toFixed(2)}</span>
            </>
          ) : (
            "Enter cost"
          )}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-[minmax(7rem,0.8fr)_minmax(7rem,0.72fr)_minmax(6rem,0.55fr)_minmax(8rem,0.8fr)_auto] lg:items-end">
        <label className="grid gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
            State
          </span>
          <select
            aria-label="Select raw or graded"
            value={holdingType}
            onChange={(event) => {
              const nextHoldingType = event.target.value as HoldingType;
              const nextGrade = buildGradeLabel(
                nextHoldingType,
                gradingService,
                serviceGrade,
              );
              setHoldingType(nextHoldingType);
              syncCostFromGrade(nextGrade, nextHoldingType);
            }}
            className="min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-yellow-300/70 sm:text-sm"
          >
            <option value="Ungraded" className="bg-slate-950 text-white">Ungraded / Raw</option>
            <option value="Graded" className="bg-slate-950 text-white">Graded slab</option>
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
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
              syncCostFromGrade(nextGrade, "Graded");
            }}
            className="min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-yellow-300/70 disabled:opacity-45 sm:text-sm"
          >
            {GRADING_SERVICES.map((service) => (
              <option key={service} value={service} className="bg-slate-950 text-white">
                {service}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
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
              syncCostFromGrade(nextGrade, "Graded");
            }}
            className="min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-yellow-300/70 disabled:opacity-45 sm:text-sm"
          >
            {GRADE_OPTIONS[gradingService].map((option) => (
              <option key={option} value={option} className="bg-slate-950 text-white">
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Cost USD
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={costBasisUsd}
            onChange={(event) => {
              setCostBasisUsd(event.target.value);
              setStatus("");
            }}
            placeholder={
              typeof selectedGradeValue === "number" && selectedGradeValue > 0
                ? selectedGradeValue.toFixed(2)
                : "Enter actual cost"
            }
            className="min-w-0 rounded-xl border border-yellow-200/25 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none placeholder:text-slate-600 focus:border-yellow-300/70 sm:text-sm"
          />
        </label>
        <div className="col-span-2 grid gap-2 lg:col-span-1">
          <span className="hidden text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 lg:block">
            Save
          </span>
          <button
            type="button"
            onClick={addCard}
            disabled={!canAddCard}
            className="trainer-button h-[38px] rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
      {status ? <p className="mt-2 text-sm text-emerald-300">{status}</p> : null}
    </div>
  );
}
