import PublicSiteShell from "@/components/site/PublicSiteShell";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicOfficerDirectory from "@/components/site/PublicOfficerDirectory";
import PublicContactSection from "@/components/site/PublicContactSection";
import { fetchPublicOfficers, fetchPublicShellData } from "@/lib/serverFetch";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "關於班聯會",
  description: "了解新竹高中班聯會的使命、沿革、組織與聯絡方式。",
  path: "/about",
  type: "website",
});

export default async function AboutPage() {
  const [{ bundle, urgentAnnouncement }, officers] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicOfficers(),
  ]);
  const settings = bundle?.settings;

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 lg:pt-12">
        <section id="about" className="scroll-mt-24">
          <header className="public-page-head mb-8">
            <p className="public-section-kicker">About HCCA</p>
            <h1 className="mt-2 text-3xl font-bold">{settings?.about_title ?? "關於班聯會"}</h1>
            {settings?.site_description && (
              <p className="mt-3 text-base leading-8 text-[var(--text-secondary)]">
                {settings.site_description}
              </p>
            )}
            <Link href="#officers" className="public-text-link mt-5 inline-flex items-center gap-1.5">
              直接跳到班聯會幹部
              <ArrowDown size={15} aria-hidden />
            </Link>
          </header>
          <section className="card p-6" data-reveal>
            <MarkdownBlock markdown={settings?.about_body_md} />
          </section>
          {(settings?.mission_md || settings?.history_md) && (
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {settings?.mission_md && (
                <section className="card p-5" data-reveal style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
                  <h2 className="mb-3 text-lg font-semibold">使命</h2>
                  <MarkdownBlock markdown={settings.mission_md} />
                </section>
              )}
              {settings?.history_md && (
                <section className="card p-5" data-reveal style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
                  <h2 className="mb-3 text-lg font-semibold">沿革</h2>
                  <MarkdownBlock markdown={settings.history_md} />
                </section>
              )}
            </div>
          )}
        </section>

        <section id="officers" className="mt-20 scroll-mt-24 border-t pt-12" style={{ borderColor: "var(--border)" }}>
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="public-section-kicker">People behind the work</p>
              <h2 className="mt-2 text-3xl font-bold">班聯會幹部</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">
                認識正在服務校園的自治幹部；同一部門的長級職位會以特別樣式標示。
              </p>
            </div>
            <Link href="/officers" className="public-text-link inline-flex items-center gap-1.5">
              開啟幹部專頁
              <ArrowUpRight size={15} aria-hidden />
            </Link>
          </div>
          <PublicOfficerDirectory officers={officers} themeConfig={settings?.theme_config} showHeading={false} />
        </section>

        <PublicContactSection markdown={settings?.contact_md} />
      </div>
    </PublicSiteShell>
  );
}
