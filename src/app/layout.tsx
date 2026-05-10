import type { Metadata, Viewport } from "next";

import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { CurrencyProvider } from "@/components/currency-provider";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#050816",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <CurrencyProvider>
          <div className="app-shell">
            <AppHeader />
            {children}
          </div>
        </CurrencyProvider>
      </body>
    </html>
  );
}
