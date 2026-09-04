import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  Landmark,
  ShieldCheck,
} from "lucide-react";

import { fetchPublicBudgets } from "@/lib/publicSeoFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "預算與決算",
  description: "查閱已核准預算，以及提供議員審理的預算草案。",
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
          <p>查閱已核准的預算資料，或直接進入標示清楚的議員審理草案。</p>
        </div>
        <span>
          <Landmark size={20} aria-hidden="true" />
          {budgets.length} 份可檢視預算
        </span>
      </header>

      <aside className="public-budget-index__notice">
        <ShieldCheck size={19} aria-hidden="true" />
        <p>
          <strong>公開範圍已經過資料隔離。</strong>
          本頁只呈現編列明細與審核資訊，不包含報帳人、憑證或其他個人資料；議員審理草案會明確標示尚未核定。
        </p>
      </aside>

      {budgets.length === 0 ? (
        <section className="public-budget-index__empty">
          <Landmark size={24} aria-hidden="true" />
          <div>
            <h2>目前沒有可檢視預算</h2>
            <p>預算案核准公開，或由幹部開放議員審理後，會出現在這裡。</p>
          </div>
        </section>
      ) : (
        <section className="public-budget-index__list" aria-label="公開預算案">
          {budgets.map((budget) => (
            <Link
              key={`${budget.id}-${budget.review_submission_id || "approved"}`}
              href={
                budget.review_submission_id
                  ? `/public/budgets/${budget.id}?review_submission_id=${budget.review_submission_id}`
                  : `/public/budgets/${budget.id}`
              }
              className="public-budget-index__row"
            >
              <span>{budget.period_name}</span>
              <div>
                <h2>{budget.name}</h2>
                {budget.review_title && <p>{budget.review_title}</p>}
              </div>
              <span
                className={
                  budget.visibility === "council_review" ? "is-review" : ""
                }
              >
                {budget.visibility === "council_review" ? (
                  <>
                    <ClipboardCheck size={16} aria-hidden="true" />
                    議員審理草案
                  </>
                ) : (
                  <>
                    查看核准明細 <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
