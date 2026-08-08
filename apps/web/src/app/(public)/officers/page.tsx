import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import PublicOfficerDirectory from "@/components/site/PublicOfficerDirectory";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicBundle, fetchPublicOfficers } from "@/lib/serverFetch";

export const metadata = pageMetadata({
  title: "班聯會幹部名單",
  description: "查看新竹高中班聯會本屆幹部、組織與職務，找到適合的自治工作聯絡窗口。",
  path: "/officers",
  type: "website",
});

export default async function OfficersPage() {
  const [bundle, officers] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicOfficers(),
  ]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:pt-12">
        <header
          className="public-page-head mb-12 rounded-2xl border p-6 sm:p-8 lg:p-10"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          <Link href="/about" className="public-text-link inline-flex items-center gap-1.5">
            <ArrowLeft size={15} aria-hidden />
            返回關於班聯會
          </Link>
          <p className="mt-6 text-xs font-bold tracking-[0.16em] text-[var(--primary-text)]">HCCA / 公開名冊</p>
          <h1 className="mt-3 text-5xl font-bold tracking-[-0.04em] sm:text-6xl">班聯會幹部</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--text-secondary)]">
            認識正在服務校園的自治幹部，依組織與職位找到正確的聯絡對象。
          </p>
        </header>
        <PublicOfficerDirectory
          officers={officers}
          themeConfig={bundle?.settings?.theme_config}
          showFullPageLink={false}
        />
      </div>
    </PublicSiteShell>
  );
}
