"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { loansApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type { LoanRecordOut, LoanRecordStatus } from "@/lib/types";

// ── 工具 ───────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<LoanRecordStatus, string> = {
  active: "借用中",
  returned: "已歸還",
  overdue: "逾期",
  lost: "遺失",
};

const STATUS_COLOR: Record<LoanRecordStatus, string> = {
  active: "var(--primary)",
  returned: "var(--success)",
  overdue: "var(--danger)",
  lost: "var(--text-muted)",
};

function StatusBadge({ status }: { status: LoanRecordStatus }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: STATUS_COLOR[status],
        background: `color-mix(in srgb, ${STATUS_COLOR[status]} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${STATUS_COLOR[status]} 30%, transparent)`,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── 展開詳情行 ─────────────────────────────────────────────────────────────────

function RecordExpandedRow({
  record,
  onReturn,
  onUpdateNotes,
}: {
  record: LoanRecordOut;
  onReturn: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
}) {
  const [notes, setNotes] = useState(record.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [returning, setReturning] = useState(false);
  const [newDue, setNewDue] = useState(record.due_at.slice(0, 16));
  const [savingDue, setSavingDue] = useState(false);

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await loansApi.updateRecord(record.id, { notes });
      onUpdateNotes(record.id, notes);
      toast.success("備註已儲存");
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setSavingNotes(false);
    }
  };

  const handleSaveDue = async () => {
    setSavingDue(true);
    try {
      await loansApi.updateRecord(record.id, { due_at: new Date(newDue).toISOString() });
      toast.success("期限已更新");
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    } finally {
      setSavingDue(false);
    }
  };

  const handleReturn = async () => {
    setReturning(true);
    try {
      await loansApi.returnItem(record.id);
      onReturn(record.id);
      toast.success("已標記歸還");
    } catch (e) {
      toast.error(apiErrorMessage(e, "歸還失敗"));
    } finally {
      setReturning(false);
    }
  };

  return (
    <div
      className="px-4 pb-4 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm"
      style={{ background: "var(--bg-elevated)" }}
    >
      <div className="space-y-2">
        <p>
          <span style={{ color: "var(--text-muted)" }}>借出時間：</span>
          {formatDate(record.borrowed_at)}
        </p>
        {record.borrower_student_id && (
          <p>
            <span style={{ color: "var(--text-muted)" }}>學號：</span>
            {record.borrower_student_id}
          </p>
        )}
        {record.borrower_email && (
          <p>
            <span style={{ color: "var(--text-muted)" }}>Email：</span>
            {record.borrower_email}
          </p>
        )}
        {record.borrower_contact && (
          <p>
            <span style={{ color: "var(--text-muted)" }}>聯絡：</span>
            {record.borrower_contact}
          </p>
        )}
        {record.handled_by_name && (
          <p>
            <span style={{ color: "var(--text-muted)" }}>借出工作人員：</span>
            {record.handled_by_name}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {/* 修改期限 */}
        {(record.status === "active" || record.status === "overdue") && (
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              歸還期限
            </label>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                className="input text-sm flex-1"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleSaveDue}
                disabled={savingDue}
              >
                更新
              </button>
            </div>
          </div>
        )}

        {/* 備註 */}
        <div className="space-y-1">
          <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            備註
          </label>
          <textarea
            className="input w-full h-16 resize-none text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="btn btn-ghost btn-xs"
            onClick={handleSaveNotes}
            disabled={savingNotes}
          >
            {savingNotes ? "儲存中…" : "儲存備註"}
          </button>
        </div>

        {/* 快速歸還 */}
        {(record.status === "active" || record.status === "overdue") && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={handleReturn}
            disabled={returning}
          >
            {returning ? "歸還中…" : "確認歸還"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function LoanRecordsPage() {
  const { can } = usePermissions();
  const canView = can("loan:checkout") || can("loan:manage") || can("loan:view_all");

  const [records, setRecords] = useState<LoanRecordOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<LoanRecordStatus | "">("");
  const [keyword, setKeyword] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loansApi.listRecords({
        status: filterStatus || undefined,
        keyword: keyword.trim() || undefined,
        limit: 200,
      });
      setRecords(data);
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入紀錄"));
    } finally {
      setLoading(false);
    }
  }, [filterStatus, keyword]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReturn = (id: string) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "returned", returned_at: new Date().toISOString() } : r))
    );
  };

  const handleUpdateNotes = (id: string, notes: string) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, notes } : r)));
  };

  if (!canView) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <p style={{ color: "var(--text-muted)" }}>您沒有查看借用紀錄的權限。</p>
      </div>
    );
  }

  const overdue = records.filter((r) => r.status === "overdue");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">借用紀錄</h1>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          重新整理
        </button>
      </div>

      {/* 逾期警示 */}
      {overdue.length > 0 && (
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-2 text-sm font-medium"
          style={{
            color: "var(--danger)",
            background: "color-mix(in srgb, var(--danger) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)",
          }}
        >
          ⚠ 共 {overdue.length} 筆逾期未還
        </div>
      )}

      {/* 篩選列 */}
      <div className="flex gap-2 flex-wrap">
        <select
          className="input w-32"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LoanRecordStatus | "")}
        >
          <option value="">全部狀態</option>
          <option value="active">借用中</option>
          <option value="overdue">逾期</option>
          <option value="returned">已歸還</option>
          <option value="lost">遺失</option>
        </select>
        <input
          className="input flex-1 min-w-40"
          placeholder="搜尋姓名或學號…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
      </div>

      {/* 紀錄列表 */}
      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
      ) : records.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>找不到符合的紀錄</p>
      ) : (
        <div className="card overflow-hidden">
          {records.map((r, idx) => {
            const isExpanded = expandedId === r.id;
            const isOverdue = r.status === "overdue";
            return (
              <div
                key={r.id}
                style={
                  idx > 0 ? { borderTop: "1px solid var(--border)" } : undefined
                }
              >
                <button
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-elevated)] transition-colors"
                  style={isOverdue ? { borderLeft: "3px solid var(--danger)" } : undefined}
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                    <span className="font-medium text-sm truncate">{r.borrower_name}</span>
                    <span className="text-sm truncate">
                      {r.item_name}
                      <span className="font-mono ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.unit_code}
                      </span>
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      到期 {new Date(r.due_at).toLocaleDateString("zh-TW")}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  {isExpanded ? (
                    <ChevronUp size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  ) : (
                    <ChevronDown size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  )}
                </button>
                {isExpanded && (
                  <RecordExpandedRow
                    record={r}
                    onReturn={handleReturn}
                    onUpdateNotes={handleUpdateNotes}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
