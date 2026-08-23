import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./accessibility.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import BarePageTransition from "@/components/layout/BarePageTransition";
import ClientErrorReporter from "@/components/providers/ClientErrorReporter";
import WebVitalsReporter from "@/components/providers/WebVitalsReporter";
import { BRANDING } from "@/lib/branding";
import { SOCIAL_IMAGE, SOCIAL_SHARE_TITLE, SOCIAL_SITE_NAME } from "@/lib/social-metadata";
import { SITE_URL } from "@/lib/seo";

const DEFAULT_DESCRIPTION = BRANDING.description;

// CSP nonce is generated per request by proxy.ts. Dynamic rendering keeps the
// nonce in the response header synchronized with Next.js inline bootstrap scripts.
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

function ThemeScript({ nonce }: { nonce: string | null }) {
  if (!nonce) return <script src="/theme.v1.js" defer />;

  // Apply the theme before the first paint so the root surface does not wait
  // for a separate request or flash between light and dark modes.
  const script = `(() => {
  try {
    let theme = localStorage.getItem("hcca-theme");
    if (!theme) {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch {}
})();`;

  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}

function StyleNonceBridge({ nonce }: { nonce: string | null }) {
  if (!nonce) return null;

  const script = `(() => {
    const nonce = ${JSON.stringify(nonce)};
    const createElement = document.createElement.bind(document);
    document.createElement = function(name, options) {
      const element = createElement(name, options);
      if (name.toLowerCase() === "style") element.setAttribute("nonce", nonce);
      return element;
    };
  })();`;

  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce");

  return (
    <html lang="zh-TW" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <StyleNonceBridge nonce={nonce} />
        <ThemeScript nonce={nonce} />
      </head>
      <body className="antialiased">
        <ClientErrorReporter />
        <WebVitalsReporter />
        <ThemeProvider>
          <ConfirmProvider>
            <BarePageTransition>{children}</BarePageTransition>
          </ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
