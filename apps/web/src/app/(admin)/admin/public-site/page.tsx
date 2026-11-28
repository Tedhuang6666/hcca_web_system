"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Field, Select, TextArea, TextInput } from "@/components/site/PublicSiteAdminFields";
import OfficerAdminTab, { type OfficerProfileDraft } from "@/components/site/OfficerAdminTab";
import PublicSiteWorkspaceHeader from "@/components/site/PublicSiteWorkspaceHeader";

import Image from "next/image";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Compass,
  ChevronDown,
  Eye,
  EyeOff,
  FileUp,
  FileText,
  Handshake,
  Home,
  Info,
  Link as LinkIcon,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError, siteApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import ArticleMarkdownEditor from "@/components/site/ArticleMarkdownEditor";
import PublicNavIcon from "@/components/site/PublicNavIcon";
import { linkTreeCollisionDetection, SortablePublicLinkCategory, UnassignedPublicLinks } from "@/components/site/PublicLinksEditor";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import DraftStatus from "@/components/ui/DraftStatus";
import TabBar from "@/components/ui/TabBar";
import Toggle from "@/components/ui/Toggle";
import { clearStoredDraft, useDraftAutosave } from "@/hooks/useDraftAutosave";
import { mergeSavedSettings, normalizeSettingsForEditor } from "@/lib/public-site-settings";
import {
  PUBLIC_NAV_GROUP_META,
  PUBLIC_NAV_GROUP_ORDER,
  PUBLIC_NAV_ITEMS,
  type PublicNavGroupId,
  type PublicNavOverride,
  type ResolvedNavItem,
  resolvePublicNav,
} from "@/lib/publicNav";
import type {
  PublicLinkCategoryOut,
  PublicLinkOut,
  PublicOfficerCandidateOut,
  PublicOfficerProfileOut,
  PublicSpecialAgreementContent,
  PublicSpecialAgreementFile,
  PublicSitePageOut,
  PublicSiteSettingsOut,
  PublicSiteSettingsUpdate,
} from "@/lib/types";
import {
  DEFAULT_SPECIAL_AGREEMENT_CONTENT,
  readSpecialAgreementContent,
} from "@/lib/specialAgreement";
import { LUNCH_GUIDE_MARKDOWN } from "@/lib/article-content";
import {
  articleSlugFromTitle,
  articleSummaryFromMarkdown,
  articleTitleFromMarkdown,
} from "@/lib/article-utils";
import { getExamScopeDefaultSection } from "@/lib/exam-scope";
import { parseJsonObject, parseOfficerRoster, parseStoredOfficerRosterTabs, rosterMemberKey, serializeOfficerRoster, toIsoDateTime, toLocalDateTimeInput } from "@/lib/public-site-roster";
import type { OfficerRosterLine, OfficerRosterTab } from "@/lib/public-site-roster";

type Tab = "homepage" | "system" | "contact" | "special" | "nav" | "pages" | "links" | "officers" | "advanced";

const EMPTY_PAGE_DRAFT = {
  slug: "",
  title: "",
  summary: "",
  body_md: "",
  page_kind: "standard",
  nav_label: "",
  nav_order: 0,
  sort_order: 0,
  show_in_nav: false,
  is_published: false,
  cover_image_url: "",
  cover_image_alt: "",
  layout_config: {} as Record<string, unknown>,
  content_blocks: {} as Record<string, unknown>,
  seo_title: "",
  seo_description: "",
  exam_scope_default_section: "",
};

function isEmptyPageDraft(draft: typeof EMPTY_PAGE_DRAFT) {
  return JSON.stringify(draft) === JSON.stringify(EMPTY_PAGE_DRAFT);
}

/** 後台導覽列分頁的群組顯示順序。 */
const NAV_GROUP_ORDER: PublicNavGroupId[] = PUBLIC_NAV_GROUP_ORDER;

const emptySettings: PublicSiteSettingsOut = {
  id: "",
  site_title: "新竹高中班聯會",
  site_description: "",
  site_logo_url: "",
  site_logo_alt: "",
  hero_title: "新竹高中班聯會",
  hero_subtitle: "",
  hero_image_url: "",
  hero_image_alt: "",
  about_title: "關於班聯會",
  about_body_md: "請在後台編輯關於本會內容。",
  mission_md: "",
  history_md: "",
  support_md: "",
  error_report_md: "",
  contact_md: "",
  terms_md: "",
  developer_team_md: "",
  system_info_md: "",
  cta_label: "查看公開資料",
  cta_href: "/public",
  public_database_label: "公開資料庫",
  public_database_description: "",
  theme_config: {},
  homepage_blocks: {},
  custom_css: "",
  seo_title: "",
  seo_description: "",
  created_at: "",
  updated_at: "",
};

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "homepage", label: "首頁資訊", icon: <Home size={16} aria-hidden /> },
  { id: "system", label: "系統資訊", icon: <Info size={16} aria-hidden /> },
  { id: "contact", label: "聯絡我們", icon: <Mail size={16} aria-hidden /> },
  { id: "special", label: "特約資訊", icon: <Handshake size={16} aria-hidden /> },
  { id: "nav", label: "導覽列", icon: <Compass size={16} aria-hidden /> },
  { id: "pages", label: "頁面內容", icon: <FileText size={16} aria-hidden /> },
  { id: "links", label: "連結整理", icon: <LinkIcon size={16} aria-hidden /> },
  { id: "officers", label: "幹部顯示", icon: <Users size={16} aria-hidden /> },
  { id: "advanced", label: "進階樣式", icon: <Eye size={16} aria-hidden /> },
];

function displayError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

function MarkdownEditor({
  value,
  onChange,
  rows = 6,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const [preview, setPreview] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)]">支援 Markdown 語法</span>
        <button
          type="button"
          className="btn btn-ghost min-h-8 px-2 text-xs"
          onClick={() => setPreview((current) => !current)}>
          {preview ? <Pencil size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
          {preview ? "編輯 Markdown" : "預覽格式"}
        </button>
      </div>
      {preview ? (
        <div
          className="min-h-28 rounded-lg px-3 py-2 text-sm leading-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
          {value.trim() ? <MarkdownBlock markdown={value} /> : <span className="text-[var(--text-muted)]">尚未輸入內容</span>}
        </div>
      ) : (
        <TextArea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

function ImageField({
  label,
  hint,
  value,
  alt,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  alt?: string;
  onChange: (url: string) => void;
}) {
  const previewUrl = uploadUrl(value);
  const upload = (file: File, reportProgress: (progress: number) => void) =>
    siteApi.uploadImage(file, reportProgress);
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_12rem] md:items-end">
      <Field label={label} hint={hint ?? "支援圖片網址或上傳 JPEG、PNG、GIF、WebP，上限 20 MB。"}>
        <div className="grid gap-2">
          <TextInput value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… 或拖曳圖片上傳" />
          <AnimatedFileUpload
            accept="image/png,image/jpeg,image/gif,image/webp"
            label="拖曳圖片到這裡"
            hint="支援點擊選取或貼上圖片"
            onUpload={upload}
            onUploaded={(result) => {
              onChange(result.url);
              toast.success("圖片已上傳");
            }}
          />
        </div>
      </Field>
      <div className="grid h-28 place-items-center rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt={alt || `${label}預覽`}
            width={192}
            height={96}
            unoptimized
            className="max-h-24 max-w-full object-contain"
          />
        ) : (
          <span className="text-xs text-[var(--text-muted)]">{label}預覽</span>
        )}
      </div>
    </div>
  );
}













export default function PublicSiteAdminPage() {
  const confirm = useConfirm();
  const linkSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [savingLinkTree, setSavingLinkTree] = useState(false);
  const router = useRouter();
  const requestedTab = useSearchParams().get("tab");
  const tab: Tab = tabs.find((item) => item.id === requestedTab)?.id ?? "homepage";
  const setTab = (next: Tab) => router.replace(`/admin/public-site?tab=${next}`, { scroll: false });
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<PublicSiteSettingsOut>(emptySettings);
  const [pages, setPages] = useState<PublicSitePageOut[]>([]);
  const [savingPage, setSavingPage] = useState(false);
  const [categories, setCategories] = useState<PublicLinkCategoryOut[]>([]);
  const [links, setLinks] = useState<PublicLinkOut[]>([]);
  const [candidates, setCandidates] = useState<PublicOfficerCandidateOut[]>([]);
  const [profiles, setProfiles] = useState<PublicOfficerProfileOut[]>([]);
  const [specialAgreement, setSpecialAgreement] = useState<PublicSpecialAgreementContent>(DEFAULT_SPECIAL_AGREEMENT_CONTENT);
  const [themeJson, setThemeJson] = useState("{}");
  const [blocksJson, setBlocksJson] = useState("{}");
  // 進階樣式直接編輯整份 JSON；記下最後同步的內容，其他分頁存檔前可判斷是否有未儲存的 JSON 修改。
  const [syncedJson, setSyncedJson] = useState({ theme: "{}", blocks: "{}" });
  const themeJsonDirty = themeJson !== syncedJson.theme;
  const blocksJsonDirty = blocksJson !== syncedJson.blocks;
  const syncThemeJson = useCallback((value: unknown) => {
    const text = JSON.stringify(value ?? {}, null, 2);
    setThemeJson(text);
    setSyncedJson((current) => ({ ...current, theme: text }));
  }, []);
  const syncBlocksJson = useCallback((value: unknown) => {
    const text = JSON.stringify(value ?? {}, null, 2);
    setBlocksJson(text);
    setSyncedJson((current) => ({ ...current, blocks: text }));
  }, []);
  const blockedByUnsavedJson = (dirty: boolean) => {
    if (dirty) toast.error("「進階樣式」有未儲存的 JSON 修改，請先儲存或還原後再儲存此區。");
    return dirty;
  };
  const [rosterText, setRosterText] = useState("");
  const [rosterTabs, setRosterTabs] = useState<OfficerRosterTab[]>([]);
  const [rosterMemberLabelOverrides, setRosterMemberLabelOverrides] = useState<Record<string, string>>({});
  const [activeRosterTabId, setActiveRosterTabId] = useState("");
  const [newRosterTabLabel, setNewRosterTabLabel] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const [navItems, setNavItems] = useState<ResolvedNavItem[]>([]);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);

  const [pageDraft, setPageDraft] = useState(EMPTY_PAGE_DRAFT);
  const restorePageDraft = useCallback((draft: typeof EMPTY_PAGE_DRAFT) => {
    setPageDraft(draft);
    toast.info("已復原未送出的頁面草稿，可在「頁面」分頁繼續編輯");
  }, []);
  const {
    clearDraft: clearPageDraft,
    lastSavedAt: pageDraftLastSavedAt,
  } = useDraftAutosave({
    key: `public-site-page:${editingPageId ?? "new"}`,
    value: pageDraft,
    onRestore: restorePageDraft,
    isEmpty: isEmptyPageDraft,
  });
  const markdownFileRef = useRef<HTMLInputElement>(null);
  const [categoryDraft, setCategoryDraft] = useState({
    title: "",
    description: "",
    sort_order: 0,
    is_active: true,
  });
  const [linkDraft, setLinkDraft] = useState({
    title: "",
    url: "",
    description: "",
    category_id: "",
    icon_key: "",
    is_active: true,
    starts_at: "",
    ends_at: "",
  });
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [officerDraft, setOfficerDraft] = useState<OfficerProfileDraft>({
    user_position_id: "",
    display_name_override: "",
    title_override: "",
    bio: "",
    public_email: "",
    sort_order: 0,
    is_featured: false,
    is_visible: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        nextSettings,
        nextPages,
        nextCategories,
        nextLinks,
        nextCandidates,
        nextProfiles,
      ] = await Promise.all([
        siteApi.adminSettings(),
        siteApi.adminPages(),
        siteApi.adminLinkCategories(),
        siteApi.adminLinks(),
        siteApi.officerCandidates(true),
        siteApi.officerProfiles(),
      ]);
      setSettings(normalizeSettingsForEditor(nextSettings));
      setPages(nextPages);
      setCategories(nextCategories);
      setLinks(nextLinks);
      setCandidates(nextCandidates);
      setProfiles(nextProfiles);
      syncThemeJson(nextSettings.theme_config);
      syncBlocksJson(nextSettings.homepage_blocks);
      setSpecialAgreement(readSpecialAgreementContent(nextSettings.homepage_blocks?.special_agreement));
      const nextRosterTabs = parseStoredOfficerRosterTabs(nextSettings.theme_config);
      setRosterTabs(nextRosterTabs);
      const nextMemberLabelOverrides: Record<string, string> = {};
      nextRosterTabs.forEach((rosterTab) => {
        rosterTab.entries.forEach((entry) => {
          Object.entries(entry.member_labels ?? {}).forEach(([name, label]) => {
            nextMemberLabelOverrides[rosterMemberKey(rosterTab.id, entry.title, name)] = label;
          });
          if (!entry.member_labels && entry.is_lead === true && entry.names[0]) {
            nextMemberLabelOverrides[rosterMemberKey(rosterTab.id, entry.title, entry.names[0])] = "長級";
          }
        });
      });
      setRosterMemberLabelOverrides(nextMemberLabelOverrides);
      setActiveRosterTabId((currentId) => nextRosterTabs.some((tab) => tab.id === currentId) ? currentId : nextRosterTabs[0]?.id ?? "");
      setRosterText(serializeOfficerRoster(nextRosterTabs[0]?.entries ?? []));
      setNavItems(resolvePublicNav(nextSettings.theme_config));
    } catch (error) {
      displayError(error, "載入公開網站設定失敗");
    } finally {
      setLoading(false);
    }
  }, [syncBlocksJson, syncThemeJson]);

  useEffect(() => { load(); }, [load]);


  const rosterLines = useMemo(() => parseOfficerRoster(rosterText), [rosterText]);
  const rosterSummary = useMemo(() => {
    const validLines = rosterLines.filter((line): line is OfficerRosterLine & { error?: undefined } => !line.error);
    return {
      validLines,
      memberCount: validLines.reduce((total, line) => total + line.names.length, 0),
    };
  }, [rosterLines]);

  const activeRosterTab = rosterTabs.find((tab) => tab.id === activeRosterTabId);

  const getRosterMemberLabel = (title: string, name: string) => (
    rosterMemberLabelOverrides[rosterMemberKey(activeRosterTabId, title, name)] ?? ""
  );

  const currentRosterEntries = () => rosterSummary.validLines.map(({ title, names }) => {
    const memberLabels: Record<string, string> = {};
    names.forEach((name) => {
      const label = getRosterMemberLabel(title, name);
      if (label) memberLabels[name] = label;
    });
    return { title, names, member_labels: memberLabels };
  });

  const setRosterMemberLabel = (title: string, name: string, value: string) => {
    setRosterMemberLabelOverrides((current) => ({
      ...current,
      [rosterMemberKey(activeRosterTabId, title, name)]: value.trim(),
    }));
  };

  const selectRosterTab = (tabId: string) => {
    const tab = rosterTabs.find((item) => item.id === tabId);
    if (!tab) return;
    setRosterTabs((current) => current.map((item) => item.id === activeRosterTabId ? { ...item, entries: currentRosterEntries() } : item));
    setActiveRosterTabId(tabId);
    setRosterText(serializeOfficerRoster(tab.entries));
  };

  const addRosterTab = () => {
    const label = newRosterTabLabel.trim();
    if (!label) {
      toast.error("請先輸入組織名稱");
      return;
    }
    if (rosterTabs.some((tab) => tab.label === label)) {
      toast.error("組織名稱不可重複");
      return;
    }
    const id = `roster-${Date.now()}`;
    const nextTab = { id, label, entries: [] };
    setRosterTabs((current) => [
      ...current.map((tab) => tab.id === activeRosterTabId ? { ...tab, entries: currentRosterEntries() } : tab),
      nextTab,
    ]);
    setActiveRosterTabId(id);
    setRosterText("");
    setNewRosterTabLabel("");
  };

  const deleteRosterTab = () => {
    if (!activeRosterTab) return;
    if (rosterTabs.length <= 1) {
      toast.error("至少保留一個組織頁籤");
      return;
    }
    const nextTabs = rosterTabs.filter((tab) => tab.id !== activeRosterTab.id);
    const nextTab = nextTabs[0];
    setRosterTabs(nextTabs);
    setActiveRosterTabId(nextTab.id);
    setRosterText(serializeOfficerRoster(nextTab.entries));
  };

  const saveSettingsFields = async (body: PublicSiteSettingsUpdate) => {
    const next = await siteApi.updateSettings(body);
    setSettings((current) => mergeSavedSettings(current, next, Object.keys(body)));
    return next;
  };

  const saveOfficerRoster = async () => {
    if (blockedByUnsavedJson(themeJsonDirty)) return;
    const invalidLines = rosterLines.filter((line) => line.error);
    if (invalidLines.length > 0) {
      toast.error(`第 ${invalidLines.map((line) => line.lineNumber).join("、")} 行格式有誤`);
      return;
    }
    if (rosterSummary.memberCount === 0) {
      toast.error("尚未輸入任何有效幹部");
      return;
    }

    setRosterBusy(true);
    try {
      const roster = currentRosterEntries();
      const nextTabs = rosterTabs.map((tab) => tab.id === activeRosterTabId ? { ...tab, entries: roster } : tab);
      const nextTheme = { ...(settings.theme_config ?? {}), officer_rosters: nextTabs };
      const next = await saveSettingsFields({ theme_config: nextTheme });
      setRosterTabs(nextTabs);
      syncThemeJson(next.theme_config);
      toast.success(`已儲存 ${rosterSummary.memberCount} 位幹部、${roster.length} 個職位`);
    } catch (error) {
      displayError(error, "儲存幹部名單失敗");
    } finally {
      setRosterBusy(false);
    }
  };

  const saveSettings = async () => {
    try {
      await saveSettingsFields({
        site_title: settings.site_title,
        site_description: settings.site_description,
        site_logo_url: settings.site_logo_url,
        site_logo_alt: settings.site_logo_alt,
        hero_title: settings.hero_title,
        hero_subtitle: settings.hero_subtitle,
        hero_image_url: settings.hero_image_url,
        hero_image_alt: settings.hero_image_alt,
        about_title: settings.about_title,
        about_body_md: settings.about_body_md,
        mission_md: settings.mission_md,
        history_md: settings.history_md,
        cta_label: settings.cta_label,
        cta_href: settings.cta_href,
        public_database_label: settings.public_database_label,
        public_database_description: settings.public_database_description,
      });
      toast.success("公開網站設定已儲存");
    } catch (error) {
      displayError(error, "儲存設定失敗");
    }
  };

  const saveSystemInfo = async () => {
    try {
      await saveSettingsFields({ system_info_md: settings.system_info_md });
      toast.success("系統資訊已儲存");
    } catch (error) {
      displayError(error, "儲存系統資訊失敗");
    }
  };

  const saveContact = async () => {
    try {
      await saveSettingsFields({ contact_md: settings.contact_md });
      toast.success("聯絡方式已儲存");
    } catch (error) {
      displayError(error, "儲存聯絡方式失敗");
    }
  };

  const saveAdvanced = async () => {
    try {
      const next = await saveSettingsFields({
        theme_config: parseJsonObject(themeJson, "主題設定"),
        homepage_blocks: parseJsonObject(blocksJson, "首頁區塊"),
        custom_css: settings.custom_css,
        seo_title: settings.seo_title,
        seo_description: settings.seo_description,
      });
      syncThemeJson(next.theme_config);
      syncBlocksJson(next.homepage_blocks);
      toast.success("進階設定已儲存");
    } catch (error) {
      displayError(error, error instanceof Error ? error.message : "儲存進階設定失敗");
    }
  };

  /** 更新單一導覽項目的覆寫欄位（顯示名稱、是否隱藏）。 */
  const patchNavItem = (key: string, patch: Partial<ResolvedNavItem>) => {
    setNavItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  /** 同組內上移／下移；以 order 為準，移動後重新編號避免衝突。 */
  const moveNavItem = (key: string, dir: "up" | "down") => {
    setNavItems((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((item) => item.key === key);
      if (idx < 0) return prev;
      const step = dir === "up" ? -1 : 1;
      let target = idx + step;
      while (target >= 0 && target < sorted.length && sorted[target].group !== sorted[idx].group) {
        target += step;
      }
      if (target < 0 || target >= sorted.length) return prev;
      [sorted[idx], sorted[target]] = [sorted[target], sorted[idx]];
      return sorted.map((item, index) => ({ ...item, order: index }));
    });
  };

  /** 還原成內建預設（清空覆寫），仍需按儲存才會生效。 */
  const resetNav = () => setNavItems(resolvePublicNav(null));

  const saveNav = async () => {
    if (blockedByUnsavedJson(themeJsonDirty)) return;
    try {
      const sorted = [...navItems].sort((a, b) => a.order - b.order);
      const items: Record<string, PublicNavOverride> = {};
      sorted.forEach((item, index) => {
        const def = PUBLIC_NAV_ITEMS.find((entry) => entry.key === item.key);
        const override: PublicNavOverride = { order: index };
        if (item.hidden) override.hidden = true;
        const label = item.label.trim();
        if (def && label && label !== def.label) override.label = label;
        items[item.key] = override;
      });
      const nextTheme = { ...(settings.theme_config ?? {}), nav: { items } };
      const next = await saveSettingsFields({ theme_config: nextTheme });
      setNavItems(resolvePublicNav(next.theme_config));
      syncThemeJson(next.theme_config);
      toast.success("導覽列設定已儲存");
    } catch (error) {
      displayError(error, "儲存導覽列失敗");
    }
  };

  const resetPageDraft = () => {
    setEditingPageId(null);
    setPageDraft({ ...EMPTY_PAGE_DRAFT });
  };

  const startEditPage = (page: PublicSitePageOut) => {
    setEditingPageId(page.id);
    setPageDraft({
      slug: page.slug,
      title: page.title,
      summary: page.summary ?? "",
      body_md: page.body_md,
      page_kind: page.page_kind,
      nav_label: page.nav_label ?? "",
      nav_order: page.nav_order,
      sort_order: page.sort_order,
      show_in_nav: page.show_in_nav,
      is_published: page.is_published,
      cover_image_url: page.cover_image_url ?? "",
      cover_image_alt: page.cover_image_alt ?? "",
      layout_config: page.layout_config ?? {},
      content_blocks: page.content_blocks ?? {},
      seo_title: page.seo_title ?? "",
      seo_description: page.seo_description ?? "",
      exam_scope_default_section: getExamScopeDefaultSection(page.layout_config) ?? "",
    });
  };

  const importPageMarkdown = async (file: File) => {
    const filename = file.name.toLocaleLowerCase();
    if (!filename.endsWith(".md") && !filename.endsWith(".txt")) {
      toast.error("請選擇 Markdown（.md）或純文字（.txt）檔案");
      return;
    }

    try {
      const markdown = await file.text();
      if (!markdown.trim()) {
        toast.error("檔案沒有文章內容");
        return;
      }
      const title = articleTitleFromMarkdown(markdown);
      const summary = articleSummaryFromMarkdown(markdown);
      setPageDraft((current) => ({
        ...current,
        slug: current.slug.trim() || (!editingPageId && title ? articleSlugFromTitle(title) : current.slug),
        title: title || current.title,
        summary: summary || current.summary,
        body_md: markdown,
        page_kind: "article",
        is_published: editingPageId ? current.is_published : true,
        seo_title: title || current.seo_title,
        seo_description: summary || current.seo_description,
      }));
      toast.success(`已載入 ${file.name}，內容已填入文章編輯器`);
    } catch {
      toast.error("無法讀取文章檔案，請重新選擇");
    }
  };

  const useLunchGuideExample = () => {
    setEditingPageId(null);
    setPageDraft({
      ...EMPTY_PAGE_DRAFT,
      slug: "zhuzhong-lunch-guide",
      title: "🍱 竹中訂餐指南",
      summary: "整理竹中校內學餐、校外業者、外送與外出用餐的午餐選擇。",
      body_md: LUNCH_GUIDE_MARKDOWN,
      page_kind: "article",
      is_published: true,
      seo_title: "🍱 竹中訂餐指南",
      seo_description: "整理竹中校內學餐、校外業者、外送與外出用餐的午餐選擇。",
    });
  };

  const createPage = async () => {
    if (!pageDraft.slug.trim() || !pageDraft.title.trim() || !pageDraft.body_md.trim()) {
      toast.error("請填寫 Slug、標題與文章內容");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(pageDraft.slug.trim())) {
      toast.error("Slug 只能使用小寫英文字母、數字與連字號");
      return;
    }
    setSavingPage(true);
    try {
      const { exam_scope_default_section, ...pageDraftData } = pageDraft;
      const layoutConfig = { ...pageDraft.layout_config };
      if (exam_scope_default_section) {
        layoutConfig.exam_scope_default_section = exam_scope_default_section;
      } else {
        delete layoutConfig.exam_scope_default_section;
      }
      const body = {
        ...pageDraftData,
        slug: pageDraft.slug.trim(),
        title: pageDraft.title.trim(),
        summary: pageDraft.summary || null,
        nav_label: pageDraft.nav_label || null,
        layout_config: layoutConfig,
        content_blocks: pageDraft.content_blocks,
        cover_image_url: pageDraft.cover_image_url || null,
        cover_image_alt: pageDraft.cover_image_alt || null,
        seo_title: pageDraft.seo_title || null,
        seo_description: pageDraft.seo_description || null,
      };
      if (editingPageId) {
        await siteApi.updatePage(editingPageId, body);
        toast.success(pageDraft.page_kind === "article" ? "文章已更新" : "頁面已更新");
      } else {
        await siteApi.createPage(body);
        toast.success(
          pageDraft.page_kind === "article" && pageDraft.is_published
            ? "文章已新增並上線"
            : "頁面已新增",
        );
      }
      clearPageDraft();
      resetPageDraft();
      await load();
    } catch (error) {
      displayError(error, editingPageId ? "更新頁面失敗" : "新增頁面失敗");
    } finally {
      setSavingPage(false);
    }
  };

  const deletePage = async (page: PublicSitePageOut) => {
    if (!(await confirm({
      title: `刪除「${page.title}」？`,
      description: "刪除後無法在後台復原，且會立即從公開網站移除。",
      confirmLabel: "刪除頁面",
      danger: true,
    }))) return;

    try {
      await siteApi.deletePage(page.id);
      clearStoredDraft(`public-site-page:${page.id}`);
      if (editingPageId === page.id) {
        resetPageDraft();
      }
      toast.success("頁面已刪除");
      await load();
    } catch (error) {
      displayError(error, "刪除頁面失敗");
    }
  };

  const createCategory = async () => {
    const title = categoryDraft.title.trim();
    if (!title) {
      toast.error("請輸入分類名稱");
      return;
    }

    try {
      await siteApi.createLinkCategory({
        ...categoryDraft,
        slug: `category-${crypto.randomUUID()}`,
        title,
        description: categoryDraft.description.trim() || null,
        sort_order: Math.max(-1, ...categories.map((category) => category.sort_order)) + 1,
      });
      toast.success("分類已新增");
      setCategoryDraft({ title: "", description: "", sort_order: 0, is_active: true });
      await load();
    } catch (error) {
      displayError(error, "新增類別失敗");
    }
  };

  const createLink = async () => {
    const startsAt = toIsoDateTime(linkDraft.starts_at);
    const endsAt = toIsoDateTime(linkDraft.ends_at);
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      toast.error("停用時間必須晚於啟用時間");
      return;
    }

    try {
      const body = {
        title: linkDraft.title,
        url: linkDraft.url,
        description: linkDraft.description || null,
        category_id: linkDraft.category_id || null,
        icon_key: linkDraft.icon_key || null,
        is_active: linkDraft.is_active,
        starts_at: startsAt,
        ends_at: endsAt,
      };
      if (editingLinkId) {
        await siteApi.updateLink(editingLinkId, body);
        toast.success("連結已更新");
      } else {
        await siteApi.createLink({
          ...body,
          sort_order: Math.max(0, ...links.map((link) => link.sort_order)) + 1,
        });
        toast.success("連結已新增");
      }
      setEditingLinkId(null);
      setLinkDraft({ title: "", url: "", description: "", category_id: "", icon_key: "", is_active: true, starts_at: "", ends_at: "" });
      await load();
    } catch (error) {
      displayError(error, editingLinkId ? "更新連結失敗" : "新增連結失敗");
    }
  };

  const addSpecialProcess = () => {
    setSpecialAgreement((current) => ({
      ...current,
      process: [
        ...current.process,
        {
          id: `step-${Date.now()}`,
          title: "",
          description: "",
        },
      ],
    }));
  };

  const updateSpecialProcess = (
    id: string,
    field: "title" | "description",
    value: string,
  ) => {
    setSpecialAgreement((current) => ({
      ...current,
      process: current.process.map((step) => (step.id === id ? { ...step, [field]: value } : step)),
    }));
  };

  const moveSpecialProcess = (id: string, direction: "up" | "down") => {
    setSpecialAgreement((current) => {
      const index = current.process.findIndex((step) => step.id === id);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= current.process.length) return current;
      const process = [...current.process];
      [process[index], process[target]] = [process[target], process[index]];
      return { ...current, process };
    });
  };

  const removeSpecialProcess = (id: string) => {
    setSpecialAgreement((current) => ({
      ...current,
      process: current.process.filter((step) => step.id !== id),
    }));
  };

  const addSpecialFile = () => {
    setSpecialAgreement((current) => ({
      ...current,
      files: [
        ...current.files,
        {
          id: `file-${Date.now()}`,
          title: "",
          description: "",
          url: "",
          mimeType: "",
        },
      ],
    }));
  };

  const updateSpecialFile = (id: string, patch: Partial<PublicSpecialAgreementFile>) => {
    setSpecialAgreement((current) => ({
      ...current,
      files: current.files.map((file) => (file.id === id ? { ...file, ...patch } : file)),
    }));
  };

  const removeSpecialFile = (id: string) => {
    setSpecialAgreement((current) => ({
      ...current,
      files: current.files.filter((file) => file.id !== id),
    }));
  };

  const saveSpecialAgreement = async () => {
    if (blockedByUnsavedJson(blocksJsonDirty)) return;
    const invalidStep = specialAgreement.process.find(
      (step) => !step.title.trim() || !step.description.trim(),
    );
    if (invalidStep) {
      toast.error("請先完成每個流程的名稱與說明");
      return;
    }
    const invalidFile = specialAgreement.files.find((file) => !file.title.trim() || !file.url.trim());
    if (invalidFile) {
      toast.error("請先完成每個參考文件的名稱與網址，或移除空白項目");
      return;
    }

    try {
      const homepageBlocks = {
        ...(settings.homepage_blocks ?? {}),
        special_agreement: specialAgreement,
      };
      const next = await saveSettingsFields({ homepage_blocks: homepageBlocks });
      setSpecialAgreement(readSpecialAgreementContent(next.homepage_blocks?.special_agreement));
      syncBlocksJson(next.homepage_blocks);
      toast.success("特約資訊已儲存");
    } catch (error) {
      displayError(error, "儲存特約資訊失敗");
    }
  };

  const startEditLink = (link: PublicLinkOut) => {
    setEditingLinkId(link.id);
    setLinkDraft({
      title: link.title,
      url: link.url,
      description: link.description ?? "",
      category_id: link.category_id ?? "",
      icon_key: link.icon_key ?? "",
      is_active: link.is_active,
      starts_at: toLocalDateTimeInput(link.starts_at),
      ends_at: toLocalDateTimeInput(link.ends_at),
    });
  };

  const cancelEditLink = () => {
    setEditingLinkId(null);
    setLinkDraft({ title: "", url: "", description: "", category_id: "", icon_key: "", is_active: true, starts_at: "", ends_at: "" });
  };

  const persistLinkTree = async (
    nextCategories: PublicLinkCategoryOut[],
    nextLinks: PublicLinkOut[],
  ) => {
    const previousCategories = categories;
    const previousLinks = links;
    setCategories(nextCategories);
    setLinks(nextLinks);
    setSavingLinkTree(true);
    try {
      const saved = await siteApi.updateLinkTree({
        category_ids: nextCategories.map((category) => category.id),
        links: nextLinks.map((link) => ({ id: link.id, category_id: link.category_id ?? null })),
      });
      setCategories(saved.categories);
      setLinks(saved.links);
      toast.success("連結樹已儲存");
    } catch (error) {
      setCategories(previousCategories);
      setLinks(previousLinks);
      displayError(error, "儲存連結分類與排序失敗");
    } finally {
      setSavingLinkTree(false);
    }
  };

  const reorderLinkTree = async ({ active, over }: DragEndEvent) => {
    if (!over || savingLinkTree) return;
    const activeType = active.data.current?.type;

    if (activeType === "category") {
      if (over.data.current?.type !== "category") return;
      const oldIndex = categories.findIndex((category) => category.id === active.id);
      const newIndex = categories.findIndex((category) => category.id === over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      const nextCategories = arrayMove(categories, oldIndex, newIndex);
      const lanes = new Map<string | null, PublicLinkOut[]>();
      categories.forEach((category) => lanes.set(category.id, []));
      lanes.set(null, []);
      for (const link of links) {
        lanes.get(link.category_id ?? null)?.push(link);
      }
      const nextLinks = [
        ...nextCategories.flatMap((category) => lanes.get(category.id) ?? []),
        ...(lanes.get(null) ?? []),
      ];
      await persistLinkTree(nextCategories, nextLinks);
      return;
    }

    if (
      activeType !== "link" ||
      (active.id === over.id && over.data.current?.type === "link")
    ) return;

    const activeLinkId = String(active.id);
    const sourceCategoryId = (active.data.current?.categoryId as string | null | undefined) ?? null;
    const overType = over.data.current?.type;
    if (overType !== "link" && overType !== "category" && overType !== "category-drop") return;

    const targetCategoryId = (over.data.current?.categoryId as string | null | undefined) ?? null;
    const targetLinkId = overType === "link" ? String(over.id) : null;
    const lanes = new Map<string | null, string[]>();
    categories.forEach((category) => lanes.set(category.id, []));
    lanes.set(null, []);
    for (const link of links) {
      lanes.get(link.category_id ?? null)?.push(link.id);
    }

    const sourceLane = lanes.get(sourceCategoryId);
    const targetLaneBeforeMove = lanes.get(targetCategoryId);
    const sourceIndex = sourceLane?.indexOf(activeLinkId) ?? -1;
    if (!sourceLane || sourceIndex < 0 || !targetLaneBeforeMove) return;
    const targetIndexBeforeMove = targetLinkId ? targetLaneBeforeMove.indexOf(targetLinkId) : -1;
    if (targetLinkId && targetIndexBeforeMove < 0) return;

    sourceLane.splice(sourceIndex, 1);
    const targetLane = lanes.get(targetCategoryId);
    if (!targetLane) return;
    let insertIndex = targetLane.length;
    if (targetLinkId) {
      const targetIndex = targetLane.indexOf(targetLinkId);
      if (targetIndex < 0) return;
      insertIndex = sourceCategoryId === targetCategoryId && sourceIndex < targetIndexBeforeMove
        ? targetIndex + 1
        : targetIndex;
    }
    targetLane.splice(insertIndex, 0, activeLinkId);

    const orderedLinkIds = [
      ...categories.flatMap((category) => lanes.get(category.id) ?? []),
      ...(lanes.get(null) ?? []),
    ];
    const linksById = new Map(links.map((link) => [link.id, link]));
    const nextLinks = orderedLinkIds.flatMap((id) => {
      const link = linksById.get(id);
      if (!link) return [];
      if (id !== activeLinkId) return [link];
      const category = targetCategoryId
        ? categories.find((entry) => entry.id === targetCategoryId) ?? null
        : null;
      return [{ ...link, category_id: targetCategoryId, category }];
    });
    await persistLinkTree(categories, nextLinks);
  };

  const deleteLink = async (link: PublicLinkOut) => {
    if (!(await confirm({
      title: `刪除「${link.title}」？`,
      description: "此公開連結會立即從網站移除，無法復原。",
      confirmLabel: "刪除連結",
      danger: true,
    }))) return;
    try {
      await siteApi.deleteLink(link.id);
      if (editingLinkId === link.id) cancelEditLink();
      toast.success("連結已刪除");
      await load();
    } catch (error) {
      displayError(error, "刪除連結失敗");
    }
  };

  const createOfficerProfile = async () => {
    try {
      await siteApi.createOfficerProfile({
        ...officerDraft,
        display_name_override: officerDraft.display_name_override || null,
        title_override: officerDraft.title_override || null,
        bio: officerDraft.bio || null,
        public_email: officerDraft.public_email || null,
        external_links: {},
      });
      toast.success("公開幹部已新增");
      setOfficerDraft({ user_position_id: "", display_name_override: "", title_override: "", bio: "", public_email: "", sort_order: 0, is_featured: false, is_visible: true });
      await load();
    } catch (error) {
      displayError(error, "新增幹部顯示失敗");
    }
  };

  const patchPage = async (page: PublicSitePageOut, body: Partial<PublicSitePageOut>) => {
    await siteApi.updatePage(page.id, body);
    await load();
  };

  const patchLink = async (link: PublicLinkOut, body: Partial<PublicLinkOut>) => {
    await siteApi.updateLink(link.id, body);
    await load();
  };

  const patchProfile = async (profile: PublicOfficerProfileOut, body: Partial<PublicOfficerProfileOut>) => {
    await siteApi.updateOfficerProfile(profile.id, body);
    await load();
  };

  const workspaceHeader = <PublicSiteWorkspaceHeader loading={loading} onRefresh={load} />;
  if (loading) {
    return <div className="public-site-admin-page mx-auto max-w-7xl space-y-5">
      {workspaceHeader}
      <p role="status" className="py-20 text-center text-sm text-[var(--text-muted)]">載入公開網站設定...</p>
    </div>;
  }

  const publishedPages = pages.filter((page) => page.is_published).length;
  const activeLinks = links.filter((link) => link.is_active).length;
  const visibleOfficers = profiles.filter((profile) => profile.is_visible).length;

  return (
    <div className="public-site-admin-page mx-auto max-w-7xl space-y-5">
      {workspaceHeader}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="公開網站內容摘要">
        {[
          { label: "已發布頁面", value: publishedPages, detail: `共 ${pages.length} 頁` },
          { label: "啟用連結", value: activeLinks, detail: `共 ${categories.length} 個分類` },
          { label: "公開幹部", value: visibleOfficers, detail: "含首頁精選設定" },
        ].map((item) => (
          <div key={item.label} className="card p-4">
            <p className="text-xs font-medium text-[var(--text-muted)]">{item.label}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <strong className="text-2xl font-semibold text-[var(--text-primary)]">{item.value}</strong>
              <span className="text-xs text-[var(--text-muted)]">{item.detail}</span>
            </div>
          </div>
        ))}
      </section>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-sm sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="public-site-tab" className="text-xs font-semibold text-[var(--text-secondary)]">
            編輯區塊
          </label>
          <span className="text-xs text-[var(--text-muted)]">共 {tabs.length} 個設定</span>
        </div>
        <div className="relative mt-2">
          <Select
            id="public-site-tab"
            value={tab}
            onChange={(event) => setTab(event.target.value as Tab)}
            className="min-h-12 appearance-none pr-10 font-semibold"
            aria-label="選擇公開網站設定區塊"
          >
            {tabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
          <ChevronDown
            size={17}
            aria-hidden={true}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
        </div>
      </div>

      <TabBar
        className="public-site-admin-tabs hidden sm:block"
        label="公開網站設定分頁"
        items={tabs.map(({ id, label, icon }) => ({ key: id, label, icon }))}
        value={tab}
        onChange={setTab}
      />

      {tab === "homepage" && (
        <section key="homepage" className="tab-panel-transition grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="card space-y-4 p-5">
            <Field label="網站標題"><TextInput value={settings.site_title} onChange={(e) => setSettings({ ...settings, site_title: e.target.value })} /></Field>
            <Field label="網站描述"><TextArea value={settings.site_description ?? ""} onChange={(e) => setSettings({ ...settings, site_description: e.target.value })} /></Field>
            <ImageField
              label="班聯會會徽"
              hint="顯示於導覽列與首頁。JPEG、PNG、GIF、WebP，上限 20 MB。"
              value={settings.site_logo_url ?? ""}
              alt={settings.site_logo_alt ?? undefined}
              onChange={(url) => setSettings({ ...settings, site_logo_url: url })}
            />
            <Field label="會徽替代文字"><TextInput value={settings.site_logo_alt ?? ""} onChange={(e) => setSettings({ ...settings, site_logo_alt: e.target.value })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="首頁主標"><TextInput value={settings.hero_title} onChange={(e) => setSettings({ ...settings, hero_title: e.target.value })} /></Field>
              <Field label="CTA 文字"><TextInput value={settings.cta_label} onChange={(e) => setSettings({ ...settings, cta_label: e.target.value })} /></Field>
            </div>
            <Field label="首頁副標"><TextArea value={settings.hero_subtitle ?? ""} onChange={(e) => setSettings({ ...settings, hero_subtitle: e.target.value })} /></Field>
            <Field label="CTA 連結"><TextInput value={settings.cta_href} onChange={(e) => setSettings({ ...settings, cta_href: e.target.value })} /></Field>
            <ImageField
              label="首頁封面圖"
              hint="顯示於首頁主視覺。"
              value={settings.hero_image_url ?? ""}
              alt={settings.hero_image_alt ?? undefined}
              onChange={(url) => setSettings({ ...settings, hero_image_url: url })}
            />
            <Field label="封面圖替代文字"><TextInput value={settings.hero_image_alt ?? ""} onChange={(e) => setSettings({ ...settings, hero_image_alt: e.target.value })} /></Field>
            <button type="button" onClick={saveSettings} className="btn btn-primary"><Save size={16} aria-hidden /> 儲存基本設定</button>
          </div>
          <div className="card space-y-4 p-5">
            <Field label="關於標題"><TextInput value={settings.about_title} onChange={(e) => setSettings({ ...settings, about_title: e.target.value })} /></Field>
            <Field label="關於內文 Markdown"><MarkdownEditor rows={8} value={settings.about_body_md} onChange={(value) => setSettings({ ...settings, about_body_md: value })} /></Field>
            <Field label="使命 Markdown"><MarkdownEditor value={settings.mission_md ?? ""} onChange={(value) => setSettings({ ...settings, mission_md: value })} /></Field>
            <Field label="沿革 Markdown"><MarkdownEditor value={settings.history_md ?? ""} onChange={(value) => setSettings({ ...settings, history_md: value })} /></Field>
          </div>
        </section>
      )}

      {tab === "system" && (
        <section key="system" className="tab-panel-transition space-y-4">
          <div className="card overflow-hidden border-[var(--primary)]/20 bg-[var(--primary-dim)] p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--bg-surface)] text-[var(--primary-text)]">
                <Info size={19} aria-hidden />
              </span>
              <div>
                <h2 className="font-semibold text-[var(--text-primary)]">系統資訊</h2>
              </div>
            </div>
          </div>
          <div className="card space-y-4 p-5">
            <Field label="頁面內容 Markdown" hint="單換行會在公開頁保留；可用 ## 建立頁內標題、清單或連結。">
              <MarkdownEditor rows={22} value={settings.system_info_md ?? ""} onChange={(value) => setSettings({ ...settings, system_info_md: value })} />
            </Field>
            <button type="button" onClick={saveSystemInfo} className="btn btn-primary self-start">
              <Save size={16} aria-hidden /> 儲存系統資訊
            </button>
          </div>
        </section>
      )}

      {tab === "contact" && (
        <section key="contact" className="tab-panel-transition space-y-4">
          <div className="card space-y-4 p-5">
            <Field label="聯絡方式 Markdown" hint="可使用 Markdown 建立信箱、社群、表單連結與分段說明。">
              <MarkdownEditor rows={22} value={settings.contact_md ?? ""} onChange={(value) => setSettings({ ...settings, contact_md: value })} />
            </Field>
            <button type="button" onClick={saveContact} className="btn btn-primary self-start">
              <Save size={16} aria-hidden /> 儲存聯絡方式
            </button>
          </div>
        </section>
      )}

      {tab === "special" && (
        <section key="special" className="tab-panel-transition space-y-4">
          <div className="card overflow-hidden border-[#173654]/20 bg-[#173654] p-5 text-[#f8f3e5] sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-[#e8c970]">
                  <Handshake size={19} aria-hidden />
                </span>
                <div>
                  <h2 className="text-xl font-semibold">特約資訊</h2>
                </div>
              </div>
              <div className="shrink-0 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center">
                <strong className="block text-2xl font-semibold text-[#e8c970]">{specialAgreement.process.length}</strong>
                <span className="text-xs text-[#d5e0e6]">個流程步驟</span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
            <div className="card space-y-5 p-5">
              <div>
                <h2 className="font-semibold">頁面內容</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                  介紹與特約說明支援 Markdown。
                </p>
              </div>
              <Field label="頁首介紹 Markdown">
                <MarkdownEditor rows={5} value={specialAgreement.intro_md} onChange={(value) => setSpecialAgreement((current) => ({ ...current, intro_md: value }))} />
              </Field>
              <Field label="特約資訊 Markdown" hint="建議使用 ## 分段，前台會以清楚的內容區塊呈現。">
                <MarkdownEditor rows={18} value={specialAgreement.info_md} onChange={(value) => setSpecialAgreement((current) => ({ ...current, info_md: value }))} />
              </Field>
            </div>

            <aside className="card space-y-4 p-5">
              <div>
                <h2 className="font-semibold">流程預覽</h2>
              </div>
              {specialAgreement.process.length === 0 ? (
                <p className="rounded-lg bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">尚未建立流程。</p>
              ) : (
                <ol className="space-y-3">
                  {specialAgreement.process.map((step, index) => (
                    <li key={step.id} className="flex gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--primary-dim)] text-xs font-semibold text-[var(--primary-text)]">{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0">
                        <strong className="block text-sm">{step.title || "未命名流程"}</strong>
                        <span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{step.description || "尚未填寫說明"}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </aside>
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <h2 className="font-semibold">公開申請表單</h2>
            <Link href="/partner-map/admin/applications" className="btn btn-secondary min-h-11">
              表單設定與審核 <ArrowRight size={15} aria-hidden />
            </Link>
          </div>

          <div className="card space-y-4 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold">參考附件</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">支援網址、PDF、圖片與 Office 文件。</p>
              </div>
              <button type="button" onClick={addSpecialFile} className="btn btn-secondary min-h-11 shrink-0">
                <Plus size={16} aria-hidden /> 新增附件
              </button>
            </div>
            {specialAgreement.files.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-10 text-center text-sm text-[var(--text-muted)]">尚未設定參考附件。</p>
            ) : (
              <div className="space-y-3">
                {specialAgreement.files.map((file) => (
                  <div key={file.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="附件名稱"><TextInput value={file.title} onChange={(event) => updateSpecialFile(file.id, { title: event.target.value })} placeholder="例如：合作說明 PDF" /></Field>
                      <Field label="附件說明"><TextInput value={file.description} onChange={(event) => updateSpecialFile(file.id, { description: event.target.value })} placeholder="選填" /></Field>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                      <Field label="附件網址" hint={file.mimeType ? `檔案類型：${file.mimeType}` : undefined}>
                        <TextInput value={file.url} onChange={(event) => updateSpecialFile(file.id, { url: event.target.value })} placeholder="https://… 或上傳檔案" />
                      </Field>
                      <div className="min-w-0 sm:w-72">
                        <AnimatedFileUpload
                          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                          label="拖曳替換檔案到這裡"
                          hint="支援 PDF、Office 與圖片"
                          onUpload={(selected, reportProgress) => siteApi.uploadPublicFile(selected, reportProgress)}
                          onUploaded={(uploaded) => {
                            updateSpecialFile(file.id, { url: uploaded.url, mimeType: uploaded.content_type });
                            toast.success("參考文件已上傳");
                          }}
                        />
                      </div>
                      <button type="button" className="btn btn-ghost min-h-10 text-[var(--danger)]" onClick={() => removeSpecialFile(file.id)}>
                        <Trash2 size={15} aria-hidden /> 移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card space-y-4 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold">特約流程</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">每一步都會依序顯示在前台；可用上下箭頭調整順序。</p>
              </div>
              <button type="button" onClick={addSpecialProcess} className="btn btn-secondary min-h-11 shrink-0">
                <Plus size={16} aria-hidden /> 新增流程
              </button>
            </div>
            {specialAgreement.process.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-10 text-center">
                <Handshake size={26} className="mx-auto text-[var(--text-muted)]" aria-hidden />
                <p className="mt-3 text-sm font-medium">還沒有特約流程</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">按「新增流程」開始建立第一個步驟。</p>
              </div>
            ) : (
              <ol className="space-y-3">
                {specialAgreement.process.map((step, index) => (
                  <li key={step.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--primary-dim)] text-sm font-semibold text-[var(--primary-text)]">{String(index + 1).padStart(2, "0")}</span>
                      <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.5fr)]">
                        <Field label="流程名稱"><TextInput value={step.title} onChange={(event) => updateSpecialProcess(step.id, "title", event.target.value)} placeholder="例如：提出合作構想" /></Field>
                        <Field label="流程說明"><TextArea rows={3} value={step.description} onChange={(event) => updateSpecialProcess(step.id, "description", event.target.value)} placeholder="說明這個步驟需要完成什麼。" /></Field>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 lg:pt-6">
                        <button type="button" className="btn btn-sm btn-ghost" disabled={index === 0} onClick={() => moveSpecialProcess(step.id, "up")} aria-label="流程上移"><ArrowUp size={15} aria-hidden /></button>
                        <button type="button" className="btn btn-sm btn-ghost" disabled={index === specialAgreement.process.length - 1} onClick={() => moveSpecialProcess(step.id, "down")} aria-label="流程下移"><ArrowDown size={15} aria-hidden /></button>
                        <button type="button" className="btn btn-sm btn-ghost text-[var(--danger)]" onClick={() => removeSpecialProcess(step.id)} aria-label="刪除流程"><Trash2 size={15} aria-hidden /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <button type="button" onClick={saveSpecialAgreement} className="btn btn-primary min-h-11">
                <Save size={16} aria-hidden /> 儲存特約資訊
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === "nav" && (
        <section key="nav" className="tab-panel-transition space-y-4">
          <div className="card space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">公開站導覽列</h2>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={resetNav} className="btn btn-secondary">
                  <RotateCcw size={16} aria-hidden /> 還原預設
                </button>
                <button type="button" onClick={saveNav} className="btn btn-primary">
                  <Save size={16} aria-hidden /> 儲存導覽列
                </button>
              </div>
            </div>
          </div>
          {NAV_GROUP_ORDER.map((groupId) => {
            const meta = PUBLIC_NAV_GROUP_META[groupId];
            const items = navItems
              .filter((item) => item.group === groupId)
              .sort((a, b) => a.order - b.order);
            if (items.length === 0) return null;
            return (
              <div key={groupId} className="card space-y-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  {meta.hint && (
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>
                      {meta.hint}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const def = PUBLIC_NAV_ITEMS.find((entry) => entry.key === item.key);
                    return (
                      <div
                        key={item.key}
                        className={`flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 ${item.hidden ? "opacity-55" : ""}`}
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>
                          <PublicNavIcon iconKey={item.iconKey} size={17} />
                        </span>
                        <div className="min-w-[10rem] flex-1">
                          <input
                            value={item.label}
                            onChange={(e) => patchNavItem(item.key, { label: e.target.value })}
                            placeholder={def?.label ?? ""}
                            aria-label={`${def?.label ?? item.key} 顯示名稱`}
                            className="w-full rounded-md px-2 py-1 text-sm outline-none"
                            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                          />
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {item.href}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={index === 0}
                            aria-label="上移"
                            onClick={() => moveNavItem(item.key, "up")}
                          >
                            <ArrowUp size={15} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={index === items.length - 1}
                            aria-label="下移"
                            onClick={() => moveNavItem(item.key, "down")}
                          >
                            <ArrowDown size={15} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            aria-label={item.hidden ? "顯示此項目" : "隱藏此項目"}
                            onClick={() => patchNavItem(item.key, { hidden: !item.hidden })}
                          >
                            {item.hidden ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                            {item.hidden ? "已隱藏" : "顯示中"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {tab === "pages" && (
        <section key="pages" className="tab-panel-transition space-y-4">
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="card space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {editingPageId
                    ? pageDraft.page_kind === "article" ? "編輯文章" : "編輯公開頁面"
                    : pageDraft.page_kind === "article" ? "新增文章" : "新增公開頁面"}
                </h2>
                <DraftStatus lastSavedAt={pageDraftLastSavedAt} className="mt-1" />
              </div>
              {editingPageId && <button type="button" className="btn btn-sm btn-ghost" onClick={resetPageDraft}>取消編輯</button>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Slug"
                hint={`${pageDraft.page_kind === "article" ? "/articles/" : "/"}${pageDraft.slug || "…"}`}
              >
                <TextInput value={pageDraft.slug} onChange={(e) => setPageDraft({ ...pageDraft, slug: e.target.value })} placeholder="history" spellCheck={false} />
              </Field>
              <Field label="頁面類別">
                <Select value={pageDraft.page_kind} onChange={(e) => setPageDraft({ ...pageDraft, page_kind: e.target.value })}>
                  <option value="standard">一般頁面</option>
                  <option value="article">文章</option>
                </Select>
              </Field>
            </div>
            <Field label="標題"><TextInput value={pageDraft.title} onChange={(e) => setPageDraft({ ...pageDraft, title: e.target.value })} /></Field>
            <Field label="摘要"><TextArea value={pageDraft.summary} onChange={(e) => setPageDraft({ ...pageDraft, summary: e.target.value })} /></Field>
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text-secondary)]">內文 Markdown</span>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={markdownFileRef}
                    type="file"
                    accept=".md,.txt,text/markdown,text/plain"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importPageMarkdown(file);
                      event.target.value = "";
                    }}
                  />
                  <button type="button" className="btn btn-secondary min-h-10" onClick={() => markdownFileRef.current?.click()}>
                    <FileUp size={15} aria-hidden /> 匯入 .md 檔
                  </button>
                  {!editingPageId && (
                    <button type="button" className="btn btn-secondary min-h-10" onClick={useLunchGuideExample}>
                      <Sparkles size={15} aria-hidden /> 帶入訂餐指南
                    </button>
                  )}
                </div>
              </div>
              <ArticleMarkdownEditor value={pageDraft.body_md} onChange={(value) => setPageDraft({ ...pageDraft, body_md: value })} rows={18} />
              <p className="mt-1 text-xs text-[var(--text-muted)]">以 ## 建立頁內標題。</p>
            </div>
            {pageDraft.page_kind === "article" && (
              <Field
                label="考試範圍預設段次"
                hint="僅套用在含有科目、年級與段次結構的文章；登入學生會再自動帶入年級。"
              >
                <Select
                  value={pageDraft.exam_scope_default_section}
                  onChange={(e) => setPageDraft({ ...pageDraft, exam_scope_default_section: e.target.value })}
                >
                  <option value="">不預設段次</option>
                  <option value="一段">一段</option>
                  <option value="二段">二段</option>
                  <option value="三段">三段</option>
                </Select>
              </Field>
            )}
            <ImageField
              label="封面照片"
              hint="選填，顯示於文章專欄與頁首。"
              value={pageDraft.cover_image_url}
              alt={pageDraft.cover_image_alt}
              onChange={(url) => setPageDraft({ ...pageDraft, cover_image_url: url })}
            />
            <Field label="封面替代文字"><TextInput value={pageDraft.cover_image_alt} onChange={(e) => setPageDraft({ ...pageDraft, cover_image_alt: e.target.value })} placeholder="照片內容說明" /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="導覽名稱"><TextInput value={pageDraft.nav_label} onChange={(e) => setPageDraft({ ...pageDraft, nav_label: e.target.value })} /></Field>
              <Field label="排序"><TextInput type="number" value={pageDraft.sort_order} onChange={(e) => setPageDraft({ ...pageDraft, sort_order: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Toggle label="發布" checked={pageDraft.is_published} onChange={(value) => setPageDraft({ ...pageDraft, is_published: value })} />
              <Toggle label="顯示在導覽" checked={pageDraft.show_in_nav} onChange={(value) => setPageDraft({ ...pageDraft, show_in_nav: value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={createPage} className="btn btn-primary" disabled={savingPage}>
                <Save size={16} aria-hidden />
                {savingPage ? "儲存中…" : editingPageId
                  ? "儲存變更"
                  : pageDraft.page_kind === "article"
                    ? pageDraft.is_published ? "新增並上線" : "新增文章草稿"
                    : "新增頁面"}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {pages.length === 0 ? (
              <div className="card flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
                <FileText size={28} className="text-[var(--text-muted)]" aria-hidden />
                <p className="text-sm text-[var(--text-muted)]">尚未新增任何頁面，請填寫左側表單後按「新增頁面」。</p>
              </div>
            ) : pages.map((page) => (
              <div key={page.id} className="card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold">{page.title}</h3>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">/{page.slug} / {page.page_kind === "article" ? "文章" : "一般頁面"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {page.page_kind === "article" && page.is_published && (
                      <a
                        href={`/articles/${encodeURIComponent(page.slug)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-ghost"
                      >
                        <ArrowUpRight size={14} aria-hidden /> 查看文章
                      </a>
                    )}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => startEditPage(page)}>
                      <Pencil size={14} aria-hidden /> 編輯
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchPage(page, { is_published: !page.is_published }).catch((e) => displayError(e, "更新頁面失敗"))}>
                      {page.is_published ? "取消發布" : "發布"}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchPage(page, { show_in_nav: !page.show_in_nav }).catch((e) => displayError(e, "更新導覽失敗"))}>
                      {page.show_in_nav ? "移出導覽" : "放入導覽"}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void deletePage(page)}>
                      <Trash2 size={14} aria-hidden /> 刪除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          </div>
        </section>
      )}

      {tab === "links" && (
        <section key="links" className="tab-panel-transition min-w-0 space-y-6">
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="card min-w-0 space-y-4 p-5">
              <div>
                <h2 className="font-semibold">新增連結分類</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                  建立後可在下方分類樹調整順序，或把連結拖進分類。
                </p>
              </div>
              <Field label="分類名稱"><TextInput value={categoryDraft.title} onChange={(e) => setCategoryDraft({ ...categoryDraft, title: e.target.value })} /></Field>
              <Field label="說明"><TextInput value={categoryDraft.description} onChange={(e) => setCategoryDraft({ ...categoryDraft, description: e.target.value })} /></Field>
              <button type="button" onClick={createCategory} className="btn btn-primary" disabled={savingLinkTree}>
                <Plus size={16} aria-hidden /> 新增分類
              </button>
            </div>
            <div className="card min-w-0 space-y-4 p-5">
              <h2 className="font-semibold">{editingLinkId ? "編輯 Linktree 連結" : "新增 Linktree 連結"}</h2>
              <Field label="標題"><TextInput value={linkDraft.title} onChange={(e) => setLinkDraft({ ...linkDraft, title: e.target.value })} /></Field>
              <Field label="URL"><TextInput value={linkDraft.url} onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })} /></Field>
              <Field label="類別">
                <Select value={linkDraft.category_id} onChange={(e) => setLinkDraft({ ...linkDraft, category_id: e.target.value })}>
                  <option value="">不分類</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
                </Select>
              </Field>
              <Field label="說明"><TextInput value={linkDraft.description} onChange={(e) => setLinkDraft({ ...linkDraft, description: e.target.value })} /></Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="啟用時間">
                  <TextInput type="datetime-local" value={linkDraft.starts_at} onChange={(e) => setLinkDraft({ ...linkDraft, starts_at: e.target.value })} />
                </Field>
                <Field label="停用時間">
                  <TextInput type="datetime-local" value={linkDraft.ends_at} onChange={(e) => setLinkDraft({ ...linkDraft, ends_at: e.target.value })} />
                </Field>
              </div>
              <p className="-mt-2 text-xs leading-5 text-[var(--text-muted)]">
                時間使用此裝置的本機時區；留空代表不設定該時間。連結須手動啟用，且在排程時間範圍內才會公開顯示。
              </p>
              <Toggle label="手動啟用" checked={linkDraft.is_active} onChange={(value) => setLinkDraft({ ...linkDraft, is_active: value })} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={createLink} className="btn btn-primary" disabled={savingLinkTree}>
                  {editingLinkId ? <Save size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
                  {editingLinkId ? "儲存修改" : "新增連結"}
                </button>
                {editingLinkId && <button type="button" onClick={cancelEditLink} className="btn btn-ghost">取消編輯</button>}
              </div>
            </div>
          </div>

          <section className="space-y-3" aria-labelledby="public-link-tree-title">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="public-link-tree-title" className="font-semibold">連結分類樹</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                  拖曳排序或移入分類。鍵盤：Space 拿起／放下，方向鍵移動。
                </p>
              </div>
              {savingLinkTree && <span className="text-sm text-[var(--text-muted)]" role="status">儲存分類與排序中…</span>}
            </div>
            {categories.length === 0 && links.length === 0 ? (
              <div className="rounded-xl px-4 py-8 text-center text-sm text-[var(--text-muted)]" style={{ border: "1px dashed var(--border)" }}>
                先新增分類或連結，接著就能在這裡整理公開連結。
              </div>
            ) : (
              <DndContext
                sensors={linkSensors}
                collisionDetection={linkTreeCollisionDetection}
                onDragEnd={reorderLinkTree}
              >
                <SortableContext items={categories.map((category) => category.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {categories.map((category) => (
                      <SortablePublicLinkCategory
                        key={category.id}
                        category={category}
                        links={links.filter((link) => link.category_id === category.id)}
                        disabled={savingLinkTree}
                        onDelete={() => siteApi.deleteLinkCategory(category.id).then(load).catch((error) => displayError(error, "刪除類別失敗"))}
                        onEditLink={startEditLink}
                        onDeleteLink={(link) => void deleteLink(link)}
                        onToggleLink={(link) => patchLink(link, { is_active: !link.is_active }).catch((error) => displayError(error, "更新連結失敗"))}
                      />
                    ))}
                    <UnassignedPublicLinks
                      links={links.filter((link) => !link.category_id)}
                      disabled={savingLinkTree}
                      onEditLink={startEditLink}
                      onDeleteLink={(link) => void deleteLink(link)}
                      onToggleLink={(link) => patchLink(link, { is_active: !link.is_active }).catch((error) => displayError(error, "更新連結失敗"))}
                    />
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </section>
        </section>
      )}

      {tab === "officers" && (
        <OfficerAdminTab
          rosterTabs={rosterTabs}
          activeRosterTab={activeRosterTab}
          activeRosterTabId={activeRosterTabId}
          newRosterTabLabel={newRosterTabLabel}
          onNewRosterTabLabelChange={setNewRosterTabLabel}
          onSelectRosterTab={selectRosterTab}
          onAddRosterTab={addRosterTab}
          onDeleteRosterTab={deleteRosterTab}
          rosterText={rosterText}
          onRosterTextChange={setRosterText}
          rosterLines={rosterLines}
          rosterSummary={rosterSummary}
          getRosterMemberLabel={getRosterMemberLabel}
          setRosterMemberLabel={setRosterMemberLabel}
          rosterBusy={rosterBusy}
          onSaveRoster={saveOfficerRoster}
          candidates={candidates}
          profiles={profiles}
          officerDraft={officerDraft}
          onOfficerDraftChange={(patch) => setOfficerDraft((draft) => ({ ...draft, ...patch }))}
          onCreateOfficerProfile={createOfficerProfile}
          patchProfile={patchProfile}
          deleteOfficerProfile={(profile) => siteApi.deleteOfficerProfile(profile.id).then(load)}
          displayError={displayError}
        />
      )}

      {tab === "advanced" && (
        <section key="advanced" className="tab-panel-transition grid gap-4 lg:grid-cols-2">
          <div className="card space-y-4 p-5">
            <Field label="主題設定 JSON" hint="可放色彩、區塊開關、品牌設定等。">
              <TextArea rows={10} value={themeJson} onChange={(e) => setThemeJson(e.target.value)} />
            </Field>
            <Field label="首頁區塊 JSON" hint="保留彈性給之後擴充首頁區塊排序與內容。">
              <TextArea rows={10} value={blocksJson} onChange={(e) => setBlocksJson(e.target.value)} />
            </Field>
          </div>
          <div className="card space-y-4 p-5">
            <Field label="自訂 CSS">
              <TextArea rows={18} value={settings.custom_css ?? ""} onChange={(e) => setSettings({ ...settings, custom_css: e.target.value })} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SEO Title"><TextInput value={settings.seo_title ?? ""} onChange={(e) => setSettings({ ...settings, seo_title: e.target.value })} /></Field>
              <Field label="SEO Description"><TextInput value={settings.seo_description ?? ""} onChange={(e) => setSettings({ ...settings, seo_description: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveAdvanced} className="btn btn-primary"><Save size={16} aria-hidden /> 儲存進階設定</button>
              {(themeJsonDirty || blocksJsonDirty) && (
                <button type="button" className="btn btn-ghost" onClick={() => { setThemeJson(syncedJson.theme); setBlocksJson(syncedJson.blocks); }}>
                  還原 JSON
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
