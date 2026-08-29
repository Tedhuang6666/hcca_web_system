import Link from "next/link";

import { fetchPublicBudgets } from "@/lib/publicSeoFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "預算與決算",
  description: "查閱已核准並開放的班聯會預算案與執行情況。",
  path: "/public/budgets",
  type: "website",
});

export default async function PublicBudgetsPage() {
  const budgets = await fetchPublicBudgets();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="workspace-header">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>預算與決算</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7" style={{ color: "var(--text-muted)" }}>
          此頁僅顯示已核准且由財務主管開放的資料，不包含報帳人、憑證或其他個人資料。
        </p>
      </header>

      {budgets.length === 0 ? (
        <section className="rounded border p-6 text-sm" style={{ borderColor: "var(--public-border)", color: "var(--text-muted)" }}>
          目前尚無開放檢視的預算案。
        </section>
      ) : (
        <section className="border-y" style={{ borderColor: "var(--public-border)" }} aria-label="公開預算案">
          {budgets.map((budget) => (
            <Link
              key={budget.id}
              href={`/public/budgets/${budget.id}`}
              className="grid min-h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b px-1 py-5 transition-colors last:border-b-0 hover:bg-[var(--public-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              style={{ borderColor: "var(--public-border)", color: "var(--text-primary)", textDecoration: "none" }}
            >
              <div>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{budget.period_name}</p>
                <h2 className="mt-1 text-lg font-semibold">{budget.name}</h2>
              </div>
              <span className="text-sm font-medium" style={{ color: "var(--public-accent-text)" }}>檢視明細</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
