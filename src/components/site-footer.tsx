import Link from "next/link";

const footerLinks = [
  { href: "/search", label: "Card Dex" },
  { href: "/search?sort=price-desc", label: "Market" },
  { href: "/portfolio", label: "Binder" },
  { href: "/settings", label: "Settings" },
];

/** Quiet, editorial footer — brand mark, one line of intent, and the routes. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner mx-auto w-full max-w-6xl">
        <div className="site-footer-top">
          <div className="site-footer-brand">
            <span className="brand-dot" aria-hidden="true" />
            <span className="site-wordmark">PokéDex</span>
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
          <span>© {new Date().getFullYear()} PokéDex</span>
          <span>Live pricing from public sources · No affiliation with Nintendo or The Pokémon Company.</span>
        </div>
      </div>
    </footer>
  );
}
