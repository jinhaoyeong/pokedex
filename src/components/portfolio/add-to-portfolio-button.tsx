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
    <div className="glass-card relative overflow-hidden rounded-3xl border-yellow-200/20 p-3 sm:p-6">
      <div className="absolute -right-10 -top-10 h-20 w-20 rounded-full border-[10px] border-white/10 bg-gradient-to-b from-red-500 to-red-500 opacity-25 sm:-right-8 sm:-top-8 sm:h-24 sm:w-24 sm:border-[12px] sm:opacity-35" />
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-yellow-200 sm:text-xs sm:tracking-[0.24em]">
        Binder capture
      </p>
      <h3 className="mt-1 text-base font-black text-white sm:mt-2 sm:text-lg">Add to portfolio</h3>
      <p className="mt-2 hidden text-sm text-slate-400 sm:block">
        Choose whether this is raw or graded, then enter what you paid so the binder can calculate true P/L later.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-4 lg:grid-cols-[minmax(9rem,0.7fr)_minmax(9rem,0.75fr)_minmax(8rem,0.6fr)_minmax(11rem,0.75fr)_auto] lg:items-end">
        <label className="grid gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.18em]">
            Card state
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
            className="min-w-0 rounded-2xl border border-yellow-200/25 bg-slate-950 px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-yellow-300/70 sm:px-4 sm:py-3 sm:text-sm"
          >
            <option value="Ungraded" className="bg-slate-950 text-white">Ungraded / Raw</option>
            <option value="Graded" className="bg-slate-950 text-white">Graded slab</option>
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.18em]">
            Grading service
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
            className="min-w-0 rounded-2xl border border-yellow-200/25 bg-slate-950 px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-yellow-300/70 disabled:opacity-45 sm:px-4 sm:py-3 sm:text-sm"
          >
            {GRADING_SERVICES.map((service) => (
              <option key={service} value={service} className="bg-slate-950 text-white">
                {service}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.18em]">
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
            className="min-w-0 rounded-2xl border border-yellow-200/25 bg-slate-950 px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-yellow-300/70 disabled:opacity-45 sm:px-4 sm:py-3 sm:text-sm"
          >
            {GRADE_OPTIONS[gradingService].map((option) => (
              <option key={option} value={option} className="bg-slate-950 text-white">
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.18em]">
            Cost paid (USD)
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
            className="min-w-0 rounded-2xl border border-yellow-200/25 bg-slate-950 px-3 py-2.5 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-yellow-300/70 sm:px-4 sm:py-3 sm:text-sm"
          />
        </label>
        <div className="col-span-2 grid gap-2 lg:col-span-1">
          <span className="hidden text-xs font-black uppercase tracking-[0.18em] text-slate-400 lg:block">
            Save
          </span>
          <button
            type="button"
            onClick={addCard}
            disabled={!canAddCard}
            className="trainer-button rounded-2xl bg-blue-500 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 sm:py-3"
          >
            Add Card
          </button>
        </div>
      </div>
      <div className="mt-3 hidden rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300 sm:block">
        {typeof selectedGradeValue === "number" && selectedGradeValue > 0 ? (
          <>
            Suggested market reference for <span className="font-black text-yellow-100">{grade}</span>:{" "}
            <span className="font-black text-yellow-100">
              ${selectedGradeValue.toFixed(2)}
            </span>
            . Change the cost field if your actual buy price was different.
          </>
        ) : (
          <>
            No reliable market reference is available for{" "}
            <span className="font-black text-yellow-100">{grade}</span> yet. Enter your actual cost paid.
          </>
        )}
      </div>
      {status ? <p className="mt-3 text-sm text-emerald-300">{status}</p> : null}
    </div>
  );
}
