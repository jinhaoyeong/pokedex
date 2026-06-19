"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CurrencySelector } from "@/components/currency-selector";

const navItems = [
  { href: "/", label: "Base Camp", code: "DEX-00", matches: ["/"] },
  { href: "/search", label: "Card Dex", code: "DEX-01", matches: ["/search", "/cards"] },
  { href: "/portfolio", label: "Binder", code: "DEX-02", matches: ["/portfolio"] },
  { href: "/settings", label: "Settings", code: "DEX-03", matches: ["/settings"] },
] as const;

function isNavItemActive(pathname: string, matches: readonly string[]) {
  return matches.some((match) =>
    match === "/" ? pathname === "/" : pathname === match || pathname.startsWith(`${match}/`),
  );
}

function HeaderNavLink({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={isActive ? "page" : undefined}
      title={label}
      className={[
        "header-nav-link dex-nav-link shrink-0 px-3 py-2 text-xs sm:px-4 sm:text-sm",
        isActive ? "header-nav-link-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="dex-nav-dot" aria-hidden="true" />
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
      isActive={isNavItemActive(pathname, item.matches)}
    />
  ));

  return (
    <header className="app-header dex-header sticky top-0 z-30">
      <div className="dex-header-rivets" aria-hidden="true">
        <span /> <span /> <span /> <span />
      </div>
      <div className="app-header-inner mx-auto flex w-full max-w-7xl flex-col items-stretch gap-2 px-2.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-3 sm:px-10 sm:py-4 lg:px-12">
        <div className="header-main-row flex w-full min-w-0 flex-1 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-3">
          <Link href="/" className="header-brand-link group flex min-w-0 items-center gap-3 text-white">
            <span className="dex-lens shrink-0" aria-hidden="true">
              <span className="dex-lens-glint" />
            </span>
            <span className="dex-lights shrink-0" aria-hidden="true">
              <i className="dex-led dex-led--red" />
              <i className="dex-led dex-led--yellow" />
              <i className="dex-led dex-led--green" />
            </span>
            <span className="min-w-0">
              <span className="brand-title dex-brand-title block text-base font-black tracking-normal text-yellow-200 drop-shadow sm:text-xl">
                PokéDex OS
              </span>
              <span className="brand-subtitle dex-brand-sub mt-0.5 hidden text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-cyan-200 sm:block">
                Trainer terminal · online
              </span>
            </span>
          </Link>
          <div className="hidden w-full max-w-full overflow-x-auto sm:block sm:w-auto">
            <nav aria-label="Primary navigation" className="dex-nav flex min-w-max items-center justify-start gap-1.5">
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
      <span className="dex-header-pulse" aria-hidden="true" />
    </header>
  );
}
