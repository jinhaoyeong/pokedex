"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { CurrencySelector } from "@/components/currency-selector";
import { BrandLogo } from "@/components/icons/brand-logo";

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
        "header-nav-link nav-link shrink-0 px-1 py-2 text-sm",
        isActive ? "header-nav-link-active nav-link-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </Link>
  );
}

function HeaderAuthControls() {
  const { isLoaded, isSignedIn } = useUser();

  return (
    <div className="header-auth-controls flex shrink-0 items-center justify-end gap-2">
      {isLoaded && !isSignedIn ? (
        <>
          <SignInButton mode="modal">
            <button type="button" className="header-auth-button header-auth-button-secondary">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button type="button" className="header-auth-button header-auth-button-primary">
              Sign Up
            </button>
          </SignUpButton>
        </>
      ) : null}
      {isLoaded && isSignedIn ? (
        <UserButton
          appearance={{
            elements: {
              avatarImage: "clerk-pokedex-avatar-image",
              avatarBox: "header-user-avatar",
              userButtonPopoverCard: "header-user-popover",
              userButtonPopoverActionButton: "header-user-popover-action",
              userButtonPopoverActionButtonText: "header-user-popover-action-text",
              userButtonPopoverFooter: "header-user-popover-footer",
            },
            variables: {
              colorBackground: "#071124",
              colorPrimary: "#E3350D",
              borderRadius: "0.75rem",
            },
          }}
        />
      ) : null}
    </div>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  const desktopNavLinks = navItems.map((item) => (
    <HeaderNavLink
      key={item.href}
      href={item.href}
      label={item.label}
      isActive={isNavItemActive(pathname, item.matches)}
    />
  ));

  return (
    <header className="app-header site-header sticky top-0 z-30">
      <div className="app-header-inner mx-auto flex w-full max-w-6xl flex-col items-stretch gap-2 px-2.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-3 sm:px-8 sm:py-5 lg:px-10">
        <div className="header-main-row flex w-full min-w-0 flex-1 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-9 sm:gap-y-3">
          <Link href="/" className="header-brand-link group flex min-w-0 items-center gap-2.5 text-white">
            <BrandLogo className="brand-logo h-7 w-7 shrink-0 sm:h-8 sm:w-8" />
            <span className="brand-title site-wordmark block text-base sm:text-lg">PokePokedex</span>
          </Link>
          <div className="hidden w-full max-w-full sm:block sm:w-auto">
            <nav aria-label="Primary navigation" className="site-nav flex min-w-max flex-wrap items-center justify-start gap-7">
              {desktopNavLinks}
            </nav>
          </div>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <CurrencySelector />
          {clerkEnabled ? <HeaderAuthControls /> : null}
        </div>
        <div className="mobile-currency-slot sm:hidden">
          <CurrencySelector />
        </div>
        {clerkEnabled ? (
          <div className="mobile-auth-slot sm:hidden">
            <HeaderAuthControls />
          </div>
        ) : null}
      </div>
    </header>
  );
}
