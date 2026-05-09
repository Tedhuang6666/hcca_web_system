import Link from "next/link";
import type { Metadata } from "next";

type RegulationListItem = {
  id: string;
  title: string;
  category: string;
  version: number;
  is_active: boolean;
  workflow_status: string;
  org_id: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export const metadata: Metadata = {
  title: "法規資料庫",
  description: "公開法規查詢：條文目錄、穩定連結、沿革與版本比對。",
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchRegs(q?: string): Promise<RegulationListItem[]> {
  const url = new URL(`${BASE}/regulations`);
  url.searchParams.set("active_only", "true");
  url.searchParams.set("limit", "50");
  url.searchParams.set("offset", "0");
  if (q?.trim()) url.searchParams.set("keyword", q.trim());
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) return [];
  return res.json();
}

export default async function PublicRegulationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const regs = await fetchRegs(q);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          公開法規資料庫
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          只顯示已發布且有效之法規。每條文提供穩定錨點連結，方便引用與分享。
        </p>
      </div>

      <form className="card p-4 flex flex-col sm:flex-row gap-3" action="/public/regulations">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜尋法規標題 / 內容關鍵字…"
          className="input flex-1"
          aria-label="搜尋法規"
        />
        <button className="btn btn-primary sm:w-auto" type="submit">
          搜尋
        </button>
      </form>

      <div className="card overflow-hidden">
        {regs.length === 0 ? (
          <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            查無符合條件的法規
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {regs.map((r) => (
              <li key={r.id} className="px-4 sm:px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/public/regulations/${r.id}`}
                      className="font-medium hover:underline"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {r.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      <span className="px-2 py-0.5 rounded" style={{ border: "1px solid var(--border)" }}>
                        v{r.version}
                      </span>
                      {r.published_at && (
                        <span>
                          公布 {new Date(r.published_at).toLocaleDateString("zh-TW")}
                        </span>
                      )}
                      <span>更新 {new Date(r.updated_at).toLocaleDateString("zh-TW")}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <Link
                      href={`/public/regulations/${r.id}`}
                      className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
                      style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}
                    >
                      查看
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

