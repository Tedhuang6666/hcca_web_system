import Link from "next/link";
import { ArrowRight } from "lucide-react";

import PublicHomeServices from "./PublicHomeServices";
import { fetchPublicModuleStatuses } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "公開資料與校園服務",
  description: "查詢公開法規、公文、即時開票與學生自治服務。",
  path: "/public",
  type: "website",
});

const DATABASES = [
  {
    href: "/regulations",
    title: "法規資料庫",
    description: "現行條文與修正沿革",
  },
  {
    href: "/documents",
    title: "公文資料庫",
    description: "公開公文、附件與基本資訊",
  },
  {
    href: "/public/budgets",
    title: "財務總覽",
    description: "公開預算、支出總額與最近支出紀錄",
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

      <PublicHomeServices initialClosedModuleIds={initialClosedModuleIds} />

      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-semibold">查詢資料</h2>
        </div>
        <div className="public-directory-list">
          {DATABASES.map((item) => {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="public-directory-link"
              >
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
                <ArrowRight size={20} aria-hidden />
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
