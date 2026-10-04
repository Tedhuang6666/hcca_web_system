"use client";

import { useMemo, useState } from "react";
import { FileCheck2, Paperclip, Plus, ReceiptText, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { financeApi } from "@/lib/api";
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
  isPublic,
  onRecorded,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [allocationId, setAllocationId] = useState("");
  const [entryDate, setEntryDate] = useState(taiwanToday);
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [files, setFiles] = useState<File[]>([]);

  const approvedAllocations = useMemo(() => {
    const approvedSubmissionIds = new Set(
      submissions.filter((item) => item.status === "approved").map((item) => item.id),
    );
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return allocations
      .filter((allocation) => approvedSubmissionIds.has(allocation.submission_id))
      .map((allocation) => {
        const node = nodeById.get(allocation.node_id);
        const org = orgs.find((item) => item.id === allocation.proposing_org_id);
        return {
          allocation,
          label: `${node?.name || "預算明細"}${org ? `・${org.name}` : ""}・NT$${allocation.amount.toLocaleString()}`,
        };
      });
  }, [allocations, nodes, orgs, submissions]);

  const total = items.reduce((sum, item) => sum + itemAmount(item), 0);

  const resetForm = () => {
    setAllocationId("");
    setEntryDate(taiwanToday());
    setPurpose("");
    setNote("");
    setItems([emptyItem()]);
    setFiles([]);
  };

  const addFiles = (selected: FileList | null) => {
    if (!selected?.length) return;
    const nextFiles = Array.from(selected);
    if (files.length + nextFiles.length > 20) {
      toast.error("一筆核銷最多附上 20 份憑證");
      return;
    }
    if (nextFiles.some((file) => file.size > 20 * 1024 * 1024)) {
      toast.error("單一憑證不可超過 20 MB");
      return;
    }
    setFiles((current) => [...current, ...nextFiles]);
  };

  const saveExpense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allocationId) return toast.error("請選擇一筆已核准的預算明細");
    if (!purpose.trim()) return toast.error("請填寫支出用途");
    if (items.some((item) => !item.name.trim() || !item.unit.trim() || itemAmount(item) <= 0)) {
      return toast.error("請確認每個品項都有名稱、數量、單位與單價");
    }

    setIsSaving(true);
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
      await financeApi.createBudgetExpense(budgetId, {
        allocation_id: allocationId,
        entry_date: entryDate,
        purpose: purpose.trim(),
        note: note.trim() || undefined,
        items: items.map((item) => ({
          name: item.name.trim(),
          unit_price: Number(item.unit_price),
          tax_rate: Number(item.tax_rate || 0),
          quantity: Number(item.quantity),
          unit: item.unit.trim(),
        })),
        evidence,
      });
      resetForm();
      setIsOpen(false);
      await onRecorded();
      toast.success("支出與憑證已登錄");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登錄支出失敗");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="finance-budget__section finance-budget-expenses" aria-labelledby="budget-expenses-heading">
      <header>
        <div>
          <h3 id="budget-expenses-heading">核銷紀錄</h3>
          <p>選一筆核准明細，填用途、品項和憑證；登錄後直接計入決算。</p>
        </div>
        {canRecord && approvedAllocations.length > 0 && (
          <button className="btn btn-primary" type="button" onClick={() => setIsOpen((value) => !value)}>
            {isOpen ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {isOpen ? "取消" : "登錄支出"}
          </button>
        )}
      </header>

      {isOpen && (
        <form className="finance-budget-expenses__form" onSubmit={(event) => void saveExpense(event)}>
          <div className="finance-budget-expenses__fields">
            <label>
              支出日期
              <input className="input" type="date" required value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
            </label>
            <label>
              對應預算明細
              <select className="input" required value={allocationId} onChange={(event) => setAllocationId(event.target.value)}>
                <option value="">選擇核准項目</option>
                {approvedAllocations.map(({ allocation, label }) => (
                  <option key={allocation.id} value={allocation.id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="finance-budget-expenses__purpose">
              支出用途
              <input className="input" required maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="例如：辦公用品採購" />
            </label>
          </div>

          <fieldset className="finance-budget-expenses__items">
            <legend>購買品項</legend>
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
            <button className="btn btn-secondary" type="button" onClick={() => setItems((current) => [...current, emptyItem()])}>
              <Plus size={15} aria-hidden="true" />新增品項
            </button>
          </fieldset>

          <div className="finance-budget-expenses__attachments">
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
              <Save size={16} aria-hidden="true" />{isSaving ? "正在登錄…" : "儲存核銷"}
            </button>
          </footer>
          <p className="finance-budget-expenses__visibility">
            {isPublic ? "這份預算已公開；登錄後的用途、品項與憑證會同步公開。" : "預算公開後，這筆用途、品項與憑證會一併公開。"}
          </p>
        </form>
      )}

      {expenses.length > 0 ? (
        <ol className="finance-budget-expenses__list">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <div className="finance-budget-expenses__record">
                <time dateTime={expense.entry_date}>{expense.entry_date.replaceAll("-", "/")}</time>
                <div><strong>{expense.purpose}</strong><small>{expense.allocation_name}</small></div>
                <b>NT${expense.total_amount.toLocaleString()}</b>
              </div>
              <ul className="finance-budget-expenses__details">
                {expense.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <small>{item.quantity} {item.unit} × NT${item.unit_price.toLocaleString()}</small>
                    <strong>NT${item.amount.toLocaleString()}</strong>
                  </li>
                ))}
              </ul>
              {expense.evidence.length > 0 && (
                <div className="finance-budget-expenses__evidence">
                  {expense.evidence.map((evidence) => (
                    <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">
                      <FileCheck2 size={14} aria-hidden="true" />{evidence.filename}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="finance-budget-expenses__empty">
          <ReceiptText size={18} aria-hidden="true" />
          <p>{approvedAllocations.length > 0 ? "這份預算還沒有核銷紀錄。" : "核准預算後，可直接在這裡登錄支出與憑證。"}</p>
        </div>
      )}
    </section>
  );
}
