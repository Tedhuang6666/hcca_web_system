"use client";

import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Compass,
  Eye,
  EyeOff,
  FileText,
  Globe2,
  Link as LinkIcon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiError, siteApi } from "@/lib/api";
import { safeImageUrl } from "@/lib/config";
import {
  PUBLIC_NAV_GROUP_META,
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
  PublicSitePageOut,
  PublicSiteSettingsOut,
} from "@/lib/types";

type Tab = "settings" | "nav" | "pages" | "links" | "officers" | "advanced";

/** 後台導覽列分頁的群組顯示順序。 */
const NAV_GROUP_ORDER: PublicNavGroupId[] = ["primary", "info", "data", "participation"];

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
  { id: "settings", label: "基本設定", icon: <Save size={16} aria-hidden /> },
  { id: "nav", label: "導覽列", icon: <Compass size={16} aria-hidden /> },
  { id: "pages", label: "頁面內容", icon: <FileText size={16} aria-hidden /> },
  { id: "links", label: "平台連結", icon: <LinkIcon size={16} aria-hidden /> },
  { id: "officers", label: "幹部顯示", icon: <Users size={16} aria-hidden /> },
  { id: "advanced", label: "進階樣式", icon: <Eye size={16} aria-hidden /> },
];

function displayError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", ...props.style }}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-28 w-full rounded-lg px-3 py-2 text-sm leading-6 outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", ...props.style }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", ...props.style }}
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-secondary)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
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
  const [uploading, setUploading] = useState(false);
  const previewUrl = safeImageUrl(value);
  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const result = await siteApi.uploadImage(file);
      onChange(result.url);
      toast.success("圖片已上傳");
    } catch (error) {
      displayError(error, "圖片上傳失敗");
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_12rem] md:items-end">
      <Field label={label} hint={hint ?? "可貼上圖片網址，或點右側「上傳」直接從電腦選圖（JPEG/PNG/GIF/WebP，上限 20MB）。"}>
        <div className="flex gap-2">
          <TextInput value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… 或點右側上傳" />
          <label className={`btn btn-secondary shrink-0 ${uploading ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
            {uploading ? "上傳中…" : "上傳"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
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

function parseJsonObject(value: string, label: string) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必須是 JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export default function PublicSiteAdminPage() {
  const [tab, setTab] = useState<Tab>("settings");
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<PublicSiteSettingsOut>(emptySettings);
  const [pages, setPages] = useState<PublicSitePageOut[]>([]);
  const [categories, setCategories] = useState<PublicLinkCategoryOut[]>([]);
  const [links, setLinks] = useState<PublicLinkOut[]>([]);
  const [candidates, setCandidates] = useState<PublicOfficerCandidateOut[]>([]);
  const [profiles, setProfiles] = useState<PublicOfficerProfileOut[]>([]);
  const [themeJson, setThemeJson] = useState("{}");
  const [blocksJson, setBlocksJson] = useState("{}");
  const [navItems, setNavItems] = useState<ResolvedNavItem[]>([]);

  const [pageDraft, setPageDraft] = useState({
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
  });
  const [categoryDraft, setCategoryDraft] = useState({
    slug: "",
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
    sort_order: 0,
    is_active: true,
  });
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [officerDraft, setOfficerDraft] = useState({
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
      setSettings(nextSettings);
      setPages(nextPages);
      setCategories(nextCategories);
      setLinks(nextLinks);
      setCandidates(nextCandidates);
      setProfiles(nextProfiles);
      setThemeJson(JSON.stringify(nextSettings.theme_config ?? {}, null, 2));
      setBlocksJson(JSON.stringify(nextSettings.homepage_blocks ?? {}, null, 2));
      setNavItems(resolvePublicNav(nextSettings.theme_config));
    } catch (error) {
      displayError(error, "載入公開網站設定失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const candidateByUserPosition = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.user_position_id, candidate])),
    [candidates],
  );

  const saveSettings = async () => {
    try {
      const next = await siteApi.updateSettings({
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
        seo_title: settings.seo_title,
        seo_description: settings.seo_description,
      });
      setSettings(next);
      toast.success("公開網站設定已儲存");
    } catch (error) {
      displayError(error, "儲存設定失敗");
    }
  };

  const saveAdvanced = async () => {
    try {
      const next = await siteApi.updateSettings({
        theme_config: parseJsonObject(themeJson, "主題設定"),
        homepage_blocks: parseJsonObject(blocksJson, "首頁區塊"),
        custom_css: settings.custom_css,
      });
      setSettings(next);
      setThemeJson(JSON.stringify(next.theme_config ?? {}, null, 2));
      setBlocksJson(JSON.stringify(next.homepage_blocks ?? {}, null, 2));
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
      const next = await siteApi.updateSettings({ theme_config: nextTheme });
      setSettings(next);
      setNavItems(resolvePublicNav(next.theme_config));
      setThemeJson(JSON.stringify(next.theme_config ?? {}, null, 2));
      toast.success("導覽列設定已儲存");
    } catch (error) {
      displayError(error, "儲存導覽列失敗");
    }
  };

  const createPage = async () => {
    try {
      await siteApi.createPage({
        ...pageDraft,
        summary: pageDraft.summary || null,
        nav_label: pageDraft.nav_label || null,
        layout_config: {},
        content_blocks: {},
        cover_image_url: null,
        cover_image_alt: null,
        seo_title: null,
        seo_description: null,
      });
      toast.success("頁面已新增");
      setPageDraft({ slug: "", title: "", summary: "", body_md: "", page_kind: "standard", nav_label: "", nav_order: 0, sort_order: 0, show_in_nav: false, is_published: false });
      await load();
    } catch (error) {
      displayError(error, "新增頁面失敗");
    }
  };

  const createCategory = async () => {
    try {
      await siteApi.createLinkCategory({
        ...categoryDraft,
        description: categoryDraft.description || null,
      });
      toast.success("連結類別已新增");
      setCategoryDraft({ slug: "", title: "", description: "", sort_order: 0, is_active: true });
      await load();
    } catch (error) {
      displayError(error, "新增類別失敗");
    }
  };

  const createLink = async () => {
    try {
      const body = {
        ...linkDraft,
        description: linkDraft.description || null,
        category_id: linkDraft.category_id || null,
        icon_key: linkDraft.icon_key || null,
      };
      if (editingLinkId) {
        await siteApi.updateLink(editingLinkId, body);
        toast.success("連結已更新");
      } else {
        await siteApi.createLink(body);
        toast.success("連結已新增");
      }
      setEditingLinkId(null);
      setLinkDraft({ title: "", url: "", description: "", category_id: "", icon_key: "", sort_order: 0, is_active: true });
      await load();
    } catch (error) {
      displayError(error, editingLinkId ? "更新連結失敗" : "新增連結失敗");
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
      sort_order: link.sort_order,
      is_active: link.is_active,
    });
  };

  const cancelEditLink = () => {
    setEditingLinkId(null);
    setLinkDraft({ title: "", url: "", description: "", category_id: "", icon_key: "", sort_order: 0, is_active: true });
  };

  const deleteLink = async (link: PublicLinkOut) => {
    if (!window.confirm(`確定要刪除「${link.title}」嗎？此操作無法復原。`)) return;
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

  if (loading) {
    return <div className="py-20 text-center text-sm text-[var(--text-muted)]">載入公開網站設定...</div>;
  }

  const publishedPages = pages.filter((page) => page.is_published).length;
  const activeLinks = links.filter((link) => link.is_active).length;
  const visibleOfficers = profiles.filter((profile) => profile.is_visible).length;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-[var(--primary-text)]">
              <Globe2 size={15} aria-hidden />
              PUBLIC SITE CONTROL
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
              公開網站工作台
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              管理首頁內容、公開頁面、常用連結與幹部資料。發布前可先開啟官網確認實際呈現。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={load}
              className="btn btn-ghost min-h-11 px-4 text-sm"
            >
              <RefreshCw size={16} aria-hidden /> 同步資料
            </button>
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary min-h-11 px-4 text-sm font-semibold"
            >
              <Eye size={16} aria-hidden /> 預覽官網
              <ArrowUpRight size={15} aria-hidden />
            </a>
          </div>
        </div>
      </header>

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

      <nav className="module-tabs-scroll max-w-full overflow-x-auto" aria-label="公開網站設定分頁">
        <div className="module-tabs-list">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`module-tab-link cursor-pointer${tab === item.id ? " is-active" : ""}`}>
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        </div>
      </nav>

      {tab === "settings" && (
        <section key="settings" className="tab-panel-transition grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="card space-y-4 p-5">
            <Field label="網站標題"><TextInput value={settings.site_title} onChange={(e) => setSettings({ ...settings, site_title: e.target.value })} /></Field>
            <Field label="網站描述"><TextArea value={settings.site_description ?? ""} onChange={(e) => setSettings({ ...settings, site_description: e.target.value })} /></Field>
            <ImageField
              label="班聯會會徽"
              hint="會顯示在導覽列與首頁。可貼上圖片網址，或點「上傳」直接選圖（JPEG/PNG/GIF/WebP，上限 20MB）。"
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
              hint="顯示於首頁主視覺。可貼上圖片網址，或點「上傳」直接選圖。"
              value={settings.hero_image_url ?? ""}
              alt={settings.hero_image_alt ?? undefined}
              onChange={(url) => setSettings({ ...settings, hero_image_url: url })}
            />
            <Field label="封面圖替代文字"><TextInput value={settings.hero_image_alt ?? ""} onChange={(e) => setSettings({ ...settings, hero_image_alt: e.target.value })} /></Field>
            <button type="button" onClick={saveSettings} className="btn btn-primary"><Save size={16} aria-hidden /> 儲存基本設定</button>
          </div>
          <div className="card space-y-4 p-5">
            <Field label="關於標題"><TextInput value={settings.about_title} onChange={(e) => setSettings({ ...settings, about_title: e.target.value })} /></Field>
            <Field label="關於內文 Markdown"><TextArea rows={8} value={settings.about_body_md} onChange={(e) => setSettings({ ...settings, about_body_md: e.target.value })} /></Field>
            <Field label="使命 Markdown"><TextArea value={settings.mission_md ?? ""} onChange={(e) => setSettings({ ...settings, mission_md: e.target.value })} /></Field>
            <Field label="沿革 Markdown"><TextArea value={settings.history_md ?? ""} onChange={(e) => setSettings({ ...settings, history_md: e.target.value })} /></Field>
          </div>
        </section>
      )}

      {tab === "nav" && (
        <section key="nav" className="tab-panel-transition space-y-4">
          <div className="card space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">公開站導覽列</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
                  調整公開網站頂部導覽：開關顯示、上下排序、改寫顯示名稱。「主要導覽」會直接出現在頂列，其餘群組收進「所有公開服務」選單；標記「免登入」的服務未登入者也能直接使用。
                </p>
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
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                      {meta.hint}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const Icon = item.icon;
                    const def = PUBLIC_NAV_ITEMS.find((entry) => entry.key === item.key);
                    return (
                      <div
                        key={item.key}
                        className={`flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 ${item.hidden ? "opacity-55" : ""}`}
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                          <Icon size={17} aria-hidden />
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
                            {item.guestUsable && <span className="ml-2 font-medium text-[var(--primary)]">免登入可用</span>}
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
        <section key="pages" className="tab-panel-transition grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold">新增 CMS 頁面</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Slug"><TextInput value={pageDraft.slug} onChange={(e) => setPageDraft({ ...pageDraft, slug: e.target.value })} placeholder="history" /></Field>
              <Field label="頁面類別"><TextInput value={pageDraft.page_kind} onChange={(e) => setPageDraft({ ...pageDraft, page_kind: e.target.value })} placeholder="standard" /></Field>
            </div>
            <Field label="標題"><TextInput value={pageDraft.title} onChange={(e) => setPageDraft({ ...pageDraft, title: e.target.value })} /></Field>
            <Field label="摘要"><TextArea value={pageDraft.summary} onChange={(e) => setPageDraft({ ...pageDraft, summary: e.target.value })} /></Field>
            <Field label="內文 Markdown"><TextArea rows={8} value={pageDraft.body_md} onChange={(e) => setPageDraft({ ...pageDraft, body_md: e.target.value })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="導覽名稱"><TextInput value={pageDraft.nav_label} onChange={(e) => setPageDraft({ ...pageDraft, nav_label: e.target.value })} /></Field>
              <Field label="排序"><TextInput type="number" value={pageDraft.sort_order} onChange={(e) => setPageDraft({ ...pageDraft, sort_order: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Toggle label="發布" checked={pageDraft.is_published} onChange={(value) => setPageDraft({ ...pageDraft, is_published: value })} />
              <Toggle label="顯示在導覽" checked={pageDraft.show_in_nav} onChange={(value) => setPageDraft({ ...pageDraft, show_in_nav: value })} />
            </div>
            <button type="button" onClick={createPage} className="btn btn-primary"><Plus size={16} aria-hidden /> 新增頁面</button>
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
                    <p className="mt-1 text-xs text-[var(--text-muted)]">/{page.slug} / {page.page_kind}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchPage(page, { is_published: !page.is_published }).catch((e) => displayError(e, "更新頁面失敗"))}>
                      {page.is_published ? "取消發布" : "發布"}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchPage(page, { show_in_nav: !page.show_in_nav }).catch((e) => displayError(e, "更新導覽失敗"))}>
                      {page.show_in_nav ? "移出導覽" : "放入導覽"}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => siteApi.deletePage(page.id).then(load).catch((e) => displayError(e, "刪除頁面失敗"))}>
                      <Trash2 size={14} aria-hidden /> 刪除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "links" && (
        <section key="links" className="tab-panel-transition grid gap-4 lg:grid-cols-2">
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold">新增連結類別</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Slug"><TextInput value={categoryDraft.slug} onChange={(e) => setCategoryDraft({ ...categoryDraft, slug: e.target.value })} /></Field>
              <Field label="名稱"><TextInput value={categoryDraft.title} onChange={(e) => setCategoryDraft({ ...categoryDraft, title: e.target.value })} /></Field>
            </div>
            <Field label="說明"><TextInput value={categoryDraft.description} onChange={(e) => setCategoryDraft({ ...categoryDraft, description: e.target.value })} /></Field>
            <button type="button" onClick={createCategory} className="btn btn-primary"><Plus size={16} aria-hidden /> 新增類別</button>
            <div className="space-y-2">
              {categories.map((category) => (
                <div key={category.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                  <span className="text-sm">{category.title}</span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => siteApi.deleteLinkCategory(category.id).then(load).catch((e) => displayError(e, "刪除類別失敗"))}>刪除</button>
                </div>
              ))}
            </div>
          </div>
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold">{editingLinkId ? "編輯 Linktree 連結" : "新增 Linktree 連結"}</h2>
            <Field label="標題"><TextInput value={linkDraft.title} onChange={(e) => setLinkDraft({ ...linkDraft, title: e.target.value })} /></Field>
            <Field label="URL"><TextInput value={linkDraft.url} onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="類別">
                <Select value={linkDraft.category_id} onChange={(e) => setLinkDraft({ ...linkDraft, category_id: e.target.value })}>
                  <option value="">不分類</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
                </Select>
              </Field>
              <Field label="排序"><TextInput type="number" value={linkDraft.sort_order} onChange={(e) => setLinkDraft({ ...linkDraft, sort_order: Number(e.target.value) })} /></Field>
            </div>
            <Field label="說明"><TextInput value={linkDraft.description} onChange={(e) => setLinkDraft({ ...linkDraft, description: e.target.value })} /></Field>
            <Toggle label="啟用" checked={linkDraft.is_active} onChange={(value) => setLinkDraft({ ...linkDraft, is_active: value })} />
            <button type="button" onClick={createLink} className="btn btn-primary"><Plus size={16} aria-hidden /> 新增連結</button>
            <div className="space-y-2">
              {links.map((link) => (
                <div key={link.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                  <span className="min-w-0 text-sm"><span className="font-medium">{link.title}</span><span className="ml-2 text-[var(--text-muted)]">{link.category?.title ?? "未分類"}</span></span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchLink(link, { is_active: !link.is_active }).catch((e) => displayError(e, "更新連結失敗"))}>
                    {link.is_active ? "停用" : "啟用"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "officers" && (
        <section
          key="officers"
          className={`tab-panel-transition grid gap-4 ${profiles.length > 0 ? "lg:grid-cols-[0.9fr_1.1fr]" : ""}`}
        >
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold">幹部覆寫 / 隱藏設定</h2>
            <p className="text-xs text-[var(--text-muted)]">
              公開幹部頁會<strong>自動列出當屆所有幹部</strong>，不需逐一新增。只有在你想覆寫顯示名稱／稱謂／簡介、調整排序、設為首頁精選，或<strong>隱藏</strong>某位成員時，才需要在此建立設定。
            </p>
            <Field label="幹部候選人">
              <Select value={officerDraft.user_position_id} onChange={(e) => setOfficerDraft({ ...officerDraft, user_position_id: e.target.value })}>
                <option value="">請選擇</option>
                {candidates.map((candidate) => (
                  <option key={candidate.user_position_id} value={candidate.user_position_id}>
                    {candidate.display_name} / {candidate.org_name} / {candidate.position_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="公開姓名覆寫"><TextInput value={officerDraft.display_name_override} onChange={(e) => setOfficerDraft({ ...officerDraft, display_name_override: e.target.value })} /></Field>
              <Field label="公開稱謂覆寫"><TextInput value={officerDraft.title_override} onChange={(e) => setOfficerDraft({ ...officerDraft, title_override: e.target.value })} /></Field>
            </div>
            <Field label="公開簡介"><TextArea value={officerDraft.bio} onChange={(e) => setOfficerDraft({ ...officerDraft, bio: e.target.value })} /></Field>
            <Field label="公開 Email" hint="後端仍會檢查使用者 show_email，未允許時不會對外顯示。">
              <TextInput value={officerDraft.public_email} onChange={(e) => setOfficerDraft({ ...officerDraft, public_email: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Toggle label="顯示" checked={officerDraft.is_visible} onChange={(value) => setOfficerDraft({ ...officerDraft, is_visible: value })} />
              <Toggle label="首頁精選" checked={officerDraft.is_featured} onChange={(value) => setOfficerDraft({ ...officerDraft, is_featured: value })} />
            </div>
            <button type="button" onClick={createOfficerProfile} className="btn btn-primary"><Plus size={16} aria-hidden /> 新增公開幹部</button>
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
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => siteApi.deleteOfficerProfile(profile.id).then(load).catch((e) => displayError(e, "刪除幹部失敗"))}>刪除</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
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
            <Field label="自訂 CSS" hint="管理員可微調公開站視覺；請避免影響可讀性與 focus ring。">
              <TextArea rows={18} value={settings.custom_css ?? ""} onChange={(e) => setSettings({ ...settings, custom_css: e.target.value })} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SEO Title"><TextInput value={settings.seo_title ?? ""} onChange={(e) => setSettings({ ...settings, seo_title: e.target.value })} /></Field>
              <Field label="SEO Description"><TextInput value={settings.seo_description ?? ""} onChange={(e) => setSettings({ ...settings, seo_description: e.target.value })} /></Field>
            </div>
            <button type="button" onClick={saveAdvanced} className="btn btn-primary"><Save size={16} aria-hidden /> 儲存進階設定</button>
          </div>
        </section>
      )}
    </div>
  );
}
