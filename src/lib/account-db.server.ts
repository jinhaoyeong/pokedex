import { desc, eq, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { withAccountDbRetry } from "@/db/account-access.server";
import { getDb, isDatabaseConfigured } from "@/db/client";
import { binderCards, userSettings, users } from "@/db/schema";

export type AccountUser = typeof users.$inferSelect;
export type AccountSettings = typeof userSettings.$inferSelect;
export type BinderCard = typeof binderCards.$inferSelect;

const DEFAULT_PREFERRED_CURRENCY = "MYR";

type SyncClerkUserInput = {
  clerkId: string;
  email?: string | null;
  displayName?: string | null;
};

type AddCardToVaultInput = {
  cardId: string;
  name: string;
  imageUrl: string;
  marketPrice?: number | null;
  quantity?: number;
  notes?: string | null;
};

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function isAccountBackendConfigured() {
  return (
    isDatabaseConfigured() &&
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY)
  );
}

export async function syncClerkUserToDb({
  clerkId,
  email = null,
  displayName = null,
}: SyncClerkUserInput) {
  return withAccountDbRetry(() => syncClerkUserToDbOnce({ clerkId, email, displayName }));
}

async function syncClerkUserToDbOnce({
  clerkId,
  email = null,
  displayName = null,
}: SyncClerkUserInput) {
  const db = getDb();
  const normalizedEmail = normalizeOptionalText(email);
  const normalizedDisplayName = normalizeOptionalText(displayName);

  const [insertedUser] = await db
    .insert(users)
    .values({
      clerkUserId: clerkId,
      email: normalizedEmail,
      displayName: normalizedDisplayName,
    })
    .onConflictDoNothing({
      target: users.clerkUserId,
    })
    .returning();

  if (insertedUser) {
    await db
      .insert(userSettings)
      .values({
        clerkId,
        preferredCurrency: DEFAULT_PREFERRED_CURRENCY,
      })
      .onConflictDoNothing({
        target: userSettings.clerkId,
      });

    return insertedUser;
  }

  const [updatedUser] = await db
    .update(users)
    .set({
      email: sql`coalesce(${normalizedEmail}, ${users.email})`,
      displayName: sql`coalesce(${normalizedDisplayName}, ${users.displayName})`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.clerkUserId, clerkId))
    .returning();

  const user =
    updatedUser ??
    (
      await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkId))
        .limit(1)
    )[0];

  if (!user) {
    throw new Error("Could not sync Clerk user to the account database.");
  }

  await db
    .insert(userSettings)
    .values({
      clerkId,
      preferredCurrency: DEFAULT_PREFERRED_CURRENCY,
    })
    .onConflictDoNothing({
      target: userSettings.clerkId,
    });

  return user;
}

async function ensureAccountSettings(clerkId: string) {
  const db = getDb();
  const [existingSettings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.clerkId, clerkId))
    .limit(1);

  if (existingSettings) {
    return existingSettings;
  }

  const [createdSettings] = await db
    .insert(userSettings)
    .values({
      clerkId,
      preferredCurrency: DEFAULT_PREFERRED_CURRENCY,
    })
    .onConflictDoUpdate({
      target: userSettings.clerkId,
      set: {
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return (
    createdSettings ??
    (
      await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.clerkId, clerkId))
        .limit(1)
    )[0] ??
    null
  );
}

export async function ensureCurrentAccountUser() {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return null;
  }

  const profile = await currentUser().catch(() => null);

  return syncClerkUserToDb({
    clerkId,
    email:
      profile?.primaryEmailAddress?.emailAddress ??
      profile?.emailAddresses?.[0]?.emailAddress ??
      null,
    displayName: profile?.fullName ?? profile?.username ?? null,
  });
}

export async function getCurrentAccountSettings() {
  return withAccountDbRetry(async () => {
    const user = await ensureCurrentAccountUser();

    if (!user) {
      return null;
    }

    return ensureAccountSettings(user.clerkUserId);
  });
}

export async function updateCurrentAccountCurrency(preferredCurrency: string) {
  const user = await ensureCurrentAccountUser();

  if (!user) {
    throw new Error("Sign in to update account settings.");
  }

  const db = getDb();

  const [settings] = await db
    .insert(userSettings)
    .values({
      clerkId: user.clerkUserId,
      preferredCurrency,
    })
    .onConflictDoUpdate({
      target: userSettings.clerkId,
      set: {
        preferredCurrency: sql`excluded.preferred_currency`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return settings;
}

export async function addCardToVault({
  cardId,
  name,
  imageUrl,
  marketPrice = null,
  quantity = 1,
  notes = null,
}: AddCardToVaultInput) {
  const user = await ensureCurrentAccountUser();

  if (!user) {
    throw new Error("Sign in to add cards to your binder.");
  }

  const normalizedCardId = normalizeOptionalText(cardId);
  const normalizedName = normalizeOptionalText(name);
  const normalizedImageUrl = normalizeOptionalText(imageUrl);
  const normalizedNotes = normalizeOptionalText(notes);
  const normalizedQuantity = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const normalizedMarketPrice =
    typeof marketPrice === "number" && Number.isFinite(marketPrice) && marketPrice >= 0
      ? marketPrice.toFixed(2)
      : null;

  if (!normalizedCardId) {
    throw new Error("Missing card ID.");
  }

  if (!normalizedName) {
    throw new Error("Missing card name.");
  }

  if (!normalizedImageUrl) {
    throw new Error("Missing card image.");
  }

  const db = getDb();
  const [card] = await db
    .insert(binderCards)
    .values({
      clerkId: user.clerkUserId,
      cardId: normalizedCardId,
      name: normalizedName,
      imageUrl: normalizedImageUrl,
      marketPrice: normalizedMarketPrice,
      quantity: normalizedQuantity,
      notes: normalizedNotes,
    })
    .onConflictDoUpdate({
      target: [binderCards.clerkId, binderCards.cardId],
      set: {
        name: sql`excluded.name`,
        imageUrl: sql`excluded.image_url`,
        marketPrice: sql`excluded.market_price`,
        quantity: sql`${binderCards.quantity} + ${normalizedQuantity}`,
        notes: sql`excluded.notes`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return card;
}

export async function getCurrentBinderCards() {
  const user = await ensureCurrentAccountUser();

  if (!user) {
    return null;
  }

  const db = getDb();

  return db
    .select()
    .from(binderCards)
    .where(eq(binderCards.clerkId, user.clerkUserId))
    .orderBy(desc(binderCards.addedAt));
}
