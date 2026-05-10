import type { Metadata } from "next";

import { PsaImportForm } from "@/components/psa/psa-import-form";
import { getCardById, getCardBySlug } from "@/lib/cards";
import { fetchLiveCardById } from "@/lib/pokemon-tcg-api";

export const metadata: Metadata = {
  title: "PSA Import",
};

export default async function PsaImportPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const params = await searchParams;
  const cardId = params.card ?? "";
  const card = cardId
    ? getCardById(cardId) ?? getCardBySlug(cardId) ?? (await fetchLiveCardById(cardId))
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-6 py-10 sm:px-10 lg:px-12">
      <PsaImportForm
        card={
          card
            ? {
                id: card.id,
                name: card.name,
                collectorNumber: card.collectorNumber,
                setName: card.setName,
              }
            : null
        }
      />
    </main>
  );
}
