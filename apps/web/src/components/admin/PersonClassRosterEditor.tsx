"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ApiError, classApi } from "@/lib/api";
import type { PersonDetailOut, SchoolClassListItem } from "@/lib/types";

export default function PersonClassRosterEditor({ person, classes, onChanged }: {
  person: PersonDetailOut;
  classes: SchoolClassListItem[];
  onChanged: () => Promise<void>;
}) {
  const classIds = new Set([
    ...person.affiliations.filter((item) => item.kind === "class_member" && item.status === "active")
      .map((item) => item.class_id),
    ...(person.class_roster ?? []).filter((item) => item.is_active).map((item) => item.class_id),
  ]);
  const options = classes.filter((item) => item.is_active && classIds.has(item.id));
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  const classId = options.some((item) => item.id === selected) ? selected : options[0]?.id ?? "";
  const currentSeat = (person.class_roster ?? []).find((item) => item.class_id === classId)?.seat_number;
  const [seat, setSeat] = useState(currentSeat === undefined ? "" : String(currentSeat));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return <form className="mt-4 space-y-3" onSubmit={async (event) => {
    event.preventDefault();
    if (saving || !classId || !person.student_id) return;
    const seatNumber = Number(seat);
    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 999) {
      setError("請輸入 1 到 999 的整數座號。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const roster = await classApi.roster(classId);
      const entry = roster.find((item) => item.student_id === person.student_id
        || (person.user_id && item.user_id === person.user_id));
      if (entry) {
        await classApi.updateRoster(classId, entry.id, { seat_number: seatNumber });
      } else {
        await classApi.addRoster(classId, { seat_number: seatNumber, student_id: person.student_id });
      }
      toast.success("座號已更新");
      await onChanged();
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "儲存座號失敗，請稍後再試。");
    } finally { setSaving(false); }
  }}>
    <label className="block space-y-1 text-sm">
      <span style={{ color: "var(--text-secondary)" }}>設定座號的班級</span>
      <select className="input min-h-11 w-full" value={classId} disabled={saving || !options.length}
        onChange={(event) => {
          const id = event.target.value;
          setSelected(id);
          const entry = (person.class_roster ?? []).find((item) => item.class_id === id);
          setSeat(entry ? String(entry.seat_number) : "");
          setError("");
        }}>
        {!options.length && <option value="">請先設定班級</option>}
        {options.map((item) => <option key={item.id} value={item.id}>
          {item.academic_year} 學年度 {item.label ?? `${item.class_code} 班`}
        </option>)}
      </select>
    </label>
    <label className="block space-y-1 text-sm">
      <span style={{ color: "var(--text-secondary)" }}>設定座號</span>
      <input className="input min-h-11 w-full" type="number" inputMode="numeric"
        min={1} max={999} step={1} required value={seat}
        disabled={saving || !classId || !person.student_id}
        onChange={(event) => setSeat(event.target.value)} />
    </label>
    {!person.student_id && <p className="text-sm" style={{ color: "var(--text-muted)" }}>請先儲存學號，再設定座號。</p>}
    {error && <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    <button className="btn btn-primary min-h-11 w-full disabled:opacity-50" type="submit"
      disabled={saving || !classId || !person.student_id || !seat}>
      {saving ? "儲存中…" : "儲存座號"}
    </button>
  </form>;
}
