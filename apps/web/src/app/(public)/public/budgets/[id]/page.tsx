import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, FileText, ShieldCheck } from "lucide-react";

import { fetchPublicBudget } from "@/lib/publicSeoFetch";
import { pageMetadata } from "@/lib/seo";

type PageProps = { params: Promise<{ id: string }> };

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const budget = await fetchPublicBudget(id);
  if (!budget) return pageMetadata({
    title: "找不到預算案",
    description: "此預算案不存在或尚未開放檢視。",
    path: `/public/budgets/${id}`,
    type: "website",
  });
  return pageMetadata({
    title: budget.name,
    description: `${budget.period_name}已核准預算案的公開明細。`,
    path: `/public/budgets/${id}`,
    type: "website",
  });
}

export default async function PublicBudgetDetailPage({ params }: PageProps) {
  const { id } = await params;
  const budget = await fetchPublicBudget(id);
  if (!budget) notFound();

  const nodes = new Map(budget.nodes.map((node) => [node.id, node]));
  const pathFor = (nodeId: string) => {
    const path: (typeof budget.nodes)[number][] = [];
    let current = nodes.get(nodeId);
    while (current) {
      path.unshift(current);
      current = current.parent_id ? nodes.get(current.parent_id) : undefined;
    }
    return path;
  };
  const groups = Array.from(budget.allocations.reduce((result, allocation) => {
    const path = pathFor(allocation.node_id);
    const groupNode = path[0];
    const groupId = groupNode?.id || allocation.node_id;
    const group = result.get(groupId) || {
      id: groupId,
      name: groupNode?.name || "未分類",
      total: 0,
      rows: [] as Array<{ allocation: typeof allocation; detail: string }>,
    };
    group.total += allocation.amount;
    group.rows.push({
      allocation,
      detail: path.slice(1).map((item) => item.name).join(" ＞ ") || group.name,
    });
    result.set(groupId, group);
    return result;
  }, new Map<string, {
    id: string;
    name: string;
    total: number;
    rows: Array<{ allocation: (typeof budget.allocations)[number]; detail: string }>;
  }>()).values());
  const total = budget.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);

  return (
    <div className="public-budget-detail">
      <Link href="/public/budgets" className="public-budget-detail__back"><ArrowLeft size={15} aria-hidden="true" />返回公開預算</Link>
      <header className="public-budget-detail__header">
        <div>
          <span>{budget.period_name}</span>
          <h1>{budget.name}</h1>
          <p>這是完成內部審核後的核准版本；後續追加預算與核准紀錄也會保留在同一頁。</p>
        </div>
        <div className="public-budget-detail__total"><span>核准預算總額</span><strong>{formatAmount(total)}</strong><small>{budget.allocations.length} 筆編列明細</small></div>
      </header>

      <aside className="public-budget-detail__privacy"><ShieldCheck size={18} aria-hidden="true" /><p><strong>公開資料不包含個人資訊。</strong>報帳人、內部憑證、帳戶與承辦資料都不會出現在這個頁面。</p></aside>

      <section className="public-budget-detail__section" aria-labelledby="public-budget-lines-heading">
        <header><div><FileText size={18} aria-hidden="true" /><div><h2 id="public-budget-lines-heading">核准編列明細</h2><p>金額依核准預算案的末層條目彙整。</p></div></div><span>{budget.allocations.length} 筆</span></header>
        <div className="public-budget-detail__table"><table><thead><tr><th>項目</th><th>細項</th><th>數量</th><th>單價</th><th>總額（含稅）</th><th>項目總額</th><th>備註</th></tr></thead>
          <tbody>
            {groups.flatMap((group) => group.rows.map(({ allocation, detail }, rowIndex) => <tr key={allocation.id}>
              {rowIndex === 0 && <th scope="rowgroup" rowSpan={group.rows.length}>{group.name}</th>}
              <td><strong>{detail}</strong></td>
              <td>{allocation.quantity ?? "—"}{allocation.unit || ""}</td>
              <td>{allocation.unit_price ? formatAmount(allocation.unit_price) : "＊"}</td>
              <td><strong>{formatAmount(allocation.amount)}</strong></td>
              {rowIndex === 0 && <td rowSpan={group.rows.length} className="public-budget-detail__group-total"><strong>{formatAmount(group.total)}</strong></td>}
              <td>{allocation.note || "—"}</td>
            </tr>))}
          </tbody></table></div>
        <div className="public-budget-detail__cards">{groups.map((group) => <section key={group.id}><header><h3>{group.name}</h3><span>項目總額<strong>{formatAmount(group.total)}</strong></span></header>{group.rows.map(({ allocation, detail }) => <article key={allocation.id}><div><h4>{detail}</h4><strong>{formatAmount(allocation.amount)}</strong></div><dl><div><dt>數量</dt><dd>{allocation.quantity ?? "—"}{allocation.unit || ""}</dd></div><div><dt>單價</dt><dd>{allocation.unit_price ? formatAmount(allocation.unit_price) : "＊"}</dd></div></dl>{allocation.note && <p>{allocation.note}</p>}</article>)}</section>)}</div>
      </section>

      <section className="public-budget-detail__approvals" aria-labelledby="public-budget-approvals-heading">
        <header><h2 id="public-budget-approvals-heading">核准紀錄</h2><p>初始預算與每一次追加案都會依審核時間保留。</p></header>
        <ol>
          {budget.submissions.map((submission) => (
            <li key={submission.id}>
              <span><Check size={14} aria-hidden="true" /></span>
              <div><h3>{submission.title}</h3><p>{submission.review_note || "已完成內部審核。"}</p>{submission.reviewed_at && <time dateTime={submission.reviewed_at}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "long" }).format(new Date(submission.reviewed_at))}</time>}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
