"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CurrencySelector } from "@/components/currency-selector";
import { BrandLogo } from "@/components/icons/brand-logo";

const ClerkHeaderAuthControls = dynamic(
  () => import("@/components/clerk-auth-controls").then((module) => module.ClerkHeaderAuthControls),
  { ssr: false, loading: () => null },
);

const navItems = [
  { href: "/", label: "Home", matches: ["/"] },
  { href: "/search", label: "Dex", matches: ["/search", "/cards"] },
  { href: "/portfolio", label: "Binder", matches: ["/portfolio"] },
  { href: "/settings", label: "Settings", matches: ["/settings"] },
] as const;

function isNavItemActive(pathname: string, matches: readonly string[]) {
  return matches.some((match) =>
    match === "/" ? pathname === "/" : pathname === match || pathname.startsWith(`${match}/`),
  );
}

function HeaderNavLink({ href, label, isActive }: { href: string; label: string; isActive: boolean }) {
  return <Link href={href} prefetch aria-current={isActive ? "page" : undefined} title={label} className={["header-nav-link nav-link shrink-0 px-1 py-2 text-sm", isActive ? "header-nav-link-active nav-link-active" : ""].filter(Boolean).join(" ")}>{label}</Link>;
}

export function AppHeader({ clerkEnabled }: { clerkEnabled: boolean }) {
  const pathname = usePathname();
  const desktopNavLinks = navItems.map((item) => <HeaderNavLink key={item.href} href={item.href} label={item.label} isActive={isNavItemActive(pathname, item.matches)} />);

  return (
    <header className="app-header site-header sticky top-0 z-30">
      <div className="app-header-inner app-frame flex w-full flex-col items-stretch gap-2 py-2.5 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-5 sm:gap-y-0 sm:py-5">
        <div className="header-main-row flex w-full min-w-0 flex-1 items-center sm:w-auto sm:justify-self-start">
          <Link href="/" className="header-brand-link group flex min-w-0 items-center gap-2.5 text-white"><BrandLogo className="brand-logo h-7 w-7 shrink-0 sm:h-8 sm:w-8" /><span className="brand-title site-wordmark block text-base sm:text-lg">PokePokedex</span></Link>
        </div>
        <nav aria-label="Primary navigation" className="site-nav header-center-nav hidden min-w-max items-center justify-center gap-7 sm:flex sm:justify-self-center">{desktopNavLinks}</nav>
        <div className="header-end-actions hidden items-center justify-end gap-3 sm:flex sm:justify-self-end"><CurrencySelector />{clerkEnabled ? <ClerkHeaderAuthControls /> : null}</div>
        <div className="mobile-header-actions sm:hidden">{clerkEnabled ? <ClerkHeaderAuthControls mobile /> : null}<div className="mobile-currency-slot"><CurrencySelector /></div></div>
      </div>
    </header>
  );
}
