"use client";
import { useCallback, useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { classApi, documentsApi, documentTemplatesApi, serialTemplatesApi, orgsApi, usersApi, apiErrorMessage } from "@/lib/api";
import type {
  DocumentUrgency, DocumentClassification, DocumentCategory,
  DocumentVisibility, RecipientType, SerialTemplateOut,
  SchoolClassListItem,
} from "@/lib/types";
import type { OrgRead } from "@/lib/api";
import { orgDisplayName } from "@/lib/orgs";
import GongwenEditor from "@/components/ui/GongwenEditor";
import SmartTextarea from "@/components/ui/SmartTextarea";
import Toggle from "@/components/ui/Toggle";
import GuidedForm, { GuidedFormStep, type GuidedFormStepDefinition } from "@/components/ui/GuidedForm";
import { useDraftAutosave, useFileDraftAutosave } from "@/hooks/useDraftAutosave";
import { RecipientSearch } from "@/components/documents/RecipientSearch";
import ActivitySelect from "@/components/activities/ActivitySelect";
import {
  GovernanceLinkNotice,
  createGovernanceBacklink,
  governanceContextFromParams,
} from "@/lib/governanceLinking";

interface Recipient {
  id: string;
  recipient_type: RecipientType;
  name: string;
  email: string;
  target_user_id?: string;
  target_org_id?: string;
  target_class_id?: string;
}

interface LinkDraft {
  id: string;
  url: string;
  display_text: string;
}

type DocumentDraft = {
  urgency: DocumentUrgency;
  classification: DocumentClassification;
  title: string;
  subject: string;
  category: DocumentCategory;
  selectedOrgId: string;
  activityId: string;
  docDescription: string;
  actionRequired: string;
  meetingPurpose: string;
  meetingTime: string;
  meetingLocation: string;
  meetingChairperson: string;
  handlerName: string;
  handlerUnit: string;
  handlerEmail: string;
  showEmail: boolean;
  dueDate: string;
  visibilityLevel: DocumentVisibility;
  recipients: Recipient[];
  pendingLinks: LinkDraft[];
  newLink: LinkDraftInput;
  selectedTemplateId: string;
};

type LinkDraftInput = {
  url: string;
  display_text: string;
};

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
      {children}{required && <span style={{ color: "var(--danger)" }} aria-hidden="true"> *</span>}
    </label>
  );
}

const CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: "letter",         label: "函"       },
  { value: "decree",         label: "令"       },
  { value: "announcement",   label: "公告"     },
  { value: "report",         label: "報告"     },
  { value: "record",         label: "紀錄"     },
  { value: "consultation",   label: "咨"       },
  { value: "meeting_notice", label: "開會通知單" },
  { value: "other",          label: "其他"     },
];

const DOCUMENT_STEPS: GuidedFormStepDefinition[] = [
  { label: "基本資料", description: "先選擇組織與公文用途。" },
  { label: "撰寫內容", description: "完成本次要傳達的重點。" },
  { label: "對象與附件", description: "加入收件人、連結或檔案。" },
  { label: "確認設定", description: "檢查字號、可見範圍與承辦資訊。" },
];

const CONTENT_COPY: Record<DocumentCategory, {
  section: string;
  subjectLabel?: string;
  subjectPlaceholder?: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  actionLabel?: string;
  actionPlaceholder?: string;
}> = {
  letter: {
    section: "公文內容",
    subjectLabel: "主旨",
    subjectPlaceholder: "一句話概述目的，結尾用「請　鑒核」等語",
    descriptionLabel: "說明",
    descriptionPlaceholder: "一、說明事由…\n　　（一）依據：\n　　（二）辦理進度：\n　　　　1. 第一階段…",
    actionLabel: "辦法",
    actionPlaceholder: "一、具體請求事項…",
  },
  decree: {
    section: "令文內容",
    descriptionLabel: "正文",
    descriptionPlaceholder: "茲修正發布「…」第…條條文，自即日生效。\n\n附修正條文1份。",
  },
  announcement: {
    section: "公告內容",
    subjectLabel: "主旨",
    subjectPlaceholder: "公告本會第…案辦理事項，請查照。",
    descriptionLabel: "公告事項",
    descriptionPlaceholder: "一、活動時間：\n二、活動地點：\n三、參與方式：",
  },
  report: {
    section: "報告內容",
    subjectLabel: "主旨",
    subjectPlaceholder: "檢陳…成果／分析報告，請鑒核。",
    descriptionLabel: "說明／分析",
    descriptionPlaceholder: "一、現況\n二、分析\n三、成果",
    actionLabel: "建議事項",
    actionPlaceholder: "一、建議後續採行事項…",
  },
  record: {
    section: "討論與決議",
    descriptionLabel: "討論事項",
    descriptionPlaceholder: "一、案由：\n　　（一）發言摘要…",
    actionLabel: "決議",
    actionPlaceholder: "一、照案通過。\n二、請…續辦。",
  },
  consultation: {
    section: "咨文內容",
    subjectLabel: "主旨",
    subjectPlaceholder: "為…事項，請惠復見解。",
    descriptionLabel: "說明",
    descriptionPlaceholder: "一、緣由：\n二、需協調／詢問事項：",
    actionLabel: "辦法或事項",
    actionPlaceholder: "一、擬請貴機關…\n二、回復期限…",
  },
  meeting_notice: {
    section: "議事日程",
    descriptionLabel: "議事日程",
    descriptionPlaceholder: "一、審查「…」案。\n二、討論「…」案。\n三、臨時動議。",
  },
  other: {
    section: "公文內容",
    subjectLabel: "主旨",
    subjectPlaceholder: "一句話概述目的。",
    descriptionLabel: "說明",
    descriptionPlaceholder: "一、說明事由…",
    actionLabel: "辦法",
    actionPlaceholder: "一、具體請求事項…",
  },
};

export default function NewDocumentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get("template_id");
  const governanceContext = useMemo(
    () => governanceContextFromParams(searchParams),
    [searchParams],
  );
  const [saving, setSaving] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [urgency, setUrgency] = useState<DocumentUrgency>("normal");
  const [classification, setClassification] = useState<DocumentClassification>("normal");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState(governanceContext?.matterTitle ?? "");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState<DocumentCategory>("letter");
  const isMeetingNotice = category === "meeting_notice";
  const isDecree = category === "decree";
  const isRecord = category === "record";
  const copy = CONTENT_COPY[category];
  const docType = CATEGORY_OPTIONS.find(o => o.value === category)?.label ?? "";

  // 組織列表
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(governanceContext?.orgId ?? "");
  const [activityId, setActivityId] = useState("");
  const selectedOrg = orgs.find(o => o.id === selectedOrgId) ?? null;

  // 自動標題
  const autoTitle = useMemo(() => {
    if (category === "decree") return "主席令";
    const parts = [selectedOrg?.name, docType.trim()].filter(Boolean);
    return parts.join("").replace(/\s+/g, "");
  }, [category, selectedOrg, docType]);

  const [docDescription, setDocDescription] = useState("");
  const [actionRequired, setActionRequired] = useState("");

  // 開會通知單專屬欄位
  const [meetingPurpose, setMeetingPurpose] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [meetingChairperson, setMeetingChairperson] = useState("");

  // 承辦人（從個人資料自動填入）
  const [handlerName, setHandlerName] = useState("");
  const [handlerUnit, setHandlerUnit] = useState("");
  const [handlerEmail, setHandlerEmail] = useState("");
  const [showEmail, setShowEmail] = useState(true);

  const [dueDate, setDueDate] = useState("");
  const [visibilityLevel, setVisibilityLevel] = useState<DocumentVisibility>("org_only");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [templates, setTemplates] = useState<SerialTemplateOut[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const fieldError = {
    org: !selectedOrgId ? "請選擇發文組織" : "",
    title: !title.trim() && !autoTitle ? "請輸入公文標題" : "",
    subject: copy.subjectLabel && !subject.trim()
      ? `${copy.subjectLabel}為必填`
      : copy.subjectLabel && subject.trim().length < 8
        ? `${copy.subjectLabel}至少需 8 個字`
        : "",
    meetingPurpose: isMeetingNotice && !meetingPurpose.trim() ? "開會通知單需填寫開會事由" : "",
    meetingTime: (isMeetingNotice || isRecord) && !meetingTime
      ? isRecord ? "紀錄需填寫時間" : "開會通知單需填寫開會時間"
      : "",
    meetingLocation: (isMeetingNotice || isRecord) && !meetingLocation.trim()
      ? isRecord ? "紀錄需填寫地點" : "開會通知單需填寫開會地點"
      : "",
    serialTemplate: selectedOrgId && templates.length > 0 && !selectedTemplateId
      ? "請選擇字號前綴"
      : "",
    recordChairperson: isRecord && !meetingChairperson.trim() ? "紀錄需填寫主席" : "",
    recordAttendees: isRecord && recipients.length === 0 ? "紀錄需填寫出席者" : "",
    recordDiscussion: isRecord && !docDescription.trim() ? "紀錄需填寫討論事項" : "",
    recordDecision: isRecord && !actionRequired.trim() ? "紀錄需填寫決議" : "",
  };
  const hasErrors = Object.values(fieldError).some(Boolean);
  const markTouched = (key: string) => setTouched(p => ({ ...p, [key]: true }));
  const showErr = (key: string) => touched[key] && fieldError[key as keyof typeof fieldError];

  // 連結附件（草稿建立後逐一新增）
  const [pendingLinks, setPendingLinks] = useState<LinkDraft[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [newLink, setNewLink] = useState<LinkDraftInput>({ url: "", display_text: "" });
  const addPendingLink = () => {
    if (!newLink.url.trim()) return;
    setPendingLinks(p => [...p, { id: crypto.randomUUID(), ...newLink }]);
    setNewLink({ url: "", display_text: "" });
  };
  const draftKey = templateId ? `documents:new:template:${templateId}` : "documents:new";
  const draftValue = useMemo<DocumentDraft>(() => ({
    urgency,
    classification,
    title,
    subject,
    category,
    selectedOrgId,
    activityId,
    docDescription,
    actionRequired,
    meetingPurpose,
    meetingTime,
    meetingLocation,
    meetingChairperson,
    handlerName,
    handlerUnit,
    handlerEmail,
    showEmail,
    dueDate,
    visibilityLevel,
    recipients,
    pendingLinks,
    newLink,
    selectedTemplateId,
  }), [
    actionRequired,
    activityId,
    category,
    classification,
    docDescription,
    dueDate,
    handlerEmail,
    handlerName,
    handlerUnit,
    meetingChairperson,
    meetingLocation,
    meetingPurpose,
    meetingTime,
    newLink,
    pendingLinks,
    recipients,
    selectedOrgId,
    selectedTemplateId,
    showEmail,
    subject,
    title,
    urgency,
    visibilityLevel,
  ]);
  const restoreDraft = useCallback((draft: DocumentDraft) => {
    setUrgency(draft.urgency ?? "normal");
    setClassification(draft.classification ?? "normal");
    setTitle(draft.title ?? "");
    setSubject(draft.subject ?? "");
    setCategory(draft.category ?? "letter");
    setSelectedOrgId(draft.selectedOrgId ?? "");
    setActivityId(draft.activityId ?? "");
    setDocDescription(draft.docDescription ?? "");
    setActionRequired(draft.actionRequired ?? "");
    setMeetingPurpose(draft.meetingPurpose ?? "");
    setMeetingTime(draft.meetingTime ?? "");
    setMeetingLocation(draft.meetingLocation ?? "");
    setMeetingChairperson(draft.meetingChairperson ?? "");
    setHandlerName(draft.handlerName ?? "");
    setHandlerUnit(draft.handlerUnit ?? "");
    setHandlerEmail(draft.handlerEmail ?? "");
    setShowEmail(draft.showEmail ?? true);
    setDueDate(draft.dueDate ?? "");
    setVisibilityLevel(draft.visibilityLevel ?? "org_only");
    setRecipients(draft.recipients ?? []);
    setPendingLinks(draft.pendingLinks ?? []);
    setNewLink(draft.newLink ?? { url: "", display_text: "" });
    setSelectedTemplateId(draft.selectedTemplateId ?? "");
    toast.info("已復原未儲存的公文草稿");
  }, []);
  const { clearDraft, flushDraft, lastSavedAt } = useDraftAutosave({
    key: draftKey,
    value: draftValue,
    onRestore: restoreDraft,
    isEmpty: useCallback((draft: DocumentDraft) => (
      !(draft.subject ?? "").trim()
      && !(draft.docDescription ?? "").trim()
      && !(draft.actionRequired ?? "").trim()
      && !(draft.meetingPurpose ?? "").trim()
      && !draft.meetingTime
      && !(draft.meetingLocation ?? "").trim()
      && !(draft.meetingChairperson ?? "").trim()
      && !(draft.handlerUnit ?? "").trim()
      && !draft.dueDate
      && (draft.recipients ?? []).length === 0
      && (draft.pendingLinks ?? []).length === 0
      && !(draft.newLink?.url ?? "").trim()
      && !(draft.newLink?.display_text ?? "").trim()
    ), []),
  });
  const restoreFileDraft = useCallback((files: File[]) => {
    setPendingFiles(files);
    toast.info("已復原未上傳的公文附件草稿");
  }, []);
  const { clearDraftFiles, flushDraftFiles } = useFileDraftAutosave({
    key: `${draftKey}:files`,
    files: pendingFiles,
    onRestore: restoreFileDraft,
  });

  // 載入使用者資料與組織
  useEffect(() => {
    classApi.recipientOptions().then(setClasses).catch(() => {});
    orgsApi.myCreateOrgs().then((items) => {
      setOrgs(items);
      const storedOrgId = typeof window !== "undefined" ? (localStorage.getItem("org_id") ?? "") : "";
      setSelectedOrgId((current) => {
        if (current && items.some((org) => org.id === current)) return current;
        if (storedOrgId && items.some((org) => org.id === storedOrgId)) return storedOrgId;
        return items.length === 1 ? items[0].id : "";
      });
    }).catch(() => {});

    // 從個人資料自動填入承辦人
    usersApi.me().then(u => {
      setHandlerName(u.display_name ?? "");
      if (u.show_email) setHandlerEmail(u.email ?? "");
      setShowEmail(u.show_email ?? true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedOrgId) { setTemplates([]); setSelectedTemplateId(""); return; }
    serialTemplatesApi
      .list({ org_id: selectedOrgId, active_only: true })
      .then(ts => {
        setTemplates(ts);
        setSelectedTemplateId((prev) => {
          if (prev && ts.some((item) => item.id === prev)) return prev;
          return ts.find((item) => item.is_default)?.id ?? ts[0]?.id ?? "";
        });
      })
      .catch(() => {});
  }, [selectedOrgId]);

  useEffect(() => {
    if (!templateId) return;
    documentTemplatesApi
      .get(templateId)
      .then((template) => {
        setSelectedOrgId(template.org_id);
        setCategory(template.category);
        setUrgency(template.urgency);
        setClassification(template.classification);
        setSubject(template.subject ?? "");
        setDocDescription(template.doc_description ?? template.content ?? "");
        setActionRequired(template.action_required ?? "");
        setMeetingPurpose(template.meeting_purpose ?? "");
        setMeetingLocation(template.meeting_location ?? "");
        setMeetingChairperson(template.meeting_chairperson ?? "");
        setHandlerUnit(template.handler_unit ?? "");
        setVisibilityLevel(template.visibility_level);
        setRecipients(
          (template.recipients ?? []).map((item) => ({
            id: crypto.randomUUID(),
            recipient_type: item.recipient_type,
            name: item.name,
            email: item.email ?? "",
            target_user_id: item.target_user_id ?? undefined,
            target_org_id: item.target_org_id ?? undefined,
            target_class_id: item.target_class_id ?? undefined,
          })),
        );
        toast.success(`已套用公文範本「${template.name}」`);
      })
      .catch((e) => toast.error(apiErrorMessage(e, "套用公文範本失敗")));
  }, [templateId]);


  const save = async () => {
    setTouched({
      org: true,
      title: true,
      subject: true,
      meetingPurpose: true,
      meetingTime: true,
      meetingLocation: true,
      serialTemplate: true,
      recordChairperson: true,
      recordAttendees: true,
      recordDiscussion: true,
      recordDecision: true,
    });
    if (hasErrors) { toast.error("請填寫必填欄位"); return; }
    setSaving(true);
    try {
      const doc = await documentsApi.create({
        title: title.trim() || autoTitle, urgency, classification, category,
        declassification_condition: "none",
        content: "",
        is_public: false,
        serial_template_id: selectedTemplateId || null,
        subject: copy.subjectLabel ? subject || undefined : undefined,
        doc_description: docDescription || undefined,
        action_required: copy.actionLabel ? actionRequired || undefined : undefined,
        meeting_purpose: category === "meeting_notice" ? (meetingPurpose || undefined) : undefined,
        meeting_time: (category === "meeting_notice" || isRecord) && meetingTime ? meetingTime : undefined,
        meeting_location: (category === "meeting_notice" || isRecord) ? (meetingLocation || undefined) : undefined,
        meeting_chairperson: (category === "meeting_notice" || isRecord) ? (meetingChairperson || undefined) : undefined,
        handler_name: handlerName || undefined,
        handler_unit: handlerUnit || undefined,
        handler_email: showEmail ? (handlerEmail || undefined) : undefined,
        due_date: dueDate || undefined,
        visibility_level: visibilityLevel,
        org_id: selectedOrgId,
        activity_id: activityId || null,
        recipients: recipients.map((r) => ({
          recipient_type: r.recipient_type,
          name: r.name,
          email: r.email || undefined,
          target_user_id: r.target_user_id,
          target_org_id: r.target_org_id,
          target_class_id: r.target_class_id,
          delivery_method: (r.email ? "email" : "none") as "none" | "system" | "email" | "paper" | "postal",
        })),
      });
      for (const lnk of pendingLinks) {
        await documentsApi.addLink(doc.id, { url: lnk.url, display_text: lnk.display_text || undefined });
      }
      for (const file of pendingFiles) {
        await documentsApi.uploadAttachment(doc.id, file);
      }
      await createGovernanceBacklink({
        context: governanceContext,
        targetType: "document",
        targetId: doc.id,
        title: doc.title,
        href: `/documents/${encodeURIComponent(doc.serial_number)}`,
      });
      clearDraft();
      clearDraftFiles();
      toast.success("草稿已儲存");
      router.push(`/documents/${encodeURIComponent(doc.serial_number)}`);
    } catch (e) {
      flushDraft();
      flushDraftFiles();
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setSaving(false);
    }
  };

  const advanceStep = () => {
    if (activeStep === 0) {
      setTouched((current) => ({
        ...current,
        org: true,
        meetingPurpose: true,
        meetingTime: true,
        meetingLocation: true,
        recordChairperson: true,
      }));
      const needsBasicInfo = Boolean(
        fieldError.org
        || fieldError.meetingPurpose
        || fieldError.meetingTime
        || fieldError.meetingLocation
        || fieldError.recordChairperson,
      );
      if (needsBasicInfo) {
        toast.error("請先完成此步驟的必填欄位");
        return;
      }
    }
    if (activeStep === 1) {
      const needsContent = Boolean(
        fieldError.subject
        || fieldError.recordDiscussion
        || fieldError.recordDecision
      );
      setTouched((current) => ({
        ...current,
        subject: true,
        recordDiscussion: true,
        recordDecision: true,
      }));
      if (!needsContent) {
        setActiveStep((step) => Math.min(step + 1, DOCUMENT_STEPS.length - 1));
        return;
      }
      toast.error("請先完成此步驟的必填欄位");
      return;
    }
    if (activeStep === 2 && fieldError.recordAttendees) {
      setTouched((current) => ({ ...current, recordAttendees: true }));
      toast.error("請先完成此步驟的必填欄位");
      return;
    }
    setActiveStep((step) => Math.min(step + 1, DOCUMENT_STEPS.length - 1));
  };

  const inputStyle = {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    borderRadius: "8px",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    width: "100%",
    outline: "none",
  } as React.CSSProperties;

  const selectStyle = { ...inputStyle, cursor: "pointer" } as React.CSSProperties;

  return (
    <div className="app-page-width space-y-5">

      {/* 頁首 */}
      <div className="flex items-center gap-3">
        <Link href="/documents" className="topbar-icon-btn" aria-label="返回公文列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>新增公文</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            建立草稿後可隨時修改，確認後再送審
          </p>
        </div>
      </div>

      <GovernanceLinkNotice context={governanceContext} />

      <GuidedForm
        steps={DOCUMENT_STEPS}
        activeStep={activeStep}
        onStepChange={setActiveStep}
        onBack={() => setActiveStep((step) => Math.max(step - 1, 0))}
        onNext={advanceStep}
        onSave={save}
        saveLabel="儲存草稿"
        saving={saving}
        draftStatus={lastSavedAt
          ? `已於 ${new Date(lastSavedAt).toLocaleTimeString("zh-TW", {
            hour: "2-digit", minute: "2-digit",
          })} 自動保存`
          : "變更會自動保存到此裝置"}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 主欄 */}
        <div className="lg:col-span-2 space-y-4">

          <GuidedFormStep step={0} activeStep={activeStep} className="space-y-4">
          <FormSection title="基本資訊">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label required>發文組織</Label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => { setSelectedOrgId(e.target.value); markTouched("org"); }}
                  onBlur={() => markTouched("org")}
                  style={showErr("org")
                    ? { ...selectStyle, border: "1px solid var(--danger)" }
                    : selectStyle}>
                  <option value="">選擇組織…</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{orgDisplayName(o, orgs)}</option>)}
                </select>
                {showErr("org") && (
                  <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.org}</p>
                )}
              </div>
              <div>
                <Label required>公文類別</Label>
                <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                  style={selectStyle}>
                  {CATEGORY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label required>公文標題</Label>
              <input
                value={title || autoTitle}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="輸入公文標題…"
                style={showErr("title")
                  ? { ...inputStyle, border: "1px solid var(--danger)" }
                  : inputStyle}
              />
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                預設為「{autoTitle || "發文組織＋公文類別"}」，可依需要修改。
              </p>
              {showErr("title") && (
                <p className="mt-1 text-xs" style={{ color: "var(--danger)" }}>{fieldError.title}</p>
              )}
            </div>

            <ActivitySelect value={activityId} onChange={setActivityId} />

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "速別", value: urgency,
                  setter: (v: string) => setUrgency(v as DocumentUrgency),
                  options: [["normal","普通件"],["priority","速件"],["express","最速件"]],
                },
                {
                  label: "密等", value: classification,
                  setter: (v: string) => setClassification(v as DocumentClassification),
                  options: [["normal","普通"],["confidential","機密"],["secret","秘密"]],
                },
              ].map(({ label, value, setter, options }) => (
                <div key={label}>
                  <Label>{label}</Label>
                  <select value={value} onChange={(e) => setter(e.target.value)} style={selectStyle}>
                    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </FormSection>

          {/* 開會通知單 / 紀錄專屬 */}
          {(isMeetingNotice || isRecord) && (
            <FormSection title={isRecord ? "紀錄資訊" : "開會資訊"}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {isMeetingNotice && (
                  <div className="sm:col-span-2">
                    <Label required>開會事由</Label>
                    <input value={meetingPurpose} onChange={e => setMeetingPurpose(e.target.value)}
                      onBlur={() => markTouched("meetingPurpose")}
                      placeholder="例：班級聯合自治會第1屆學生代表團第3次會議"
                      style={showErr("meetingPurpose")
                        ? { ...inputStyle, border: "1px solid var(--danger)" }
                        : inputStyle} />
                    {showErr("meetingPurpose") && (
                      <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.meetingPurpose}</p>
                    )}
                  </div>
                )}
                <div>
                  <Label required>{isRecord ? "時間" : "開會時間"}</Label>
                  <input type="datetime-local" value={meetingTime}
                    onChange={e => setMeetingTime(e.target.value)}
                    onBlur={() => markTouched("meetingTime")}
                    style={showErr("meetingTime") ? { ...inputStyle, border: "1px solid var(--danger)" } : inputStyle} />
                  {showErr("meetingTime") && (
                    <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.meetingTime}</p>
                  )}
                </div>
                <div>
                  <Label required>{isRecord ? "地點" : "開會地點"}</Label>
                  <input value={meetingLocation} onChange={e => setMeetingLocation(e.target.value)}
                    onBlur={() => markTouched("meetingLocation")}
                    placeholder="例：班聯會辦公室"
                    style={showErr("meetingLocation") ? { ...inputStyle, border: "1px solid var(--danger)" } : inputStyle} />
                  {showErr("meetingLocation") && (
                    <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.meetingLocation}</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Label required={isRecord}>{isRecord ? "主席" : "主持人"}</Label>
                  <input value={meetingChairperson} onChange={e => setMeetingChairperson(e.target.value)}
                    onBlur={() => markTouched("recordChairperson")}
                    placeholder="例：楊總召千霆"
                    style={showErr("recordChairperson") ? { ...inputStyle, border: "1px solid var(--danger)" } : inputStyle} />
                  {showErr("recordChairperson") && (
                    <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.recordChairperson}</p>
                  )}
                </div>
              </div>
            </FormSection>
          )}
          </GuidedFormStep>

          {/* 公文主體 */}
          <GuidedFormStep step={1} activeStep={activeStep}>
          <FormSection title={copy.section}>
            {/* 主旨（類別需要時顯示） */}
            {copy.subjectLabel && (
              <div>
                <Label required>{copy.subjectLabel}</Label>
                <SmartTextarea
                  value={subject}
                  onChange={setSubject}
                  onBlur={() => markTouched("subject")}
                  rows={2}
                  wrap="soft"
                  placeholder={copy.subjectPlaceholder}
                  style={showErr("subject")
                    ? {
                        ...inputStyle,
                        border: "1px solid var(--danger)",
                        resize: "vertical",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        overflowX: "hidden",
                      }
                    : {
                        ...inputStyle,
                        resize: "vertical",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        overflowX: "hidden",
                      }}
                />
                {showErr("subject") && (
                  <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.subject}</p>
                )}
              </div>
            )}
            <div>
              <Label>
                {copy.descriptionLabel}
                <span className="ml-2 font-normal opacity-60 text-[10px]">
                  Tab 降級 ／ Shift+Tab 升級 ／ Enter 續編
                </span>
              </Label>
              <GongwenEditor
                value={docDescription}
                onChange={setDocDescription}
                onBlur={() => markTouched("recordDiscussion")}
                minRows={6}
                placeholder={copy.descriptionPlaceholder}
              />
              {showErr("recordDiscussion") && (
                <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.recordDiscussion}</p>
              )}
            </div>
            {copy.actionLabel && (
              <div>
                <Label required={isRecord}>{copy.actionLabel}</Label>
                <GongwenEditor
                  value={actionRequired}
                  onChange={setActionRequired}
                  onBlur={() => markTouched("recordDecision")}
                  minRows={3}
                  placeholder={copy.actionPlaceholder}
                />
                {showErr("recordDecision") && (
                  <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.recordDecision}</p>
                )}
              </div>
            )}
          </FormSection>
          </GuidedFormStep>

          {/* 受文者 / 出席者 */}
          <GuidedFormStep step={2} activeStep={activeStep} className="space-y-4">
          <FormSection title={
            isMeetingNotice
              ? "受文者 / 正本（出席） / 副本（列席）"
              : isRecord
                ? "出席者 / 列席者"
              : isDecree
                ? "受文者（選填）"
                : "受文者"
          }>
            {recipients.length > 0 && (
              <ul className="space-y-1.5">
                {recipients.map((r) => (
                  <li key={r.id}
                    className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <span className="badge text-[10px] flex-shrink-0"
                      style={{ color: "var(--primary)", background: "var(--primary-dim)", borderColor: "var(--primary-dim)" }}>
                      {isMeetingNotice
                        ? { main: "受文者", primary: "正本（出席）", copy: "副本（列席）" }[r.recipient_type] ?? r.recipient_type
                        : isRecord
                          ? { main: "出席者", primary: "出席者", copy: "列席者" }[r.recipient_type] ?? r.recipient_type
                          : { main: "受文者", primary: "正本", copy: "副本" }[r.recipient_type] ?? r.recipient_type}
                    </span>
                    <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{r.name}</span>
                    {r.email && (
                      <span className="truncate max-w-32" style={{ color: "var(--text-muted)" }}>{r.email}</span>
                    )}
                    <button onClick={() => setRecipients((p) => p.filter((x) => x.id !== r.id))}
                      className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center transition-colors hover:text-red-500"
                      style={{ color: "var(--text-muted)" }}
                      aria-label={`移除收件人 ${r.name}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <RecipientSearch
              onAdd={(r) => setRecipients(p => [...p, { ...r, id: crypto.randomUUID() }])}
              inputStyle={inputStyle}
              selectStyle={selectStyle}
              isMeetingNotice={isMeetingNotice}
              isRecord={isRecord}
              orgs={orgs}
              classes={classes}
            />
            {showErr("recordAttendees") && (
              <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.recordAttendees}</p>
            )}
          </FormSection>

          {/* 連結附件 */}
          <FormSection title="連結附件">
            {pendingLinks.length > 0 && (
              <ul className="space-y-1.5">
                {pendingLinks.map(lnk => (
                  <li key={lnk.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" style={{ color: "var(--primary)", flexShrink: 0 }}>
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                      {lnk.display_text || lnk.url}
                    </span>
                    <span className="truncate max-w-40 text-[10px]" style={{ color: "var(--text-muted)" }}>{lnk.url}</span>
                    <button onClick={() => setPendingLinks(p => p.filter(x => x.id !== lnk.id))}
                      className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center transition-colors hover:text-red-500"
                      style={{ color: "var(--text-muted)" }}
                      aria-label={`移除連結 ${lnk.display_text || lnk.url}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <input placeholder="連結網址 https://…" value={newLink.url}
                onChange={e => setNewLink(p => ({ ...p, url: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") addPendingLink(); }}
                style={{ ...inputStyle, flex: "2", minWidth: "12rem" }} />
              <input placeholder="顯示名稱（選填）" value={newLink.display_text}
                onChange={e => setNewLink(p => ({ ...p, display_text: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") addPendingLink(); }}
                style={{ ...inputStyle, flex: "1", minWidth: "8rem" }} />
              <button onClick={addPendingLink} className="btn btn-ghost flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                新增
              </button>
            </div>
            <div className="pt-2">
              <Label>檔案附件</Label>
              <label className="block text-xs px-3 py-2 rounded-lg cursor-pointer"
                style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}>
                <input
                  type="file"
                  className="hidden"
                  onChange={e => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) setPendingFiles(prev => [...prev, ...files]);
                    e.target.value = "";
                  }}
                />
                ＋ 選擇附件（建立草稿後自動上傳）
              </label>
              {pendingFiles.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {pendingFiles.map((file, idx) => (
                    <li key={`${file.name}-${idx}`} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                      <span className="truncate" style={{ color: "var(--text-primary)" }}>{file.name}</span>
                      <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                        className="min-h-11 px-2"
                        style={{ color: "var(--danger)" }}>
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FormSection>
          </GuidedFormStep>
        </div>

        {/* 右欄 */}
        <GuidedFormStep step={3} activeStep={activeStep} className="space-y-4">

          {/* 字號模板 */}
          <FormSection title="字號設定">
            {!selectedOrgId ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>請先選擇發文組織</p>
            ) : templates.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>此組織目前無可用字號模板</p>
            ) : (
              <>
                <div>
                  <Label required>選擇字號前綴</Label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => { setSelectedTemplateId(e.target.value); markTouched("serialTemplate"); }}
                    onBlur={() => markTouched("serialTemplate")}
                    style={showErr("serialTemplate")
                      ? { ...selectStyle, border: "1px solid var(--danger)" }
                      : selectStyle}
                  >
                    <option value="">選擇字號前綴…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.org_prefix}{t.category_char}字
                        {t.description ? ` — ${t.description}` : ""}
                      </option>
                    ))}
                  </select>
                  {showErr("serialTemplate") && (
                    <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>{fieldError.serialTemplate}</p>
                  )}
                </div>
                <div className="rounded-xl px-4 py-3 text-center"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                  <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>發文後字號預覽</p>
                  <p className="text-sm font-mono font-bold" style={{ color: "var(--primary)" }}>
                    {selectedTemplate ? selectedTemplate.preview : `DOC-${new Date().getFullYear()}-XXXXXX`}
                  </p>
                </div>
              </>
            )}
          </FormSection>

          {/* 可見度 */}
          <FormSection title="可見度">
            <select value={visibilityLevel}
              onChange={e => setVisibilityLevel(e.target.value as DocumentVisibility)}
              style={selectStyle}>
              <option value="org_only">機關成員可見</option>
              <option value="subject_only">僅當事人（建立者＋審核人）</option>
              <option value="public">全體登入使用者</option>
              <option value="publicly_open">完全公開（含未登入）</option>
            </select>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              控制哪些人可以查閱此公文
            </p>
          </FormSection>

          <div className="card p-4 space-y-2" aria-label="儲存前檢查">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>儲存前檢查</h3>
            <dl className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              <div className="flex items-center justify-between gap-3">
                <dt>組織</dt><dd className="truncate font-medium">{selectedOrg?.name || "尚未選擇"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>類別</dt><dd className="font-medium">{docType}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>收件人</dt><dd className="font-medium">{recipients.length} 位</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>可見範圍</dt><dd className="font-medium">{visibilityLevel === "org_only" ? "機關成員" : visibilityLevel === "publicly_open" ? "完全公開" : "受限公開"}</dd>
              </div>
            </dl>
            <p className="pt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              儲存後會前往詳情頁設定審核人並送審。
            </p>
          </div>

          {/* 儲存 */}
          <div className="card p-4 space-y-3 hidden md:block">
            <button onClick={save} disabled={saving} className="btn btn-primary w-full" aria-busy={saving}>
              {saving ? "儲存中…" : "儲存草稿"}
            </button>
            {Object.keys(touched).length > 0 && hasErrors && (
              <p className="text-xs text-center" style={{ color: "var(--danger)" }}>請填寫所有必填欄位</p>
            )}
            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              儲存後可在詳情頁設定審核人並送審
            </p>
          </div>

          {/* 承辦人 */}
          <FormSection title="承辦人資訊">
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              從個人資料自動帶入，可手動修改
            </p>
            {[
              { label: "姓名", value: handlerName, setter: setHandlerName, ph: "承辦人姓名" },
              {
                label: isDecree ? "令前主詞" : "單位",
                value: handlerUnit,
                setter: setHandlerUnit,
                ph: isDecree ? "例如：主席" : "所屬單位",
              },
            ].map(({ label, value, setter, ph }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs w-12 flex-shrink-0 font-medium" style={{ color: "var(--text-muted)" }}>
                  {label}
                </span>
                <input value={value} onChange={(e) => setter(e.target.value)} placeholder={ph}
                  style={{ ...inputStyle, fontSize: "0.75rem" }} />
              </div>
            ))}
            {/* Email + 顯示切換 */}
            <div className="flex items-center gap-3">
              <span className="text-xs w-12 flex-shrink-0 font-medium" style={{ color: "var(--text-muted)" }}>
                Email
              </span>
              <input value={handlerEmail} onChange={(e) => setHandlerEmail(e.target.value)}
                placeholder="電子郵件" type="email"
                style={{ ...inputStyle, flex: 1, fontSize: "0.75rem" }} />
              <div className="flex-shrink-0" title="顯示於公文上">
                <Toggle checked={showEmail} onChange={setShowEmail} label="顯示" ariaLabel="顯示 Email" />
              </div>
            </div>
          </FormSection>

          {/* 限辦日期 */}
          <div className="card p-4">
            <Label>限辦日期</Label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              style={inputStyle} />
          </div>
        </GuidedFormStep>
      </div>
      </GuidedForm>
    </div>
  );
}
