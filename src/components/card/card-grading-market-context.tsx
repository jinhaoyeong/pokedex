"use client";

import { createContext, useContext } from "react";

import { useCardGradingMarket } from "@/hooks/use-card-grading-market";
import type { TcgCard } from "@/types/pokemon";

type CardGradingMarketContextValue = ReturnType<typeof useCardGradingMarket>;

const CardGradingMarketContext = createContext<CardGradingMarketContextValue | null>(null);

export function CardGradingMarketProvider({
  card,
  children,
}: {
  card: TcgCard;
  children: React.ReactNode;
}) {
  const market = useCardGradingMarket(card);

  return (
    <CardGradingMarketContext.Provider value={market}>{children}</CardGradingMarketContext.Provider>
  );
}

export function useManagedCardGradingMarket() {
  return useContext(CardGradingMarketContext);
}
