"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { classApi, usersApi, ApiError } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type {
  SchoolClassBulkGradeCreate,
  SchoolClassListItem,
  SchoolClassOut,
  ClassMemberOut,
  UserSummary,
} from "@/lib/types";

const defaultRangeTemplate = {
  student_id_start_template: "{academic_year}{grade}{class_no_padded}{student_no_padded}",
  student_id_end_template: "{academic_year}{grade}{class_no_padded}{student_no_padded}",
  student_no_start: 1,
  student_no_end: 40,
  class_no_width: 2,
  student_no_width: 2,
};

const defaultGradeRule = (grade: number): SchoolClassBulkGradeCreate => ({
  grade,
  class_start: 1,
  class_end: 20,
  class_code_template: "{grade}{class_no_padded}",
  label_template: "{academic_year} 學年度 {grade} 年 {class_no} 班",
  range_template: { ...defaultRangeTemplate },
  class_overrides: [],
});

function renderTemplate(
  template: string,
  year: number,
  rule: SchoolClassBulkGradeCreate,
  classNo: number,
  studentNo?: number,
) {
  const range = rule.range_template ?? defaultRangeTemplate;
  return template
    .replaceAll("{academic_year}", String(year))
    .replaceAll("{grade}", String(rule.grade))
    .replaceAll("{class_no}", String(classNo))
    .replaceAll("{class_no_padded}", String(classNo).padStart(range.class_no_width, "0"))
    .replaceAll("{student_no}", studentNo == null ? "" : String(studentNo))
    .replaceAll(
      "{student_no_padded}",
      studentNo == null ? "" : String(studentNo).padStart(range.student_no_width, "0"),
    );
}

function BulkCreateClassForm({ onCreated }: { onCreated: () => void }) {
  const now = new Date();
  const defaultYear = now.getFullYear() - 1911;
  const [year, setYear] = useState(String(defaultYear));
  const [rules, setRules] = useState<SchoolClassBulkGradeCreate[]>([defaultGradeRule(1)]);
  const [withRanges, setWithRanges] = useState(true);
  const [busy, setBusy] = useState(false);

  const updateRule = <K extends keyof SchoolClassBulkGradeCreate>(
    index: number,
    key: K,
    value: SchoolClassBulkGradeCreate[K],
  ) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  };

  const updateRange = (
    index: number,
    key: keyof NonNullable<SchoolClassBulkGradeCreate["range_template"]>,
    value: string | number,
  ) => {
    setRules((prev) =>
      prev.map((r, i) =>
        i === index
          ? { ...r, range_template: { ...(r.range_template ?? defaultRangeTemplate), [key]: value } }
          : r,
      ),
    );
  };

  const classNumbersFor = (rule: SchoolClassBulkGradeCreate) => {
    const start = Math.min(rule.class_start, rule.class_end);
    const end = Math.max(rule.class_start, rule.class_end);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  const overrideFor = (rule: SchoolClassBulkGradeCreate, classNo: number) =>
    rule.class_overrides.find((item) => item.class_no === classNo);

  const updateOverride = (
    index: number,
    classNo: number,
    key: "student_no_start" | "student_no_end",
    value: number | null,
  ) => {
    setRules((prev) =>
      prev.map((rule, i) => {
        if (i !== index) return rule;
        const existing = overrideFor(rule, classNo);
        const nextOverride = {
          class_no: classNo,
          student_no_start: existing?.student_no_start ?? null,
          student_no_end: existing?.student_no_end ?? null,
          [key]: value,
        };
        if (nextOverride.student_no_start == null && nextOverride.student_no_end == null) {
          return {
            ...rule,
            class_overrides: rule.class_overrides.filter((item) => item.class_no !== classNo),
          };
        }
        const class_overrides = existing
          ? rule.class_overrides.map((item) => (item.class_no === classNo ? nextOverride : item))
          : [...rule.class_overrides, nextOverride];
        return { ...rule, class_overrides };
      }),
    );
  };

  const preview = rules.flatMap((rule) => {
    return classNumbersFor(rule).map((classNo) => {
      const range = rule.range_template;
      const override = overrideFor(rule, classNo);
      const studentStart = override?.student_no_start ?? range?.student_no_start;
      const studentEnd = override?.student_no_end ?? range?.student_no_end;
      return {
        code: renderTemplate(rule.class_code_template, Number(year), rule, classNo),
        label: rule.label_template
          ? renderTemplate(rule.label_template, Number(year), rule, classNo)
          : "",
        range:
          withRanges && range
            ? `${renderTemplate(
                range.student_id_start_template,
                Number(year),
                rule,
                classNo,
                studentStart,
              )} ～ ${renderTemplate(
                range.student_id_end_template,
                Number(year),
                rule,
                classNo,
                studentEnd,
              )}`
            : "不建立區間",
        overridden: Boolean(override),
      };
    });
  });

  const submit = async () => {
    if (!Number(year) || rules.length === 0) {
      toast.error("請設定學年度與至少一個年級規則");
      return;
    }
    setBusy(true);
    try {
      const result = await classApi.bulkCreate({
        academic_year: Number(year),
        is_active: true,
        grades: rules.map((r) => ({ ...r, range_template: withRanges ? r.range_template : null })),
      });
      toast.success(`已建立 ${result.succeeded} 班，略過 ${result.skipped} 班`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "批量建立失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            批量建立班級
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            設定每個年級的班號範圍，並套用學號區間模板。
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={withRanges}
            onChange={(e) => setWithRanges(e.target.checked)}
          />
          建立學號區間
        </label>
      </div>

      <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
        學年度
        <input
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="input w-full mt-1"
          inputMode="numeric"
        />
      </label>

      <div className="space-y-3">
        {rules.map((rule, index) => (
          <div key={index} className="rounded border p-3 space-y-3" style={{ borderColor: "var(--border)" }}>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                年級
                <input
                  value={rule.grade}
                  onChange={(e) => updateRule(index, "grade", Number(e.target.value))}
                  className="input w-full mt-1"
                  inputMode="numeric"
                />
              </label>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                起始班
                <input
                  value={rule.class_start}
                  onChange={(e) => updateRule(index, "class_start", Number(e.target.value))}
                  className="input w-full mt-1"
                  inputMode="numeric"
                />
              </label>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                結束班
                <input
                  value={rule.class_end}
                  onChange={(e) => updateRule(index, "class_end", Number(e.target.value))}
                  className="input w-full mt-1"
                  inputMode="numeric"
                />
              </label>
            </div>
            <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
              班級代碼模板
              <input
                value={rule.class_code_template}
                onChange={(e) => updateRule(index, "class_code_template", e.target.value)}
                className="input w-full mt-1 font-mono"
              />
            </label>
            {withRanges && rule.range_template && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                  座號起
                  <input
                    value={rule.range_template.student_no_start}
                    onChange={(e) => updateRange(index, "student_no_start", Number(e.target.value))}
                    className="input w-full mt-1"
                    inputMode="numeric"
                  />
                </label>
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                  座號迄
                  <input
                    value={rule.range_template.student_no_end}
                    onChange={(e) => updateRange(index, "student_no_end", Number(e.target.value))}
                    className="input w-full mt-1"
                    inputMode="numeric"
                  />
                </label>
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                  班號位數
                  <input
                    value={rule.range_template.class_no_width}
                    onChange={(e) => updateRange(index, "class_no_width", Number(e.target.value))}
                    className="input w-full mt-1"
                    inputMode="numeric"
                  />
                </label>
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                  座號位數
                  <input
                    value={rule.range_template.student_no_width}
                    onChange={(e) => updateRange(index, "student_no_width", Number(e.target.value))}
                    className="input w-full mt-1"
                    inputMode="numeric"
                  />
                </label>
                <label className="text-xs col-span-2" style={{ color: "var(--text-muted)" }}>
                  學號模板
                  <input
                    value={rule.range_template.student_id_start_template}
                    onChange={(e) => {
                      updateRange(index, "student_id_start_template", e.target.value);
                      updateRange(index, "student_id_end_template", e.target.value);
                    }}
                    className="input w-full mt-1 font-mono"
                  />
                </label>
                <div className="col-span-2 rounded border p-2 space-y-2" style={{ borderColor: "var(--border)" }}>
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                      各班人數詳細設定
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      留空則使用上方預設座號起迄。
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {classNumbersFor(rule).map((classNo) => {
                      const override = overrideFor(rule, classNo);
                      return (
                        <div key={classNo} className="grid grid-cols-[44px_1fr_1fr] gap-1 items-center">
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {classNo} 班
                          </span>
                          <input
                            value={override?.student_no_start ?? ""}
                            onChange={(e) =>
                              updateOverride(
                                index,
                                classNo,
                                "student_no_start",
                                e.target.value ? Number(e.target.value) : null,
                              )
                            }
                            className="input w-full text-xs"
                            inputMode="numeric"
                            placeholder={String(rule.range_template?.student_no_start ?? "")}
                          />
                          <input
                            value={override?.student_no_end ?? ""}
                            onChange={(e) =>
                              updateOverride(
                                index,
                                classNo,
                                "student_no_end",
                                e.target.value ? Number(e.target.value) : null,
                              )
                            }
                            className="input w-full text-xs"
                            inputMode="numeric"
                            placeholder={String(rule.range_template?.student_no_end ?? "")}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {rules.length > 1 && (
              <button
                type="button"
                onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs"
                style={{ color: "var(--danger)" }}>
                移除此年級
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setRules((prev) => [...prev, defaultGradeRule(prev.length + 1)])}
          className="btn btn-ghost text-xs flex-1">
          新增年級規則
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="btn text-xs flex-1"
          style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
          {busy ? "建立中…" : `批量建立 ${preview.length} 班`}
        </button>
      </div>

      <div className="rounded border p-3 max-h-36 overflow-auto text-xs space-y-1"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        {preview.slice(0, 30).map((item) => (
          <p key={`${item.code}-${item.range}`}>
            <span className="font-mono">{item.code}</span> · {item.range}
            {item.overridden && (
              <span className="ml-1" style={{ color: "var(--primary)" }}>已自訂</span>
            )}
          </p>
        ))}
        {preview.length > 30 && <p>另有 {preview.length - 30} 班…</p>}
      </div>
    </div>
  );
}

function CreateClassForm({ onCreated }: { onCreated: () => void }) {
  const now = new Date();
  const defaultYear = now.getFullYear() - 1911;
  const [year, setYear] = useState(String(defaultYear));
  const [code, setCode] = useState("");
  const [grade, setGrade] = useState("1");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim()) {
      toast.error("請輸入班級代碼");
      return;
    }
    setBusy(true);
    try {
      await classApi.create({
        academic_year: Number(year),
        class_code: code.trim(),
        grade: Number(grade),
      });
      toast.success("班級已建立");
      setCode("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>新增班級</p>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          學年度
          <input value={year} onChange={(e) => setYear(e.target.value)}
            className="input w-full mt-1" inputMode="numeric" />
        </label>
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          班級代碼
          <input value={code} onChange={(e) => setCode(e.target.value)}
            className="input w-full mt-1" placeholder="115" />
        </label>
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          年級
          <input value={grade} onChange={(e) => setGrade(e.target.value)}
            className="input w-full mt-1" inputMode="numeric" />
        </label>
      </div>
      <button onClick={submit} disabled={busy} className="btn w-full"
        style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
        {busy ? "建立中…" : "建立班級"}
      </button>
    </div>
  );
}

function ClassDetail({ classId, onChanged }: { classId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<SchoolClassOut | null>(null);
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [userResults, setUserResults] = useState<UserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");

  const load = useCallback(() => {
    classApi.get(classId).then(setDetail).catch(() => setDetail(null));
    classApi.members(classId).then(setMembers).catch(() => setMembers([]));
  }, [classId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (memberQuery.trim().length < 2) {
      setUserResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      usersApi
        .listForSearch(memberQuery.trim())
        .then(setUserResults)
        .catch(() => setUserResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [memberQuery]);

  if (!detail) return <div className="card p-6 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</div>;

  const toggleActive = async () => {
    try {
      await classApi.update(classId, { is_active: !detail.is_active });
      load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
    }
  };

  const addRange = async () => {
    if (!rangeStart.trim() || !rangeEnd.trim()) {
      toast.error("請輸入學號區間起迄");
      return;
    }
    try {
      await classApi.addRange(classId, {
        student_id_start: rangeStart.trim(),
        student_id_end: rangeEnd.trim(),
      });
      setRangeStart("");
      setRangeEnd("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "新增失敗");
    }
  };

  const delRange = async (rangeId: string) => {
    try {
      await classApi.deleteRange(classId, rangeId);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "刪除失敗");
    }
  };

  const toggleCadre = async (m: ClassMemberOut) => {
    try {
      if (m.is_cadre) await classApi.removeCadre(classId, m.id);
      else await classApi.addCadre(classId, m.id);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
    }
  };

  const addManualMember = async () => {
    if (!selectedUserId) {
      toast.error("請先搜尋並選擇使用者");
      return;
    }
    try {
      await classApi.addMember(classId, selectedUserId);
      toast.success("成員已加入班級");
      setMemberQuery("");
      setUserResults([]);
      setSelectedUserId("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加入成員失敗");
    }
  };

  const removeManualMember = async (m: ClassMemberOut) => {
    try {
      await classApi.removeMember(classId, m.id);
      toast.success("手動成員已移除");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "移除成員失敗");
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {detail.academic_year} 學年度 {detail.class_code} 班
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {detail.grade} 年級 · {detail.is_active ? "當前學年度" : "非當前學年度"}
          </p>
        </div>
        <button onClick={toggleActive} className="btn btn-ghost text-xs">
          {detail.is_active ? "設為非當前" : "設為當前學年度"}
        </button>
      </div>

      {/* 學號區間 */}
      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          學號區間規則
        </p>
        {detail.ranges.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            尚未設定區間；學生需有落在區間內的學號才會自動歸入此班。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {detail.ranges.map((r) => (
              <li key={r.id} className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-secondary)" }}>
                  學號 {r.student_id_start} ～ {r.student_id_end}
                </span>
                <button onClick={() => delRange(r.id)} className="text-xs"
                  style={{ color: "var(--text-muted)" }}>刪除</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input value={rangeStart} onChange={(e) => setRangeStart(e.target.value)}
            className="input flex-1" placeholder="起始學號" />
          <input value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)}
            className="input flex-1" placeholder="結束學號" />
          <button onClick={addRange} className="btn btn-ghost text-xs px-4">新增</button>
        </div>
      </div>

      {/* 成員與幹部 */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              班級成員與幹部權限（{members.length}）
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              手動成員可不依賴學號區間；設為幹部後可檢視本班訂單並標示繳費。
            </p>
          </div>
        </div>
        <div className="rounded border p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <input
              value={memberQuery}
              onChange={(e) => {
                setMemberQuery(e.target.value);
                setSelectedUserId("");
              }}
              className="input"
              placeholder="搜尋姓名、Email 或學號"
            />
            <button onClick={addManualMember} className="btn btn-ghost text-xs px-4">
              加入班級
            </button>
          </div>
          {userResults.length > 0 && (
            <div className="max-h-40 overflow-auto rounded border" style={{ borderColor: "var(--border)" }}>
              {userResults.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelectedUserId(u.id);
                    setMemberQuery(`${u.display_name}${u.student_id ? `（${u.student_id}）` : ""}`);
                    setUserResults([]);
                  }}
                  className="w-full text-left px-3 py-2 text-xs"
                  style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {u.display_name}
                  </span>
                  <span className="ml-2">{u.student_id ?? u.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {members.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            尚無符合學號區間或手動加入的成員。
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {members.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="py-2 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    {m.student_id ?? "—"}
                  </td>
                  <td className="py-2 text-sm" style={{ color: "var(--text-primary)" }}>
                    {m.display_name}
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                      style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                      {m.source === "manual" ? "手動" : "區間"}
                    </span>
                    {m.is_cadre && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                        幹部
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => toggleCadre(m)} className="text-xs"
                        style={{ color: "var(--primary)" }}>
                        {m.is_cadre ? "取消幹部" : "設為幹部"}
                      </button>
                      {m.source === "manual" && (
                        <button onClick={() => removeManualMember(m)} className="text-xs"
                          style={{ color: "var(--danger)" }}>
                          移除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function ClassesAdminPage() {
  const { can } = usePermissions();
  const allowed = can("class:manage");
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"bulk" | "single">("bulk");
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [classListOpen, setClassListOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    classApi
      .list()
      .then((data) => {
        setClasses(data);
        setSelected((prev) => prev ?? data[0]?.id ?? null);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (allowed) load();
    else setLoading(false);
  }, [allowed, load]);

  const selectedClass = classes.find((c) => c.id === selected);

  if (!allowed) {
    return (
      <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
        <p className="text-sm">需要「管理班級」權限才能存取此頁。</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>班級管理</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          逐年建立數字班級、設定學號區間規則並指定班級幹部
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <div className="space-y-3">
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setCreatePanelOpen((open) => !open)}
              className="w-full px-4 py-3 text-left flex items-center justify-between gap-3"
              style={{ borderBottom: createPanelOpen ? "1px solid var(--border)" : "none" }}>
              <span className="min-w-0">
                <span className="block text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  建立工具
                </span>
                <span className="block truncate text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  預設收合，需要新增班級時再展開
                </span>
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                {createPanelOpen ? "收合" : "展開"}
              </span>
            </button>
            {createPanelOpen && (
              <div>
                <div className="grid grid-cols-2 gap-1 p-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => setCreateMode("bulk")}
                    className="rounded-md px-3 py-2 text-sm font-medium"
                    style={createMode === "bulk"
                      ? { background: "var(--primary-dim)", color: "var(--primary)" }
                      : { color: "var(--text-secondary)" }}>
                    批量建立
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateMode("single")}
                    className="rounded-md px-3 py-2 text-sm font-medium"
                    style={createMode === "single"
                      ? { background: "var(--primary-dim)", color: "var(--primary)" }
                      : { color: "var(--text-secondary)" }}>
                    建立班級
                  </button>
                </div>
                <div className="p-3">
                  {createMode === "bulk" ? (
                    <BulkCreateClassForm onCreated={load} />
                  ) : (
                    <CreateClassForm onCreated={load} />
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setClassListOpen((open) => !open)}
              className="w-full px-4 py-3 text-left flex items-center justify-between gap-3"
              style={{ borderBottom: classListOpen ? "1px solid var(--border)" : "none" }}>
              <span className="min-w-0">
                <span className="block text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  班級清單
                </span>
                {selectedClass ? (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                      目前選擇
                    </span>
                    <span className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {selectedClass.academic_year} 學年度 {selectedClass.class_code} 班
                    </span>
                    {!selectedClass.is_active && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>停用</span>
                    )}
                  </span>
                ) : (
                  <span className="block truncate text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {classes.length} 個班級
                  </span>
                )}
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                {classListOpen ? "收合" : "展開"}
              </span>
            </button>
            {classListOpen && (
              <div className="max-h-[460px] overflow-y-auto">
                {loading ? (
                  <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
                ) : classes.length === 0 ? (
                  <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>尚無班級</p>
                ) : (
                  classes.map((c) => {
                    const active = selected === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelected(c.id);
                          setClassListOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 text-sm flex items-center justify-between"
                        style={{
                          borderBottom: "1px solid var(--border)",
                          background: active ? "var(--primary-dim)" : "transparent",
                          color: active ? "var(--primary)" : "var(--text-primary)",
                        }}>
                        <span>{c.academic_year} · {c.class_code} 班</span>
                        {!c.is_active && (
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>停用</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          {selected ? (
            <ClassDetail key={selected} classId={selected} onChanged={load} />
          ) : (
            <div className="card p-6 text-sm" style={{ color: "var(--text-muted)" }}>
              請從左側選擇或新增班級。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
