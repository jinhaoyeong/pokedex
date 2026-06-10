"use client";

import { useEffect, useState } from "react";

import { getBootPreviewCards } from "@/lib/client-catalog-cache";
import type { TcgCard } from "@/types/pokemon";

export function useBootPreviewCards(initialCards: TcgCard[]) {
  const [cards, setCards] = useState(initialCards);

  useEffect(() => {
    const sync = () => {
      const cached = getBootPreviewCards();

      if (cached?.length) {
        setCards(cached);
      }
    };

    sync();
    window.addEventListener("pokedex-boot-preview", sync);

    return () => {
      window.removeEventListener("pokedex-boot-preview", sync);
    };
  }, []);

  return cards;
}
