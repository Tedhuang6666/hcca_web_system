import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
  const labelFor = (nodeId: string) => {
    const names: string[] = [];
    let current = nodes.get(nodeId);
    while (current) {
      names.unshift(current.name);
      current = current.parent_id ? nodes.get(current.parent_id) : undefined;
    }
    return names.join(" ＞ ");
  };
  const total = budget.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <Link href="/public/budgets" className="text-sm font-medium" style={{ color: "var(--public-accent-text)" }}>← 返回預算列表</Link>
      <header>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>{budget.period_name}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>{budget.name}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: "var(--text-muted)" }}>
          已核准預算合計 {formatAmount(total)}。本頁僅供議員檢視，不能修改資料或查看憑證。
        </p>
      </header>

      <section className="overflow-x-auto border-y" style={{ borderColor: "var(--public-border)" }}>
        <table className="w-full min-w-[780px] text-sm">
          <thead style={{ background: "var(--public-soft)" }}>
            <tr>
              <th className="px-4 py-3 text-left">項目</th>
              <th className="px-4 py-3 text-right">數量</th>
              <th className="px-4 py-3 text-left">單位</th>
              <th className="px-4 py-3 text-right">單價</th>
              <th className="px-4 py-3 text-right">總額</th>
              <th className="px-4 py-3 text-left">備註</th>
            </tr>
          </thead>
          <tbody>
            {budget.allocations.map((allocation) => (
              <tr key={allocation.id} className="border-t" style={{ borderColor: "var(--public-border)" }}>
                <td className="px-4 py-3 font-medium">{labelFor(allocation.node_id)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{allocation.quantity ?? "—"}</td>
                <td className="px-4 py-3">{allocation.unit || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{allocation.unit_price ? formatAmount(allocation.unit_price) : "—"}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{formatAmount(allocation.amount)}</td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{allocation.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>核准紀錄</h2>
        <ul className="border-y" style={{ borderColor: "var(--public-border)" }}>
          {budget.submissions.map((submission) => (
            <li key={submission.id} className="border-b px-1 py-4 last:border-b-0" style={{ borderColor: "var(--public-border)" }}>
              <p className="font-medium">{submission.title}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{submission.review_note || "已完成內部審核。"}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
