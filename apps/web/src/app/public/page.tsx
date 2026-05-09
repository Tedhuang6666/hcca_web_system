import Link from "next/link";

export default function PublicHomePage() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          公開資訊服務層
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
          統一的公開檢索入口：公開法規、公開公文。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/public/regulations"
            className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
          >
            進入法規資料庫
          </Link>
          <Link
            href="/public/documents"
            className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            進入公文資料庫
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            法規
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            條文目錄、穩定錨點連結、版本沿革、版本比對與分享。
          </p>
          <div className="mt-3">
            <Link href="/public/regulations" className="text-sm hover:underline" style={{ color: "var(--primary)" }}>
              前往查詢 →
            </Link>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            公文
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            公開公文列表、可分享查詢連結、附件預覽（PDF/圖片/連結）。
          </p>
          <div className="mt-3">
            <Link href="/public/documents" className="text-sm hover:underline" style={{ color: "var(--primary)" }}>
              前往查詢 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

