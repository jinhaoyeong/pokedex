import { NextResponse } from "next/server";

import { scheduleCardBackgroundRefresh } from "@/lib/card-learning.server";
import { parseCardFeedback, type FeedbackIssueType } from "@/lib/feedback-parser";
import { listCardCorrections, recordCardCorrection } from "@/lib/pokemon-cards-cache.server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim();

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  return NextResponse.json({ corrections: listCardCorrections(slug) });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    slug?: string;
    field?: "price" | "identity";
    issueType?: FeedbackIssueType;
    reportedValue?: string;
    note?: string;
    expectedPrice?: string;
    expectedGrade?: string;
    correctName?: string;
    correctSet?: string;
    correctNumber?: string;
    parsed?: ReturnType<typeof parseCardFeedback>;
  };

  const slug = payload.slug?.trim();

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const parsed =
    payload.parsed ??
    parseCardFeedback({
      issueType: payload.issueType ?? "other",
      note: payload.note,
      expectedPrice: payload.expectedPrice,
      expectedGrade: payload.expectedGrade,
      correctName: payload.correctName,
      correctSet: payload.correctSet,
      correctNumber: payload.correctNumber,
    });

  const field = payload.field === "price" || payload.field === "identity" ? payload.field : parsed.field;

  if (field !== "price" && field !== "identity") {
    return NextResponse.json({ error: "field is required" }, { status: 400 });
  }

  recordCardCorrection({
    slug,
    field,
    issueType: parsed.issueType,
    reportedValue: payload.reportedValue?.trim() || parsed.reportedValue,
    note: payload.note?.trim() || parsed.note || parsed.summary,
    parsed,
  });

  scheduleCardBackgroundRefresh(slug);

  return NextResponse.json({
    ok: true,
    parsed,
  });
}
