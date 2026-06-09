import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { CurrencyProvider } from "@/components/currency-provider";
import { MobileAppGuard } from "@/components/mobile-app-guard";
import { RouteScrollManager } from "@/components/route-scroll-manager";
import { APP_SCROLL_ROOT_ID } from "@/lib/app-scroll";
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
    statusBarStyle: "black",
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
  maximumScale: 1,
  userScalable: false,
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
          <MobileAppGuard />
          <Suspense fallback={null}>
            <RouteScrollManager />
          </Suspense>
          <div id={APP_SCROLL_ROOT_ID} className="app-shell">
            <AppHeader />
            {children}
          </div>
        </CurrencyProvider>
      </body>
    </html>
  );
}
