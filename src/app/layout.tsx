import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { CurrencyProvider } from "@/components/currency-provider";
import { RouteScrollManager } from "@/components/route-scroll-manager";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: siteConfig.name,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#081225",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
          <Suspense fallback={null}>
            <RouteScrollManager />
          </Suspense>
          <div className="app-shell">
            <AppHeader />
            {children}
          </div>
        </CurrencyProvider>
      </body>
    </html>
  );
}
