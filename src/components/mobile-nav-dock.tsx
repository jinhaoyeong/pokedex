"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import { createPortal } from "react-dom";

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

function prefetchNavRoutes(router: ReturnType<typeof useRouter>) {
  for (const item of navItems) {
    router.prefetch(item.href);
  }
}

function MobileNavLink({
  href,
  label,
  mobileLabel,
  Icon,
  isActive,
  onIntent,
}: {
  href: string;
  label: string;
  mobileLabel: string;
  Icon: ComponentType<NavIconProps>;
  isActive: boolean;
  onIntent: () => void;
}) {
  return (
    <Link
      href={href}
      prefetch
      onPointerEnter={onIntent}
      onPointerDown={onIntent}
      aria-current={isActive ? "page" : undefined}
      aria-label={label}
      title={label}
      className={[
        "header-nav-link header-tab-link shrink-0",
        isActive ? "header-nav-link-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon className="header-tab-icon" aria-hidden="true" />
      <span className="header-tab-label">{mobileLabel}</span>
    </Link>
  );
}

function MobileNavDockPanel() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    prefetchNavRoutes(router);

    const onBootReady = () => {
      prefetchNavRoutes(router);
    };

    window.addEventListener("pokedex-boot-complete", onBootReady);
    return () => window.removeEventListener("pokedex-boot-complete", onBootReady);
  }, [router]);

  return (
    <div className="header-tab-island poke-dock-island sm:hidden">
      <nav
        aria-label="Mobile primary navigation"
        className="header-tab-nav poke-dock grid w-full min-w-0 grid-cols-4 items-stretch gap-0.5"
      >
        {navItems.map((item) => (
          <MobileNavLink
            key={item.href}
            href={item.href}
            label={item.label}
            mobileLabel={item.mobileLabel}
            Icon={item.Icon}
            isActive={isNavItemActive(pathname, item.matches)}
            onIntent={() => router.prefetch(item.href)}
          />
        ))}
      </nav>
    </div>
  );
}

function subscribeClientMounted() {
  return () => {};
}

function getClientMounted() {
  return true;
}

export function MobileNavDock() {
  const mounted = useSyncExternalStore(subscribeClientMounted, getClientMounted, () => false);

  if (!mounted) {
    return null;
  }

  return createPortal(<MobileNavDockPanel />, document.body);
}
