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
  const navLinks = navItems.map((item) => {
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
        className={`header-nav-link shrink-0 px-2.5 py-2 text-xs sm:px-4 sm:text-sm ${
          isActive ? "header-nav-link-active" : ""
        }`}
      >
        {item.label}
      </Link>
    );
  });

  return (
    <>
      <header className="app-header sticky top-0 z-30 border-b border-yellow-300/20 bg-[#081225]/95">
        <div className="app-header-inner mx-auto flex w-full max-w-7xl flex-col items-stretch gap-2 px-2.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-3 sm:px-10 sm:py-4 lg:px-12">
          <div className="flex w-full min-w-0 flex-1 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-3">
            <Link href="/" className="header-brand-link group flex min-w-0 items-center gap-2 text-white sm:gap-3">
              <span className="pokeball-mark shrink-0" />
              <span className="leading-none">
                <span className="brand-title block text-base font-black tracking-normal text-yellow-200 drop-shadow sm:text-xl">
                  PokePokedex
                </span>
                <span className="brand-subtitle mt-1 hidden text-xs font-semibold uppercase tracking-[0.2em] text-blue-200 sm:block">
                  Trainer card lab
                </span>
              </span>
            </Link>
            <div className="hidden w-full max-w-full overflow-x-auto sm:block sm:w-auto">
              <nav aria-label="Primary navigation" className="flex min-w-max items-center justify-start gap-2">
                {navLinks}
              </nav>
            </div>
          </div>
          <CurrencySelector />
        </div>
      </header>

      <div className="header-tab-island sm:hidden">
        <nav aria-label="Mobile primary navigation" className="header-tab-nav grid w-full min-w-0 grid-cols-3 items-center gap-1">
          {navLinks}
        </nav>
      </div>
    </>
  );
}
