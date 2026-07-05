import { desc, eq, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { binderCards, userSettings, users } from "@/db/schema";

export type AccountUser = typeof users.$inferSelect;
export type AccountSettings = typeof userSettings.$inferSelect;
export type BinderCard = typeof binderCards.$inferSelect;

type SyncClerkUserInput = {
  clerkId: string;
  email?: string | null;
  displayName?: string | null;
};

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
  const db = getDb();

  const [user] = await db
    .insert(users)
    .values({
      clerkUserId: clerkId,
      email,
      displayName,
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: {
        email,
        displayName,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  await db
    .insert(userSettings)
    .values({
      clerkId,
      preferredCurrency: "MYR",
    })
    .onConflictDoNothing({
      target: userSettings.clerkId,
    });

  return user;
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
  const user = await ensureCurrentAccountUser();

  if (!user) {
    return null;
  }

  const db = getDb();
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.clerkId, user.clerkUserId))
    .limit(1);

  return settings ?? null;
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
        preferredCurrency,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return settings;
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
