"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  FileCheck2,
  FileSpreadsheet,
  FileUp,
  ListTree,
  Megaphone,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm, usePrompt } from "@/components/ui/ConfirmDialog";
import { financeApi } from "@/lib/api";
import type {
  FinanceBudget,
  FinanceBudgetAllocation,
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
  currentUserId: string;
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
  currentUserId,
}: Props) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [detail, setDetail] = useState<FinanceBudgetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<
    "publication" | "council_review" | "submit" | "review" | null
  >(null);
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
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTarget, setImportTarget] = useState<"new" | "replace" | "supplemental">("new");
  const [isImporting, setIsImporting] = useState(false);
  const [editingAllocationId, setEditingAllocationId] = useState<string | null>(null);
  const [uploadingEvidenceId, setUploadingEvidenceId] = useState<string | null>(null);
  const [allocationDraft, setAllocationDraft] = useState({
    quantity: "", unit: "", unit_price: "", amount: "", note: "",
  });

  const load = useCallback(async (selectedId?: string) => {
    setIsLoading(true);
    try {
      const next = await financeApi.listBudgets(ledgerId);
      setBudgets(next);
      const selected = selectedId && next.some((budget) => budget.id === selectedId)
        ? selectedId
        : next[0]?.id;
      if (selected) setDetail(await financeApi.getBudget(selected));
      else setDetail(null);
    } finally {
      setIsLoading(false);
    }
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
    || detail?.submissions.find((item) => item.status === "draft" || item.status === "returned")
    || detail?.submissions.at(-1);

  useEffect(() => {
    if (!detail) {
      setImportTarget("new");
      return;
    }
    const editable = detail.submissions.some(
      (item) => item.status === "draft" || item.status === "returned",
    );
    setImportTarget(editable ? "replace" : "supplemental");
  }, [detail?.id]);

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

  const importBudget = async () => {
    const importingIntoCurrent = Boolean(detail && importTarget !== "new");
    const targetPeriodId = importingIntoCurrent ? detail!.period_id : periodId;
    const targetName = importingIntoCurrent ? detail!.name : budgetName.trim();
    if (!targetPeriodId || !targetName || !importFile) {
      return toast.error("請選擇期間、填寫預算名稱並選擇 xlsx 檔案");
    }
    if (importTarget === "new" && budgets.some((budget) => budget.period_id === targetPeriodId)) {
      return toast.error("這個會計期間已有共同預算，請改選「更新目前草案」或「建立追加草案」");
    }
    if (importTarget === "replace" && (!activeSubmission || !["draft", "returned"].includes(activeSubmission.status))) {
      return toast.error("只有草案或退回補正的預算案可以重新匯入覆寫");
    }
    if (importTarget === "replace") {
      const confirmed = await confirm({
        title: "以檔案更新目前草案？",
        description: "目前草案的預算明細與已附憑證會被這份檔案取代；分類階層會保留並自動對應相同名稱的項目。",
        confirmLabel: "確認覆寫草案",
        danger: true,
      });
      if (!confirmed) return;
    }
    try {
      setIsImporting(true);
      const result = await financeApi.importBudget(ledgerId, {
        file: importFile,
        period_id: targetPeriodId,
        name: targetName,
        proposing_org_id: allocationOrgId || undefined,
        budget_id: importingIntoCurrent ? detail!.id : undefined,
        replace_submission_id: importTarget === "replace" ? activeSubmission?.id : undefined,
      });
      if (!importingIntoCurrent) setBudgetName("");
      setImportFile(null);
      setSelectedSubmissionId(result.submission.id);
      await load(result.budget.id);
      const skipped = result.skipped_rows.length > 0 ? `，略過 ${result.skipped_rows.length} 列` : "";
      toast.success(`${importTarget === "replace" ? "已更新草案" : "已匯入"} ${result.allocations_created} 筆預算明細${skipped}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "匯入預算失敗");
    } finally {
      setIsImporting(false);
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

  const startAllocationEdit = (allocation: FinanceBudgetAllocation) => {
    setEditingAllocationId(allocation.id);
    setAllocationDraft({
      quantity: allocation.quantity == null ? "" : String(allocation.quantity),
      unit: allocation.unit || "",
      unit_price: allocation.unit_price == null ? "" : String(allocation.unit_price),
      amount: String(allocation.amount),
      note: allocation.note || "",
    });
  };

  const saveAllocation = async (allocation: FinanceBudgetAllocation) => {
    if (!activeSubmission) return;
    const quantity = allocationDraft.quantity.trim() ? Number(allocationDraft.quantity) : undefined;
    const unitPrice = allocationDraft.unit_price.trim() ? Number(allocationDraft.unit_price) : undefined;
    const amount = quantity !== undefined && unitPrice !== undefined
      ? Math.round(quantity * unitPrice)
      : allocationDraft.amount.trim() ? Number(allocationDraft.amount) : undefined;
    if (
      (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0))
      || (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice <= 0))
      || (amount !== undefined && (!Number.isFinite(amount) || amount <= 0))
      || (quantity !== undefined && !allocationDraft.unit.trim())
      || (quantity === undefined && amount === undefined)
    ) {
      return toast.error("請填寫有效的數量／單位／單價或總額");
    }
    try {
      if (activeSubmission.status === "approved") {
        const reason = await prompt({
          title: "修正已核准預算明細",
          description: "修改會立即更新核准明細，系統會保留修改前後內容與操作人。",
          inputLabel: "修正原因",
          required: true,
          confirmLabel: "確認修正",
        });
        if (!reason?.trim()) return;
        await financeApi.updateBudgetAllocation(allocation.id, {
          quantity,
          unit: quantity === undefined ? undefined : allocationDraft.unit.trim(),
          unit_price: unitPrice,
          amount,
          note: allocationDraft.note.trim() || null,
          reason: reason.trim(),
        });
      } else {
        await financeApi.updateBudgetDraftAllocation(activeSubmission.id, allocation.id, {
          node_id: allocation.node_id,
          proposing_org_id: allocation.proposing_org_id,
          quantity,
          unit: quantity === undefined ? undefined : allocationDraft.unit.trim(),
          unit_price: unitPrice,
          amount,
          note: allocationDraft.note.trim() || null,
        });
      }
      setEditingAllocationId(null);
      await refreshDetail();
      toast.success("預算明細已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新預算明細失敗");
    }
  };

  const uploadAllocationEvidence = async (
    allocation: FinanceBudgetAllocation,
    files: FileList | File[] | null | undefined,
  ) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (selectedFiles.length === 0) return;
    try {
      setUploadingEvidenceId(allocation.id);
      for (const file of selectedFiles) {
        const stored = await financeApi.uploadEvidence(ledgerId, file);
        await financeApi.addBudgetAllocationEvidence(allocation.id, stored);
      }
      await refreshDetail();
      toast.success(`已補上 ${selectedFiles.length} 份憑證`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上傳預算憑證失敗");
    } finally {
      setUploadingEvidenceId(null);
    }
  };

  const togglePublication = async () => {
    if (!detail || pendingAction) return;
    const publishing = !detail.is_public;
    const confirmed = await confirm({
      title: publishing ? "確認對外公開這份預算？" : "停止對外公開這份預算？",
      description: publishing
        ? "公開後不需登入，任何取得網址的人都能查看已核准的預算明細與審核紀錄；報帳人、憑證與內部資料不會公開。"
        : "停止後，公開網址將不再提供這份預算內容；內部預算與審核紀錄不受影響。",
      confirmLabel: publishing ? "確認公開" : "停止公開",
      danger: !publishing,
    });
    if (!confirmed) return;
    try {
      setPendingAction("publication");
      const updated = await financeApi.updateBudgetPublication(detail.id, !detail.is_public);
      setDetail((current) => current && { ...current, is_public: updated.is_public });
      await load(detail.id);
      toast.success(updated.is_public ? "已開放對外檢視" : "已停止對外檢視");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新公開設定失敗");
    } finally {
      setPendingAction(null);
    }
  };

  const toggleCouncilReviewPublication = async () => {
    if (!activeSubmission || pendingAction) return;
    const publishing = !activeSubmission.is_council_review_public;
    const confirmed = await confirm({
      title: publishing ? "開放這份草案供議員審理？" : "停止議員審理頁？",
      description: publishing
        ? "開放後不需登入，任何取得網址的人都能查看本次草案的明細與備註。頁面會清楚標示「尚未核定」，且不會公開憑證、提案人或內部資料。"
        : "停止後，這份草案的審理網址會立即失效；正式核准公開頁不受影響。",
      confirmLabel: publishing ? "開放議員審理" : "停止審理頁",
      danger: !publishing,
    });
    if (!confirmed) return;
    try {
      setPendingAction("council_review");
      await financeApi.updateCouncilReviewPublication(activeSubmission.id, publishing);
      await refreshDetail();
      toast.success(publishing ? "議員審理頁已開放" : "議員審理頁已停止");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新議員審理設定失敗");
    } finally {
      setPendingAction(null);
    }
  };

  const submit = async () => {
    if (!activeSubmission || pendingAction) return;
    try {
      setPendingAction("submit");
      await financeApi.submitBudget(activeSubmission.id);
      await refreshDetail();
      toast.success("預算案已送內部審核並鎖定編輯");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "送審失敗");
    } finally {
      setPendingAction(null);
    }
  };

  const review = async (status: "approved" | "returned" | "rejected") => {
    if (!activeSubmission || pendingAction) return;
    try {
      setPendingAction("review");
      await financeApi.reviewBudget(activeSubmission.id, { status });
      await refreshDetail();
      toast.success(status === "approved" ? "預算案已核准" : status === "returned" ? "預算案已退回" : "預算案已否決");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "審核失敗");
    } finally {
      setPendingAction(null);
    }
  };

  const leafNodeIds = new Set(nodes.filter((node) => node.leaf).map((node) => node.id));
  const total = detail?.nodes.reduce(
    (sum, node) => sum + (leafNodeIds.has(node.id) ? node.allocated_amount : 0),
    0,
  ) || 0;
  const used = detail?.nodes.reduce(
    (sum, node) => sum + (leafNodeIds.has(node.id) ? node.used_amount : 0),
    0,
  ) || 0;
  const activeAllocations = detail?.allocations.filter(
    (item) => item.submission_id === activeSubmission?.id,
  ) || [];
  const nodeById = new Map(detail?.nodes.map((node) => [node.id, node]) || []);
  const allocationGroups = Array.from(activeAllocations.reduce((groups, allocation) => {
    const path = [];
    let node = nodeById.get(allocation.node_id);
    while (node) {
      path.unshift(node);
      node = node.parent_id ? nodeById.get(node.parent_id) : undefined;
    }
    const groupNode = path[0];
    const groupId = groupNode?.id || allocation.node_id;
    const current = groups.get(groupId) || {
      id: groupId,
      name: groupNode?.name || "未分類",
      total: 0,
      rows: [] as Array<{ allocation: FinanceBudgetAllocation; detail: string }>,
    };
    current.total += allocation.amount;
    current.rows.push({
      allocation,
      detail: path.slice(1).map((item) => item.name).join(" ＞ ") || groupNode?.name || "未命名細項",
    });
    groups.set(groupId, current);
    return groups;
  }, new Map<string, {
    id: string;
    name: string;
    total: number;
    rows: Array<{ allocation: FinanceBudgetAllocation; detail: string }>;
  }>()).values());
  const canOpenPublic = detail?.submissions.some(
    (item) => item.kind === "initial" && item.status === "approved",
  );
  const canEditAllocations = Boolean(
    activeSubmission
    && (activeSubmission.status === "draft" || activeSubmission.status === "returned")
    && (canPropose || canManage),
  );
  const utilization = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const hasApprovedInitial = Boolean(
    detail?.submissions.some((item) => item.kind === "initial" && item.status === "approved"),
  );
  const canOpenCouncilReview = Boolean(
    activeSubmission
    && ["draft", "submitted", "returned"].includes(activeSubmission.status),
  );
  const councilReviewHref = activeSubmission
    ? `/public/budgets/${detail?.id}?review_submission_id=${activeSubmission.id}`
    : "";
  const importingIntoCurrent = Boolean(detail && importTarget !== "new");
  const importPeriodId = importingIntoCurrent ? detail!.period_id : periodId;
  const importName = importingIntoCurrent ? detail!.name : budgetName;
  const workflowSteps = [
    { label: "建立共同預算", done: Boolean(detail), active: !detail },
    {
      label: "完成部門編列",
      done: Boolean(detail && detail.allocations.length > 0),
      active: Boolean(detail && detail.allocations.length === 0),
    },
    {
      label: "內部審核核准",
      done: hasApprovedInitial,
      active: Boolean(detail && detail.allocations.length > 0 && !hasApprovedInitial),
    },
    {
      label: "開放對外檢視",
      done: Boolean(detail?.is_public),
      active: Boolean(hasApprovedInitial && !detail?.is_public),
    },
  ];

  return (
    <section
      className="finance-budget"
      aria-labelledby="budget-heading"
      aria-busy={isLoading || pendingAction !== null}
    >
      <header className="finance-budget__header">
        <div>
          <h2 id="budget-heading">共同預算</h2>
          <p>從部門編列、內部審核到對外公開，所有版本與追加案都留在同一個工作區。</p>
        </div>
        {detail && (
          <div className={`finance-budget__publication-status ${detail.is_public ? "is-public" : ""}`}>
            {detail.is_public ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
            <span><strong>{detail.is_public ? "已對外公開" : "尚未公開"}</strong><small>{detail.is_public ? "任何取得網址者都可查看" : canOpenPublic ? "已符合公開條件" : "初始預算核准後才能公開"}</small></span>
          </div>
        )}
      </header>

      <ol className="finance-budget__workflow" aria-label="預算編列與公開流程">
        {workflowSteps.map((step, index) => (
          <li key={step.label} className={step.done ? "is-done" : step.active ? "is-active" : ""}>
            <span>{step.done ? <Check size={14} aria-label="已完成" /> : index + 1}</span>
            <p>{step.label}</p>
          </li>
        ))}
      </ol>

      <div className="finance-budget__toolbar">
        {budgets.length > 0 && (
          <label>
            <span>目前預算</span>
            <select
              className="input"
              value={detail?.id || ""}
              onChange={(event) => {
                setSelectedSubmissionId("");
                void financeApi.getBudget(event.target.value).then(setDetail);
              }}
            >
              {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
            </select>
          </label>
        )}
        {detail && canPublish && (canOpenPublic || detail.is_public) && (
          <div className="finance-budget__publish-actions">
            <button className="btn btn-secondary" disabled={pendingAction === "publication"} onClick={() => void togglePublication()}>
              {detail.is_public ? <EyeOff size={16} aria-hidden="true" /> : <Megaphone size={16} aria-hidden="true" />}
              {pendingAction === "publication" ? "正在更新…" : detail.is_public ? "停止公開" : "開放對外檢視"}
            </button>
            {detail.is_public && <a className="btn btn-primary" href={`/public/budgets/${detail.id}`} target="_blank" rel="noreferrer"><Eye size={16} aria-hidden="true" />預覽公開頁</a>}
          </div>
        )}
      </div>

      {canManage && (
        <details className="finance-budget__create" open={!detail}>
          <summary><Plus size={16} aria-hidden="true" />{detail ? "重新匯入或建立追加預算" : "建立或匯入共同預算"}</summary>
          <div className="finance-budget__create-fields">
            {detail && <fieldset className="finance-budget__import-target"><legend>匯入方式</legend><label><input type="radio" name="budget-import-target" value="replace" checked={importTarget === "replace"} disabled={!activeSubmission || !["draft", "returned"].includes(activeSubmission.status)} onChange={() => setImportTarget("replace")} />更新目前草案<span>取代目前草案的明細與憑證</span></label><label><input type="radio" name="budget-import-target" value="supplemental" checked={importTarget === "supplemental"} onChange={() => setImportTarget("supplemental")} />建立追加草案<span>保留既有版本，另建一份追加案</span></label><label><input type="radio" name="budget-import-target" value="new" checked={importTarget === "new"} onChange={() => setImportTarget("new")} />建立另一期間預算<span>僅適用於尚無共同預算的會計期間</span></label></fieldset>}
            <label>會計期間<select className="input" value={importPeriodId} disabled={importingIntoCurrent} onChange={(event) => setPeriodId(event.target.value)}><option value="">選擇會計期間</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
            <label>預算名稱<input className="input" value={importName} disabled={importingIntoCurrent} onChange={(event) => setBudgetName(event.target.value)} placeholder="例如：115 學年度共同預算" /></label>
            {!importingIntoCurrent && <button className="btn btn-secondary" onClick={() => void createBudget()}><Plus size={16} aria-hidden="true" />空白建立</button>}
            <label className="btn btn-secondary finance-budget__file"><FileUp size={16} aria-hidden="true" /><span>{importFile ? importFile.name : "選擇 xlsx"}</span><input className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setImportFile(event.target.files?.[0] || null)} /></label>
            <button className="btn btn-primary" disabled={isImporting || !importFile} onClick={() => void importBudget()}><FileSpreadsheet size={16} aria-hidden="true" />{isImporting ? "正在匯入…" : importTarget === "replace" ? "覆寫草案並匯入" : importTarget === "supplemental" ? "匯入為追加草案" : "匯入並建立"}</button>
          </div>
        </details>
      )}

      {isLoading && !detail ? (
        <div className="finance-budget__loading" role="status">
          <span aria-hidden="true" />
          正在載入共同預算…
        </div>
      ) : !detail ? (
        <div className="finance-budget__empty">
          <ListTree size={24} aria-hidden="true" />
          <div><h3>尚未建立共同預算</h3><p>財務管理者建立後，各部門即可在同一份草案中新增條目與編列額度。</p></div>
        </div>
      ) : (
        <>
          <section className="finance-budget__overview" aria-label="預算執行概況">
            <div className="finance-budget__numbers">
              <div><span>核准編列</span><strong>NT${total.toLocaleString()}</strong></div>
              <div><span>已完成核銷</span><strong>NT${used.toLocaleString()}</strong></div>
              <div><span>可用餘額</span><strong>NT${(total - used).toLocaleString()}</strong></div>
            </div>
            <div className="finance-budget__utilization"><span><b>整體執行率</b><strong>{utilization}%</strong></span><div aria-hidden="true"><i style={{ width: `${utilization}%` }} /></div></div>
          </section>

          <section className="finance-budget__section" aria-labelledby="budget-ledger-heading">
            <header><div><h3 id="budget-ledger-heading">預算執行表</h3><p>編列、核銷與餘額會隨完成核銷的案件更新。</p></div><span>{nodes.filter((node) => node.leaf).length} 個末層條目</span></header>
            <div className="finance-budget__table" role="region" aria-label="預算執行表，可左右捲動" tabIndex={0}><table><thead><tr><th>預算條目</th><th>編列</th><th>已用</th><th>剩餘</th><th>執行率</th></tr></thead><tbody>{nodes.map((row) => {
              const node = detail.nodes.find((item) => item.id === row.id)!;
              const ratio = node.allocated_amount ? Math.min(100, Math.round(node.used_amount / node.allocated_amount * 100)) : 0;
              return <tr key={node.id} className={row.leaf ? "" : "is-group"}><td style={{ paddingLeft: `${14 + row.depth * 22}px` }}>{node.name}</td><td>{row.leaf ? `NT$${node.allocated_amount.toLocaleString()}` : "—"}</td><td>{row.leaf ? `NT$${node.used_amount.toLocaleString()}` : "—"}</td><td>{row.leaf ? `NT$${node.remaining_amount.toLocaleString()}` : "—"}</td><td>{row.leaf ? <span className="finance-budget__ratio"><i><b style={{ width: `${ratio}%` }} /></i>{ratio}%</span> : "—"}</td></tr>;
            })}{nodes.length === 0 && <tr><td className="finance-budget__table-empty" colSpan={5}>尚未編列任何預算條目。</td></tr>}</tbody></table></div>
            <div className="finance-budget__mobile-list">
              {nodes.filter((row) => row.leaf).map((row) => {
                const node = detail.nodes.find((item) => item.id === row.id)!;
                const ratio = node.allocated_amount
                  ? Math.min(100, Math.round(node.used_amount / node.allocated_amount * 100))
                  : 0;
                return <article key={node.id}><header><strong>{row.label}</strong><b>{ratio}%</b></header><dl><div><dt>編列</dt><dd>NT${node.allocated_amount.toLocaleString()}</dd></div><div><dt>已用</dt><dd>NT${node.used_amount.toLocaleString()}</dd></div><div><dt>剩餘</dt><dd>NT${node.remaining_amount.toLocaleString()}</dd></div></dl><span className="finance-budget__mobile-progress" aria-label={`執行率 ${ratio}%`}><i style={{ width: `${ratio}%` }} /></span></article>;
              })}
              {nodes.every((row) => !row.leaf) && <p className="finance-budget__mobile-empty">尚未編列任何預算條目。</p>}
            </div>
          </section>

          <section className="finance-budget__section" aria-labelledby="budget-review-heading">
            <header><div><h3 id="budget-review-heading">預算案與內部審核</h3><p>初始案核准後可建立追加案；每次送審與決定都保留紀錄。</p></div>{(canManage || canPropose) && <div className="finance-budget__new-submission"><label><span className="sr-only">預算案名稱</span><input className="input" value={submissionTitle} onChange={(event) => setSubmissionTitle(event.target.value)} placeholder="預算案名稱" /></label><button className="btn btn-secondary" onClick={() => void createSubmission(detail.submissions.length === 0 ? "initial" : "supplemental")}><Plus size={15} aria-hidden="true" />{detail.submissions.length === 0 ? "建立初始草案" : "建立追加草案"}</button></div>}</header>

            {detail.submissions.length > 0 ? <div className="finance-budget__submissions" role="group" aria-label="預算案版本">{detail.submissions.map((submission) => <button key={submission.id} type="button" aria-pressed={activeSubmission?.id === submission.id} className={activeSubmission?.id === submission.id ? "is-active" : ""} onClick={() => setSelectedSubmissionId(submission.id)}><span>{submission.kind === "initial" ? "初始預算" : "追加預算"}</span><strong>{submission.title}</strong><small className={`is-${submission.status}`}>{statusLabel[submission.status]}</small></button>)}</div> : <div className="finance-budget__inline-empty"><CircleAlert size={17} aria-hidden="true" />先建立初始預算草案，再開始編列。</div>}

            {activeSubmission && (canPropose || canManage) && (activeSubmission.status === "draft" || activeSubmission.status === "returned") && <div className="finance-budget__editor">
              <section><div className="finance-budget__editor-heading"><ListTree size={18} aria-hidden="true" /><div><h4>建立預算階層</h4><p>先建立分類，再把金額配置到最末層條目。</p></div></div><div className="finance-budget__node-form"><select className="input" aria-label="上層預算分類" value={nodeParentId} onChange={(event) => setNodeParentId(event.target.value)}><option value="">最上層分類</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><input className="input" aria-label="新預算條目名稱" value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="例如：行政支出／文書費" /><button className="btn btn-secondary" onClick={() => void createNode()}>新增條目</button></div></section>
              <section><div className="finance-budget__editor-heading"><FileSpreadsheet size={18} aria-hidden="true" /><div><h4>配置部門額度</h4><p>選擇末層條目，填入提出部門與計價方式。</p></div></div><div className="finance-budget__allocation-form"><select className="input" aria-label="配置到預算條目" value={allocationNodeId} onChange={(event) => setAllocationNodeId(event.target.value)}><option value="">選擇末層條目</option>{nodes.filter((node) => node.leaf).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><select className="input" aria-label="提出預算部門" value={allocationOrgId} onChange={(event) => setAllocationOrgId(event.target.value)}><option value="">提出部門</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select><input className="input" aria-label="預算數量" type="number" min="0.01" step="0.01" value={allocationQuantity} onChange={(event) => setAllocationQuantity(event.target.value)} placeholder="數量" /><input className="input" aria-label="預算計價單位" value={allocationUnit} onChange={(event) => setAllocationUnit(event.target.value)} placeholder="單位" /><input className="input" aria-label="預算單價" type="number" min="1" value={allocationUnitPrice} onChange={(event) => setAllocationUnitPrice(event.target.value)} placeholder="單價" /><button className="btn btn-secondary" onClick={() => void createAllocation()}>加入明細</button></div></section>
              <div className="finance-budget__submit"><span><CircleAlert size={16} aria-hidden="true" />送審後會鎖定目前草案，退回後才能繼續修改。</span><button className="btn btn-primary" disabled={pendingAction === "submit"} onClick={() => void submit()}><Send size={16} aria-hidden="true" />{pendingAction === "submit" ? "正在送審…" : "送內部審核"}</button></div>
            </div>}

            {activeSubmission?.status === "submitted" && canReview && <div className="finance-budget__review-bar"><span><CircleAlert size={17} aria-hidden="true" /><b>{activeSubmission.title}</b>正在等待你的審核決定</span><div><button className="btn btn-primary" disabled={pendingAction === "review"} onClick={() => void review("approved")}><CheckCircle2 size={16} aria-hidden="true" />{pendingAction === "review" ? "處理中…" : "核准預算案"}</button><button className="btn btn-secondary" disabled={pendingAction === "review"} onClick={() => void review("returned")}>退回補正</button><button className="btn btn-secondary" disabled={pendingAction === "review"} onClick={() => void review("rejected")}>否決</button></div></div>}

            {activeAllocations.length > 0 && <>
              <p className="finance-budget__scroll-hint">手機版會依項目分組顯示，不需橫向捲動。</p>
              <div className="finance-budget__table finance-budget__table--allocations" role="region" aria-label="預算配置明細" tabIndex={0}>
                <table>
                  <thead><tr><th>項目</th><th>細項</th><th>數量</th><th>單價</th><th>總額（含稅）</th><th>項目總額</th><th>備註與憑證</th><th>操作</th></tr></thead>
                  <tbody>{allocationGroups.flatMap((group) => group.rows.map(({ allocation, detail: allocationDetail }, rowIndex) => {
                    const draftEditable = canEditAllocations
                      && (canManage || allocation.proposed_by_id === currentUserId);
                    const approvedEditable = activeSubmission?.status === "approved" && canManage;
                    const canEdit = draftEditable || approvedEditable;
                    const canAttach = draftEditable || approvedEditable;
                    const editing = editingAllocationId === allocation.id;
                    const calculatedAmount = Number(allocationDraft.quantity) > 0 && Number(allocationDraft.unit_price) > 0
                      ? Math.round(Number(allocationDraft.quantity) * Number(allocationDraft.unit_price))
                      : Number(allocationDraft.amount || 0);
                    return <tr key={allocation.id}>
                      {rowIndex === 0 && <th scope="rowgroup" rowSpan={group.rows.length} className="finance-budget__group-cell">{group.name}</th>}
                      <td><strong>{allocationDetail}</strong></td>
                      <td>{editing ? <span className="finance-budget__quantity-edit"><input className="input" aria-label="編輯數量" type="number" min="0.01" step="0.01" value={allocationDraft.quantity} onChange={(event) => setAllocationDraft({ ...allocationDraft, quantity: event.target.value })} /><input className="input" aria-label="編輯單位" value={allocationDraft.unit} onChange={(event) => setAllocationDraft({ ...allocationDraft, unit: event.target.value })} /></span> : <span>{allocation.quantity ?? "—"}{allocation.unit || ""}</span>}</td>
                      <td>{editing ? <input className="input" aria-label="編輯單價" type="number" min="1" value={allocationDraft.unit_price} onChange={(event) => setAllocationDraft({ ...allocationDraft, unit_price: event.target.value })} placeholder="可留白" /> : <span>{allocation.unit_price ? `NT$${allocation.unit_price.toLocaleString()}` : "＊"}</span>}</td>
                      <td>{editing ? <input className="input" aria-label="編輯總額" type="number" min="1" value={calculatedAmount || ""} disabled={Number(allocationDraft.quantity) > 0 && Number(allocationDraft.unit_price) > 0} onChange={(event) => setAllocationDraft({ ...allocationDraft, amount: event.target.value })} /> : <strong>NT${allocation.amount.toLocaleString()}</strong>}</td>
                      {rowIndex === 0 && <td rowSpan={group.rows.length} className="finance-budget__group-total"><strong>NT${group.total.toLocaleString()}</strong></td>}
                      <td>{editing ? <textarea className="input" aria-label="編輯備註" value={allocationDraft.note} onChange={(event) => setAllocationDraft({ ...allocationDraft, note: event.target.value })} /> : <div className="finance-budget__evidence-cell">{allocation.note && <p>{allocation.note}</p>}{allocation.evidence.length > 0 ? <span>{allocation.evidence.map((evidence) => <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer"><FileCheck2 size={13} aria-hidden="true" />{evidence.filename}</a>)}</span> : <small>尚未附內部憑證</small>}</div>}</td>
                      <td><span className="finance-budget__row-actions">{editing ? <><button className="btn btn-primary" title="儲存" aria-label="儲存預算明細" onClick={() => void saveAllocation(allocation)}><Save size={15} aria-hidden="true" /></button><button className="btn btn-secondary" title="取消" aria-label="取消編輯預算明細" onClick={() => setEditingAllocationId(null)}><X size={15} aria-hidden="true" /></button></> : <>{canEdit && <button className="btn btn-secondary" onClick={() => startAllocationEdit(allocation)}><Pencil size={14} aria-hidden="true" />編輯</button>}{canAttach && <label className="btn btn-secondary finance-budget__evidence-upload"><Paperclip size={14} aria-hidden="true" />{uploadingEvidenceId === allocation.id ? "上傳中…" : "補憑證"}<input className="sr-only" type="file" multiple disabled={uploadingEvidenceId === allocation.id} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { void uploadAllocationEvidence(allocation, event.target.files); event.currentTarget.value = ""; }} /></label>}</>}</span></td>
                    </tr>;
                  }))}</tbody>
                </table>
              </div>
              <div className="finance-budget__allocation-cards">
                {allocationGroups.map((group) => <section key={group.id}>
                  <header><strong>{group.name}</strong><span>項目總額 NT${group.total.toLocaleString()}</span></header>
                  {group.rows.map(({ allocation, detail: allocationDetail }) => {
                    const draftEditable = canEditAllocations
                      && (canManage || allocation.proposed_by_id === currentUserId);
                    const approvedEditable = activeSubmission?.status === "approved" && canManage;
                    const editing = editingAllocationId === allocation.id;
                    return <article key={allocation.id}>
                      <div><h4>{allocationDetail}</h4><strong>NT${allocation.amount.toLocaleString()}</strong></div>
                      {editing ? <div className="finance-budget__card-edit"><label>數量<input className="input" type="number" min="0.01" step="0.01" value={allocationDraft.quantity} onChange={(event) => setAllocationDraft({ ...allocationDraft, quantity: event.target.value })} /></label><label>單位<input className="input" value={allocationDraft.unit} onChange={(event) => setAllocationDraft({ ...allocationDraft, unit: event.target.value })} /></label><label>單價<input className="input" type="number" min="1" value={allocationDraft.unit_price} onChange={(event) => setAllocationDraft({ ...allocationDraft, unit_price: event.target.value })} /></label><label>總額<input className="input" type="number" min="1" value={Number(allocationDraft.quantity) > 0 && Number(allocationDraft.unit_price) > 0 ? Math.round(Number(allocationDraft.quantity) * Number(allocationDraft.unit_price)) : allocationDraft.amount} disabled={Number(allocationDraft.quantity) > 0 && Number(allocationDraft.unit_price) > 0} onChange={(event) => setAllocationDraft({ ...allocationDraft, amount: event.target.value })} /></label><label className="is-wide">備註<textarea className="input" value={allocationDraft.note} onChange={(event) => setAllocationDraft({ ...allocationDraft, note: event.target.value })} /></label><footer><button className="btn btn-primary" onClick={() => void saveAllocation(allocation)}><Save size={14} aria-hidden="true" />儲存</button><button className="btn btn-secondary" onClick={() => setEditingAllocationId(null)}><X size={14} aria-hidden="true" />取消</button></footer></div> : <><dl><div><dt>數量</dt><dd>{allocation.quantity ?? "—"}{allocation.unit || ""}</dd></div><div><dt>單價</dt><dd>{allocation.unit_price ? `NT$${allocation.unit_price.toLocaleString()}` : "＊"}</dd></div></dl>{allocation.note && <p>{allocation.note}</p>}{allocation.evidence.length > 0 && <div className="finance-budget__card-evidence">{allocation.evidence.map((evidence) => <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer"><FileCheck2 size={14} aria-hidden="true" />{evidence.filename}</a>)}</div>}{(draftEditable || approvedEditable) && <footer><button className="btn btn-secondary" onClick={() => startAllocationEdit(allocation)}><Pencil size={14} aria-hidden="true" />編輯細項</button><label className="btn btn-secondary"><Paperclip size={14} aria-hidden="true" />補憑證<input className="sr-only" type="file" multiple disabled={uploadingEvidenceId === allocation.id} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { void uploadAllocationEvidence(allocation, event.target.files); event.currentTarget.value = ""; }} /></label></footer>}</>}
                    </article>;
                  })}
                </section>)}
              </div>
            </>}
          </section>

          <section className={`finance-budget__publication ${detail.is_public ? "is-public" : ""}`}>
            <div className="finance-budget__publication-icon">{detail.is_public ? <Eye size={21} aria-hidden="true" /> : <Megaphone size={21} aria-hidden="true" />}</div>
            <div><h3>{detail.is_public ? "這份預算已開放對外檢視" : "對外公布"}</h3><p>{detail.is_public ? "任何取得網址的人都能查看核准預算與審核紀錄；報帳人、憑證與內部資料不會公開。" : canOpenPublic ? "初始預算已核准。確認公開後，任何取得網址的人都能查看核准明細。" : "初始預算完成內部審核後，才會開放發布控制。"}</p></div>
            {canPublish && (canOpenPublic || detail.is_public) && <div>{detail.is_public && <a className="btn btn-secondary" href={`/public/budgets/${detail.id}`} target="_blank" rel="noreferrer"><Eye size={16} aria-hidden="true" />預覽公開頁</a>}<button className="btn btn-primary" disabled={pendingAction === "publication"} onClick={() => void togglePublication()}>{detail.is_public ? <EyeOff size={16} aria-hidden="true" /> : <Megaphone size={16} aria-hidden="true" />}{pendingAction === "publication" ? "正在更新…" : detail.is_public ? "停止公開" : "確認並公開"}</button></div>}
          </section>

          {activeSubmission && canPublish && canOpenCouncilReview && (
            <section className={`finance-budget__council-review ${activeSubmission.is_council_review_public ? "is-public" : ""}`}>
              <div className="finance-budget__publication-icon">{activeSubmission.is_council_review_public ? <Eye size={21} aria-hidden="true" /> : <Megaphone size={21} aria-hidden="true" />}</div>
              <div><h3>{activeSubmission.is_council_review_public ? "這份草案已開放議員審理" : "提供議員審理草案"}</h3><p>{activeSubmission.is_council_review_public ? "公開頁會清楚標示尚未核定，僅呈現這次草案的明細與備註；憑證和提出人資訊不會公開。" : "草案不必等到核准才可提供議員審理。開放後，任何取得網址的人都能檢視本次送審內容。"}</p></div>
              <div>{activeSubmission.is_council_review_public && <a className="btn btn-secondary" href={councilReviewHref} target="_blank" rel="noreferrer"><Eye size={16} aria-hidden="true" />預覽審理頁</a>}<button className="btn btn-primary" disabled={pendingAction === "council_review"} onClick={() => void toggleCouncilReviewPublication()}>{activeSubmission.is_council_review_public ? <EyeOff size={16} aria-hidden="true" /> : <Megaphone size={16} aria-hidden="true" />}{pendingAction === "council_review" ? "正在更新…" : activeSubmission.is_council_review_public ? "停止審理頁" : "開放議員審理"}</button></div>
            </section>
          )}

          {settlement && <section className="finance-budget__section" aria-labelledby="budget-settlement-heading"><header><div><h3 id="budget-settlement-heading">期末決算</h3><p>只統計已完成核銷的支出；尚有 {settlement.unsettled_claim_count} 件已過帳報帳等待憑證或完成核銷。</p></div><span>{settlement.period_name}</span></header><div className="finance-budget__settlement-totals"><p>核准預算<strong>NT${settlement.budgeted_total.toLocaleString()}</strong></p><p>決算支出<strong>NT${settlement.settled_total.toLocaleString()}</strong></p><p>差額<strong>NT${(settlement.budgeted_total - settlement.settled_total).toLocaleString()}</strong></p></div><div className="finance-budget__table" role="region" aria-label="期末決算明細，可左右捲動" tabIndex={0}><table><thead><tr><th>預算條目</th><th>核准</th><th>決算</th><th>差額</th></tr></thead><tbody>{settlement.lines.map((line) => <tr key={line.node_id}><td>{line.name}</td><td>NT${line.budgeted_amount.toLocaleString()}</td><td>NT${line.settled_amount.toLocaleString()}</td><td>NT${line.difference_amount.toLocaleString()}</td></tr>)}</tbody></table></div><div className="finance-budget__mobile-list finance-budget__mobile-list--settlement">{settlement.lines.map((line) => <article key={line.node_id}><header><strong>{line.name}</strong></header><dl><div><dt>核准</dt><dd>NT${line.budgeted_amount.toLocaleString()}</dd></div><div><dt>決算</dt><dd>NT${line.settled_amount.toLocaleString()}</dd></div><div><dt>差額</dt><dd>NT${line.difference_amount.toLocaleString()}</dd></div></dl></article>)}</div></section>}
        </>
      )}
    </section>
  );
}
