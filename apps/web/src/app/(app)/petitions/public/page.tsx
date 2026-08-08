import type { Metadata } from "next";
import Link from "next/link";

import { fetchPublicPetitions } from "@/lib/publicSeoFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "公開陳情",
  description: "閱讀經陳情人同意公開的校園問題、承辦單位與處理回覆。",
  path: "/petitions/public",
  type: "website",
});

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export default async function PublicPetitionsPage() {
  const items = await fetchPublicPetitions({ limit: 200 });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="workspace-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            公開陳情
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            以下案件已經陳情人同意公開，內容不包含姓名、Email、學號或其他聯絡資料。
          </p>
        </div>
        <Link href="/petitions/new" className="btn btn-primary shrink-0">
          我要陳情
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="card p-5 text-sm" style={{ color: "var(--text-muted)" }}>
          目前尚無已公開陳情。
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/petitions/public/${item.id}`}
              className="card card-hover p-5 space-y-3"
              style={{ textDecoration: "none" }}
            >
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                #{item.case_number} · {item.current_org_name} · {item.type_name}
              </p>
              <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {item.title}
              </h2>
              <p className="text-sm line-clamp-3" style={{ color: "var(--text-muted)" }}>
                {item.reply || "已結案，暫無公開回覆。"}
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                公開於 {formatPublishedAt(item.published_at)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
