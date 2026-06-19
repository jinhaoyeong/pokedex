import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import "./globals.css";
import { AppBootSplash } from "@/components/app-boot-splash";
import { BackgroundCatalogWarmup } from "@/components/background-catalog-warmup";
import { AmbientBackdrop } from "@/components/fx/ambient-backdrop";
import { RouteTransition } from "@/components/fx/route-transition";
import { AppHeader } from "@/components/app-header";
import { MobileNavDock } from "@/components/mobile-nav-dock";
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
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem("pokedex_boot_ready_v2")){document.documentElement.classList.add("app-ready")}}catch(e){}`,
          }}
        />
        <CurrencyProvider>
          <AmbientBackdrop />
          <AppBootSplash />
          <BackgroundCatalogWarmup />
          <MobileAppGuard />
          <Suspense fallback={null}>
            <RouteScrollManager />
          </Suspense>
          <div id={APP_SCROLL_ROOT_ID} className="app-shell app-shell--booting">
            <AppHeader />
            <RouteTransition>{children}</RouteTransition>
          </div>
          <MobileNavDock />
        </CurrencyProvider>
      </body>
    </html>
  );
}
