"use client";

import { useEffect, useState } from "react";

import { getBootPreviewCards } from "@/lib/client-catalog-cache";
import { mergeBootPreviewCards } from "@/lib/preview-utils";
import type { TcgCard } from "@/types/pokemon";

export function useBootPreviewCards(initialCards: TcgCard[]) {
  const [bootCards, setBootCards] = useState<TcgCard[] | null>(null);

  useEffect(() => {
    const sync = () => {
      const boot = getBootPreviewCards();

      if (boot?.length) {
        setBootCards(boot);
      }
    };

    sync();
    window.addEventListener("pokedex-boot-preview", sync);

    return () => {
      window.removeEventListener("pokedex-boot-preview", sync);
    };
  }, []);

  return mergeBootPreviewCards(initialCards, bootCards ?? []);
}
