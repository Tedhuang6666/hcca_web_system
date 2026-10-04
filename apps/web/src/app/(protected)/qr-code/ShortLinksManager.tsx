"use client";

import { Check, Copy, ExternalLink, Link2, LoaderCircle, Pencil, QrCode, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { shortLinksApi } from "@/lib/api/short-links";
import { BRANDING } from "@/lib/branding";
import type { ShortLinkOut } from "@/lib/types";

const PERMISSION = "qr_code:manage";

type FormValues = {
  slug: string;
  title: string;
  target_url: string;
};

type ActionFeedback = { kind: "error" | "success"; message: string };

const EMPTY_FORM: FormValues = { slug: "", title: "", target_url: "" };

function shortUrl(slug: string): string {
  return `https://${BRANDING.domain}/${slug}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function ShortLinksManager({
  onGenerateQr,
}: {
  onGenerateQr: (url: string) => void;
}) {
  const { can, isReady } = usePermissions();
  const canManage = can(PERMISSION);
  const [links, setLinks] = useState<ShortLinkOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShortLinkOut | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setLinks(await shortLinksApi.list());
    } catch (loadFailure) {
      setLoadError(errorMessage(loadFailure, "短網址載入失敗，請稍後重試。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isReady && canManage) void loadLinks();
  }, [canManage, isReady, loadLinks]);

  const beginEditing = (link: ShortLinkOut) => {
    setEditing(link);
    setForm({ slug: link.slug, title: link.title ?? "", target_url: link.target_url });
    setError("");
    setNotice("");
    document.getElementById("short-link-form-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const resetForm = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
  };

  const saveLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const values = {
        title: form.title.trim() || null,
        target_url: form.target_url.trim(),
      };
      if (editing) {
        const updated = await shortLinksApi.update(editing.id, values);
        setLinks((current) => current.map((link) => link.id === updated.id ? updated : link));
        setNotice("短網址設定已更新。");
      } else {
        const created = await shortLinksApi.create({ ...values, slug: form.slug.trim() });
        setLinks((current) => [created, ...current]);
        setNotice("短網址已建立，可以複製分享或製作 QR Code。");
      }
      resetForm();
    } catch (saveFailure) {
      setError(errorMessage(saveFailure, "儲存失敗，請檢查資料後重試。"));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (link: ShortLinkOut) => {
    setUpdatingId(link.id);
    setActionFeedback(null);
    try {
      const updated = await shortLinksApi.update(link.id, { is_active: !link.is_active });
      setLinks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setActionFeedback({
        kind: "success",
        message: updated.is_active
          ? "短網址已重新啟用。"
          : "短網址已停用，訪客將無法開啟。還能隨時重新啟用。",
      });
    } catch (updateFailure) {
      setActionFeedback({
        kind: "error",
        message: errorMessage(updateFailure, "狀態更新失敗，請稍後重試。"),
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const copyLink = async (slug: string) => {
    setActionFeedback(null);
    try {
      await navigator.clipboard.writeText(shortUrl(slug));
      setActionFeedback({ kind: "success", message: "短網址已複製。" });
    } catch {
      setActionFeedback({ kind: "error", message: "瀏覽器未允許複製，請選取短網址手動複製。" });
    }
  };

  if (!isReady) {
    return <main className="qr-tool-page" aria-busy="true"><div className="qr-tool-loading">讀取權限中…</div></main>;
  }

  if (!canManage) {
    return (
      <main className="qr-tool-page">
        <section className="qr-access-denied" aria-labelledby="short-links-access-title">
          <span className="qr-access-icon" aria-hidden="true"><Link2 size={22} /></span>
          <h2 id="short-links-access-title">沒有經營工具權限</h2>
          <p>這個工具只開放給被指派 <code>{PERMISSION}</code> 的職位。請洽系統管理員加入對應權限組。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="qr-tool-page short-links-page">
      <div className="qr-tool-shell short-links-shell">
        <section className="short-link-form-panel" aria-labelledby="short-link-form-title">
          <div className="short-links-section-heading">
            <div>
              <h2 id="short-link-form-title">{editing ? "編輯短網址" : "建立短網址"}</h2>
              <p>{editing ? "目的網址可以調整，建立後的短網址路徑會固定。" : "設定容易記住的路徑，分享時就不必貼上長網址。"}</p>
            </div>
            <span className="short-links-heading-icon" aria-hidden="true"><Link2 size={18} /></span>
          </div>

          <form onSubmit={saveLink} className="short-link-form">
            {editing ? (
              <div className="short-link-field">
                <span className="short-link-label">短網址路徑</span>
                <div className="short-link-fixed-url"><span>https://{BRANDING.domain}/</span><strong>{editing.slug}</strong></div>
                <small>路徑建立後固定，原有分享連結會持續有效。</small>
              </div>
            ) : (
              <label className="short-link-field" htmlFor="short-link-slug">
                <span className="short-link-label">自訂路徑</span>
                <span className="short-link-slug-input">
                  <span>https://{BRANDING.domain}/</span>
                  <input
                    id="short-link-slug"
                    value={form.slug}
                    onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                    maxLength={80}
                    autoCapitalize="off"
                    autoCorrect="off"
                    required
                    aria-describedby="short-link-slug-help"
                    placeholder="學生社群"
                  />
                </span>
                <small id="short-link-slug-help">支援中文、英文、數字、連字號與底線，最多 80 字。</small>
              </label>
            )}

            <label className="short-link-field" htmlFor="short-link-title">
              <span className="short-link-label">名稱 <small>選填</small></span>
              <input
                id="short-link-title"
                className="qr-textarea short-link-input"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                maxLength={120}
                placeholder="例如：學生社群入口"
              />
            </label>

            <label className="short-link-field short-link-target-field" htmlFor="short-link-target">
              <span className="short-link-label">導向網址</span>
              <input
                id="short-link-target"
                className="qr-textarea short-link-input"
                type="url"
                value={form.target_url}
                onChange={(event) => setForm((current) => ({ ...current, target_url: event.target.value }))}
                maxLength={2048}
                required
                placeholder="https://example.com/your-page"
              />
              <small>只接受 http 或 https 網址。</small>
            </label>

            {error && <p className="short-link-feedback is-error" role="alert">{error}</p>}
            {notice && <p className="short-link-feedback is-success" role="status"><Check size={15} aria-hidden="true" />{notice}</p>}

            <div className="short-link-form-actions">
              {editing && <button type="button" className="qr-button qr-button-secondary" onClick={resetForm}>取消編輯</button>}
              <button type="submit" className="qr-button qr-button-primary" disabled={saving}>
                {saving ? <LoaderCircle className="short-link-spinner" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                {saving ? "儲存中…" : editing ? "儲存變更" : "建立短網址"}
              </button>
            </div>
          </form>
        </section>

        <section className="short-links-list-section" aria-labelledby="short-links-list-title">
          <div className="short-links-list-heading">
            <div>
              <h2 id="short-links-list-title">已建立的短網址</h2>
              <p>停用的連結仍保留設定，重新啟用即可恢復導向。</p>
            </div>
            <span className="short-links-count">{links.length}</span>
          </div>

          {actionFeedback && (
            <p
              className={`short-link-feedback short-links-action-feedback is-${actionFeedback.kind}`}
              role={actionFeedback.kind === "error" ? "alert" : "status"}
            >
              {actionFeedback.kind === "success" && <Check size={15} aria-hidden="true" />}
              {actionFeedback.message}
            </p>
          )}

          {loadError && (
            <div className="short-links-load-error" role="alert">
              <span>{loadError}</span>
              <button type="button" className="qr-button qr-button-secondary" onClick={() => void loadLinks()}>
                <RotateCw size={15} aria-hidden="true" />重新載入
              </button>
            </div>
          )}
          {loading ? (
            <div className="short-links-loading" aria-busy="true" aria-label="載入短網址">
              <span /><span /><span />
            </div>
          ) : !loadError && links.length === 0 ? (
            <div className="short-links-empty">
              <Link2 size={24} aria-hidden="true" />
              <strong>還沒有短網址</strong>
              <span>先建立一個專屬路徑，之後就能直接從清單製作 QR Code。</span>
            </div>
          ) : (
            <ul className="short-links-list">
              {links.map((link) => (
                <li key={link.id}>
                  <article className={`short-link-item ${link.is_active ? "" : "is-inactive"}`}>
                    <div className="short-link-main">
                      <div className="short-link-name-row">
                        <h3>{link.title || link.slug}</h3>
                        <span className={`short-link-status ${link.is_active ? "is-active" : "is-paused"}`}>
                          {link.is_active ? "啟用中" : "已停用"}
                        </span>
                      </div>
                      <a className="short-link-url" href={shortUrl(link.slug)} target="_blank" rel="noreferrer">
                        {shortUrl(link.slug)} <ExternalLink size={13} aria-hidden="true" />
                      </a>
                      <p className="short-link-target"><span>導向</span>{link.target_url}</p>
                    </div>
                    <div className="short-link-actions" aria-label={`${link.title || link.slug} 的操作`}>
                      <button type="button" className="qr-button qr-button-secondary" onClick={() => void copyLink(link.slug)}>
                        <Copy size={15} aria-hidden="true" />複製
                      </button>
                      <button
                        type="button"
                        className="qr-button qr-button-secondary"
                        disabled={!link.is_active}
                        onClick={() => onGenerateQr(shortUrl(link.slug))}
                      >
                        <QrCode size={15} aria-hidden="true" />製作 QR Code
                      </button>
                      <button type="button" className="qr-button qr-button-secondary" onClick={() => beginEditing(link)}>
                        <Pencil size={15} aria-hidden="true" />編輯
                      </button>
                      <button
                        type="button"
                        className="qr-button qr-button-secondary"
                        disabled={updatingId !== null}
                        onClick={() => void toggleActive(link)}
                      >
                        {updatingId === link.id
                          ? <LoaderCircle className="short-link-spinner" size={15} aria-hidden="true" />
                          : link.is_active ? "停用" : "啟用"}
                      </button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
