import PublicSiteShell from "@/components/site/PublicSiteShell";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import { fetchPublicShellData } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "關於班聯會",
  description: "了解新竹高中班聯會的使命、沿革、組織與聯絡方式。",
  path: "/about",
  type: "website",
});

export default async function AboutPage() {
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();
  const settings = bundle?.settings;

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 lg:pt-12">
        <section>
          <header className="public-page-head mb-8">
            <h1 className="text-3xl font-bold">{settings?.about_title ?? "關於班聯會"}</h1>
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
      </div>
    </PublicSiteShell>
  );
}
