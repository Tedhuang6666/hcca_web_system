"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { financeApi } from "@/lib/api";
import type {
  FinanceBudget,
  FinanceBudgetDetail,
  FinanceSettlement,
  OrgRead,
  PeriodOut,
} from "@/lib/types";

type Props = {
  ledgerId: string;
  periods: PeriodOut[];
  orgs: OrgRead[];
  canManage: boolean;
  canPropose: boolean;
  canReview: boolean;
  canPublish: boolean;
};

const statusLabel = {
  draft: "草案",
  submitted: "待內部審核",
  approved: "已核准",
  returned: "退回補正",
  rejected: "已否決",
} as const;

export default function BudgetWorkspace({
  ledgerId,
  periods,
  orgs,
  canManage,
  canPropose,
  canReview,
  canPublish,
}: Props) {
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [detail, setDetail] = useState<FinanceBudgetDetail | null>(null);
  const [budgetName, setBudgetName] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [submissionTitle, setSubmissionTitle] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [nodeParentId, setNodeParentId] = useState("");
  const [allocationNodeId, setAllocationNodeId] = useState("");
  const [allocationOrgId, setAllocationOrgId] = useState("");
  const [allocationQuantity, setAllocationQuantity] = useState("1");
  const [allocationUnit, setAllocationUnit] = useState("項");
  const [allocationUnitPrice, setAllocationUnitPrice] = useState("");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [settlement, setSettlement] = useState<FinanceSettlement | null>(null);

  const load = useCallback(async (selectedId?: string) => {
    const next = await financeApi.listBudgets(ledgerId);
    setBudgets(next);
    const selected = selectedId && next.some((budget) => budget.id === selectedId)
      ? selectedId
      : next[0]?.id;
    if (selected) setDetail(await financeApi.getBudget(selected));
    else setDetail(null);
  }, [ledgerId]);

  useEffect(() => {
    void load().catch((error) => toast.error(error instanceof Error ? error.message : "無法載入預算"));
  }, [load]);

  useEffect(() => {
    setPeriodId((current) => current || periods.find((item) => !item.is_closed)?.id || "");
    setAllocationOrgId((current) => current || orgs[0]?.id || "");
  }, [orgs, periods]);

  useEffect(() => {
    if (!detail) {
      setSettlement(null);
      return;
    }
    void financeApi
      .getSettlement(ledgerId, detail.period_id)
      .then(setSettlement)
      .catch(() => setSettlement(null));
  }, [detail, ledgerId]);

  const nodes = useMemo(() => {
    if (!detail) return [];
    const children = new Map<string, number>();
    detail.nodes.forEach((node) => {
      if (node.parent_id) children.set(node.parent_id, (children.get(node.parent_id) || 0) + 1);
    });
    const result: Array<{ id: string; label: string; depth: number; leaf: boolean }> = [];
    const walk = (parentId: string | null, depth: number, prefix: string) => {
      detail.nodes.filter((node) => (node.parent_id || null) === parentId).forEach((node) => {
        const label = prefix ? `${prefix} ＞ ${node.name}` : node.name;
        result.push({ id: node.id, label, depth, leaf: !children.has(node.id) });
        walk(node.id, depth + 1, label);
      });
    };
    walk(null, 0, "");
    return result;
  }, [detail]);

  const activeSubmission = detail?.submissions.find((item) => item.id === selectedSubmissionId)
    || detail?.submissions.find((item) => item.status === "draft" || item.status === "returned");

  const refreshDetail = async () => {
    await load(detail?.id);
  };

  const createBudget = async () => {
    if (!periodId || !budgetName.trim()) return toast.error("請選擇期間並填寫預算名稱");
    try {
      const budget = await financeApi.createBudget(ledgerId, { period_id: periodId, name: budgetName.trim() });
      setBudgetName("");
      setDetail(await financeApi.getBudget(budget.id));
      await load(budget.id);
      toast.success("共同預算已建立，請建立初始預算案開始編列");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立預算失敗");
    }
  };

  const createSubmission = async (kind: "initial" | "supplemental") => {
    if (!detail || !submissionTitle.trim()) return toast.error("請填寫預算案名稱");
    try {
      const submission = await financeApi.createBudgetSubmission(detail.id, { kind, title: submissionTitle.trim() });
      setSubmissionTitle("");
      setSelectedSubmissionId(submission.id);
      await refreshDetail();
      toast.success(kind === "initial" ? "初始預算草案已建立" : "追加預算草案已建立");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立預算案失敗");
    }
  };

  const createNode = async () => {
    if (!activeSubmission || !nodeName.trim()) return toast.error("請選擇草案並填寫條目名稱");
    try {
      await financeApi.createBudgetNode(activeSubmission.id, {
        parent_id: nodeParentId || null,
        name: nodeName.trim(),
      });
      setNodeName("");
      await refreshDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增預算條目失敗");
    }
  };

  const createAllocation = async () => {
    if (
      !activeSubmission
      || !allocationNodeId
      || !allocationOrgId
      || Number(allocationQuantity) <= 0
      || !allocationUnit.trim()
      || Number(allocationUnitPrice) <= 0
    ) {
      return toast.error("請填寫最末層條目、提出部門、數量、單位與單價");
    }
    try {
      await financeApi.createBudgetAllocation(activeSubmission.id, {
        node_id: allocationNodeId,
        proposing_org_id: allocationOrgId,
        quantity: Number(allocationQuantity),
        unit: allocationUnit.trim(),
        unit_price: Number(allocationUnitPrice),
      });
      setAllocationQuantity("1");
      setAllocationUnit("項");
      setAllocationUnitPrice("");
      await refreshDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增預算配置失敗");
    }
  };

  const togglePublication = async () => {
    if (!detail) return;
    try {
      const updated = await financeApi.updateBudgetPublication(detail.id, !detail.is_public);
      setDetail((current) => current && { ...current, is_public: updated.is_public });
      await load(detail.id);
      toast.success(updated.is_public ? "已開放議員唯讀檢視" : "已停止公開檢視");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新公開設定失敗");
    }
  };

  const submit = async () => {
    if (!activeSubmission) return;
    try {
      await financeApi.submitBudget(activeSubmission.id);
      await refreshDetail();
      toast.success("預算案已送內部審核並鎖定編輯");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "送審失敗");
    }
  };

  const review = async (status: "approved" | "returned" | "rejected") => {
    if (!activeSubmission) return;
    try {
      await financeApi.reviewBudget(activeSubmission.id, { status });
      await refreshDetail();
      toast.success(status === "approved" ? "預算案已核准" : status === "returned" ? "預算案已退回" : "預算案已否決");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "審核失敗");
    }
  };

  const total = detail?.nodes.reduce((sum, node) => sum + node.allocated_amount, 0) || 0;
  const used = detail?.nodes.reduce((sum, node) => sum + node.used_amount, 0) || 0;
  const activeAllocations = detail?.allocations.filter(
    (item) => item.submission_id === activeSubmission?.id,
  ) || [];
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
  const canOpenPublic = detail?.submissions.some(
    (item) => item.kind === "initial" && item.status === "approved",
  );

  return (
    <section className="space-y-5" aria-labelledby="budget-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="budget-heading" className="font-semibold">共同預算與追加</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>以同一會計期間共同編列；核准後才能成為報帳對應依據。</p>
        </div>
        {detail && canPublish && (canOpenPublic || detail.is_public) ? (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-secondary" onClick={() => void togglePublication()}>
              {detail.is_public ? "停止議員檢視" : "開放議員檢視"}
            </button>
            {detail.is_public && <a className="btn btn-primary" href={`/public/budgets/${detail.id}`} target="_blank" rel="noreferrer">開啟唯讀頁</a>}
          </div>
        ) : canManage && !detail && (
          <div className="flex flex-wrap gap-2">
            <select className="input" value={periodId} onChange={(event) => setPeriodId(event.target.value)}>
              <option value="">選擇會計期間</option>
              {periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
            </select>
            <input className="input" value={budgetName} onChange={(event) => setBudgetName(event.target.value)} placeholder="例如：115 學年度預算" />
            <button className="btn btn-primary" onClick={() => void createBudget()}>建立共同預算</button>
          </div>
        )}
      </div>

      {budgets.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="選擇預算">
          {budgets.map((budget) => <button key={budget.id} role="tab" aria-selected={detail?.id === budget.id} className={`btn ${detail?.id === budget.id ? "btn-primary" : "btn-secondary"}`} onClick={() => void financeApi.getBudget(budget.id).then(setDetail)}>{budget.name}</button>)}
        </div>
      )}

      {!detail ? (
        <div className="rounded border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          尚未建立共同預算。財務管理者建立後，各部門即可在同一份草案中編列條目。
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>核准編列</p><p className="mt-1 text-xl font-semibold tabular-nums">NT${total.toLocaleString()}</p></div>
            <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>已核銷</p><p className="mt-1 text-xl font-semibold tabular-nums">NT${used.toLocaleString()}</p></div>
            <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>可用餘額</p><p className="mt-1 text-xl font-semibold tabular-nums">NT${(total - used).toLocaleString()}</p></div>
          </div>

          <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full min-w-[780px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">預算條目</th><th className="px-3 py-2 text-right">編列</th><th className="px-3 py-2 text-right">已用</th><th className="px-3 py-2 text-right">剩餘</th><th className="px-3 py-2 text-right">執行率</th></tr></thead><tbody>{nodes.map((row) => {
              const node = detail.nodes.find((item) => item.id === row.id)!;
              const ratio = node.allocated_amount ? Math.min(100, Math.round(node.used_amount / node.allocated_amount * 100)) : 0;
              return <tr key={node.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-3" style={{ paddingLeft: `${12 + row.depth * 24}px` }}>{node.name}</td><td className="px-3 py-3 text-right tabular-nums">{row.leaf ? `NT$${node.allocated_amount.toLocaleString()}` : "—"}</td><td className="px-3 py-3 text-right tabular-nums">{row.leaf ? `NT$${node.used_amount.toLocaleString()}` : "—"}</td><td className="px-3 py-3 text-right tabular-nums">{row.leaf ? `NT$${node.remaining_amount.toLocaleString()}` : "—"}</td><td className="px-3 py-3 text-right tabular-nums">{row.leaf ? `${ratio}%` : "—"}</td></tr>;
            })}{nodes.length === 0 && <tr><td className="px-3 py-6 text-center" colSpan={5} style={{ color: "var(--text-muted)" }}>尚未編列任何預算條目。</td></tr>}</tbody></table>
          </div>

          <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-3"><div><h3 className="font-semibold">預算案與內部審核</h3><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>初始預算核准後，可建立追加預算；核准額度的直接修正會保留稽核紀錄。</p></div>{canManage && <div className="flex gap-2"><input className="input" value={submissionTitle} onChange={(event) => setSubmissionTitle(event.target.value)} placeholder="預算案名稱" /><button className="btn btn-secondary" onClick={() => void createSubmission(detail.submissions.length === 0 ? "initial" : "supplemental")}>{detail.submissions.length === 0 ? "建立初始草案" : "建立追加草案"}</button></div>}</div>
            <div className="mt-4 flex flex-wrap gap-2">{detail.submissions.map((submission) => <button key={submission.id} className={`btn ${activeSubmission?.id === submission.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedSubmissionId(submission.id)}>{submission.title}・{statusLabel[submission.status]}</button>)}</div>
            {activeSubmission && (canPropose || canManage) && (activeSubmission.status === "draft" || activeSubmission.status === "returned") && <div className="mt-5 grid gap-3 border-t pt-5 lg:grid-cols-2" style={{ borderColor: "var(--border)" }}>
              <div className="space-y-2"><p className="text-sm font-medium">新增階層條目</p><div className="flex gap-2"><select className="input" value={nodeParentId} onChange={(event) => setNodeParentId(event.target.value)}><option value="">最上層</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><input className="input" value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="例如：文書費" /><button className="btn btn-secondary" onClick={() => void createNode()}>新增</button></div></div>
              <div className="space-y-2"><p className="text-sm font-medium">配置最末層額度</p><div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6"><select className="input" value={allocationNodeId} onChange={(event) => setAllocationNodeId(event.target.value)}><option value="">選擇條目</option>{nodes.filter((node) => node.leaf).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><select className="input" value={allocationOrgId} onChange={(event) => setAllocationOrgId(event.target.value)}><option value="">提出部門</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select><input className="input" type="number" min="0.01" step="0.01" value={allocationQuantity} onChange={(event) => setAllocationQuantity(event.target.value)} placeholder="數量" /><input className="input" value={allocationUnit} onChange={(event) => setAllocationUnit(event.target.value)} placeholder="單位，例如：張" /><input className="input" type="number" min="1" value={allocationUnitPrice} onChange={(event) => setAllocationUnitPrice(event.target.value)} placeholder="單價" /><button className="btn btn-secondary" onClick={() => void createAllocation()}>加入明細</button></div></div>
              {canManage && <button className="btn btn-primary justify-self-start" onClick={() => void submit()}>送內部審核</button>}
            </div>}
            {activeSubmission?.status === "submitted" && canReview && <div className="mt-5 flex flex-wrap gap-2 border-t pt-5" style={{ borderColor: "var(--border)" }}><button className="btn btn-primary" onClick={() => void review("approved")}>核准預算案</button><button className="btn btn-secondary" onClick={() => void review("returned")}>退回補正</button><button className="btn btn-secondary" onClick={() => void review("rejected")}>否決</button></div>}
            {activeAllocations.length > 0 && <div className="mt-5 overflow-x-auto border-t pt-5" style={{ borderColor: "var(--border)" }}><table className="w-full min-w-[680px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">預算細項</th><th className="px-3 py-2 text-right">數量</th><th className="px-3 py-2 text-left">單位</th><th className="px-3 py-2 text-right">單價</th><th className="px-3 py-2 text-right">總額</th></tr></thead><tbody>{activeAllocations.map((allocation) => <tr key={allocation.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2">{nodeLabels.get(allocation.node_id) || "已刪除條目"}</td><td className="px-3 py-2 text-right tabular-nums">{allocation.quantity ?? "—"}</td><td className="px-3 py-2">{allocation.unit || "—"}</td><td className="px-3 py-2 text-right tabular-nums">{allocation.unit_price ? `NT$${allocation.unit_price.toLocaleString()}` : "—"}</td><td className="px-3 py-2 text-right tabular-nums">NT${allocation.amount.toLocaleString()}</td></tr>)}</tbody></table></div>}
          </section>

          {settlement && <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}><div><h3 className="font-semibold">期末決算</h3><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>僅統計已完成核銷的支出；尚有 {settlement.unsettled_claim_count} 件已過帳報帳等待憑證或完成核銷。</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><p className="text-sm">核准預算 <strong className="ml-2 tabular-nums">NT${settlement.budgeted_total.toLocaleString()}</strong></p><p className="text-sm">決算支出 <strong className="ml-2 tabular-nums">NT${settlement.settled_total.toLocaleString()}</strong></p></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">預算條目</th><th className="px-3 py-2 text-right">核准</th><th className="px-3 py-2 text-right">決算</th><th className="px-3 py-2 text-right">差額</th></tr></thead><tbody>{settlement.lines.map((line) => <tr key={line.node_id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2">{line.name}</td><td className="px-3 py-2 text-right tabular-nums">NT${line.budgeted_amount.toLocaleString()}</td><td className="px-3 py-2 text-right tabular-nums">NT${line.settled_amount.toLocaleString()}</td><td className="px-3 py-2 text-right tabular-nums">NT${line.difference_amount.toLocaleString()}</td></tr>)}</tbody></table></div></section>}
        </>
      )}
    </section>
  );
}
