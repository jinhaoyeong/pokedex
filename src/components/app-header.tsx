import Link from "next/link";

import { CurrencySelector } from "@/components/currency-selector";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/search", label: "Search" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/psa-import", label: "PSA Import" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/8 bg-slate-950/75 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4 sm:px-10 lg:px-12">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            PokePokedex
          </Link>
          <nav className="hidden gap-4 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-slate-300 transition-colors hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <CurrencySelector />
      </div>
    </header>
  );
}
