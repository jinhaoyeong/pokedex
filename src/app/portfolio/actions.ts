"use server";

import { revalidatePath } from "next/cache";

import { addCardToVault, isAccountBackendConfigured } from "@/lib/account-db.server";
import { toUserActionMessage } from "@/lib/db-action-error";

export type AddCardToVaultState = {
  ok: boolean;
  message: string;
};

const INITIAL_ERROR = "Could not add card to cloud binder.";

function parsePositiveNumber(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    return null;
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function addCardToVaultAction(
  _prevState: AddCardToVaultState,
  formData: FormData,
): Promise<AddCardToVaultState> {
  try {
    if (!isAccountBackendConfigured()) {
      return {
        ok: false,
        message: "Cloud binder is not configured in this environment.",
      };
    }

    const cardId = String(formData.get("cardId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const imageUrl = String(formData.get("imageUrl") ?? "").trim();
    const quantityRaw = String(formData.get("quantity") ?? "1").trim() || "1";
    const quantity = Number.parseInt(quantityRaw, 10);

    await addCardToVault({
      cardId,
      name,
      imageUrl,
      marketPrice: parsePositiveNumber(formData.get("marketPrice")),
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
      notes: String(formData.get("notes") ?? "").trim() || null,
    });

    revalidatePath("/portfolio");

    return {
      ok: true,
      message: "Saved to cloud binder.",
    };
  } catch (error) {
    return {
      ok: false,
      message: toUserActionMessage(error, INITIAL_ERROR),
    };
  }
}
