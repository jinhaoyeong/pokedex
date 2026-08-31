"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { updateCurrentAccountCurrency } from "@/lib/account-db.server";
import {
  CURRENCY_COOKIE_MAX_AGE_SECONDS,
  CURRENCY_COOKIE_NAME,
  parseSupportedCurrency,
} from "@/lib/currency-preference";

export async function updateAccountCurrency(formData: FormData) {
  const preferredCurrency = parseSupportedCurrency(
    String(formData.get("preferredCurrency") ?? "").trim(),
  );

  if (!preferredCurrency) {
    throw new Error("Unsupported currency.");
  }

  try {
    await updateCurrentAccountCurrency(preferredCurrency);
  } catch (error) {
    console.error("Failed to persist account currency to Supabase", error);
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: CURRENCY_COOKIE_NAME,
    value: preferredCurrency,
    path: "/",
    maxAge: CURRENCY_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/search");
}
