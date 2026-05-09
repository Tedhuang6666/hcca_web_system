import Link from "next/link";
import type { Metadata } from "next";

type DocumentListItem = {
  id: string;
  serial_number: string;
  title: string;
  urgency: string;
  classification: string;
  category: string;
  subject: string | null;
  status: string;
  org_id: string;
  created_by: string;
  due_date: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export const metadata: Metadata = {
  title: "公文資料庫",
  description: "公開公文查詢：可分享的 URL 篩選、附件預覽與列印。",
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchDocs(q?: string): Promise<DocumentListItem[]> {
  const url = new URL(`${BASE}/documents`);
  url.searchParams.set("visibility", "publicly_open");
  url.searchParams.set("limit", "50");
  url.searchParams.set("offset", "0");
  if (q?.trim()) url.searchParams.set("keyword", q.trim());
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) return [];
  return res.json();
}

export default async function PublicDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const docs = await fetchDocs(q);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          公開公文資料庫
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          只顯示「公開（未登入可見）」之公文。可直接分享 URL 作為查詢結果連結。
        </p>
      </div>

      <form className="card p-4 flex flex-col sm:flex-row gap-3" action="/public/documents">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜尋字號 / 標題 / 主旨關鍵字…"
          className="input flex-1"
          aria-label="搜尋公文"
        />
        <button className="btn btn-primary sm:w-auto" type="submit">
          搜尋
        </button>
      </form>

      <div className="card overflow-hidden">
        {docs.length === 0 ? (
          <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            查無符合條件的公文
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {docs.map((d) => (
              <li key={d.id} className="px-4 sm:px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-mono" style={{ color: "var(--primary)" }}>
                      {d.serial_number}
                    </p>
                    <Link
                      href={`/public/documents/${encodeURIComponent(d.serial_number)}`}
                      className="font-medium hover:underline block truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {d.title}
                    </Link>
                    {d.subject && (
                      <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                        {d.subject}
                      </p>
                    )}
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      建立 {new Date(d.created_at).toLocaleDateString("zh-TW")}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <Link
                      href={`/public/documents/${encodeURIComponent(d.serial_number)}`}
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

