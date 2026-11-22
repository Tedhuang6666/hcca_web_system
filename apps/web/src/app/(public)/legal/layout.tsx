import Link from "next/link";
import type { ReactNode } from "react";
import LegalNav from "@/components/legal/LegalNav";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";

export const metadata = {
  title: "法律專區 · 新竹高中班聯會數位整合系統",
  description: "隱私政策、服務條款、無障礙聲明、安全揭露政策",
};

export default async function LegalLayout({ children }: { children: ReactNode }) {
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="legal-document mx-auto max-w-4xl px-4 py-10 lg:py-14">
        <LegalNav />
        <article className="prose prose-slate max-w-none">{children}</article>
        <footer
          className="mt-12 border-t pt-4 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          <p>
            對本政策有疑問請
            <Link className="underline" href="/contact" style={{ color: "var(--text-primary)" }}>
              聯絡班聯會
            </Link>
            ；安全漏洞回報請見
            <Link className="underline" href="/legal/security-policy" style={{ color: "var(--text-primary)" }}>
              安全揭露政策
            </Link>
            。
          </p>
        </footer>
      </div>
    </PublicSiteShell>
  );
}
