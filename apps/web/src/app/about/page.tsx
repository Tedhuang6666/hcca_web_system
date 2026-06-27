import PublicSiteShell from "@/components/site/PublicSiteShell";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import { fetchPublicBundle } from "@/lib/serverFetch";

export default async function AboutPage() {
  const bundle = await fetchPublicBundle();
  const settings = bundle?.settings;

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={settings}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">About HCCA</p>
          <h1 className="mt-2 text-3xl font-bold">{settings?.about_title ?? "關於班聯會"}</h1>
          {settings?.site_description && (
            <p className="mt-3 text-base leading-8 text-[var(--text-secondary)]">
              {settings.site_description}
            </p>
          )}
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
      </div>
    </PublicSiteShell>
  );
}
