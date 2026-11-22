"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardPaste, Plus, Trash2 } from "lucide-react";

import { Field, Select, TextArea, TextInput, Toggle } from "@/components/site/PublicSiteAdminFields";
import type { PublicOfficerCandidateOut, PublicOfficerProfileOut } from "@/lib/types";
import type { OfficerRosterLine, OfficerRosterTab } from "@/lib/public-site-roster";

export type OfficerProfileDraft = {
  user_position_id: string;
  display_name_override: string;
  title_override: string;
  bio: string;
  public_email: string;
  sort_order: number;
  is_featured: boolean;
  is_visible: boolean;
};

type OfficerRosterSummary = { memberCount: number; validLines: OfficerRosterLine[] };
type OfficerAdminTabProps = {
  rosterTabs: OfficerRosterTab[];
  activeRosterTab?: OfficerRosterTab;
  activeRosterTabId: string;
  newRosterTabLabel: string;
  onNewRosterTabLabelChange: (value: string) => void;
  onSelectRosterTab: (tabId: string) => void;
  onAddRosterTab: () => void;
  onDeleteRosterTab: () => void;
  rosterText: string;
  onRosterTextChange: (value: string) => void;
  rosterLines: OfficerRosterLine[];
  rosterSummary: OfficerRosterSummary;
  getRosterMemberLabel: (title: string, name: string) => string;
  setRosterMemberLabel: (title: string, name: string, value: string) => void;
  rosterBusy: boolean;
  onSaveRoster: () => void;
  candidates: PublicOfficerCandidateOut[];
  profiles: PublicOfficerProfileOut[];
  officerDraft: OfficerProfileDraft;
  onOfficerDraftChange: (patch: Partial<OfficerProfileDraft>) => void;
  onCreateOfficerProfile: () => void;
  patchProfile: (profile: PublicOfficerProfileOut, body: Partial<PublicOfficerProfileOut>) => Promise<void>;
  deleteOfficerProfile: (profile: PublicOfficerProfileOut) => Promise<void>;
  displayError: (error: unknown, fallback: string) => void;
};

export default function OfficerAdminTab({
  rosterTabs, activeRosterTab, activeRosterTabId, newRosterTabLabel, onNewRosterTabLabelChange,
  onSelectRosterTab, onAddRosterTab, onDeleteRosterTab, rosterText, onRosterTextChange, rosterLines,
  rosterSummary, getRosterMemberLabel, setRosterMemberLabel, rosterBusy, onSaveRoster, candidates,
  profiles, officerDraft, onOfficerDraftChange, onCreateOfficerProfile, patchProfile,
  deleteOfficerProfile, displayError,
}: OfficerAdminTabProps) {
  const candidateByUserPosition = new Map(candidates.map((candidate) => [candidate.user_position_id, candidate]));
  return (
        <section key="officers" className="tab-panel-transition space-y-4">
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">快速貼上幹部名單</h2>
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>
                    批次輸入
                  </span>
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
                  每行一個職位，姓名以空白、頓號或逗號分隔；名單直接公開。
                </p>
              </div>
              <ClipboardPaste size={20} className="text-[var(--primary-text)]" aria-hidden />
            </div>
            <div className="space-y-3 rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div className="hidden flex-wrap gap-2 sm:flex" role="tablist" aria-label="幹部名單組織頁籤">
                {rosterTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeRosterTabId}
                    onClick={() => onSelectRosterTab(tab.id)}
                    className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors ${tab.id === activeRosterTabId ? "" : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"}`}
                    style={tab.id === activeRosterTabId ? { color: "var(--primary-contrast, white)", background: "var(--primary)" } : undefined}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="sm:hidden">
                <label htmlFor="public-roster-tab" className="text-xs font-semibold text-[var(--text-secondary)]">
                  目前編輯組織
                </label>
                <div className="relative mt-2">
                  <Select
                    id="public-roster-tab"
                    value={activeRosterTabId}
                    onChange={(event) => onSelectRosterTab(event.target.value)}
                    className="min-h-11 appearance-none pr-10 font-semibold"
                    aria-label="選擇幹部名單組織"
                  >
                    {rosterTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                  </Select>
                  <ChevronDown
                    size={17}
                    aria-hidden={true}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <TextInput
                  value={newRosterTabLabel}
                  onChange={(event) => onNewRosterTabLabelChange(event.target.value)}
                  placeholder="新增組織，例如：學生議會"
                  aria-label="新增組織名稱"
                />
                <button type="button" onClick={onAddRosterTab} className="btn btn-secondary min-h-11 shrink-0">
                  <Plus size={16} aria-hidden /> 新增組織頁籤
                </button>
                <button type="button" onClick={onDeleteRosterTab} className="btn btn-ghost min-h-11 shrink-0" disabled={rosterTabs.length <= 1}>
                  <Trash2 size={15} aria-hidden /> 刪除目前頁籤
                </button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">目前編輯：{activeRosterTab?.label ?? "尚未建立組織"}；每個頁籤各自保存一份名單。</p>
            </div>
            <TextArea
              rows={10}
              value={rosterText}
              onChange={(event) => onRosterTextChange(event.target.value)}
              placeholder={"主席｜黃丞廷\n副主席｜葉鎧丞\n秘書｜簡子皓 黃柏硯\n活動｜邱翊展 劉哲愷 黃言真"}
              aria-label="快速貼上幹部名單"
              className="font-mono text-[13px] leading-7"
            />
            <div className="flex flex-col gap-3 rounded-lg p-3 text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }} aria-live="polite">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={15} className="text-emerald-400" aria-hidden />{rosterSummary.memberCount} 位成員</span>
                <span className="inline-flex items-center gap-1.5"><AlertTriangle size={15} className={rosterLines.some((line) => line.error) ? "text-amber-400" : "text-[var(--text-muted)]"} aria-hidden />{rosterLines.filter((line) => line.error).length} 行待修正</span>
                <span className="text-[var(--text-muted)]">{rosterSummary.validLines.length} 個職位</span>
              </div>
              {rosterLines.some((line) => line.error) && (
                <p className="text-xs text-amber-300">
                  {rosterLines.filter((line) => line.error).map((line) => `第 ${line.lineNumber} 行：${line.error}`).join("；")}
                </p>
              )}
            </div>
            {rosterSummary.validLines.length > 0 && (
              <div className="overflow-hidden rounded-lg border" style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                  <div>
                    <h3 className="text-sm font-semibold">解析預覽</h3>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">標示套用於個人，可在同職位中單獨指定。</p>
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">{rosterSummary.validLines.length} 個職位</span>
                </div>
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {rosterSummary.validLines.map((line) => {
                    return (
                      <div key={`${line.lineNumber}-${line.title}`} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <span className="font-semibold">{line.title}</span>
                          <span className="text-xs text-[var(--text-muted)]">{line.names.length} 位成員</span>
                        </div>
                        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                          {line.names.map((name) => {
                            const label = getRosterMemberLabel(line.title, name);
                            return (
                              <div key={`${line.title}-${name}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:pl-8">
                                <span className="min-w-0 text-sm text-[var(--text-secondary)]">{name}</span>
                                <TextInput
                                  value={label}
                                  onChange={(event) => setRosterMemberLabel(line.title, name, event.target.value)}
                                  placeholder="個人標示（選填）"
                                  aria-label={`${line.title}的${name}公開標示`}
                                  className="min-h-11 w-full sm:max-w-52"
                                  maxLength={24}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--text-muted)]">格式：職位｜姓名 姓名；也支援「職位：姓名」；同一人可出現在不同職位。</p>
              <button type="button" onClick={onSaveRoster} disabled={rosterBusy || rosterSummary.memberCount === 0} className="btn btn-primary min-h-11">
                <ClipboardPaste size={16} aria-hidden /> {rosterBusy ? "儲存中…" : "儲存這份名單"}
              </button>
            </div>
          </div>

          <div className={`grid gap-4 ${profiles.length > 0 ? "lg:grid-cols-[0.9fr_1.1fr]" : ""}`}>
            <div className="card space-y-4 p-5">
              <h2 className="font-semibold">單筆覆寫（進階）</h2>
            <p className="text-xs text-[var(--text-muted)]">
              公開幹部頁會<strong>自動列出當屆所有幹部</strong>，不需逐一新增。只有在你想覆寫顯示名稱／稱謂／簡介、調整排序、設為首頁精選，或<strong>隱藏</strong>某位成員時，才需要在此建立設定。
            </p>
            <Field label="幹部候選人">
              <Select value={officerDraft.user_position_id} onChange={(e) => onOfficerDraftChange({ user_position_id: e.target.value })}>
                <option value="">請選擇</option>
                {candidates.map((candidate) => (
                  <option key={candidate.user_position_id} value={candidate.user_position_id}>
                    {candidate.display_name} / {candidate.org_name} / {candidate.position_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="公開姓名覆寫"><TextInput value={officerDraft.display_name_override} onChange={(e) => onOfficerDraftChange({ display_name_override: e.target.value })} /></Field>
              <Field label="公開稱謂覆寫" hint="以「長」或「主席」結尾的職稱會以長級樣式顯示。"><TextInput value={officerDraft.title_override} onChange={(e) => onOfficerDraftChange({ title_override: e.target.value })} /></Field>
            </div>
            <Field label="公開簡介"><TextArea value={officerDraft.bio} onChange={(e) => onOfficerDraftChange({ bio: e.target.value })} /></Field>
            <Field label="公開 Email" hint="僅公開已允許顯示 Email 的帳號。">
              <TextInput value={officerDraft.public_email} onChange={(e) => onOfficerDraftChange({ public_email: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Toggle label="顯示" checked={officerDraft.is_visible} onChange={(value) => onOfficerDraftChange({ is_visible: value })} />
              <Toggle label="首頁精選" checked={officerDraft.is_featured} onChange={(value) => onOfficerDraftChange({ is_featured: value })} />
            </div>
            <button type="button" onClick={onCreateOfficerProfile} className="btn btn-primary"><Plus size={16} aria-hidden /> 新增公開幹部</button>
            </div>
            <div className="space-y-3">
              {profiles.map((profile) => {
                const candidate = candidateByUserPosition.get(profile.user_position_id);
                return (
                  <div key={profile.id} className="card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="font-semibold">{profile.display_name_override || candidate?.display_name || "未命名幹部"}</h3>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {profile.title_override || candidate?.position_name || "職位未載入"} / {candidate?.org_name ?? "既有任期"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchProfile(profile, { is_visible: !profile.is_visible }).catch((e) => displayError(e, "更新幹部失敗"))}>
                          {profile.is_visible ? "隱藏" : "顯示"}
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchProfile(profile, { is_featured: !profile.is_featured }).catch((e) => displayError(e, "更新精選失敗"))}>
                          {profile.is_featured ? "取消精選" : "設為精選"}
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => deleteOfficerProfile(profile).catch((e) => displayError(e, "刪除幹部失敗"))}>刪除</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
  );
}
