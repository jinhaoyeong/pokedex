"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function SearchResultLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Link
      href={href}
      aria-busy={isPending}
      onClick={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }

        event.preventDefault();
        startTransition(() => {
          router.push(href);
        });
      }}
      className={`relative ${className ?? ""} ${isPending ? "pointer-events-none" : ""}`.trim()}
    >
      {isPending ? (
        <span className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-slate-950/55 backdrop-blur-[1px]">
          <span className="rounded-full border border-blue-300/35 bg-blue-500/15 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-blue-100">
            Opening card...
          </span>
        </span>
      ) : null}
      {children}
    </Link>
  );
}
