"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";

import { CurrencySelector } from "@/components/currency-selector";

type NavIconProps = SVGProps<SVGSVGElement>;

const navItems = [
  {
    href: "/",
    label: "Base Camp",
    mobileLabel: "Home",
    matches: ["/"],
    Icon: function NavHomeIcon({ className, ...props }: NavIconProps) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
      );
    },
  },
  {
    href: "/search",
    label: "Card Dex",
    mobileLabel: "Dex",
    matches: ["/search", "/cards"],
    Icon: function NavDexIcon({ className, ...props }: NavIconProps) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
          <rect x="4" y="5" width="11" height="14" rx="1.5" />
          <path strokeLinecap="round" d="M9 9h2M9 12h2M9 15h2" />
          <circle cx="16.5" cy="15.5" r="3.25" />
          <path strokeLinecap="round" d="m18.6 17.6 1.9 1.9" />
        </svg>
      );
    },
  },
  {
    href: "/portfolio",
    label: "Binder",
    mobileLabel: "Binder",
    matches: ["/portfolio"],
    Icon: function NavBinderIcon({ className, ...props }: NavIconProps) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 5h9a3 3 0 0 1 3 3v12H9a3 3 0 0 1-3-3V5Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9H5a2 2 0 0 0-2 2v8h3" />
          <path strokeLinecap="round" d="M9 9h6M9 13h4" />
        </svg>
      );
    },
  },
  {
    href: "/settings",
    label: "Settings",
    mobileLabel: "Settings",
    matches: ["/settings"],
    Icon: function NavSettingsIcon({ className, ...props }: NavIconProps) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
          <circle cx="12" cy="12" r="2.75" />
          <path
            strokeLinecap="round"
            d="M12 3v2.1M12 18.9V21M3 12h2.1M18.9 12H21M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"
          />
        </svg>
      );
    },
  },
] as const;

function isNavItemActive(pathname: string, matches: readonly string[]) {
  return matches.some((match) =>
    match === "/" ? pathname === "/" : pathname === match || pathname.startsWith(`${match}/`),
  );
}

function HeaderNavLink({
  href,
  label,
  mobileLabel,
  Icon,
  isActive,
  variant,
}: {
  href: string;
  label: string;
  mobileLabel: string;
  Icon: ComponentType<NavIconProps>;
  isActive: boolean;
  variant: "desktop" | "mobile";
}) {
  const className = [
    "header-nav-link shrink-0",
    variant === "desktop" ? "px-2.5 py-2 text-xs sm:px-4 sm:text-sm" : "header-tab-link",
    isActive ? "header-nav-link-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href={href}
      prefetch={href === "/search" || href === "/"}
      aria-current={isActive ? "page" : undefined}
      aria-label={variant === "mobile" ? label : undefined}
      title={label}
      className={className}
    >
      {variant === "mobile" ? (
        <>
          <Icon className="header-tab-icon" aria-hidden="true" />
          <span className="header-tab-label">{mobileLabel}</span>
        </>
      ) : (
        label
      )}
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
      mobileLabel={item.mobileLabel}
      Icon={item.Icon}
      isActive={isNavItemActive(pathname, item.matches)}
      variant="desktop"
    />
  ));

  const mobileNavLinks = navItems.map((item) => (
    <HeaderNavLink
      key={item.href}
      href={item.href}
      label={item.label}
      mobileLabel={item.mobileLabel}
      Icon={item.Icon}
      isActive={isNavItemActive(pathname, item.matches)}
      variant="mobile"
    />
  ));

  return (
    <>
      <header className="app-header sticky top-0 z-30 border-b border-yellow-300/20 bg-[#081225]/95">
        <div className="app-header-inner mx-auto flex w-full max-w-7xl flex-col items-stretch gap-2 px-2.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-3 sm:px-10 sm:py-4 lg:px-12">
          <div className="header-main-row flex w-full min-w-0 flex-1 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-3">
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

      <div className="header-tab-island sm:hidden">
        <nav
          aria-label="Mobile primary navigation"
          className="header-tab-nav grid w-full min-w-0 grid-cols-4 items-stretch gap-0.5"
        >
          {mobileNavLinks}
        </nav>
      </div>
    </>
  );
}
