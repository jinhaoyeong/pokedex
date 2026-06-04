"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CurrencySelector } from "@/components/currency-selector";

const navItems = [
  { href: "/", label: "Base Camp", matches: ["/"] },
  { href: "/search", label: "Card Dex", matches: ["/search", "/cards"] },
  { href: "/portfolio", label: "Binder", matches: ["/portfolio"] },
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-yellow-300/20 bg-[#081225]/95">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 py-3 sm:px-10 sm:py-4 lg:px-12">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
          <Link href="/" className="group flex items-center gap-3 text-white">
            <span className="pokeball-mark shrink-0" />
            <span className="leading-none">
              <span className="brand-title block text-lg font-black tracking-normal text-yellow-200 drop-shadow sm:text-xl">
                PokePokedex
              </span>
              <span className="brand-subtitle mt-1 hidden text-xs font-semibold uppercase tracking-[0.2em] text-blue-200 sm:block">
                Trainer card lab
              </span>
            </span>
          </Link>
          <div className="-mx-1 max-w-full overflow-x-auto px-1">
            <nav aria-label="Primary navigation" className="flex min-w-max items-center gap-2">
              {navItems.map((item) => {
                const isActive = item.matches.some((match) =>
                  match === "/"
                    ? pathname === "/"
                    : pathname === match || pathname.startsWith(`${match}/`),
                );

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={item.href === "/search" || item.href === "/"}
                    aria-current={isActive ? "page" : undefined}
                    className={`header-nav-link shrink-0 px-4 py-2 text-sm ${
                      isActive ? "header-nav-link-active" : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        <CurrencySelector />
      </div>
    </header>
  );
}
