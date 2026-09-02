import Link from "next/link";
import { ArrowRight, Landmark, ShieldCheck } from "lucide-react";

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
    <div className="public-budget-index">
      <header className="public-budget-index__header">
        <div>
          <h1>公開預算</h1>
          <p>查閱已完成內部審核並由財務主管開放的班聯會預算資料。</p>
        </div>
        <span><Landmark size={20} aria-hidden="true" />{budgets.length} 份公開預算</span>
      </header>

      <aside className="public-budget-index__notice">
        <ShieldCheck size={19} aria-hidden="true" />
        <p><strong>公開範圍已經過資料隔離。</strong>本頁只呈現核准預算、編列明細與審核紀錄，不包含報帳人、憑證或其他個人資料。</p>
      </aside>

      {budgets.length === 0 ? (
        <section className="public-budget-index__empty">
          <Landmark size={24} aria-hidden="true" />
          <div><h2>目前沒有公開預算</h2><p>預算案完成核准並由財務主管開放後，會自動出現在這裡。</p></div>
        </section>
      ) : (
        <section className="public-budget-index__list" aria-label="公開預算案">
          {budgets.map((budget) => (
            <Link
              key={budget.id}
              href={`/public/budgets/${budget.id}`}
              className="public-budget-index__row"
            >
              <span>{budget.period_name}</span>
              <h2>{budget.name}</h2>
              <span>查看核准明細 <ArrowRight size={16} aria-hidden="true" /></span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
