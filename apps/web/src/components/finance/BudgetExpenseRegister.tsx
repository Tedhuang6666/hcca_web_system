"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileCheck2, Paperclip, Pencil, Plus, ReceiptText, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { financeApi } from "@/lib/api";
import EvidencePreview from "@/components/finance/EvidencePreview";
import type {
  FinanceBudgetAllocation,
  FinanceBudgetExpenseOut,
  FinanceBudgetNode,
  FinanceBudgetSubmission,
  OrgRead,
} from "@/lib/types";

type Props = {
  budgetId: string;
  ledgerId: string;
  allocations: FinanceBudgetAllocation[];
  submissions: FinanceBudgetSubmission[];
  nodes: FinanceBudgetNode[];
  expenses: FinanceBudgetExpenseOut[];
  orgs: OrgRead[];
  canRecord: boolean;
  quickNodeId: string | null;
  onQuickRegistrationHandled: () => void;
  isPublic: boolean;
  onRecorded: () => Promise<void>;
};

type ItemDraft = {
  name: string;
  unit_price: string;
  tax_rate: string;
  quantity: string;
  unit: string;
};

const emptyItem = (): ItemDraft => ({
  name: "",
  unit_price: "",
  tax_rate: "0",
  quantity: "1",
  unit: "個",
});

function taiwanToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function itemAmount(item: ItemDraft) {
  const price = Number(item.unit_price);
  const quantity = Number(item.quantity);
  const taxRate = Number(item.tax_rate || 0);
  if (price <= 0 || quantity <= 0 || taxRate < 0) return 0;
  return Math.round(price * quantity * (1 + taxRate / 100));
}

export default function BudgetExpenseRegister({
  budgetId,
  ledgerId,
  allocations,
  submissions,
  nodes,
  expenses,
  orgs,
  canRecord,
  quickNodeId,
  onQuickRegistrationHandled,
  isPublic,
  onRecorded,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [allocationId, setAllocationId] = useState("");
  const [departmentOrgId, setDepartmentOrgId] = useState("");
  const [requestedNodeId, setRequestedNodeId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(taiwanToday);
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [hasItemDetails, setHasItemDetails] = useState(true);
  const [totalAmount, setTotalAmount] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  const approvedAllocations = useMemo(() => {
    const approvedSubmissionIds = new Set(
      submissions.filter((item) => item.status === "approved").map((item) => item.id),
    );
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return allocations
      .filter((allocation) => approvedSubmissionIds.has(allocation.submission_id))
      .map((allocation) => {
        const path: string[] = [];
        let node = nodeById.get(allocation.node_id);
        while (node) {
          path.unshift(node.name);
          node = node.parent_id ? nodeById.get(node.parent_id) : undefined;
        }
        const org = orgs.find((item) => item.id === allocation.proposing_org_id);
        return {
          allocation,
          purpose: path.join("／") || "預算明細",
          label: `${path.join(" ＞ ") || "預算明細"}${org ? `・${org.name}` : ""}・NT$${allocation.amount.toLocaleString()}`,
        };
      });
  }, [allocations, nodes, orgs, submissions]);

  useEffect(() => {
    if (!quickNodeId) return;
    const requested = quickNodeId;
    const matching = requested
      ? approvedAllocations.filter(({ allocation }) => allocation.node_id === requested)
      : [];
    if (!matching.length) {
      onQuickRegistrationHandled();
      return;
    }
    setRequestedNodeId(requested);
    setAllocationId(matching.length === 1 ? matching[0].allocation.id : "");
    if (matching.length === 1) setDepartmentOrgId(matching[0].allocation.proposing_org_id);
    setPurpose(matching[0].purpose);
    setIsOpen(true);
    onQuickRegistrationHandled();
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [approvedAllocations, onQuickRegistrationHandled, quickNodeId]);

  const visibleAllocations = requestedNodeId
    ? approvedAllocations.filter(({ allocation }) => allocation.node_id === requestedNodeId)
    : approvedAllocations;

  const total = hasItemDetails
    ? items.reduce((sum, item) => sum + itemAmount(item), 0)
    : Number(totalAmount) || 0;

  const resetForm = () => {
    setEditingExpenseId(null);
    setAllocationId("");
    setDepartmentOrgId("");
    setRequestedNodeId(null);
    setEntryDate(taiwanToday());
    setPurpose("");
    setNote("");
    setItems([emptyItem()]);
    setHasItemDetails(true);
    setTotalAmount("");
    setFiles([]);
  };

  const addFiles = (selected: FileList | null) => {
    if (!selected?.length) return;
    const nextFiles = Array.from(selected);
    const existingEvidenceCount = editingExpenseId
      ? expenses.find((expense) => expense.id === editingExpenseId)?.evidence.length || 0
      : 0;
    if (files.length + existingEvidenceCount + nextFiles.length > 20) {
      toast.error("一筆核銷最多附上 20 份憑證");
      return;
    }
    if (nextFiles.some((file) => file.size > 20 * 1024 * 1024)) {
      toast.error("單一憑證不可超過 20 MB");
      return;
    }
    setFiles((current) => [...current, ...nextFiles]);
  };

  const editExpense = (expense: FinanceBudgetExpenseOut) => {
    setEditingExpenseId(expense.id);
    setAllocationId(expense.allocation_id);
    setDepartmentOrgId(expense.department_org_id);
    setRequestedNodeId(null);
    setEntryDate(expense.entry_date);
    setPurpose(expense.purpose);
    setNote(expense.note || "");
    setItems(expense.items.length > 0 ? expense.items.map((item) => ({
      name: item.name,
      unit_price: String(item.unit_price),
      tax_rate: String(item.tax_rate),
      quantity: String(item.quantity),
      unit: item.unit,
    })) : [emptyItem()]);
    setHasItemDetails(expense.items.length > 0);
    setTotalAmount(String(expense.total_amount));
    setFiles([]);
    setIsOpen(true);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const cancelExpenseEdit = () => {
    resetForm();
    setIsOpen(false);
  };

  const saveExpense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allocationId) return toast.error("請選擇一筆已核准的預算明細");
    if (!departmentOrgId) return toast.error("請選擇支出部門");
    if (!purpose.trim()) return toast.error("請填寫支出用途");
    if (hasItemDetails && items.some(
      (item) => !item.name.trim() || !item.unit.trim() || itemAmount(item) <= 0,
    )) {
      return toast.error("請確認每個品項都有名稱、數量、單位與單價");
    }
    if (!hasItemDetails && (!Number.isInteger(Number(totalAmount)) || Number(totalAmount) <= 0)) {
      return toast.error("請輸入大於 0 的支出總額");
    }

    setIsSaving(true);
    const savedAllocationId = allocationId;
    const savedDepartmentOrgId = departmentOrgId;
    const savedNodeId = requestedNodeId
      || approvedAllocations.find(({ allocation }) => allocation.id === allocationId)?.allocation.node_id
      || null;
    const savedPurpose = approvedAllocations.find(
      ({ allocation }) => allocation.id === allocationId,
    )?.purpose || purpose;
    try {
      const evidence = await Promise.all(
        files.map(async (file) => {
          const uploaded = await financeApi.uploadEvidence(ledgerId, file);
          return {
            storage_key: uploaded.storage_key,
            filename: uploaded.filename,
            content_type: uploaded.content_type,
            file_size: uploaded.file_size,
          };
        }),
      );
      const body = {
        allocation_id: allocationId,
        department_org_id: departmentOrgId,
        entry_date: entryDate,
        purpose: purpose.trim(),
        ...(!hasItemDetails ? { total_amount: Number(totalAmount) } : {}),
        note: note.trim() || undefined,
        items: hasItemDetails ? items.map((item) => ({
          name: item.name.trim(),
          unit_price: Number(item.unit_price),
          tax_rate: Number(item.tax_rate || 0),
          quantity: Number(item.quantity),
          unit: item.unit.trim(),
        })) : [],
        evidence,
      };
      if (editingExpenseId) {
        await financeApi.updateBudgetExpense(budgetId, editingExpenseId, body);
      } else {
        await financeApi.createBudgetExpense(budgetId, body);
      }
      const wasEditing = Boolean(editingExpenseId);
      resetForm();
      if (wasEditing) {
        setIsOpen(false);
      } else {
        setRequestedNodeId(savedNodeId);
        setAllocationId(savedAllocationId);
        setDepartmentOrgId(savedDepartmentOrgId);
        setPurpose(savedPurpose);
        setIsOpen(true);
      }
      await onRecorded();
      toast.success(wasEditing ? "支出已更新" : "支出已登記");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : editingExpenseId ? "更新支出失敗" : "登記支出失敗");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="finance-budget__section finance-budget-expenses" aria-labelledby="budget-expenses-heading">
      <header>
        <div>
          <h3 id="budget-expenses-heading">{editingExpenseId ? "編輯已登記支出" : "登記支出"}</h3>
          <p>從執行表選定預算後，填寫日期、用途與金額；一次採購可登錄多項品目，同筆預算也能分次核銷。</p>
        </div>
        {canRecord && approvedAllocations.length > 0 && (
          <button className="btn btn-primary" type="button" onClick={() => editingExpenseId ? cancelExpenseEdit() : setIsOpen((value) => !value)}>
            {isOpen ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {editingExpenseId ? "取消修改" : isOpen ? "收起表單" : "登記支出"}
          </button>
        )}
      </header>

      {isOpen && canRecord && approvedAllocations.length > 0 && (
        <form ref={formRef} className="finance-budget-expenses__form" onSubmit={(event) => void saveExpense(event)}>
          <div className="finance-budget-expenses__fields">
            <label>
              支出日期
              <input className="input" type="date" required value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
            </label>
            <label>
              對應預算明細
              <select className="input" required value={allocationId} onChange={(event) => {
                const selected = approvedAllocations.find(({ allocation }) => allocation.id === event.target.value);
                setAllocationId(event.target.value);
                setDepartmentOrgId(selected?.allocation.proposing_org_id || "");
              }}>
                <option value="">選擇預算項目</option>
                {visibleAllocations.map(({ allocation, label }) => (
                  <option key={allocation.id} value={allocation.id}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              支出部門
              <select className="input" required value={departmentOrgId} onChange={(event) => setDepartmentOrgId(event.target.value)}>
                <option value="">選擇提出部門</option>
                {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
              <small>預設沿用預算明細部門，可依實際支出改選。</small>
            </label>
            {requestedNodeId && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setRequestedNodeId(null);
                  setAllocationId("");
                  setDepartmentOrgId("");
                }}
              >
                改選其他預算項目
              </button>
            )}
            <label className="finance-budget-expenses__purpose">
              支出用途
              <input className="input" required maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="例如：辦公用品採購" />
            </label>
          </div>

          <fieldset className="finance-budget-expenses__items">
            <legend>支出金額與品項</legend>
            {!hasItemDetails ? (
              <div className="finance-budget-expenses__fields">
                <label>
                  支出總額
                  <input className="input" type="number" min="1" step="1" required value={totalAmount} onChange={(event) => setTotalAmount(event.target.value)} placeholder="NT$" />
                </label>
                <button className="btn btn-secondary" type="button" onClick={() => setHasItemDetails(true)}>
                  <Plus size={15} aria-hidden="true" />新增品項明細（選填）
                </button>
              </div>
            ) : (
              <>
                {items.map((item, index) => (
                  <div className="finance-budget-expenses__item" key={index}>
                    <label className="finance-budget-expenses__item-name">
                      品項
                      <input className="input" required maxLength={200} value={item.name} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} placeholder="例如：原子筆" />
                    </label>
                    <label>
                      數量
                      <input className="input" type="number" min="0.01" step="0.01" required value={item.quantity} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} />
                    </label>
                    <label>
                      單位
                      <input className="input" required maxLength={32} value={item.unit} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.target.value } : row))} />
                    </label>
                    <label>
                      單價
                      <input className="input" type="number" min="1" step="1" required value={item.unit_price} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, unit_price: event.target.value } : row))} placeholder="NT$" />
                    </label>
                    <label>
                      稅率 %
                      <input className="input" type="number" min="0" max="100" step="1" value={item.tax_rate} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, tax_rate: event.target.value } : row))} />
                    </label>
                    <strong className="finance-budget-expenses__item-total">NT${itemAmount(item).toLocaleString()}</strong>
                    <button className="finance-budget-expenses__remove" type="button" disabled={items.length === 1} aria-label={`移除第 ${index + 1} 個品項`} onClick={() => setItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-secondary" type="button" onClick={() => setItems((current) => [...current, emptyItem()])}>
                    <Plus size={15} aria-hidden="true" />新增品項
                  </button>
                  <button className="btn btn-secondary" type="button" onClick={() => setHasItemDetails(false)}>
                    改填總額
                  </button>
                </div>
              </>
            )}
          </fieldset>

          <div className="finance-budget-expenses__attachments">
            {editingExpenseId && expenses.find((expense) => expense.id === editingExpenseId)?.evidence.length ? (
              <div className="finance-budget-expenses__existing-evidence">
                <span>既有憑證會保留：</span>
                {expenses.find((expense) => expense.id === editingExpenseId)?.evidence.map((evidence) => (
                  <EvidencePreview key={evidence.id} url={evidence.url} filename={evidence.filename}>
                    <FileCheck2 size={14} aria-hidden="true" />{evidence.filename}
                  </EvidencePreview>
                ))}
              </div>
            ) : null}
            <label className="btn btn-secondary">
              <Paperclip size={15} aria-hidden="true" />附上收據或憑證
              <input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
            </label>
            {files.length > 0 && <ul aria-label="待上傳憑證">{files.map((file, index) => (
              <li key={`${file.name}-${file.lastModified}-${index}`}>
                <span>{file.name}</span>
                <button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><X size={14} aria-hidden="true" /></button>
              </li>
            ))}</ul>}
            <label className="finance-budget-expenses__note">
              備註（選填）
              <input className="input" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="補充說明" />
            </label>
          </div>

          <footer>
            <span>支出合計<strong aria-live="polite">NT${total.toLocaleString()}</strong></span>
            <button className="btn btn-primary" type="submit" disabled={isSaving}>
              <Save size={16} aria-hidden="true" />{isSaving ? "正在儲存…" : editingExpenseId ? "更新支出" : "儲存支出"}
            </button>
          </footer>
          <p className="finance-budget-expenses__visibility">
            {isPublic ? "儲存後，支出的用途、金額與憑證會顯示在公開頁面。" : "預算公開後，這筆支出會一併顯示。"}
          </p>
        </form>
      )}

      {expenses.length > 0 ? (
        <ol className="finance-budget-expenses__list">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <div className="finance-budget-expenses__record">
                <time dateTime={expense.entry_date}>{expense.entry_date.replaceAll("-", "/")}</time>
                <div><strong>{expense.purpose}</strong><small>{expense.allocation_name} · 支出部門：{expense.department_name}</small></div>
                <b>NT${expense.total_amount.toLocaleString()}</b>
              </div>
              {canRecord && <div className="finance-budget-expenses__actions"><button className="btn btn-secondary" type="button" onClick={() => editExpense(expense)}><Pencil size={14} aria-hidden="true" />編輯支出</button></div>}
              {expense.items.length > 0 && (
                <ul className="finance-budget-expenses__details">
                  {expense.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.name}</span>
                      <small>{item.quantity} {item.unit} × NT${item.unit_price.toLocaleString()}</small>
                      <strong>NT${item.amount.toLocaleString()}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {expense.evidence.length > 0 && (
                <div className="finance-budget-expenses__evidence">
                  {expense.evidence.map((evidence) => (
                    <EvidencePreview key={evidence.id} url={evidence.url} filename={evidence.filename}>
                      <FileCheck2 size={14} aria-hidden="true" />{evidence.filename}
                    </EvidencePreview>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="finance-budget-expenses__empty">
          <ReceiptText size={18} aria-hidden="true" />
          <p>{approvedAllocations.length > 0 ? "這份預算還沒有支出紀錄。" : "匯入預算後，就能在這裡登記支出。"}</p>
        </div>
      )}
    </section>
  );
}
