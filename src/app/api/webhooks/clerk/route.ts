import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextResponse, type NextRequest } from "next/server";

import { syncClerkUserToDb } from "@/lib/account-db.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getPrimaryEmail(data: {
  primary_email_address_id?: string | null;
  email_addresses?: Array<{
    id?: string | null;
    email_address?: string | null;
  } | null> | null;
}) {
  const emails = data.email_addresses?.filter(Boolean) ?? [];
  const primary = emails.find((email) => email?.id === data.primary_email_address_id);

  return primary?.email_address?.trim() || emails[0]?.email_address?.trim() || null;
}

function getDisplayName(data: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}) {
  const fullName = [data.first_name, data.last_name]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || data.username?.trim() || null;
}

export async function POST(request: NextRequest) {
  let event;

  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("Clerk webhook verification failed", error);
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  if (event.type !== "user.created") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  await syncClerkUserToDb({
    clerkId: event.data.id,
    email: getPrimaryEmail(event.data),
    displayName: getDisplayName(event.data),
  });

  return NextResponse.json({ received: true });
}
