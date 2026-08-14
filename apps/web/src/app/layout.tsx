import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import "./accessibility.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import ClientErrorReporter from "@/components/providers/ClientErrorReporter";
import WebVitalsReporter from "@/components/providers/WebVitalsReporter";
import { BRANDING } from "@/lib/branding";
import { SOCIAL_IMAGE, SOCIAL_SHARE_TITLE, SOCIAL_SITE_NAME } from "@/lib/social-metadata";
import { SITE_URL } from "@/lib/seo";

const DEFAULT_DESCRIPTION = BRANDING.description;

// CSP nonce is generated per request by proxy.ts. Dynamic rendering lets Next.js
// propagate that nonce to inline runtime, JSON-LD and beforeInteractive scripts.
export const dynamic = "force-dynamic";

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

function ThemeScript() {
  return <Script src="/theme.js" strategy="beforeInteractive" />;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        <ClientErrorReporter />
        <WebVitalsReporter />
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
