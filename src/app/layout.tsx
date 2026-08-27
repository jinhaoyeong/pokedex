import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter, Space_Grotesk } from "next/font/google";

import "./globals.css";
import { AppBootSplash } from "@/components/app-boot-splash";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
import { BackgroundCatalogWarmup } from "@/components/background-catalog-warmup";
import { AmbientBackdrop } from "@/components/fx/ambient-backdrop";
import { RouteTransition } from "@/components/fx/route-transition";
import { AppHeader } from "@/components/app-header";
import { MobileNavDock } from "@/components/mobile-nav-dock";
import { CurrencyProviderHost } from "@/components/currency-provider-host";
import { MobileAppGuard } from "@/components/mobile-app-guard";
import { RouteScrollManager } from "@/components/route-scroll-manager";
import { APP_SCROLL_ROOT_ID } from "@/lib/app-scroll";
import { BOOT_SESSION_KEY } from "@/lib/client-catalog-cache";
import { getCurrencyBootScript } from "@/lib/currency-preference";
import { siteConfig } from "@/lib/site";

const CLERK_POKEDEX_RED = "#E3350D";

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
  themeColor: "#081124",
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
  // Clerk is optional: without keys the app renders exactly as before.
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  const app = (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable}`}
      style={{ backgroundColor: "#081124" }}
    >
      <body style={{ backgroundColor: "#081124" }}>
        <script
          dangerouslySetInnerHTML={{
            __html: getCurrencyBootScript(),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var k=${JSON.stringify(BOOT_SESSION_KEY)};var p=location.pathname;var skip=p!=="/";if(skip||sessionStorage.getItem(k)){if(skip){try{sessionStorage.setItem(k,"1")}catch(e){}}document.documentElement.classList.add("app-ready")}else{setTimeout(function(){try{if(!document.documentElement.classList.contains("app-ready")){sessionStorage.setItem(k,"1");document.documentElement.classList.add("app-ready");window.dispatchEvent(new Event("pokedex-boot-complete"))}}catch(e){}},4500)}}catch(e){}`,
          }}
        />
        <CurrencyProviderHost>
          <AmbientBackdrop />
          <AppBootSplash />
          <BackgroundCatalogWarmup />
          <MobileAppGuard />
          <Suspense fallback={null}>
            <RouteScrollManager />
          </Suspense>
          <div id={APP_SCROLL_ROOT_ID} className="app-shell app-shell--booting">
            <AppHeader clerkEnabled={clerkEnabled} />
            <RouteTransition>{children}</RouteTransition>
          </div>
          <MobileNavDock />
        </CurrencyProviderHost>
      </body>
    </html>
  );

  return clerkEnabled ? (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: CLERK_POKEDEX_RED,
        },
        elements: {
          avatarImage: "clerk-pokedex-avatar-image",
          modalBackdrop: "clerk-pokedex-modal-backdrop",
          modalContent: "clerk-pokedex-modal-content",
        },
      }}
    >
      {app}
    </ClerkProvider>
  ) : (
    app
  );
}
