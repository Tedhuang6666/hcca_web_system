"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle, ArrowLeft, Search, Package } from "lucide-react";
import { loansApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type { LoanAvailableItem, LoanRecordOut, LoanUnitOut } from "@/lib/types";

type Tab = "checkout" | "return";
type Step = 1 | 2 | 3;

// ── 借出流程 ──────────────────────────────────────────────────────────────────

function CheckoutFlow() {
  const [step, setStep] = useState<Step>(1);
  const [items, setItems] = useState<LoanAvailableItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [selectedItem, setSelectedItem] = useState<LoanAvailableItem | null>(null);
  const [units, setUnits] = useState<LoanUnitOut[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [form, setForm] = useState({
    borrowerName: "",
    studentId: "",
    email: "",
    contact: "",
    unitId: "",
    dueDays: 7,
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LoanRecordOut | null>(null);

  useEffect(() => {
    loansApi
      .availableItems()
      .then(setItems)
      .catch((e) => toast.error(apiErrorMessage(e, "無法載入物品")))
      .finally(() => setLoadingItems(false));
  }, []);

  const handleSelectItem = async (item: LoanAvailableItem) => {
    setSelectedItem(item);
    setForm((f) => ({ ...f, dueDays: item.default_due_days, unitId: "" }));
    setLoadingUnits(true);
    try {
      const all = await loansApi.listUnits(item.id);
      setUnits(all.filter((u) => u.status === "available"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入個體"));
    } finally {
      setLoadingUnits(false);
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!form.borrowerName.trim()) {
      toast.error("請填寫借用人姓名");
      return;
    }
    if (!form.unitId) {
      toast.error("請選擇物品編號");
      return;
    }
    setSubmitting(true);
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + form.dueDays);
      dueDate.setHours(23, 59, 59, 0);

      const record = await loansApi.checkout({
        unit_id: form.unitId,
        borrower_name: form.borrowerName,
        borrower_student_id: form.studentId || undefined,
        borrower_email: form.email || undefined,
        borrower_contact: form.contact || undefined,
        due_at: dueDate.toISOString(),
      });
      setResult(record);
      setStep(3);
    } catch (e) {
      toast.error(apiErrorMessage(e, "借出失敗"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedItem(null);
    setUnits([]);
    setForm({ borrowerName: "", studentId: "", email: "", contact: "", unitId: "", dueDays: 7 });
    setResult(null);
    // 重新載入可用物品
    setLoadingItems(true);
    loansApi
      .availableItems()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoadingItems(false));
  };

  // Step 1：選物品
  if (step === 1) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">選擇物品</h2>
        {loadingItems ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
        ) : items.length === 0 ? (
          <div className="card p-8 text-center">
            <Package size={32} className="mx-auto mb-2" style={{ color: "var(--text-muted)" }} />
            <p style={{ color: "var(--text-muted)" }}>目前沒有可借用的物品</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((item) => {
              const isEmpty = item.available_count === 0;
              return (
                <button
                  key={item.id}
                  disabled={isEmpty}
                  onClick={() => handleSelectItem(item)}
                  className="card p-4 text-left space-y-2 transition-all active:scale-95"
                  style={
                    isEmpty
                      ? { opacity: 0.4, cursor: "not-allowed" }
                      : { cursor: "pointer" }
                  }
                >
                  <p className="font-semibold text-sm leading-tight">{item.name}</p>
                  {item.description && (
                    <p className="text-xs line-clamp-1" style={{ color: "var(--text-muted)" }}>
                      {item.description}
                    </p>
                  )}
                  <p
                    className="text-lg font-bold tabular-nums"
                    style={{
                      color: isEmpty ? "var(--danger)" : "var(--success)",
                    }}
                  >
                    {item.available_count}
                    <span className="text-xs font-normal ml-1" style={{ color: "var(--text-muted)" }}>
                      / {item.total_count} 可借
                    </span>
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Step 2：填寫借用人資訊
  if (step === 2 && selectedItem) {
    return (
      <div className="space-y-5 max-w-md">
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setStep(1)}
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className="text-lg font-semibold">借用 {selectedItem.name}</h2>
        </div>

        <div className="card p-5 space-y-4">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
              姓名 <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              className="input w-full"
              placeholder="借用人姓名"
              value={form.borrowerName}
              onChange={(e) => setForm((f) => ({ ...f, borrowerName: e.target.value }))}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
              學號
            </label>
            <input
              className="input w-full"
              placeholder="可選"
              value={form.studentId}
              onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
              Email（填寫後可收到催還通知）
            </label>
            <input
              type="email"
              className="input w-full"
              placeholder="可選"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
              物品編號 <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            {loadingUnits ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
            ) : units.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--danger)" }}>目前無可用個體</p>
            ) : (
              <select
                className="input w-full"
                value={form.unitId}
                onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
              >
                <option value="">請選擇編號</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unit_code}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
              歸還天數
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input w-20"
                min={1}
                max={365}
                value={form.dueDays}
                onChange={(e) => setForm((f) => ({ ...f, dueDays: Number(e.target.value) }))}
              />
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                天後歸還（{new Date(Date.now() + form.dueDays * 86400000).toLocaleDateString("zh-TW")}）
              </span>
            </div>
          </div>

          <button
            className="btn btn-primary w-full"
            onClick={handleSubmit}
            disabled={submitting || !form.borrowerName.trim() || !form.unitId}
          >
            {submitting ? "借出中…" : "確認借出"}
          </button>
        </div>
      </div>
    );
  }

  // Step 3：完成
  if (step === 3 && result) {
    const dueDate = new Date(result.due_at).toLocaleDateString("zh-TW");
    return (
      <div className="space-y-5 max-w-md">
        <div className="card p-6 text-center space-y-4">
          <CheckCircle size={48} className="mx-auto" style={{ color: "var(--success)" }} />
          <h2 className="text-xl font-bold">借出成功！</h2>
          <div className="text-left rounded-lg p-4 space-y-2" style={{ background: "var(--bg-elevated)" }}>
            <p className="text-sm">
              <span style={{ color: "var(--text-muted)" }}>物品：</span>
              <span className="font-medium">{result.item_name}</span>
            </p>
            <p className="text-sm">
              <span style={{ color: "var(--text-muted)" }}>編號：</span>
              <span className="font-mono font-medium">{result.unit_code}</span>
            </p>
            <p className="text-sm">
              <span style={{ color: "var(--text-muted)" }}>借用人：</span>
              <span className="font-medium">{result.borrower_name}</span>
            </p>
            <p className="text-sm">
              <span style={{ color: "var(--text-muted)" }}>歸還期限：</span>
              <span className="font-medium">{dueDate}</span>
            </p>
          </div>
          <div className="flex gap-3">
            <button className="btn btn-primary flex-1" onClick={handleReset}>
              再借一件
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── 歸還流程 ──────────────────────────────────────────────────────────────────

function ReturnFlow() {
  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [records, setRecords] = useState<LoanRecordOut[]>([]);
  const [searched, setSearched] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const data = await loansApi.listRecords({ keyword: keyword.trim(), status: "active", limit: 20 });
      const overdue = await loansApi.listRecords({ keyword: keyword.trim(), status: "overdue", limit: 20 });
      setRecords([...data, ...overdue]);
      setSearched(true);
    } catch (e) {
      toast.error(apiErrorMessage(e, "搜尋失敗"));
    } finally {
      setSearching(false);
    }
  };

  const handleReturn = async (record: LoanRecordOut) => {
    setReturning(record.id);
    try {
      await loansApi.returnItem(record.id);
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      toast.success(`${record.item_name} ${record.unit_code} 已歸還`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "歸還失敗"));
    } finally {
      setReturning(null);
    }
  };

  return (
    <div className="space-y-4 max-w-md">
      <h2 className="text-lg font-semibold">辦理歸還</h2>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="輸入借用人姓名或學號搜尋"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button className="btn btn-secondary" onClick={handleSearch} disabled={searching || !keyword.trim()}>
          <Search size={16} />
          {searching ? "搜尋中" : "搜尋"}
        </button>
      </div>

      {searched && records.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          找不到符合的借用紀錄
        </p>
      )}

      <div className="space-y-3">
        {records.map((r) => {
          const isOverdue = r.status === "overdue";
          const dueDate = new Date(r.due_at).toLocaleDateString("zh-TW");
          return (
            <div
              key={r.id}
              className="card p-4 flex items-start gap-4"
              style={isOverdue ? { borderLeftColor: "var(--danger)", borderLeftWidth: 3 } : undefined}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="font-semibold text-sm">{r.borrower_name}</p>
                {r.borrower_student_id && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {r.borrower_student_id}
                  </p>
                )}
                <p className="text-sm">
                  <span className="font-medium">{r.item_name}</span>
                  <span className="font-mono ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {r.unit_code}
                  </span>
                </p>
                <p className="text-xs" style={{ color: isOverdue ? "var(--danger)" : "var(--text-muted)" }}>
                  {isOverdue ? "⚠ 逾期 — " : ""}到期：{dueDate}
                </p>
              </div>
              <button
                className="btn btn-primary btn-sm flex-shrink-0"
                onClick={() => handleReturn(r)}
                disabled={returning === r.id}
              >
                {returning === r.id ? "歸還中…" : "確認歸還"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function LoanCheckoutPage() {
  const { can } = usePermissions();
  const canCheckout = can("loan:checkout") || can("loan:manage");
  const [tab, setTab] = useState<Tab>("checkout");

  if (!canCheckout) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <p style={{ color: "var(--text-muted)" }}>您沒有借還操作的權限。</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">借還操作台</h1>

      {/* Tab 切換 */}
      <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--bg-elevated)" }}>
        <button
          className="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all"
          style={
            tab === "checkout"
              ? { background: "var(--bg-base)", boxShadow: "var(--shadow-sm)" }
              : { color: "var(--text-muted)" }
          }
          onClick={() => setTab("checkout")}
        >
          借出
        </button>
        <button
          className="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all"
          style={
            tab === "return"
              ? { background: "var(--bg-base)", boxShadow: "var(--shadow-sm)" }
              : { color: "var(--text-muted)" }
          }
          onClick={() => setTab("return")}
        >
          歸還
        </button>
      </div>

      {tab === "checkout" ? <CheckoutFlow /> : <ReturnFlow />}
    </div>
  );
}
