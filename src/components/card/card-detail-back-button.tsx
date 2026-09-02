"use client";

import { useRouter } from "next/navigation";

export function CardDetailBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="breadcrumb-link card-detail-back"
      aria-label="Go back to the previous page"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }

        router.push("/search");
      }}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
        <path
          d="m11.75 5.25-4.5 4.75 4.5 4.75"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Back</span>
    </button>
  );
}
