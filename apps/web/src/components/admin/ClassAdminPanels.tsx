"use client";

import { useState } from "react";
import { CheckSquare, Plus, Power, Search, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { ClassRosterEntryOut, ClassStudentRangeOut, SchoolClassListItem } from "@/lib/types";
import { classTitle } from "@/lib/classes-admin";

export function ClassList({
  classes,
  selectedId,
  selectedIds,
  onSelect,
  onSelectionChange,
  onBulkAction,
  bulkBusy,
}: {
  classes: SchoolClassListItem[];
  selectedId: string | null;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onSelectionChange: (ids: string[]) => void;
  onBulkAction: (action: "activate" | "deactivate" | "delete") => Promise<void>;
  bulkBusy: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = classes.filter((item) => {
    const haystack = `${item.academic_year} ${item.class_code} ${item.grade} ${item.label ?? ""}`;
    return haystack.includes(query.trim());
  });
  const selectedSet = new Set(selectedIds);
  const filteredIds = filtered.map((item) => item.id);
  const allVisibleSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id));
  const hasSelection = selectedIds.length > 0;

  const toggleSelected = (id: string) => {
    onSelectionChange(
      selectedSet.has(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onSelectionChange(selectedIds.filter((id) => !filteredIds.includes(id)));
      return;
    }
    onSelectionChange(Array.from(new Set([...selectedIds, ...filteredIds])));
  };

  return (
    <section className="rounded-md border! border-border!">
      <div className="p-4 border-b! border-b-border!">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-primary!">
            班級清單
          </h2>
          <span className="text-xs text-fg-muted!">{classes.length} 班</span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md px-3 py-2 border! border-border!"
          >
          <Search size={15}   className="text-fg-muted!"/>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent text-sm outline-none text-fg-primary!"
            placeholder="搜尋學年度、班級代碼"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleAllVisible}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs border! border-border! text-fg-secondary!"
            >
            {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allVisibleSelected ? "取消本頁" : "選取本頁"}
          </button>
          <span className="text-xs text-fg-muted!">
            已選 {selectedIds.length} 班
          </span>
          {hasSelection && (
            <>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => onBulkAction("deactivate")}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50 border! border-border! text-fg-secondary!"
                >
                <Power size={14} /> 批量停用
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => onBulkAction("activate")}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50 border! border-border! text-accent-text!"
                >
                <Power size={14} /> 批量啟用
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => onBulkAction("delete")}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50 border! border-border!"
                style={{ color: "#dc2626" }}>
                <Trash2 size={14} /> 批量刪除
              </button>
            </>
          )}
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto">
        {filtered.map((item) => {
          const active = item.id === selectedId;
          const selected = selectedSet.has(item.id);
          return (
            <div
              key={item.id}
              className="flex items-stretch border-b! border-b-border!"
              style={{ background: active ? "var(--primary-dim)" : "transparent" }}>
              <button
                type="button"
                onClick={() => toggleSelected(item.id)}
                className="flex w-10 flex-shrink-0 items-center justify-center"
                aria-label={selected ? "取消選取班級" : "選取班級"}
                style={{ color: selected ? "var(--primary-text)" : "var(--text-muted)" }}>
                {selected ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="min-w-0 flex-1 px-2 py-3 text-left transition-colors">
                <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold"
                    style={{ color: active ? "var(--primary-text)" : "var(--text-primary)" }}>
                    {classTitle(item)}
                  </p>
                  <p className="text-xs mt-0.5 text-fg-muted!">
                    {item.grade} 年級 · {item.label ?? item.class_code}
                  </p>
                </div>
                <span
                  className="rounded px-2 py-1 text-xs border! border-border!"
                  style={{ color: item.is_active ? "#047857" : "var(--text-muted)", background: item.is_active ? "rgba(16,185,129,0.12)" : "transparent" }}>
                  {item.is_active ? "當前" : "停用"}
                </span>
              </div>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-4 text-sm text-fg-muted!">
            找不到符合條件的班級。
          </div>
        )}
      </div>
    </section>
  );
}

export function RangePanel({
  ranges,
  onAdd,
  onDelete,
}: {
  ranges: ClassStudentRangeOut[];
  onAdd: (start: string, end: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <div className="space-y-4">
      <section className="rounded-md p-4 border! border-border!">
        <h3 className="text-sm font-semibold text-fg-primary!">
          新增學號區間
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input className="input" value={start} onChange={(event) => setStart(event.target.value)}
            placeholder="起始學號" />
          <input className="input" value={end} onChange={(event) => setEnd(event.target.value)}
            placeholder="結束學號" />
          <button
            type="button"
            className="rounded-md px-4 py-2 text-sm font-semibold bg-accent! text-accent-foreground!"
            onClick={async () => {
              await onAdd(start, end);
              setStart("");
              setEnd("");
            }}>
            新增
          </button>
        </div>
      </section>

      <section className="rounded-md overflow-hidden border! border-border!">
        <div className="px-4 py-3 border-b! border-b-border!">
          <h3 className="text-sm font-semibold text-fg-primary!">
            已設定區間
          </h3>
        </div>
        {ranges.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-muted!">
            尚未設定學號區間。
          </p>
        ) : (
          ranges.map((range) => (
            <div
              key={range.id}
              className="flex items-center justify-between px-4 py-3 border-b! border-b-border!"
              >
              <span className="font-mono text-sm text-fg-primary!">
                {range.student_id_start} → {range.student_id_end}
              </span>
              <button type="button" className="text-xs text-danger!"
                onClick={() => onDelete(range.id)}>
                刪除
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

export function RosterPanel({
  entries,
  onAdd,
  onBulkImport,
  onUpdate,
  onDelete,
}: {
  entries: ClassRosterEntryOut[];
  onAdd: (seatNumber: number, studentId: string) => Promise<void>;
  onBulkImport: (entries: { seat_number: number; student_id: string }[]) => Promise<void>;
  onUpdate: (id: string, seatNumber: number, studentId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [seatNumber, setSeatNumber] = useState("");
  const [studentId, setStudentId] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSeat, setEditSeat] = useState("");
  const [editStudentId, setEditStudentId] = useState("");

  const parseRows = (value: string) => {
    const rows: { seat_number: number; student_id: string }[] = [];
    for (const [index, line] of value.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const [seat, id] = line.trim().split(/[,;\t ]+/);
      const number = Number(seat);
      if (!Number.isInteger(number) || number < 1 || !id) {
        throw new Error(`第 ${index + 1} 行格式錯誤，請使用「座號,學號」`);
      }
      rows.push({ seat_number: number, student_id: id.trim() });
    }
    if (rows.length === 0) throw new Error("請先貼上至少一筆名冊資料");
    return rows;
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md p-4 border! border-border!">
        <div>
          <h3 className="text-sm font-semibold text-fg-primary!">
            手動維護座號名冊
          </h3>
        </div>
        <div className="mt-3 grid grid-cols-[96px_1fr_auto] gap-2">
          <input
            className="input"
            inputMode="numeric"
            value={seatNumber}
            onChange={(event) => setSeatNumber(event.target.value)}
            placeholder="座號"
            aria-label="座號"
          />
          <input
            className="input font-mono"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            placeholder="學號"
            aria-label="學號"
          />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold bg-accent! text-accent-foreground!"
            onClick={async () => {
              const number = Number(seatNumber);
              if (!Number.isInteger(number) || number < 1 || !studentId.trim()) {
                toast.error("請輸入有效座號與學號");
                return;
              }
              await onAdd(number, studentId.trim());
              setSeatNumber("");
              setStudentId("");
            }}
          >
            <Plus size={15} /> 新增
          </button>
        </div>
        <div className="mt-4 border-t pt-4 border-border!">
          <label className="text-xs font-medium text-fg-secondary!">
            貼上多筆名冊
            <textarea
              className="input mt-1 min-h-24 w-full font-mono text-xs"
              value={pasteValue}
              onChange={(event) => setPasteValue(event.target.value)}
              placeholder={"1,1150101\n2,1150102\n3,1150103"}
              aria-label="批量貼上座號與學號"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-fg-muted!">
              支援逗號、Tab 或空白分隔；相同座號會更新原資料。
            </span>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-xs font-semibold border! border-border! text-fg-secondary!"
              onClick={async () => {
                try {
                  await onBulkImport(parseRows(pasteValue));
                  setPasteValue("");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "批量匯入失敗");
                }
              }}
            >
              匯入名冊
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border! border-border!">
        <div className="flex items-center justify-between px-4 py-3 border-b! border-b-border!">
          <div>
            <h3 className="text-sm font-semibold text-fg-primary!">
              班級座號名冊
            </h3>
            <p className="mt-1 text-xs text-fg-muted!">
              共 {entries.length} 筆 · 可直接編輯或刪除
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-fg-muted! border-b! border-b-border!">
                <th className="px-4 py-2 text-left font-medium">座號</th>
                <th className="px-4 py-2 text-left font-medium">學號</th>
                <th className="px-4 py-2 text-left font-medium">帳號連結</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const editing = editingId === entry.id;
                return (
                  <tr key={entry.id}  className="border-b! border-b-border!">
                    <td className="px-4 py-2 text-fg-primary!">
                      {editing ? (
                        <input className="input w-20" inputMode="numeric" value={editSeat}
                          onChange={(event) => setEditSeat(event.target.value)} aria-label="編輯座號" />
                      ) : entry.seat_number}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-fg-primary!">
                      {editing ? (
                        <input className="input min-w-36" value={editStudentId}
                          onChange={(event) => setEditStudentId(event.target.value)} aria-label="編輯學號" />
                      ) : entry.student_id}
                    </td>
                    <td className="px-4 py-2 text-xs" style={{ color: entry.user ? "var(--text-secondary)" : "var(--text-muted)" }}>
                      {entry.user ? `${entry.user.display_name} · 已連結` : "尚未註冊帳號"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {editing ? (
                        <>
                          <button type="button" className="mr-3 text-xs font-medium text-accent-text!"
                            onClick={async () => {
                              const number = Number(editSeat);
                              if (!Number.isInteger(number) || number < 1 || !editStudentId.trim()) {
                                toast.error("請輸入有效座號與學號");
                                return;
                              }
                              await onUpdate(entry.id, number, editStudentId.trim());
                              setEditingId(null);
                            }}>儲存</button>
                          <button type="button" className="text-xs text-fg-muted!"
                            onClick={() => setEditingId(null)}>取消</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="mr-3 text-xs text-accent-text!"
                            onClick={() => {
                              setEditingId(entry.id);
                              setEditSeat(String(entry.seat_number));
                              setEditStudentId(entry.student_id);
                            }}>編輯</button>
                          <button type="button" className="text-xs text-danger!"
                            onClick={() => onDelete(entry.id)}>刪除</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {entries.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-fg-muted!">
                  尚未建立座號名冊，先輸入一筆或貼上多筆資料。
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
