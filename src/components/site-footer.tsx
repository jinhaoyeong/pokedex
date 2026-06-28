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

/** Quiet, editorial footer — brand mark, one line of intent, and the routes. */
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
          The quiet workspace for Pokémon TCG collectors — search, price and track every card.
        </p>
        <div className="site-footer-base">
          <span>© {new Date().getFullYear()} PokePokedex</span>
          <span>Live pricing from public sources · No affiliation with Nintendo or The Pokémon Company.</span>
          <span>build {buildStamp()}</span>
        </div>
      </div>
    </footer>
  );
}
