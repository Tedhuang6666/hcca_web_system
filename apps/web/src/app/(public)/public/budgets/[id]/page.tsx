import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, CircleAlert, FileText, ShieldCheck } from "lucide-react";

import { fetchPublicBudget } from "@/lib/publicSeoFetch";
import { pageMetadata } from "@/lib/seo";
import PublicBudgetExecutionTable from "@/components/finance/PublicBudgetExecutionTable";
import PublicBudgetFinancialSummary from "@/components/finance/PublicBudgetFinancialSummary";
import { publicBudgetWorkbookLines } from "@/components/finance/publicBudgetExecution";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review_submission_id?: string }>;
};

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { review_submission_id: reviewSubmissionId } = await searchParams;
  const budget = await fetchPublicBudget(id, reviewSubmissionId);
  if (!budget) return pageMetadata({
    title: "找不到預算案",
    description: "此預算案不存在或尚未開放檢視。",
    path: `/public/budgets/${id}`,
    type: "website",
  });
  return pageMetadata({
    title: `${budget.name}${budget.visibility === "council_review" ? "｜議員審理草案" : ""}`,
    description: budget.visibility === "council_review"
      ? `${budget.period_name}提供議員審理的預算草案，尚未核定。`
      : `${budget.period_name}已核准預算案的公開明細。`,
    path: `/public/budgets/${id}`,
    type: "website",
  });
}

export default async function PublicBudgetDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { review_submission_id: reviewSubmissionId } = await searchParams;
  const budget = await fetchPublicBudget(id, reviewSubmissionId);
  if (!budget) notFound();
  const isCouncilReview = budget.visibility === "council_review";

  const lines = publicBudgetWorkbookLines(budget, budget);
  const total = budget.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const councilApprovedOn = budget.submissions.at(-1)?.council_approved_on;

  return (
    <div className="public-budget-detail">
      <Link href="/public/budgets" className="public-budget-detail__back"><ArrowLeft size={15} aria-hidden="true" />返回財務總覽</Link>
      <header className="public-budget-detail__header">
        <div>
          <span>{budget.period_name}</span>
          <h1>{budget.name}</h1>
          {isCouncilReview && <p>這份草案正提供議員審理，內容仍可能調整，不能視為核定預算。</p>}
          {!isCouncilReview && councilApprovedOn && <p>議會通過日期：{councilApprovedOn.replaceAll("-", "/")}</p>}
        </div>
        <div className="public-budget-detail__total"><span>{isCouncilReview ? "審理草案支出預算" : "核准支出預算"}</span><strong>{formatAmount(total)}</strong><small>{budget.allocations.length} 筆編列明細</small></div>
      </header>

      {isCouncilReview && budget.review_submission && <aside className="public-budget-detail__review-notice">
        <CircleAlert size={18} aria-hidden="true" />
        <p><strong>議員審理草案，尚未核定。</strong>{budget.review_submission.title}目前為「{budget.review_submission.status === "submitted" ? "待內部審核" : budget.review_submission.status === "returned" ? "退回補正" : "草案"}」；請以後續核准版本為準。</p>
      </aside>}

      <aside className="public-budget-detail__privacy"><ShieldCheck size={18} aria-hidden="true" /><p><strong>核銷明細與已上傳憑證會公開。</strong>公開用途與品項明細；登錄人、銀行帳戶及核銷備註不公開。</p></aside>

      {!isCouncilReview && <PublicBudgetFinancialSummary lines={lines} />}

      <section className="public-budget-detail__section" aria-labelledby="public-budget-lines-heading">
        <header><div><FileText size={18} aria-hidden="true" /><div><h2 id="public-budget-lines-heading">{isCouncilReview ? "本次送審明細" : "核准編列明細"}</h2>{isCouncilReview && <p>金額只對應本次開放審理的草案。</p>}</div></div><span>{budget.allocations.length} 筆</span></header>
        <PublicBudgetExecutionTable lines={lines} />
      </section>

      {budget.submissions.length > 0 && <section className="public-budget-detail__approvals" aria-labelledby="public-budget-approvals-heading">
        <header><h2 id="public-budget-approvals-heading">{isCouncilReview ? "既有核准紀錄" : "核准紀錄"}</h2></header>
        <ol>
          {budget.submissions.map((submission) => (
            <li key={submission.id}>
              <span><Check size={14} aria-hidden="true" /></span>
              <div><h3>{submission.title}</h3>{submission.council_approved_on && <p>議會通過日期：{new Intl.DateTimeFormat("zh-TW", { dateStyle: "long" }).format(new Date(`${submission.council_approved_on}T00:00:00`))}</p>}<p>{submission.review_note || "已完成內部審核。"}</p>{submission.reviewed_at && <time dateTime={submission.reviewed_at}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "long" }).format(new Date(submission.reviewed_at))}</time>}</div>
            </li>
          ))}
        </ol>
      </section>}
    </div>
  );
}
