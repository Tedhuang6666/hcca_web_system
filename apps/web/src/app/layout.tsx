import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import "./globals.css";
import "./accessibility.css";
import "./design-system.css";
import { Toaster } from "sonner";
import AppShell from "@/components/layout/AppShell";
import GoogleOneTap from "@/components/auth/GoogleOneTap";
import PwaInstallPrompt from "@/components/pwa/PwaInstallPrompt";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import TelemetryProvider from "@/components/providers/TelemetryProvider";
import AccessBlockGuard from "@/components/security/AccessBlockGuard";
import ScrollProgressBar from "@/components/ui/ScrollProgressBar";
import NavigationProgress from "@/components/layout/NavigationProgress";
import { BRANDING } from "@/lib/branding";
import { SOCIAL_IMAGE, SOCIAL_SHARE_TITLE, SOCIAL_SITE_NAME } from "@/lib/social-metadata";
import { SITE_URL } from "@/lib/seo";

const DEFAULT_DESCRIPTION = BRANDING.description;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SOCIAL_SITE_NAME,
  title: { default: SOCIAL_SHARE_TITLE, template: `%s｜${SOCIAL_SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  authors: [{ name: BRANDING.orgShortName, url: "/" }],
  creator: BRANDING.orgShortName,
  publisher: BRANDING.orgShortName,
  category: "education",
  other: {
    google: "notranslate",
  },
  keywords: [
    BRANDING.orgShortName,
    BRANDING.acronym,
    BRANDING.schoolName,
    "校園自治",
    "學生自治",
    "班聯會",
  ],
  referrer: "origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/hcca-emblem-192.png", type: "image/png", sizes: "192x192" },
      { url: "/brand/hcca-emblem-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/brand/hcca-emblem-apple.png", type: "image/png", sizes: "180x180" }],
    shortcut: ["/brand/hcca-emblem-192.png"],
  },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: SOCIAL_SITE_NAME,
    title: SOCIAL_SHARE_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: "/",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_SHARE_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [{ url: SOCIAL_IMAGE.url, alt: SOCIAL_IMAGE.alt }],
  },
};

export const viewport: Viewport = {
  themeColor: BRANDING.themeColor,
  viewportFit: "cover",
};

async function ThemeScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const script = `
    (function(){
      try {
        var t = localStorage.getItem('hcca-theme');
        if (!t) {
          t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', t);
      } catch(e) {}
    })();
  `;
  // 瀏覽器在解析後會隱藏 nonce 屬性（nonce hiding），client 端會看到空字串，
  // 造成預期內的 hydration 不一致，故在此元素抑制警告。
  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <AccessBlockGuard />
          <NavigationProgress />
          <ScrollProgressBar />
          <Suspense fallback={null}>
            <TelemetryProvider />
          </Suspense>
          <AppShell>{children}</AppShell>
          <Suspense fallback={null}>
            <GoogleOneTap />
          </Suspense>
          <PwaInstallPrompt />
          <Toaster
            position="top-right"
            richColors
            toastOptions={{
              style: {
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-primary)",
                fontSize: "0.875rem",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
