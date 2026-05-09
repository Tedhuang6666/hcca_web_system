import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import AppShell from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import ScrollProgressBar from "@/components/ui/ScrollProgressBar";

export const metadata: Metadata = {
  title: { default: "校園自治整合平台", template: "%s · HCCA" },
  description: "Campus Self-Governance Integration Platform — 服務學生代表大會的數位治理工具",
};

function ThemeScript() {
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
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Noto+Serif+TC:wght@400;500;600;700&display=swap"
          data-href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Noto+Serif+TC:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <ScrollProgressBar />
          <AppShell>{children}</AppShell>
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
