import Link from "next/link";

import { BrandLogo } from "@/components/icons/brand-logo";

const footerLinks = [
  { href: "/search", label: "Card Dex" },
  { href: "/search?sort=price-desc", label: "Market" },
  { href: "/portfolio", label: "Binder" },
  { href: "/settings", label: "Settings" },
];

/**
 * Build/deploy marker. On Vercel these env vars are injected at build time, so
 * the value reflects exactly which commit/branch is live — making it obvious
 * whether the running deployment includes the latest fixes (vs. a stale build).
 */
function buildStamp() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const ref = process.env.VERCEL_GIT_COMMIT_REF;

  if (!sha) {
    return "dev";
  }

  return ref ? `${ref}@${sha}` : sha;
}

/** Quiet, compact footer — brand, short intent line, legal; routes live in the dock on mobile. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner mx-auto w-full max-w-6xl">
        <div className="site-footer-top">
          <div className="site-footer-brand">
            <BrandLogo className="brand-logo h-6 w-6 shrink-0" />
            <span className="site-wordmark">PokePokedex</span>
          </div>
          <nav aria-label="Footer" className="site-footer-nav">
            {footerLinks.map((link) => (
              <Link key={link.href} href={link.href} className="site-footer-link">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="site-footer-tagline">
          Search, price and track every Pokémon TCG card.
        </p>
        <div className="site-footer-base">
          <span>© {new Date().getFullYear()} PokePokedex</span>
          <span>Live pricing from public sources · Unofficial fan project.</span>
          <span>build {buildStamp()}</span>
        </div>
      </div>
    </footer>
  );
}
