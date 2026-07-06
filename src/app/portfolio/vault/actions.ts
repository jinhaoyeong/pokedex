"use server";

import { revalidatePath } from "next/cache";

import { addCardToVault, isAccountBackendConfigured } from "@/lib/account-db.server";
import { toUserActionMessage } from "@/lib/db-action-error";
import {
  addCardToPortfolio,
  ensureDbUser,
  isPortfolioBackendConfigured,
} from "@/lib/portfolio-db.server";

export type AddCardActionState = {
  ok: boolean;
  message: string;
};

function parseOptionalUsd(raw: FormDataEntryValue | null, label: string) {
  const value = typeof raw === "string" ? raw.trim() : "";

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be zero or a positive number.`);
  }

  return parsed;
}

export async function addCardAction(
  _prevState: AddCardActionState,
  formData: FormData,
): Promise<AddCardActionState> {
  try {
    if (!isPortfolioBackendConfigured() || !isAccountBackendConfigured()) {
      return {
        ok: false,
        message: "Portfolio backend is not configured (missing database or auth keys).",
      };
    }

    const user = await ensureDbUser();

    if (!user) {
      return { ok: false, message: "You must be signed in to add cards." };
    }

    const slug = String(formData.get("slug") ?? "").trim();

    if (!slug) {
      return { ok: false, message: "Enter a card slug." };
    }

    const quantityRaw = String(formData.get("quantity") ?? "1").trim() || "1";
    const quantity = Number.parseInt(quantityRaw, 10);

    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, message: "Quantity must be a whole number of at least 1." };
    }

    const item = await addCardToPortfolio(user, {
      slug,
      name: String(formData.get("name") ?? "").trim() || undefined,
      grade: String(formData.get("grade") ?? "").trim() || undefined,
      quantity,
      pricePaidUsd: parseOptionalUsd(formData.get("pricePaidUsd"), "Price paid"),
      marketPriceUsd: parseOptionalUsd(formData.get("marketPriceUsd"), "Market price"),
    });

    await addCardToVault({
      cardId: slug,
      name: String(formData.get("name") ?? "").trim() || slug,
      imageUrl: String(formData.get("imageUrl") ?? "").trim(),
      marketPrice: parseOptionalUsd(formData.get("marketPriceUsd"), "Market price") ?? null,
      quantity,
      notes: String(formData.get("grade") ?? "").trim() || null,
    });

    revalidatePath("/portfolio");
    revalidatePath("/portfolio/vault");

    return {
      ok: true,
      message: `Added ${quantity}x ${item.cardName ?? item.cardSlug} (${item.grade}) to your vault.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: toUserActionMessage(error, "Could not add card."),
    };
  }
}
