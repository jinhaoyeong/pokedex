import Link from "next/link";

import { CurrencySelector } from "@/components/currency-selector";

const navItems = [
  { href: "/", label: "Base Camp" },
  { href: "/search", label: "Card Dex" },
  { href: "/portfolio", label: "Binder" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-yellow-300/20 bg-[#081225]/95">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-10 sm:py-4 lg:px-12">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="group flex items-center gap-3 text-white">
            <span className="pokeball-mark shrink-0" />
            <span className="leading-none">
              <span className="block text-lg font-black tracking-normal text-yellow-200 drop-shadow sm:text-xl">
                PokePokedex
              </span>
              <span className="mt-1 hidden text-xs font-semibold uppercase tracking-[0.2em] text-blue-200 sm:block">
                Trainer card lab
              </span>
            </span>
          </Link>
          <CurrencySelector />
        </div>
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <nav className="flex min-w-max gap-2.5 pb-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={item.href === "/search" || item.href === "/"}
                className="header-nav-link shrink-0 px-3.5 py-2 text-sm text-yellow-50 sm:px-4"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
