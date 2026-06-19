"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CurrencySelector } from "@/components/currency-selector";

const navItems = [
  { href: "/", label: "Base Camp", type: "fire", matches: ["/"] },
  { href: "/search", label: "Card Dex", type: "water", matches: ["/search", "/cards"] },
  { href: "/portfolio", label: "Binder", type: "grass", matches: ["/portfolio"] },
  { href: "/settings", label: "Settings", type: "electric", matches: ["/settings"] },
] as const;

function isNavItemActive(pathname: string, matches: readonly string[]) {
  return matches.some((match) =>
    match === "/" ? pathname === "/" : pathname === match || pathname.startsWith(`${match}/`),
  );
}

function HeaderNavLink({
  href,
  label,
  type,
  isActive,
}: {
  href: string;
  label: string;
  type: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={isActive ? "page" : undefined}
      title={label}
      data-type={type}
      className={[
        "header-nav-link poke-tab shrink-0 px-3 py-2 text-xs sm:px-4 sm:text-sm",
        isActive ? "header-nav-link-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </Link>
  );
}

export function AppHeader() {
  const pathname = usePathname();

  const desktopNavLinks = navItems.map((item) => (
    <HeaderNavLink
      key={item.href}
      href={item.href}
      label={item.label}
      type={item.type}
      isActive={isNavItemActive(pathname, item.matches)}
    />
  ));

  return (
    <header className="app-header poke-header sticky top-0 z-30">
      <div className="app-header-inner mx-auto flex w-full max-w-7xl flex-col items-stretch gap-2 px-2.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-3 sm:px-10 sm:py-4 lg:px-12">
        <div className="header-main-row flex w-full min-w-0 flex-1 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-3">
          <Link href="/" className="header-brand-link group flex min-w-0 items-center gap-2.5 text-white sm:gap-3">
            <span className="pokeball-mark poke-ball-wiggle shrink-0" />
            <span className="min-w-0">
              <span className="brand-title poke-wordmark block text-base font-black tracking-normal sm:text-xl">
                PokéDex
              </span>
              <span className="brand-subtitle poke-brand-sub mt-0.5 hidden text-[0.62rem] font-bold uppercase tracking-[0.28em] sm:block">
                Trainer Card Lab
              </span>
            </span>
          </Link>
          <div className="hidden w-full max-w-full overflow-x-auto sm:block sm:w-auto">
            <nav aria-label="Primary navigation" className="poke-nav flex min-w-max items-center justify-start gap-2">
              {desktopNavLinks}
            </nav>
          </div>
        </div>
        <div className="hidden sm:block">
          <CurrencySelector />
        </div>
        <div className="mobile-currency-slot sm:hidden">
          <CurrencySelector />
        </div>
      </div>
    </header>
  );
}
