import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  FileSearch,
  Handshake,
} from "lucide-react";

import PublicHomeServices from "./PublicHomeServices";
import { fetchPublicModuleStatuses } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "公開資料與校園服務",
  description: "查詢公開法規、公文、即時開票與校園自治服務。",
  path: "/public",
  type: "website",
});

const DATABASES = [
  {
    href: "/regulations",
    title: "法規資料庫",
    description: "現行條文與修正沿革",
    icon: BookOpenText,
  },
  {
    href: "/documents",
    title: "公文資料庫",
    description: "公開公文、附件與基本資訊",
    icon: FileSearch,
  },
  {
    href: "/public/special-agreement",
    title: "特約洽談",
    description: "合作流程與參考文件",
    icon: Handshake,
  },
];

export default async function PublicHomePage() {
  const statuses = await fetchPublicModuleStatuses();
  const initialClosedModuleIds = statuses
    .filter((status) => status.on && status.mode === "closed")
    .map((status) => status.id)
    .filter((id): id is "elections" | "petitions" => id === "elections" || id === "petitions");

  return (
    <div className="space-y-10 pb-8">
      <header className="public-page-head">
        <h1 className="text-3xl font-semibold">公開資料與校園服務</h1>
      </header>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-semibold">查詢資料</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {DATABASES.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 transition-colors hover:border-[var(--public-accent)] hover:bg-[var(--public-soft)]"
              >
                <div className="flex items-start justify-between gap-5">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--public-accent-soft)] text-[var(--public-accent)]">
                    <Icon size={24} aria-hidden />
                  </span>
                  <ArrowRight
                    size={20}
                    className="text-[var(--public-muted)] transition-colors group-hover:text-[var(--public-accent)]"
                    aria-hidden
                  />
                </div>
                <h3 className="mt-7 text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[var(--public-secondary)]">
                  {item.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <PublicHomeServices initialClosedModuleIds={initialClosedModuleIds} />
    </div>
  );
}
