"use server";

import { revalidatePath } from "next/cache";

import { updateCurrentAccountCurrency } from "@/lib/account-db.server";
import type { SupportedCurrency } from "@/types/pokemon";

const SUPPORTED_CURRENCIES: SupportedCurrency[] = ["USD", "EUR", "GBP", "JPY", "MYR"];

export async function updateAccountCurrency(formData: FormData) {
  const preferredCurrency = String(formData.get("preferredCurrency") ?? "").trim();

  if (!SUPPORTED_CURRENCIES.includes(preferredCurrency as SupportedCurrency)) {
    throw new Error("Unsupported currency.");
  }

  await updateCurrentAccountCurrency(preferredCurrency);
  revalidatePath("/settings");
}
