"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FileText, Link as LinkIcon, Megaphone, Plus, Save, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { ApiError, siteApi } from "@/lib/api";
import type {
  PublicLinkCategoryOut,
  PublicLinkOut,
  PublicOfficerCandidateOut,
  PublicOfficerProfileOut,
  PublicSitePageOut,
  PublicSiteSettingsOut,
} from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

type Tab = "settings" | "pages" | "announcements" | "categories" | "links" | "officers";

const TABS: Array<{ key: Tab; label: string; icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }> }> = [
  { key: "settings", label: "基本設定", icon: Save },
  { key: "pages", label: "頁面", icon: FileText },
  { key: "announcements", label: "公開公告", icon: Megaphone },
  { key: "categories", label: "連結分類", icon: LinkIcon },
  { key: "links", label: "平台連結", icon: LinkIcon },
  { key: "officers", label: "幹部顯示", icon: UsersRound },
];

const EMPTY_PAGE = {
  slug: "",
  title: "",
  summary: "",
  body_md: "",
  page_kind: "standard",
  layout_config: {},
  content_blocks: {},
  cover_image_url: "",
  cover_image_alt: "",
  seo_title: "",
  seo_description: "",
  nav_label: "",
  nav_order: 0,
  sort_order: 0,
  show_in_nav: false,
  is_published: false,
};

type PageForm = typeof EMPTY_PAGE & { id?: string };

export default function AdminPublicSitePage() {
  const { can, isAdmin } = usePermissions();
  const allowed = isAdmin || can("site:manage") || can("admin:all");
  const [tab, setTab] = useState<Tab>("settings");
  const [settings, setSettings] = useState<PublicSiteSettingsOut | null>(null);
  const [pages, setPages] = useState<PublicSitePageOut[]>([]);
  const [categories, setCategories] = useState<PublicLinkCategoryOut[]>([]);
  const [links, setLinks] = useState<PublicLinkOut[]>([]);
  const [profiles, setProfiles] = useState<PublicOfficerProfileOut[]>([]);
  const [candidates, setCandidates] = useState<PublicOfficerCandidateOut[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, c, l, o, cand] = await Promise.all([
        siteApi.adminSettings(),
        siteApi.adminPages(),
        siteApi.adminLinkCategories(),
        siteApi.adminLinks(),
        siteApi.officerProfiles(),
        siteApi.officerCandidates(true),
      ]);
      setSettings(s);
      setPages(p);
      setCategories(c);
      setLinks(l);
      setProfiles(o);
      setCandidates(cand);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入公開網站設定失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (!allowed) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card p-8 text-center">
          <h1 className="text-xl font-semibold">需要公開網站管理權限</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--primary)]">Public Site CMS</p>
          <h1 className="text-2xl font-bold">公開網站設定</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            管理首頁、任意公開頁、公告入口、Linktree 分類與幹部公開資料。
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/" target="_blank" rel="noreferrer" className="btn btn-ghost">
            <Eye size={16} aria-hidden />
            預覽官網
          </a>
          <button type="button" onClick={load} className="btn btn-secondary">重新整理</button>
        </div>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="公開網站設定分頁">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`btn ${tab === item.key ? "btn-primary" : "btn-ghost"}`}>
              <Icon size={15} aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>

      {loading ? (
        <div className="card p-8 text-sm text-[var(--text-muted)]">載入中...</div>
      ) : (
        <>
          {tab === "settings" && settings && <SettingsPanel value={settings} onSaved={setSettings} />}
          {tab === "pages" && <PagesPanel pages={pages} onChanged={load} />}
          {tab === "announcements" && <AnnouncementPublicPanel />}
          {tab === "categories" && <CategoriesPanel categories={categories} onChanged={load} />}
          {tab === "links" && <LinksPanel links={links} categories={categories} onChanged={load} />}
          {tab === "officers" && (
            <OfficersPanel profiles={profiles} candidates={candidates} onChanged={load} />
          )}
        </>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

function asJson(text: string, fallback: Record<string, unknown> = {}) {
  try {
    return text.trim() ? JSON.parse(text) : fallback;
  } catch {
    throw new Error("JSON 格式不正確");
  }
}

function SettingsPanel({
  value,
  onSaved,
}: {
  value: PublicSiteSettingsOut;
  onSaved: (value: PublicSiteSettingsOut) => void;
}) {
  const [form, setForm] = useState(value);
  const save = async () => {
    try {
      const saved = await siteApi.updateSettings({
        ...form,
        theme_config: asJson(JSON.stringify(form.theme_config)),
        homepage_blocks: asJson(JSON.stringify(form.homepage_blocks)),
      });
      onSaved(saved);
      setForm(saved);
      toast.success("已儲存官網設定");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "儲存失敗");
    }
  };
  return (
    <section className="card space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="網站標題"><input className="input" value={form.site_title} onChange={(e) => setForm({ ...form, site_title: e.target.value })} /></Field>
        <Field label="SEO 標題"><input className="input" value={form.seo_title ?? ""} onChange={(e) => setForm({ ...form, seo_title: e.target.value })} /></Field>
        <Field label="Hero 標題"><input className="input" value={form.hero_title} onChange={(e) => setForm({ ...form, hero_title: e.target.value })} /></Field>
        <Field label="CTA 連結"><input className="input" value={form.cta_href} onChange={(e) => setForm({ ...form, cta_href: e.target.value })} /></Field>
        <Field label="CTA 文字"><input className="input" value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} /></Field>
        <Field label="Hero 圖片 URL"><input className="input" value={form.hero_image_url ?? ""} onChange={(e) => setForm({ ...form, hero_image_url: e.target.value })} /></Field>
      </div>
      <Field label="網站描述"><textarea className="input min-h-20" value={form.site_description ?? ""} onChange={(e) => setForm({ ...form, site_description: e.target.value })} /></Field>
      <Field label="Hero 副標"><textarea className="input min-h-20" value={form.hero_subtitle ?? ""} onChange={(e) => setForm({ ...form, hero_subtitle: e.target.value })} /></Field>
      <Field label="關於本會 Markdown"><textarea className="input min-h-40 font-mono" value={form.about_body_md} onChange={(e) => setForm({ ...form, about_body_md: e.target.value })} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="使命 Markdown"><textarea className="input min-h-32 font-mono" value={form.mission_md ?? ""} onChange={(e) => setForm({ ...form, mission_md: e.target.value })} /></Field>
        <Field label="沿革 Markdown"><textarea className="input min-h-32 font-mono" value={form.history_md ?? ""} onChange={(e) => setForm({ ...form, history_md: e.target.value })} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="首頁區塊 JSON"><textarea className="input min-h-32 font-mono" value={JSON.stringify(form.homepage_blocks, null, 2)} onChange={(e) => setForm({ ...form, homepage_blocks: asJson(e.target.value) })} /></Field>
        <Field label="主題設定 JSON"><textarea className="input min-h-32 font-mono" value={JSON.stringify(form.theme_config, null, 2)} onChange={(e) => setForm({ ...form, theme_config: asJson(e.target.value) })} /></Field>
      </div>
      <Field label="自訂 CSS（管理員專用）"><textarea className="input min-h-32 font-mono" value={form.custom_css ?? ""} onChange={(e) => setForm({ ...form, custom_css: e.target.value })} /></Field>
      <button type="button" onClick={save} className="btn btn-primary"><Save size={16} aria-hidden />儲存設定</button>
    </section>
  );
}

function PagesPanel({ pages, onChanged }: { pages: PublicSitePageOut[]; onChanged: () => void }) {
  const [form, setForm] = useState<PageForm>({ ...EMPTY_PAGE });
  const edit = (page: PublicSitePageOut) =>
    setForm({
      id: page.id,
      slug: page.slug,
      title: page.title,
      summary: page.summary ?? "",
      body_md: page.body_md,
      page_kind: page.page_kind,
      layout_config: page.layout_config,
      content_blocks: page.content_blocks,
      cover_image_url: page.cover_image_url ?? "",
      cover_image_alt: page.cover_image_alt ?? "",
      seo_title: page.seo_title ?? "",
      seo_description: page.seo_description ?? "",
      nav_label: page.nav_label ?? "",
      nav_order: page.nav_order,
      sort_order: page.sort_order,
      show_in_nav: page.show_in_nav,
      is_published: page.is_published,
    });
  const save = async () => {
    try {
      const body = {
        ...form,
        summary: form.summary || null,
        cover_image_url: form.cover_image_url || null,
        cover_image_alt: form.cover_image_alt || null,
        seo_title: form.seo_title || null,
        seo_description: form.seo_description || null,
        nav_label: form.nav_label || null,
      };
      if (form.id) await siteApi.updatePage(String(form.id), body);
      else await siteApi.createPage(body);
      toast.success("頁面已儲存");
      setForm({ ...EMPTY_PAGE });
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "儲存頁面失敗");
    }
  };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Slug"><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
          <Field label="標題"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="頁面類型"><input className="input" value={form.page_kind} onChange={(e) => setForm({ ...form, page_kind: e.target.value })} /></Field>
          <Field label="導覽文字"><input className="input" value={form.nav_label ?? ""} onChange={(e) => setForm({ ...form, nav_label: e.target.value })} /></Field>
        </div>
        <Field label="摘要"><textarea className="input min-h-20" value={form.summary ?? ""} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
        <Field label="內文 Markdown"><textarea className="input min-h-52 font-mono" value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="版面 JSON"><textarea className="input min-h-28 font-mono" value={JSON.stringify(form.layout_config, null, 2)} onChange={(e) => setForm({ ...form, layout_config: asJson(e.target.value) })} /></Field>
          <Field label="內容區塊 JSON"><textarea className="input min-h-28 font-mono" value={JSON.stringify(form.content_blocks, null, 2)} onChange={(e) => setForm({ ...form, content_blocks: asJson(e.target.value) })} /></Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.show_in_nav} onChange={(e) => setForm({ ...form, show_in_nav: e.target.checked })} />顯示於導覽</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />發布</label>
        </div>
        <button type="button" onClick={save} className="btn btn-primary"><Save size={16} aria-hidden />儲存頁面</button>
      </div>
      <aside className="space-y-3">
        <button type="button" onClick={() => setForm({ ...EMPTY_PAGE })} className="btn btn-secondary w-full"><Plus size={16} aria-hidden />新增頁面</button>
        {pages.map((page) => (
          <button key={page.id} type="button" onClick={() => edit(page)} className="card card-hover block w-full p-3 text-left">
            <span className="block font-medium">{page.title}</span>
            <span className="text-xs text-[var(--text-muted)]">/{page.slug} · {page.is_published ? "已發布" : "草稿"}</span>
          </button>
        ))}
      </aside>
    </section>
  );
}

function AnnouncementPublicPanel() {
  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-lg font-semibold">公開公告頁</h2>
      <p className="text-sm leading-7 text-[var(--text-secondary)]">
        對外公告已提供 `/news` 與 `/news/[id]`。細部管理權限已拆成
        `announcement:public_list`、`announcement:public_detail`、`announcement:public_layout`，
        可分別指派給負責列表、詳情頁與版面 SEO 的管理者。
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {["announcement:public_list", "announcement:public_detail", "announcement:public_layout"].map((code) => (
          <code key={code} className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs">{code}</code>
        ))}
      </div>
    </section>
  );
}

function CategoriesPanel({ categories, onChanged }: { categories: PublicLinkCategoryOut[]; onChanged: () => void }) {
  const [form, setForm] = useState({ slug: "", title: "", description: "", sort_order: 0, is_active: true });
  const save = async () => {
    await siteApi.createLinkCategory(form);
    toast.success("已新增分類");
    setForm({ slug: "", title: "", description: "", sort_order: 0, is_active: true });
    onChanged();
  };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="card space-y-4 p-5">
        <Field label="Slug"><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
        <Field label="分類名稱"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="描述"><textarea className="input min-h-20" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <button type="button" onClick={save} className="btn btn-primary"><Plus size={16} aria-hidden />新增分類</button>
      </div>
      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.id} className="card flex items-center justify-between gap-3 p-3">
            <div><p className="font-medium">{cat.title}</p><p className="text-xs text-[var(--text-muted)]">{cat.slug}</p></div>
            <button type="button" className="btn-sm btn-ghost" onClick={async () => { await siteApi.deleteLinkCategory(cat.id); onChanged(); }}><Trash2 size={14} aria-hidden /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function LinksPanel({ links, categories, onChanged }: { links: PublicLinkOut[]; categories: PublicLinkCategoryOut[]; onChanged: () => void }) {
  const [form, setForm] = useState({ title: "", url: "", description: "", category_id: "", icon_key: "", sort_order: 0, is_active: true });
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.title])), [categories]);
  const save = async () => {
    await siteApi.createLink({ ...form, category_id: form.category_id || null, description: form.description || null, icon_key: form.icon_key || null });
    toast.success("已新增連結");
    setForm({ title: "", url: "", description: "", category_id: "", icon_key: "", sort_order: 0, is_active: true });
    onChanged();
  };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <div className="card space-y-4 p-5">
        <Field label="標題"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="URL"><input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
        <Field label="分類"><select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">未分類</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
        <Field label="描述"><textarea className="input min-h-20" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <button type="button" onClick={save} className="btn btn-primary"><Plus size={16} aria-hidden />新增連結</button>
      </div>
      <div className="space-y-2">
        {links.map((link) => (
          <div key={link.id} className="card flex items-center justify-between gap-3 p-3">
            <div className="min-w-0"><p className="truncate font-medium">{link.title}</p><p className="truncate text-xs text-[var(--text-muted)]">{categoryName.get(link.category_id ?? "") ?? "未分類"} · {link.url}</p></div>
            <button type="button" className="btn-sm btn-ghost" onClick={async () => { await siteApi.deleteLink(link.id); onChanged(); }}><Trash2 size={14} aria-hidden /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function OfficersPanel({ profiles, candidates, onChanged }: { profiles: PublicOfficerProfileOut[]; candidates: PublicOfficerCandidateOut[]; onChanged: () => void }) {
  const [form, setForm] = useState({ user_position_id: "", display_name_override: "", title_override: "", bio: "", public_email: "", external_links: {}, sort_order: 0, is_featured: false, is_visible: true });
  const save = async () => {
    await siteApi.createOfficerProfile({ ...form, public_email: form.public_email || null, display_name_override: form.display_name_override || null, title_override: form.title_override || null, bio: form.bio || null });
    toast.success("已新增幹部公開設定");
    setForm({ user_position_id: "", display_name_override: "", title_override: "", bio: "", public_email: "", external_links: {}, sort_order: 0, is_featured: false, is_visible: true });
    onChanged();
  };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <div className="card space-y-4 p-5">
        <Field label="任期候選人"><select className="input" value={form.user_position_id} onChange={(e) => setForm({ ...form, user_position_id: e.target.value })}><option value="">選擇任期</option>{candidates.map((c) => <option key={c.user_position_id} value={c.user_position_id}>{c.display_name} · {c.org_name} / {c.position_name}{c.has_public_profile ? "（已設定）" : ""}</option>)}</select></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="公開姓名覆寫"><input className="input" value={form.display_name_override} onChange={(e) => setForm({ ...form, display_name_override: e.target.value })} /></Field>
          <Field label="公開職稱覆寫"><input className="input" value={form.title_override} onChange={(e) => setForm({ ...form, title_override: e.target.value })} /></Field>
        </div>
        <Field label="公開 Email"><input className="input" value={form.public_email} onChange={(e) => setForm({ ...form, public_email: e.target.value })} /></Field>
        <Field label="簡介"><textarea className="input min-h-24" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_featured} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} />首頁精選</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_visible} onChange={(e) => setForm({ ...form, is_visible: e.target.checked })} />公開顯示</label>
        </div>
        <button type="button" onClick={save} className="btn btn-primary"><Plus size={16} aria-hidden />新增公開設定</button>
      </div>
      <div className="space-y-2">
        {profiles.map((profile) => (
          <div key={profile.id} className="card flex items-center justify-between gap-3 p-3">
            <div><p className="font-medium">{profile.display_name_override || "使用任期姓名"}</p><p className="text-xs text-[var(--text-muted)]">{profile.is_visible ? "公開" : "隱藏"} · {profile.is_featured ? "首頁精選" : "一般"}</p></div>
            <button type="button" className="btn-sm btn-ghost" onClick={async () => { await siteApi.deleteOfficerProfile(profile.id); onChanged(); }}><Trash2 size={14} aria-hidden /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
